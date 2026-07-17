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
  resolved_actor_id uuid := coalesce(auth.uid(), p_actor_user_id);
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

  if auth.uid() is not null then
    resolved_actor_id := auth.uid();
  end if;

  if auth.uid() is not null
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

  insert into public.household_activity (
    household_id,
    actor_user_id,
    actor_email,
    actor_name,
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
    left(coalesce(p_action, 'updated'), 60),
    left(coalesce(p_entity_type, 'item'), 80),
    nullif(p_entity_id, ''),
    nullif(left(coalesce(p_entity_label, ''), 160), '')
  );
end;
$$;
