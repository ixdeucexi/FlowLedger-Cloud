-- Household activity + member management.
-- Additive and rollback-safe: existing household sharing continues to work if this is not applied yet.

create schema if not exists extensions;
create extension if not exists "pgcrypto" with schema extensions;
set search_path = public, extensions;

create table if not exists public.household_activity (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  actor_name text,
  action text not null,
  entity_type text not null,
  entity_id text,
  entity_label text,
  created_at timestamptz not null default now()
);

create index if not exists household_activity_household_created_idx
  on public.household_activity(household_id, created_at desc);

alter table public.household_activity enable row level security;

drop policy if exists "household activity: members read" on public.household_activity;
create policy "household activity: members read"
on public.household_activity
for select
using (public.is_household_member(household_id));

create or replace function public.log_household_activity(
  p_household_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text default null,
  p_entity_label text default null,
  p_actor_user_id uuid default auth.uid()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_email text;
  actor_name text;
begin
  if p_household_id is null then
    return;
  end if;

  if auth.uid() is not null and not public.is_household_member(p_household_id) then
    return;
  end if;

  select u.email::text,
         coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email::text)
    into actor_email, actor_name
  from auth.users u
  where u.id = p_actor_user_id;

  insert into public.household_activity (
    household_id, actor_user_id, actor_email, actor_name,
    action, entity_type, entity_id, entity_label
  )
  values (
    p_household_id, p_actor_user_id, actor_email, actor_name,
    left(coalesce(p_action, 'updated'), 60),
    left(coalesce(p_entity_type, 'item'), 80),
    nullif(p_entity_id, ''),
    nullif(left(coalesce(p_entity_label, ''), 160), '')
  );
end;
$$;

create or replace function public.household_activity_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_row jsonb;
  target_household uuid;
  actor_id uuid;
  action_name text;
  item_id text;
  item_label text;
begin
  if tg_op = 'DELETE' then
    source_row := to_jsonb(old);
    action_name := 'deleted';
  elsif tg_op = 'INSERT' then
    source_row := to_jsonb(new);
    action_name := 'created';
  else
    source_row := to_jsonb(new);
    action_name := 'updated';
  end if;

  if nullif(source_row->>'household_id', '') is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  target_household := (source_row->>'household_id')::uuid;
  actor_id := coalesce(auth.uid(), nullif(source_row->>'user_id', '')::uuid);
  item_id := coalesce(source_row->>'id', source_row->>'bill_id', source_row->>'account_id', source_row->>'user_id');
  item_label := coalesce(
    source_row->>'name',
    nullif(source_row->>'note', ''),
    nullif(source_row->>'category', ''),
    initcap(replace(tg_table_name, '_', ' '))
  );

  if tg_table_name = 'monthly_overrides' then
    item_label := 'Monthly bill update';
  elsif tg_table_name = 'extra_payments' then
    item_label := 'Debt snowball payment';
  elsif tg_table_name = 'bill_date_moves' then
    item_label := 'Bill date move';
  elsif tg_table_name = 'account_balances' then
    item_label := 'Account balance';
  end if;

  perform public.log_household_activity(target_household, action_name, tg_table_name, item_id, item_label, actor_id);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  audit_table text;
begin
  foreach audit_table in array array[
    'bills',
    'monthly_overrides',
    'transactions',
    'incomes',
    'goals',
    'extra_payments',
    'categories',
    'accounts',
    'account_balances',
    'decisions',
    'bill_date_moves',
    'household_settings'
  ]
  loop
    if to_regclass('public.' || audit_table) is not null
       and exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name = audit_table
           and column_name = 'household_id'
       )
    then
      execute format('drop trigger if exists %I on public.%I', 'household_activity_audit_' || audit_table, audit_table);
      execute format(
        'create trigger %I after insert or update or delete on public.%I for each row execute function public.household_activity_audit_trigger()',
        'household_activity_audit_' || audit_table,
        audit_table
      );
    end if;
  end loop;
end $$;

create or replace function public.get_household_members(p_household_id uuid)
returns table (
  user_id uuid,
  role text,
  joined_at timestamptz,
  email text,
  display_name text,
  is_current_user boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'Only household members can view household members';
  end if;

  return query
    select hm.user_id,
           hm.role,
           hm.created_at,
           u.email::text,
           coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email::text) as display_name,
           hm.user_id = auth.uid() as is_current_user
    from public.household_members hm
    join auth.users u on u.id = hm.user_id
    where hm.household_id = p_household_id
    order by case hm.role when 'owner' then 0 when 'editor' then 1 else 2 end, hm.created_at;
end;
$$;

create or replace function public.update_household_member_role(
  p_household_id uuid,
  p_member_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_role text;
  member_label text;
begin
  if public.household_role(p_household_id) <> 'owner' then
    raise exception 'Only the household owner can update member access';
  end if;

  if coalesce(p_role, '') not in ('editor', 'viewer') then
    raise exception 'Invalid invite role';
  end if;

  select role into existing_role
  from public.household_members
  where household_id = p_household_id
    and user_id = p_member_user_id;

  if existing_role is null then
    raise exception 'Household member not found';
  end if;

  if existing_role = 'owner' then
    raise exception 'Owner access cannot be changed here';
  end if;

  update public.household_members
  set role = p_role
  where household_id = p_household_id
    and user_id = p_member_user_id;

  select coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email::text)
    into member_label
  from auth.users u
  where u.id = p_member_user_id;

  perform public.log_household_activity(p_household_id, 'changed_role', 'household_member', p_member_user_id::text, member_label, auth.uid());
end;
$$;

create or replace function public.remove_household_member(
  p_household_id uuid,
  p_member_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_role text;
  member_label text;
begin
  if public.household_role(p_household_id) <> 'owner' then
    raise exception 'Only the household owner can remove members';
  end if;

  if p_member_user_id = auth.uid() then
    raise exception 'The owner cannot remove themselves here';
  end if;

  select role into existing_role
  from public.household_members
  where household_id = p_household_id
    and user_id = p_member_user_id;

  if existing_role is null then
    raise exception 'Household member not found';
  end if;

  if existing_role = 'owner' then
    raise exception 'Owner access cannot be removed here';
  end if;

  select coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email::text)
    into member_label
  from auth.users u
  where u.id = p_member_user_id;

  delete from public.household_members
  where household_id = p_household_id
    and user_id = p_member_user_id;

  perform public.log_household_activity(p_household_id, 'removed', 'household_member', p_member_user_id::text, member_label, auth.uid());
end;
$$;

create or replace function public.create_household_invite(
  p_household_id uuid,
  p_role text default 'editor'
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  invite_code text;
begin
  if public.household_role(p_household_id) <> 'owner' then
    raise exception 'Only the household owner can create invites';
  end if;

  if coalesce(p_role, 'editor') not in ('editor', 'viewer') then
    raise exception 'Invalid invite role';
  end if;

  invite_code := upper(substr(encode(gen_random_bytes(9), 'hex'), 1, 12));

  insert into public.household_invites (household_id, code_hash, role, created_by)
  values (
    p_household_id,
    encode(digest(invite_code, 'sha256'), 'hex'),
    coalesce(p_role, 'editor'),
    auth.uid()
  );

  perform public.log_household_activity(p_household_id, 'invited', 'household_invite', null, initcap(coalesce(p_role, 'editor')) || ' invite', auth.uid());

  return invite_code;
end $$;

create or replace function public.accept_household_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  invite household_invites%rowtype;
  clean_code text;
  member_label text;
begin
  clean_code := upper(regexp_replace(coalesce(p_code, ''), '\s+', '', 'g'));
  if clean_code = '' then
    raise exception 'Invite code is required';
  end if;

  select *
    into invite
  from public.household_invites
  where code_hash = encode(digest(clean_code, 'sha256'), 'hex')
    and revoked_at is null
    and accepted_at is null
    and expires_at > now()
  limit 1;

  if invite.id is null then
    raise exception 'Invite code is invalid or expired';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (invite.household_id, auth.uid(), invite.role)
  on conflict (household_id, user_id) do update set role = excluded.role;

  update public.household_invites
    set accepted_by = auth.uid(), accepted_at = now()
  where id = invite.id;

  insert into public.user_preferences (user_id, active_household_id, updated_at)
  values (auth.uid(), invite.household_id, now())
  on conflict (user_id) do update
    set active_household_id = excluded.active_household_id,
        updated_at = now();

  select coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email::text)
    into member_label
  from auth.users u
  where u.id = auth.uid();

  perform public.log_household_activity(invite.household_id, 'joined', 'household_member', auth.uid()::text, member_label, auth.uid());

  return invite.household_id;
end $$;
