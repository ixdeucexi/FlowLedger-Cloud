-- Every household needs settings so timezone-aware Pro automation can run.
insert into public.household_settings (household_id, budget_id)
select household.id, budget.id
from public.households as household
left join lateral (
  select candidate.id
  from public.budgets as candidate
  where candidate.household_id = household.id
  order by candidate.is_default desc, candidate.created_at, candidate.id
  limit 1
) as budget on true
on conflict (household_id) do nothing;
create or replace function private.ensure_household_settings_for_budget()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.household_settings (household_id, budget_id)
  values (new.household_id, new.id)
  on conflict (household_id) do update
  set budget_id = coalesce(public.household_settings.budget_id, excluded.budget_id);

  return new;
end;
$function$;
revoke all on function private.ensure_household_settings_for_budget()
  from public, anon, authenticated;
drop trigger if exists ensure_household_settings_for_budget on public.budgets;
create trigger ensure_household_settings_for_budget
after insert on public.budgets
for each row execute function private.ensure_household_settings_for_budget();
