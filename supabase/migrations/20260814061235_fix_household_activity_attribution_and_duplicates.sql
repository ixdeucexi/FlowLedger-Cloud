alter table public.household_activity
  add column if not exists actor_verified boolean not null default false;

comment on column public.household_activity.actor_verified is
  'True only when the displayed actor came from the authenticated request, not a legacy row-owner fallback.';

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
  request_actor_id uuid := auth.uid();
  resolved_actor_id uuid := coalesce(auth.uid(), p_actor_user_id);
  normalized_action text := left(coalesce(p_action, 'updated'), 60);
  normalized_entity_type text := left(coalesce(p_entity_type, 'item'), 80);
  normalized_entity_id text := nullif(p_entity_id, '');
  normalized_entity_label text := nullif(left(coalesce(p_entity_label, ''), 160), '');
begin
  if p_household_id is null then
    return;
  end if;

  if not exists (
    select 1
    from public.households h
    where h.id = p_household_id
  ) then
    return;
  end if;

  if request_actor_id is not null then
    resolved_actor_id := request_actor_id;
  end if;

  if request_actor_id is not null
     and not public.is_household_member(p_household_id) then
    return;
  end if;

  select
    u.email::text,
    coalesce(
      u.raw_user_meta_data->>'full_name',
      u.raw_user_meta_data->>'name',
      u.email::text
    )
  into actor_email, actor_name
  from auth.users u
  where u.id = resolved_actor_id;

  -- A retried request or two triggers in one save should not create two
  -- identical member-facing history rows.
  if exists (
    select 1
    from public.household_activity a
    where a.household_id = p_household_id
      and a.actor_user_id is not distinct from resolved_actor_id
      and a.action = normalized_action
      and a.entity_type = normalized_entity_type
      and a.entity_id is not distinct from normalized_entity_id
      and a.entity_label is not distinct from normalized_entity_label
      and a.created_at >= clock_timestamp() - interval '10 seconds'
  ) then
    return;
  end if;

  insert into public.household_activity (
    household_id,
    actor_user_id,
    actor_email,
    actor_name,
    actor_verified,
    action,
    entity_type,
    entity_id,
    entity_label
  )
  values (
    p_household_id,
    resolved_actor_id,
    actor_email,
    actor_name,
    request_actor_id is not null and resolved_actor_id = request_actor_id,
    normalized_action,
    normalized_entity_type,
    normalized_entity_id,
    normalized_entity_label
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
  previous_row jsonb;
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
    previous_row := to_jsonb(old);
    action_name := 'updated';

    -- Timestamp/review heartbeats are maintenance, not household edits.
    if (
      source_row - array[
        'updated_at',
        'last_reviewed_at',
        'synced_at',
        'last_synced_at',
        'last_reconciled_at',
        'provider_updated_at'
      ]
    ) = (
      previous_row - array[
        'updated_at',
        'last_reviewed_at',
        'synced_at',
        'last_synced_at',
        'last_reconciled_at',
        'provider_updated_at'
      ]
    ) then
      return new;
    end if;
  end if;

  if nullif(source_row->>'household_id', '') is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  -- Never credit a background/service update to the user who originally
  -- created the row. Only an authenticated member can appear as the actor.
  actor_id := auth.uid();
  if actor_id is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  target_household := (source_row->>'household_id')::uuid;
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

  -- Creating an item can be followed by an initialization update in the
  -- same user action. Keep the creation as the single visible activity.
  if action_name = 'updated'
     and item_id is not null
     and exists (
       select 1
       from public.household_activity a
       where a.household_id = target_household
         and a.actor_user_id = actor_id
         and a.action = 'created'
         and a.entity_type = tg_table_name
         and a.entity_id = item_id
         and a.created_at >= clock_timestamp() - interval '2 minutes'
     ) then
    return new;
  end if;

  perform public.log_household_activity(
    target_household,
    action_name,
    tg_table_name,
    item_id,
    item_label,
    actor_id
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.log_household_activity(uuid, text, text, text, text, uuid) from public;
revoke execute on function public.log_household_activity(uuid, text, text, text, text, uuid) from anon;
revoke execute on function public.log_household_activity(uuid, text, text, text, text, uuid) from authenticated;
grant execute on function public.log_household_activity(uuid, text, text, text, text, uuid) to service_role;

revoke execute on function public.household_activity_audit_trigger() from public;
revoke execute on function public.household_activity_audit_trigger() from anon;
revoke execute on function public.household_activity_audit_trigger() from authenticated;
