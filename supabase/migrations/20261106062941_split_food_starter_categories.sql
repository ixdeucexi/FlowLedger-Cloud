-- New households start with separate grocery and restaurant categories.
-- Existing catalogs and financial records remain unchanged.

create or replace function private.seed_household_categories_on_first_budget()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_author uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.household_id::text || ':categories', 0));
  if exists(select 1 from public.categories where household_id = new.household_id) then
    return new;
  end if;
  select created_by into strict v_author from public.households where id = new.household_id;
  insert into public.categories (user_id, household_id, budget_id, name)
  select v_author, new.household_id, new.id, starter.name
  from unnest(array[
    'Housing','Utilities','Insurance','Transportation','Groceries','Restaurant','Entertainment',
    'Health','Education','Savings','Debt','Shopping','Rent','Other'
  ]::text[]) starter(name)
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function private.seed_household_categories_on_first_budget() from public, anon, authenticated, service_role;
