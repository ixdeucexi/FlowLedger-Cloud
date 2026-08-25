-- Make categories household-owned and route every category mutation through a
-- household-scoped database transaction. This prevents a creator who belongs
-- to multiple households from moving, renaming, or deleting another
-- household's same-named category, and keeps category references atomic.

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

do $$
begin
  if exists (
    select 1
    from public.categories category
    left join public.budgets budget on budget.id = category.budget_id
    where category.household_id is null
       or category.budget_id is null
       or budget.id is null
       or budget.household_id is distinct from category.household_id
  ) then
    raise exception 'category scope preflight failed';
  end if;

  if exists (
    select 1
    from public.categories category
    where category.name is distinct from regexp_replace(btrim(category.name), '\s+', ' ', 'g')
       or char_length(category.name) not between 1 and 80
       or (lower(category.name) = 'other' and category.name <> 'Other')
  ) then
    raise exception 'category name preflight failed';
  end if;

  if exists (
    select 1
    from public.categories category
    group by category.household_id, lower(regexp_replace(btrim(category.name), '\s+', ' ', 'g'))
    having count(*) > 1
  ) then
    raise exception 'duplicate household category names must be repaired before migration';
  end if;
end;
$$;

alter table public.categories
  add column if not exists id uuid default gen_random_uuid();

update public.categories set id = gen_random_uuid() where id is null;

alter table public.categories alter column id set default gen_random_uuid();
alter table public.categories alter column id set not null;
alter table public.categories alter column household_id set not null;

alter table public.categories drop constraint if exists categories_pkey;
alter table public.categories add constraint categories_pkey primary key (id);

alter table public.categories drop constraint if exists categories_household_id_fkey;
alter table public.categories
  add constraint categories_household_id_fkey
  foreign key (household_id) references public.households(id) on delete cascade;

alter table public.categories drop constraint if exists categories_name_is_normalized;
alter table public.categories
  add constraint categories_name_is_normalized check (
    char_length(name) between 1 and 80
    and name = regexp_replace(btrim(name), '\s+', ' ', 'g')
    and (lower(name) <> 'other' or name = 'Other')
  );

create unique index if not exists categories_household_normalized_name_key
  on public.categories (
    household_id,
    lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
  );

create index if not exists categories_user_id_idx on public.categories (user_id);

-- Authenticated clients may read the household category list, but cannot
-- bypass the atomic functions with direct table writes. Service workflows
-- retain their existing elevated access.
revoke insert, update, delete on table public.categories from public, anon, authenticated;

create or replace function private.normalize_household_category_name(p_name text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')) = 'housing' then 'Housing'
    when lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')) = 'utilities' then 'Utilities'
    when lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')) = 'insurance' then 'Insurance'
    when lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')) = 'transportation' then 'Transportation'
    when lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')) = 'food' then 'Food'
    when lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')) = 'entertainment' then 'Entertainment'
    when lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')) = 'health' then 'Health'
    when lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')) = 'education' then 'Education'
    when lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')) = 'savings' then 'Savings'
    when lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')) = 'debt' then 'Debt'
    when lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')) = 'shopping' then 'Shopping'
    when lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')) = 'rent' then 'Rent'
    when lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')) = 'other' then 'Other'
    else regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')
  end
$$;

create or replace function private.is_builtin_household_category_name(p_name text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select lower(private.normalize_household_category_name(p_name)) = any (array[
    'housing', 'utilities', 'insurance', 'transportation', 'food',
    'entertainment', 'health', 'education', 'savings', 'debt',
    'shopping', 'rent', 'other'
  ]::text[])
$$;

create or replace function private.assert_active_category_editor(
  p_household_id uuid,
  p_budget_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'Sign in to manage categories';
  end if;
  if p_household_id is null or p_budget_id is null then
    raise exception using errcode = '22004', message = 'An active household and budget are required';
  end if;
  perform 1
  from public.user_preferences preference
  where preference.user_id = v_actor
    and preference.active_household_id = p_household_id
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'The active household changed; refresh and try again';
  end if;

  perform 1
  from public.household_members member
  where member.household_id = p_household_id
    and member.user_id = v_actor
    and member.role in ('owner', 'manager', 'editor')
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'Household edit access is required';
  end if;

  perform 1
  from public.budgets budget
  where budget.id = p_budget_id
    and budget.household_id = p_household_id
  for share;
  if not found then
    raise exception using errcode = '23503', message = 'The active budget does not belong to this household';
  end if;
  return v_actor;
end;
$$;

create or replace function private.household_category_result(
  p_household_id uuid,
  p_category_name text,
  p_bill_count integer default 0,
  p_transaction_count integer default 0,
  p_category_budget_count integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'categoryName', p_category_name,
    'billCount', greatest(coalesce(p_bill_count, 0), 0),
    'transactionCount', greatest(coalesce(p_transaction_count, 0), 0),
    'categoryBudgetCount', greatest(coalesce(p_category_budget_count, 0), 0),
    'categories', coalesce((
      select jsonb_agg(category.name order by lower(category.name), category.name)
      from public.categories category
      where category.household_id = p_household_id
    ), '[]'::jsonb)
  )
$$;

create or replace function private.merge_household_category_budgets(
  p_household_id uuid,
  p_from_name text,
  p_to_name text
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  select count(*)::integer into v_count
  from public.category_budgets category_budget
  where category_budget.household_id = p_household_id
    and lower(regexp_replace(btrim(category_budget.category), '\s+', ' ', 'g')) = lower(p_from_name);

  insert into public.category_budgets (
    user_id,
    household_id,
    budget_id,
    category,
    month,
    year,
    amount,
    updated_at
  )
  select
    (array_agg(source.user_id order by source.created_at, source.id))[1],
    source.household_id,
    source.budget_id,
    p_to_name,
    source.month,
    source.year,
    sum(source.amount),
    now()
  from public.category_budgets source
  where source.household_id = p_household_id
    and lower(regexp_replace(btrim(source.category), '\s+', ' ', 'g')) = lower(p_from_name)
  group by source.household_id, source.budget_id, source.month, source.year
  on conflict (budget_id, category, month, year) do update
  set amount = public.category_budgets.amount + excluded.amount,
      updated_at = now();

  delete from public.category_budgets category_budget
  where category_budget.household_id = p_household_id
    and lower(regexp_replace(btrim(category_budget.category), '\s+', ' ', 'g')) = lower(p_from_name);

  return v_count;
end;
$$;

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
  if private.is_builtin_household_category_name(v_old_name) then
    raise exception using errcode = '22023', message = 'Built-in categories stay available; add a custom category instead';
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

  v_source_is_valid := private.is_builtin_household_category_name(v_old_name)
    or v_source.id is not null
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
  elsif v_target.id is null and not private.is_builtin_household_category_name(v_requested_name) then
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
  set category = v_target_name
  where transaction_row.household_id = p_household_id
    and lower(regexp_replace(btrim(coalesce(transaction_row.category, '')), '\s+', ' ', 'g')) = lower(v_old_name);
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
  if private.is_builtin_household_category_name(v_name) then
    raise exception using errcode = '22023', message = 'Built-in categories stay available; custom categories can be deleted';
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
  set category = 'Other'
  where transaction_row.household_id = p_household_id
    and lower(regexp_replace(btrim(coalesce(transaction_row.category, '')), '\s+', ' ', 'g')) = lower(v_name);
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

create or replace function public.add_household_category(
  p_household_id uuid,
  p_budget_id uuid,
  p_name text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$ select private.add_household_category(p_household_id, p_budget_id, p_name) $$;

create or replace function public.rename_household_category(
  p_household_id uuid,
  p_budget_id uuid,
  p_old_name text,
  p_new_name text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$ select private.rename_household_category(p_household_id, p_budget_id, p_old_name, p_new_name) $$;

create or replace function public.delete_household_category(
  p_household_id uuid,
  p_budget_id uuid,
  p_name text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$ select private.delete_household_category(p_household_id, p_budget_id, p_name) $$;

revoke all on function private.normalize_household_category_name(text) from public, anon, authenticated, service_role;
revoke all on function private.is_builtin_household_category_name(text) from public, anon, authenticated, service_role;
revoke all on function private.assert_active_category_editor(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.household_category_result(uuid, text, integer, integer, integer) from public, anon, authenticated, service_role;
revoke all on function private.merge_household_category_budgets(uuid, text, text) from public, anon, authenticated, service_role;

revoke all on function private.add_household_category(uuid, uuid, text) from public, anon;
revoke all on function private.rename_household_category(uuid, uuid, text, text) from public, anon;
revoke all on function private.delete_household_category(uuid, uuid, text) from public, anon;
grant execute on function private.add_household_category(uuid, uuid, text) to authenticated, service_role;
grant execute on function private.rename_household_category(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function private.delete_household_category(uuid, uuid, text) to authenticated, service_role;

revoke all on function public.add_household_category(uuid, uuid, text) from public, anon;
revoke all on function public.rename_household_category(uuid, uuid, text, text) from public, anon;
revoke all on function public.delete_household_category(uuid, uuid, text) from public, anon;
grant execute on function public.add_household_category(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.rename_household_category(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.delete_household_category(uuid, uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
