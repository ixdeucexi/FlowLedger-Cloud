-- Household metadata only. Existing table policies and financial records stay unchanged.
create function private.rename_household(
  p_household_id uuid,
  p_name text,
  p_expected_name text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_current_name text;
  v_name text;
  -- Keep this list aligned with lib/householdNames.ts (Unicode whitespace).
  v_whitespace text := ' ' || chr(9) || chr(10) || chr(13) || chr(12) || chr(11)
    || chr(133) || chr(160) || chr(5760)
    || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197)
    || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202)
    || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279);
begin
  if v_actor is null then
    raise exception 'Sign in to rename a household.' using errcode = '42501';
  end if;
  if p_household_id is null then
    raise exception 'Choose a household first.' using errcode = '22023';
  end if;

  -- Same ordering as member exit: serialize scope, then lock current membership.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_household_id::text || ':shared-plan-owner', 0)
  );
  select member.role into v_role
  from public.household_members member
  where member.household_id = p_household_id and member.user_id = v_actor
  for update;
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'Only household owners or managers can rename this household.' using errcode = '42501';
  end if;

  v_name := pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.translate(p_name, v_whitespace, pg_catalog.repeat(' ', pg_catalog.char_length(v_whitespace))),
    ' +', ' ', 'g'
  ));
  if v_name is null or v_name = '' then
    raise exception 'Enter a household name.' using errcode = '22023';
  end if;
  if pg_catalog.char_length(v_name) > 80 then
    raise exception 'Use 80 characters or fewer.' using errcode = '22023';
  end if;
  if v_name ~ ('[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || ']') then
    raise exception 'Use letters, numbers, or symbols in the household name.' using errcode = '22023';
  end if;
  if p_expected_name is null then
    raise exception 'household_name_conflict' using errcode = '40001';
  end if;
  select household.name into v_current_name
  from public.households household
  where household.id = p_household_id
  for update;
  if not found then
    raise exception 'Choose a household first.' using errcode = '22023';
  end if;
  if v_current_name is distinct from p_expected_name and v_current_name is distinct from v_name then
    raise exception 'household_name_conflict' using errcode = '40001';
  end if;
  if v_current_name is distinct from v_name then
    update public.households set name = v_name where id = p_household_id;
  end if;
  return pg_catalog.jsonb_build_object('household_id', p_household_id, 'name', v_name);
end;
$$;

create function public.rename_household(p_household_id uuid, p_name text, p_expected_name text)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.rename_household(p_household_id, p_name, p_expected_name);
$$;

revoke all on function private.rename_household(uuid, text, text) from public, anon;
revoke all on function public.rename_household(uuid, text, text) from public, anon;
grant execute on function private.rename_household(uuid, text, text) to authenticated;
grant execute on function public.rename_household(uuid, text, text) to authenticated;
