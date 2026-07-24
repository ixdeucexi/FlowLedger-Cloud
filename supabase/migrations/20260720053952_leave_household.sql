create or replace function public.leave_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  personal_household boolean;
begin
  if actor_id is null then
    raise exception 'Sign in before leaving a household.';
  end if;

  select hm.role, h.is_personal
  into actor_role, personal_household
  from public.household_members hm
  join public.households h on h.id = hm.household_id
  where hm.household_id = p_household_id
    and hm.user_id = actor_id;

  if actor_role is null then
    raise exception 'You are not a member of this household.';
  end if;

  if personal_household then
    raise exception 'You cannot leave your personal household.';
  end if;

  if actor_role = 'owner' then
    raise exception 'Transfer household ownership before leaving.';
  end if;

  delete from public.household_members
  where household_id = p_household_id
    and user_id = actor_id;

  update public.user_preferences
  set active_household_id = null,
      updated_at = now()
  where user_id = actor_id
    and active_household_id = p_household_id;

  insert into public.household_activity (
    household_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    entity_label
  ) values (
    p_household_id,
    actor_id,
    'left',
    'household_member',
    actor_id::text,
    actor_role
  );
end;
$$;

revoke execute on function public.leave_household(uuid) from public;
revoke execute on function public.leave_household(uuid) from anon;
grant execute on function public.leave_household(uuid) to authenticated;
