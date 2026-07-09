-- Household manager permissions.
-- Adds Manager between Owner and Can edit without changing existing money data.

set search_path = public, extensions;

create extension if not exists "pgcrypto" with schema extensions;

do $$
begin
  if to_regclass('public.household_members') is not null then
    if exists (
      select 1
      from pg_constraint
      where conrelid = 'public.household_members'::regclass
        and conname = 'household_members_role_check'
    ) then
      alter table public.household_members drop constraint household_members_role_check;
    end if;

    alter table public.household_members
      add constraint household_members_role_check
      check (role in ('owner','manager','editor','viewer'));
  end if;
end $$;

do $$
begin
  if to_regclass('public.household_invites') is not null then
    if exists (
      select 1
      from pg_constraint
      where conrelid = 'public.household_invites'::regclass
        and conname = 'household_invites_role_check'
    ) then
      alter table public.household_invites drop constraint household_invites_role_check;
    end if;

    alter table public.household_invites
      add constraint household_invites_role_check
      check (role in ('manager','editor','viewer'));
  end if;
end $$;

create or replace function public.is_household_manager(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
      and hm.role in ('owner', 'manager')
  )
$$;

create or replace function public.is_household_editor(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
      and hm.role in ('owner', 'manager', 'editor')
  )
$$;

create or replace function public.get_household_members(p_household_id uuid)
returns table (
  user_id uuid,
  role text,
  joined_at timestamptz,
  email text,
  display_name text,
  is_current_user boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    hm.user_id,
    hm.role,
    hm.created_at as joined_at,
    coalesce(nullif(u.email, ''), null) as email,
    coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), nullif(u.raw_user_meta_data->>'name', ''), nullif(u.email, ''), null) as display_name,
    hm.user_id = auth.uid() as is_current_user
  from public.household_members hm
  left join auth.users u on u.id = hm.user_id
  where hm.household_id = p_household_id
    and public.is_household_member(p_household_id)
  order by
    case hm.role
      when 'owner' then 0
      when 'manager' then 1
      when 'editor' then 2
      else 3
    end,
    hm.created_at asc
$$;

create or replace function public.update_household_member_role(p_household_id uuid, p_member_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  target_role text;
begin
  actor_role := public.household_role(p_household_id);

  if actor_role not in ('owner', 'manager') then
    raise exception 'Only household owners or managers can update member access.';
  end if;

  if p_role not in ('manager', 'editor', 'viewer') then
    raise exception 'Invalid invite role.';
  end if;

  select role into target_role
  from public.household_members
  where household_id = p_household_id
    and user_id = p_member_user_id;

  if target_role is null then
    raise exception 'Household member not found.';
  end if;

  if p_member_user_id = auth.uid() then
    raise exception 'You cannot change your own household access.';
  end if;

  if target_role = 'owner' then
    raise exception 'The household owner role cannot be changed.';
  end if;

  if actor_role = 'manager' and (target_role = 'manager' or p_role = 'manager') then
    raise exception 'Only the household owner can manage managers.';
  end if;

  update public.household_members
  set role = p_role
  where household_id = p_household_id
    and user_id = p_member_user_id;

  insert into public.household_activity (household_id, actor_user_id, action, entity_type, entity_id, entity_label)
  values (p_household_id, auth.uid(), 'changed_role', 'household_member', p_member_user_id::text, p_role);
end
$$;

create or replace function public.remove_household_member(p_household_id uuid, p_member_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  target_role text;
begin
  actor_role := public.household_role(p_household_id);

  if actor_role not in ('owner', 'manager') then
    raise exception 'Only household owners or managers can remove members.';
  end if;

  select role into target_role
  from public.household_members
  where household_id = p_household_id
    and user_id = p_member_user_id;

  if target_role is null then
    raise exception 'Household member not found.';
  end if;

  if p_member_user_id = auth.uid() then
    raise exception 'You cannot remove yourself from the household.';
  end if;

  if target_role = 'owner' then
    raise exception 'The household owner cannot be removed.';
  end if;

  if actor_role = 'manager' and target_role = 'manager' then
    raise exception 'Only the household owner can remove managers.';
  end if;

  delete from public.household_members
  where household_id = p_household_id
    and user_id = p_member_user_id;

  insert into public.household_activity (household_id, actor_user_id, action, entity_type, entity_id, entity_label)
  values (p_household_id, auth.uid(), 'removed', 'household_member', p_member_user_id::text, coalesce(target_role, 'member'));
end
$$;

create or replace function public.create_household_invite(p_household_id uuid, p_role text default 'editor')
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  actor_role text;
  invite_code text;
begin
  actor_role := public.household_role(p_household_id);

  if actor_role not in ('owner', 'manager') then
    raise exception 'Only household owners or managers can create invite codes.';
  end if;

  if p_role not in ('manager', 'editor', 'viewer') then
    raise exception 'Invalid invite role.';
  end if;

  if actor_role = 'manager' and p_role = 'manager' then
    raise exception 'Only the household owner can invite managers.';
  end if;

  invite_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));

  insert into public.household_invites (household_id, created_by, role, code_hash)
  values (p_household_id, auth.uid(), p_role, encode(digest(invite_code, 'sha256'), 'hex'));

  insert into public.household_activity (household_id, actor_user_id, action, entity_type, entity_label)
  values (p_household_id, auth.uid(), 'invited', 'household_invite', p_role);

  return invite_code;
end
$$;

drop policy if exists "Household invites can be read by owner" on public.household_invites;
drop policy if exists "Household invites can be read by managers" on public.household_invites;

create policy "Household invites can be read by managers"
  on public.household_invites
  for select
  to authenticated
  using (public.is_household_manager(household_id));
