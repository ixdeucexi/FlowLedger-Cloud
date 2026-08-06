alter table public.user_preferences
  add column if not exists notification_center_states jsonb not null default '{}'::jsonb;

create or replace function public.save_notification_center_state(
  p_household_id uuid,
  p_state jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_household_id is null or p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'A household and notification state object are required';
  end if;

  if pg_column_size(p_state) > 65536 then
    raise exception 'Notification state is too large';
  end if;

  insert into public.user_preferences (user_id, notification_center_states, updated_at)
  values (
    auth.uid(),
    jsonb_build_object(p_household_id::text, p_state),
    now()
  )
  on conflict (user_id) do update
  set notification_center_states = coalesce(public.user_preferences.notification_center_states, '{}'::jsonb)
    || excluded.notification_center_states,
      updated_at = now()
  where public.user_preferences.user_id = auth.uid();
end;
$$;

revoke all on function public.save_notification_center_state(uuid, jsonb) from public;
grant execute on function public.save_notification_center_state(uuid, jsonb) to authenticated;
