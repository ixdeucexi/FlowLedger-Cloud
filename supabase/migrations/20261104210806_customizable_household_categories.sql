-- Categories are now the complete household catalog, not a custom-label add-on.
-- Starter rows represent the same labels previously supplied by the client.
-- Seed once; later budgets must not resurrect labels a household removed.

insert into public.categories (user_id, household_id, budget_id, name)
select scope.created_by, scope.household_id, scope.budget_id, starter.name
from (
  select distinct on (household.id)
    household.id as household_id, household.created_by, budget.id as budget_id
  from public.households household
  join public.budgets budget on budget.household_id = household.id
  order by household.id, budget.is_default desc, budget.created_at, budget.id
) scope
cross join unnest(array[
  'Housing','Utilities','Insurance','Transportation','Food','Entertainment',
  'Health','Education','Savings','Debt','Shopping','Rent','Other'
]::text[]) starter(name)
on conflict do nothing;

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
    'Housing','Utilities','Insurance','Transportation','Food','Entertainment',
    'Health','Education','Savings','Debt','Shopping','Rent','Other'
  ]::text[]) starter(name)
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function private.seed_household_categories_on_first_budget() from public, anon, authenticated, service_role;
drop trigger if exists seed_household_categories_on_first_budget on public.budgets;
create trigger seed_household_categories_on_first_budget after insert on public.budgets
for each row execute function private.seed_household_categories_on_first_budget();

-- Only category labels are changed. Amounts, allocation IDs/types, settlement
-- data and audit snapshots remain unchanged. Called inside editor-checked RPCs.
create or replace function private.remap_category_allocation_labels(p_allocations jsonb, p_old_name text, p_new_name text)
returns jsonb language sql immutable security invoker set search_path = '' as $$
  select case when jsonb_typeof(p_allocations) = 'array' then
    coalesce((select jsonb_agg(
      case when lower(regexp_replace(btrim(coalesce(item.value->>'category','')), '\s+', ' ', 'g')) = lower(p_old_name)
        then jsonb_set(item.value, '{category}', to_jsonb(p_new_name), false)
        else item.value end order by item.ordinality)
      from jsonb_array_elements(p_allocations) with ordinality item(value, ordinality)), '[]'::jsonb)
    else p_allocations end
$$;
revoke all on function private.remap_category_allocation_labels(jsonb,text,text) from public, anon, authenticated, service_role;

create or replace function private.add_household_category(
  p_household_id uuid,
  p_budget_id uuid,
  p_name text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_name text := private.normalize_household_category_name(p_name);
  v_existing text;
begin
  v_actor := private.assert_active_category_editor(p_household_id, p_budget_id);
  if char_length(v_name) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'Category names must be between 1 and 80 characters';
  end if;

  if lower(v_name) in ('income', 'transfer') then
    raise exception using errcode = '22023', message = 'Income and Transfer are reserved money movement categories';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_household_id::text || ':categories', 0));

  select category.name into v_existing
  from public.categories category
  where category.household_id = p_household_id
    and lower(regexp_replace(btrim(category.name), '\s+', ' ', 'g')) = lower(v_name)
  for update;

  if v_existing is null then
    insert into public.categories (user_id, household_id, budget_id, name)
    values (v_actor, p_household_id, p_budget_id, v_name);
    v_existing := v_name;
  end if;

  return private.household_category_result(p_household_id, v_existing);
end;
$$;

create or replace function private.rename_household_category(
  p_household_id uuid,
  p_budget_id uuid,
  p_old_name text,
  p_new_name text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_old_name text := private.normalize_household_category_name(p_old_name);
  v_requested_name text := private.normalize_household_category_name(p_new_name);
  v_source public.categories%rowtype;
  v_target public.categories%rowtype;
  v_source_is_valid boolean := false;
  v_target_name text;
  v_bill_count integer := 0;
  v_transaction_count integer := 0;
  v_category_budget_count integer := 0;
begin
  v_actor := private.assert_active_category_editor(p_household_id, p_budget_id);
  if char_length(v_old_name) not between 1 and 80
     or char_length(v_requested_name) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'Category names must be between 1 and 80 characters';
  end if;
  if lower(v_old_name) = 'other' then
    raise exception using errcode = '22023', message = 'Other is the reserved fallback category';
  end if;
  if lower(v_old_name) in ('debt', 'savings', 'income', 'transfer') then
    raise exception using errcode = '22023', message = 'This system category is used by payments, goals, or money movement';
  end if;

  if lower(v_requested_name) in ('income', 'transfer') then
    raise exception using errcode = '22023', message = 'Income and Transfer are reserved money movement categories';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_household_id::text || ':categories', 0));
  lock table public.category_budgets, public.bills, public.transactions in share row exclusive mode;

  select category.* into v_source
  from public.categories category
  where category.household_id = p_household_id
    and lower(regexp_replace(btrim(category.name), '\s+', ' ', 'g')) = lower(v_old_name)
  for update;

  select category.* into v_target
  from public.categories category
  where category.household_id = p_household_id
    and lower(regexp_replace(btrim(category.name), '\s+', ' ', 'g')) = lower(v_requested_name)
  for update;

  if lower(v_old_name) = lower(v_requested_name) then
    return private.household_category_result(
      p_household_id,
      coalesce(v_source.name, v_target.name, v_requested_name)
    );
  end if;

  v_source_is_valid := v_source.id is not null
    or exists (
      select 1 from public.bills bill
      where bill.household_id = p_household_id
        and lower(regexp_replace(btrim(coalesce(bill.category, '')), '\s+', ' ', 'g')) = lower(v_old_name)
    )
    or exists (
      select 1 from public.transactions transaction_row
      where transaction_row.household_id = p_household_id
        and lower(regexp_replace(btrim(coalesce(transaction_row.category, '')), '\s+', ' ', 'g')) = lower(v_old_name)
    )
    or exists (
      select 1 from public.category_budgets category_budget
      where category_budget.household_id = p_household_id
        and lower(regexp_replace(btrim(category_budget.category), '\s+', ' ', 'g')) = lower(v_old_name)
    );

  if not v_source_is_valid and v_target.id is null then
    raise exception using errcode = 'P0002', message = 'The category no longer exists';
  end if;

  -- A committed rename whose response was lost reaches this branch on retry.
  v_target_name := coalesce(v_target.name, v_requested_name);

  if v_source.id is not null and v_target.id is null then
    update public.categories
    set name = v_requested_name
    where id = v_source.id;
    v_target_name := v_requested_name;
  elsif v_source.id is not null and v_target.id is not null and v_source.id <> v_target.id then
    delete from public.categories where id = v_source.id;
    v_target_name := v_target.name;
  elsif v_source.id is not null then
    v_target_name := v_source.name;
  elsif v_target.id is null then
    insert into public.categories (user_id, household_id, budget_id, name)
    values (v_actor, p_household_id, p_budget_id, v_requested_name);
    v_target_name := v_requested_name;
  end if;

  update public.bills bill
  set category = v_target_name
  where bill.household_id = p_household_id
    and lower(regexp_replace(btrim(coalesce(bill.category, '')), '\s+', ' ', 'g')) = lower(v_old_name);
  get diagnostics v_bill_count = row_count;

  update public.transactions transaction_row
  set category = case
        when lower(regexp_replace(btrim(coalesce(transaction_row.category, '')), '\s+', ' ', 'g')) = lower(v_old_name)
        then v_target_name else transaction_row.category end,
      review_allocations = private.remap_category_allocation_labels(transaction_row.review_allocations, v_old_name, v_target_name)
  where transaction_row.household_id = p_household_id
    and (
      lower(regexp_replace(btrim(coalesce(transaction_row.category, '')), '\s+', ' ', 'g')) = lower(v_old_name)
      or transaction_row.review_allocations is distinct from
        private.remap_category_allocation_labels(transaction_row.review_allocations, v_old_name, v_target_name)
    );
  get diagnostics v_transaction_count = row_count;

  v_category_budget_count := private.merge_household_category_budgets(
    p_household_id,
    v_old_name,
    v_target_name
  );

  return private.household_category_result(
    p_household_id,
    v_target_name,
    v_bill_count,
    v_transaction_count,
    v_category_budget_count
  );
end;
$$;

create or replace function private.delete_household_category(
  p_household_id uuid,
  p_budget_id uuid,
  p_name text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_name text := private.normalize_household_category_name(p_name);
  v_source public.categories%rowtype;
  v_bill_count integer := 0;
  v_transaction_count integer := 0;
  v_category_budget_count integer := 0;
begin
  v_actor := private.assert_active_category_editor(p_household_id, p_budget_id);
  if char_length(v_name) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'Category names must be between 1 and 80 characters';
  end if;
  if lower(v_name) = 'other' then
    raise exception using errcode = '22023', message = 'Other is the reserved fallback category';
  end if;
  if lower(v_name) in ('debt', 'savings', 'income', 'transfer') then
    raise exception using errcode = '22023', message = 'This system category is used by payments, goals, or money movement';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_household_id::text || ':categories', 0));
  lock table public.category_budgets, public.bills, public.transactions in share row exclusive mode;

  select category.* into v_source
  from public.categories category
  where category.household_id = p_household_id
    and lower(regexp_replace(btrim(category.name), '\s+', ' ', 'g')) = lower(v_name)
  for update;

  update public.bills bill
  set category = 'Other'
  where bill.household_id = p_household_id
    and lower(regexp_replace(btrim(coalesce(bill.category, '')), '\s+', ' ', 'g')) = lower(v_name);
  get diagnostics v_bill_count = row_count;

  update public.transactions transaction_row
  set category = case
        when lower(regexp_replace(btrim(coalesce(transaction_row.category, '')), '\s+', ' ', 'g')) = lower(v_name)
        then 'Other' else transaction_row.category end,
      review_allocations = private.remap_category_allocation_labels(transaction_row.review_allocations, v_name, 'Other')
  where transaction_row.household_id = p_household_id
    and (
      lower(regexp_replace(btrim(coalesce(transaction_row.category, '')), '\s+', ' ', 'g')) = lower(v_name)
      or transaction_row.review_allocations is distinct from
        private.remap_category_allocation_labels(transaction_row.review_allocations, v_name, 'Other')
    );
  get diagnostics v_transaction_count = row_count;

  v_category_budget_count := private.merge_household_category_budgets(
    p_household_id,
    v_name,
    'Other'
  );

  if v_source.id is not null then
    delete from public.categories where id = v_source.id;
  end if;

  return private.household_category_result(
    p_household_id,
    'Other',
    v_bill_count,
    v_transaction_count,
    v_category_budget_count
  );
end;
$$;


notify pgrst, 'reload schema';
