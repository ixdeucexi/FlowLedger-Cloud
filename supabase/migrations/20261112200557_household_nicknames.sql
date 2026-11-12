-- Private display names belong to a member, not to the shared financial plan.
create function private.canonical_household_nickname(p_value text)
returns text language sql immutable security invoker set search_path = ''
as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.translate(p_value,
    ' ' || chr(9) || chr(10) || chr(13) || chr(12) || chr(11) || chr(133) || chr(160) || chr(5760)
      || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197)
      || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202)
      || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279),
    pg_catalog.repeat(' ', 26)), ' +', ' ', 'g'));
$$;
revoke all on function private.canonical_household_nickname(text) from public, anon;
grant execute on function private.canonical_household_nickname(text) to authenticated;

create table public.household_nicknames (
  user_id uuid not null,
  household_id uuid not null,
  nickname text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, household_id),
  constraint household_nicknames_current_member_fkey foreign key (household_id,user_id)
    references public.household_members(household_id,user_id) on delete cascade,
  constraint household_nicknames_length check (char_length(nickname) between 1 and 80),
  constraint household_nicknames_canonical check (nickname = private.canonical_household_nickname(nickname)),
  constraint household_nicknames_no_controls check (nickname !~ ('[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || ']'))
);
create index household_nicknames_member_idx on public.household_nicknames(household_id,user_id);
alter table public.household_nicknames enable row level security;
revoke all on table public.household_nicknames from public, anon, authenticated;
grant select,insert,update,delete on table public.household_nicknames to authenticated;

create policy "Own household nickname" on public.household_nicknames
for all to authenticated
using (user_id = (select auth.uid()) and exists (
  select 1 from public.household_members member
  where member.household_id = household_nicknames.household_id and member.user_id = (select auth.uid())
))
with check (user_id = (select auth.uid()) and exists (
  select 1 from public.household_members member
  where member.household_id = household_nicknames.household_id and member.user_id = (select auth.uid())
));

create function public.save_household_nickname(p_household_id uuid,p_nickname text,p_expected_nickname text)
returns jsonb language plpgsql volatile security invoker set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_name text;
  v_current text;
  v_saved text;
begin
  if v_actor is null then raise exception 'Sign in to save a household nickname.' using errcode='42501'; end if;
  if p_household_id is null or not exists(select 1 from public.household_members where household_id=p_household_id and user_id=v_actor) then
    raise exception 'Current household membership required.' using errcode='42501';
  end if;
  v_name := private.canonical_household_nickname(p_nickname);
  if p_nickname is not null and (v_name is null or char_length(v_name) not between 1 and 80
    or v_name ~ ('[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || ']')) then
    raise exception 'Use a nickname of 1 to 80 characters without control characters.' using errcode='22023';
  end if;
  -- Only this user's label is serialized. No locks or updates on member roles.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text || ':' || p_household_id::text || ':nickname',0));
  select nickname into v_current from public.household_nicknames
  where user_id=v_actor and household_id=p_household_id for update;
  if v_current is distinct from p_expected_nickname and v_current is distinct from v_name then
    raise exception 'household_nickname_conflict' using errcode='40001';
  end if;
  if v_name is null then
    delete from public.household_nicknames where user_id=v_actor and household_id=p_household_id
      and nickname is not distinct from p_expected_nickname;
    -- A direct own-row INSERT can commit after the absent pre-read. Do not
    -- acknowledge a clear unless the row is actually absent after DELETE.
    if exists(select 1 from public.household_nicknames where user_id=v_actor and household_id=p_household_id) then
      raise exception 'household_nickname_conflict' using errcode='40001';
    end if;
  else
    insert into public.household_nicknames(user_id,household_id,nickname)
    values(v_actor,p_household_id,v_name)
    on conflict(user_id,household_id) do update set nickname=excluded.nickname,updated_at=now()
      where household_nicknames.nickname is not distinct from p_expected_nickname or household_nicknames.nickname=v_name
    returning nickname into v_saved;
    if not found or v_saved is distinct from v_name then raise exception 'household_nickname_conflict' using errcode='40001'; end if;
  end if;
  if not exists(select 1 from public.household_members where household_id=p_household_id and user_id=v_actor) then
    raise exception 'Current household membership required.' using errcode='42501';
  end if;
  return pg_catalog.jsonb_build_object('user_id',v_actor,'household_id',p_household_id,'nickname',v_name);
end;
$$;
revoke all on function public.save_household_nickname(uuid,text,text) from public,anon;
grant execute on function public.save_household_nickname(uuid,text,text) to authenticated;
