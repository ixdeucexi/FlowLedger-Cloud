alter table public.user_preferences
  add column if not exists dashboard_layouts jsonb not null default '{}'::jsonb;

create or replace function public.save_dashboard_layout(
  p_household_id uuid,
  p_layout jsonb
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

  if p_household_id is null or p_layout is null or jsonb_typeof(p_layout) <> 'object' then
    raise exception 'A household and dashboard layout object are required';
  end if;

  if pg_column_size(p_layout) > 16384 then
    raise exception 'Dashboard layout is too large';
  end if;

  insert into public.user_preferences (user_id, dashboard_layouts, updated_at)
  values (
    auth.uid(),
    jsonb_build_object(p_household_id::text, p_layout),
    now()
  )
  on conflict (user_id) do update
  set dashboard_layouts = coalesce(public.user_preferences.dashboard_layouts, '{}'::jsonb)
    || excluded.dashboard_layouts,
      updated_at = now()
  where public.user_preferences.user_id = auth.uid();
end;
$$;

revoke all on function public.save_dashboard_layout(uuid, jsonb) from public;
grant execute on function public.save_dashboard_layout(uuid, jsonb) to authenticated;
