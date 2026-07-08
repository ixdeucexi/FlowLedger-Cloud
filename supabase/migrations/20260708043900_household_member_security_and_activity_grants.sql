-- Household member management hardening.
-- Keeps the existing household UI working while limiting callable household RPCs
-- to signed-in users and exposing activity history only through RLS.

set search_path = public, extensions;

alter table if exists public.household_activity enable row level security;

grant select on public.household_activity to authenticated;
revoke all on public.household_activity from anon;

drop policy if exists "household activity: members read" on public.household_activity;
create policy "household activity: members read"
on public.household_activity
for select
to authenticated
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
  resolved_actor_id uuid := coalesce(auth.uid(), p_actor_user_id);
begin
  if p_household_id is null then
    return;
  end if;

  -- Direct client calls cannot spoof another actor. Trigger/function calls keep
  -- their passed actor only when auth.uid() is unavailable.
  if auth.uid() is not null then
    resolved_actor_id := auth.uid();
  end if;

  if auth.uid() is not null and not public.is_household_member(p_household_id) then
    return;
  end if;

  select u.email::text,
         coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email::text)
    into actor_email, actor_name
  from auth.users u
  where u.id = resolved_actor_id;

  insert into public.household_activity (
    household_id, actor_user_id, actor_email, actor_name,
    action, entity_type, entity_id, entity_label
  )
  values (
    p_household_id, resolved_actor_id, actor_email, actor_name,
    left(coalesce(p_action, 'updated'), 60),
    left(coalesce(p_entity_type, 'item'), 80),
    nullif(p_entity_id, ''),
    nullif(left(coalesce(p_entity_label, ''), 160), '')
  );
end;
$$;

revoke execute on function public.log_household_activity(uuid, text, text, text, text, uuid) from public;
revoke execute on function public.log_household_activity(uuid, text, text, text, text, uuid) from anon;

revoke execute on function public.get_household_members(uuid) from public;
revoke execute on function public.get_household_members(uuid) from anon;
grant execute on function public.get_household_members(uuid) to authenticated;

revoke execute on function public.update_household_member_role(uuid, uuid, text) from public;
revoke execute on function public.update_household_member_role(uuid, uuid, text) from anon;
grant execute on function public.update_household_member_role(uuid, uuid, text) to authenticated;

revoke execute on function public.remove_household_member(uuid, uuid) from public;
revoke execute on function public.remove_household_member(uuid, uuid) from anon;
grant execute on function public.remove_household_member(uuid, uuid) to authenticated;

revoke execute on function public.create_household_invite(uuid, text) from public;
revoke execute on function public.create_household_invite(uuid, text) from anon;
grant execute on function public.create_household_invite(uuid, text) to authenticated;

revoke execute on function public.accept_household_invite(text) from public;
revoke execute on function public.accept_household_invite(text) from anon;
grant execute on function public.accept_household_invite(text) to authenticated;
