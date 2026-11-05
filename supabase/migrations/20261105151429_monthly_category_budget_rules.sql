-- Optional monthly category limits. Exact month rows remain compatible with
-- older clients; effective-month rules add opt-in repetition without backfilling.
create table public.category_budget_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  budget_id uuid not null references public.budgets(id) on delete cascade,
  category text not null check (char_length(btrim(category)) between 1 and 80),
  effective_month date not null check (
    effective_month = date_trunc('month', effective_month)::date
    and effective_month between date '2000-01-01' and date '2200-12-01'
  ),
  amount numeric(14,2) check (amount is null or amount between 0 and 999999999999.99),
  repeats boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (budget_id, category, effective_month, repeats)
);
create index category_budget_rules_user_idx on public.category_budget_rules(user_id);
create index category_budget_rules_household_idx on public.category_budget_rules(household_id);
alter table public.category_budget_rules enable row level security;
revoke all on public.category_budget_rules from public, anon, authenticated;
grant select on public.category_budget_rules to authenticated;
grant all on public.category_budget_rules to service_role;
create policy "category rules: household reads" on public.category_budget_rules
for select to authenticated using (
  private.is_household_member(household_id)
  and exists (select 1 from public.budgets budget where budget.id = category_budget_rules.budget_id and budget.household_id = category_budget_rules.household_id)
);

-- Internal complete resolution avoids REST row limits on long rule histories.
create or replace function private.resolve_monthly_category_budget_plan(
  p_household_id uuid, p_budget_id uuid, p_month integer, p_year integer
) returns jsonb language sql stable security definer set search_path = '' as $$
  with recurring as (
    select distinct on (rule.category) rule.category, rule.amount
    from public.category_budget_rules rule
    where rule.household_id = p_household_id and rule.budget_id = p_budget_id
      and rule.repeats and rule.effective_month <= make_date(p_year, p_month + 1, 1)
    order by rule.category, rule.effective_month desc
  ), one_month as (
    select rule.category, rule.amount
    from public.category_budget_rules rule
    where rule.household_id = p_household_id and rule.budget_id = p_budget_id
      and not rule.repeats and rule.effective_month = make_date(p_year, p_month + 1, 1)
  ), exact as (
    select budget.category, budget.amount
    from public.category_budgets budget
    where budget.household_id = p_household_id and budget.budget_id = p_budget_id
      and budget.month = p_month and budget.year = p_year
  ), names as (
    select category from recurring union select category from one_month union select category from exact
  ), resolved as (
    select names.category,
      case when exact.category is not null then exact.amount
           when one_month.category is not null then one_month.amount
           else recurring.amount end as amount
    from names left join recurring using(category) left join one_month using(category) left join exact using(category)
  )
  select jsonb_build_object(
    'budgets', coalesce((select jsonb_object_agg(category, amount order by category) from resolved where amount is not null), '{}'::jsonb),
    'recurringCategories', coalesce((select jsonb_agg(category order by category) from recurring where amount is not null), '[]'::jsonb)
  );
$$;
revoke all on function private.resolve_monthly_category_budget_plan(uuid,uuid,integer,integer) from public, anon, authenticated, service_role;

create or replace function private.get_monthly_category_budget_plan(
  p_household_id uuid, p_budget_id uuid, p_month integer, p_year integer
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception using errcode='28000', message='Sign in to view category budgets'; end if;
  if p_month is null or p_month not between 0 and 11 or p_year is null or p_year not between 2000 and 2200 then
    raise exception using errcode='22023', message='Choose a valid budget month and year';
  end if;
  if not exists(select 1 from public.user_preferences preference where preference.user_id=auth.uid() and preference.active_household_id=p_household_id)
    or not private.is_household_member(p_household_id)
    or not exists(select 1 from public.budgets budget where budget.id=p_budget_id and budget.household_id=p_household_id) then
    raise exception using errcode='42501', message='Select a household you can view before loading category budgets';
  end if;
  return private.resolve_monthly_category_budget_plan(p_household_id,p_budget_id,p_month,p_year);
end;
$$;

create or replace function private.save_monthly_category_budget_plan(
  p_household_id uuid, p_budget_id uuid, p_month integer, p_year integer,
  p_changes jsonb, p_repeat boolean
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_entry record;
  v_category text;
  v_amount numeric;
  v_effective date;
  v_seen text[] := array[]::text[];
begin
  v_actor := private.assert_active_category_editor(p_household_id,p_budget_id);
  if p_month is null or p_month not between 0 and 11 or p_year is null or p_year not between 2000 and 2200 then
    raise exception using errcode='22023', message='Choose a valid budget month and year';
  end if;
  if p_repeat is null or jsonb_typeof(p_changes) is distinct from 'object' then
    raise exception using errcode='22023', message='Send valid category budget changes';
  end if;
  if (select count(*) from jsonb_object_keys(p_changes)) > 500 then
    raise exception using errcode='22023', message='Save at most 500 category budgets at a time';
  end if;
  v_effective := make_date(p_year,p_month+1,1);
  -- Same lock as category rename/delete: labels and rules cannot race.
  perform pg_advisory_xact_lock(hashtextextended(p_household_id::text || ':categories',0));
  for v_entry in select key,value from jsonb_each(p_changes) loop
    select category.name into v_category from public.categories category
      where category.household_id=p_household_id
        and lower(regexp_replace(btrim(category.name),'\s+',' ','g')) = lower(private.normalize_household_category_name(v_entry.key));
    if v_category is null or lower(v_category) in ('income','transfer') then
      raise exception using errcode='22023', message='Choose an existing spending category';
    end if;
    if lower(v_category)=any(v_seen) then
      raise exception using errcode='22023', message='Send each category only once';
    end if;
    v_seen := array_append(v_seen,lower(v_category));
    if v_entry.value = 'null'::jsonb then v_amount := null;
    elsif jsonb_typeof(v_entry.value)='number' then
      v_amount := (v_entry.value #>> '{}')::numeric;
      if v_amount < 0 or v_amount > 999999999999.99 or v_amount <> round(v_amount,2) then
        raise exception using errcode='22023', message='Use a nonnegative amount with no more than two decimal places';
      end if;
    else raise exception using errcode='22023', message='Use a money amount or clear the category budget';
    end if;
    delete from public.category_budgets budget
      where budget.household_id=p_household_id and budget.budget_id=p_budget_id and budget.month=p_month and budget.year=p_year
        and lower(regexp_replace(btrim(budget.category),'\s+',' ','g'))=lower(v_category);
    if v_amount is not null then
      insert into public.category_budgets(user_id,household_id,budget_id,category,month,year,amount,updated_at)
      values(v_actor,p_household_id,p_budget_id,v_category,p_month,p_year,v_amount,now());
    end if;
    if p_repeat then
      delete from public.category_budget_rules rule
        where rule.household_id=p_household_id and rule.budget_id=p_budget_id and rule.category=v_category
          and rule.effective_month=v_effective and not rule.repeats;
    end if;
    insert into public.category_budget_rules(user_id,household_id,budget_id,category,effective_month,amount,repeats,updated_at)
    values(v_actor,p_household_id,p_budget_id,v_category,v_effective,v_amount,p_repeat,now())
    on conflict(budget_id,category,effective_month,repeats) do update set amount=excluded.amount,updated_at=now();
  end loop;
  return private.resolve_monthly_category_budget_plan(p_household_id,p_budget_id,p_month,p_year);
end;
$$;

create or replace function public.get_monthly_category_budget_plan(
  p_household_id uuid,p_budget_id uuid,p_month integer,p_year integer
) returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.get_monthly_category_budget_plan(p_household_id,p_budget_id,p_month,p_year)
$$;
create or replace function public.save_monthly_category_budget_plan(
  p_household_id uuid,p_budget_id uuid,p_month integer,p_year integer,p_changes jsonb,p_repeat boolean
) returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.save_monthly_category_budget_plan(p_household_id,p_budget_id,p_month,p_year,p_changes,p_repeat)
$$;
revoke all on function private.get_monthly_category_budget_plan(uuid,uuid,integer,integer) from public,anon;
revoke all on function private.save_monthly_category_budget_plan(uuid,uuid,integer,integer,jsonb,boolean) from public,anon;
revoke all on function public.get_monthly_category_budget_plan(uuid,uuid,integer,integer) from public,anon;
revoke all on function public.save_monthly_category_budget_plan(uuid,uuid,integer,integer,jsonb,boolean) from public,anon;
grant execute on function private.get_monthly_category_budget_plan(uuid,uuid,integer,integer) to authenticated,service_role;
grant execute on function private.save_monthly_category_budget_plan(uuid,uuid,integer,integer,jsonb,boolean) to authenticated,service_role;
grant execute on function public.get_monthly_category_budget_plan(uuid,uuid,integer,integer) to authenticated,service_role;
grant execute on function public.save_monthly_category_budget_plan(uuid,uuid,integer,integer,jsonb,boolean) to authenticated,service_role;

-- Called only by the existing editor-checked category RPCs while holding the
-- household ':categories' advisory lock. Snapshot both histories before writes.
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
  v_from_key text := lower(regexp_replace(btrim(p_from_name), '\s+', ' ', 'g'));
  v_to_key text := lower(regexp_replace(btrim(p_to_name), '\s+', ' ', 'g'));
  v_exact jsonb;
  v_rules jsonb;
  v_scopes jsonb;
  v_new_exact jsonb;
  v_new_rules jsonb;
  v_count integer := 0;
begin
  if v_from_key = v_to_key then return 0; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', item.user_id,
    'budget_id', item.budget_id,
    'category', item.category,
    'effective_month', make_date(item.year, item.month + 1, 1),
    'amount', item.amount,
    'side', case when lower(regexp_replace(btrim(item.category), '\s+', ' ', 'g')) = v_from_key then 0 else 1 end
  ) order by item.created_at, item.id), '[]'::jsonb)
  into v_exact
  from public.category_budgets item
  where item.household_id = p_household_id
    and lower(regexp_replace(btrim(item.category), '\s+', ' ', 'g')) in (v_from_key, v_to_key);

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', item.user_id,
    'budget_id', item.budget_id,
    'category', item.category,
    'effective_month', item.effective_month,
    'amount', item.amount,
    'repeats', item.repeats,
    'side', case when lower(regexp_replace(btrim(item.category), '\s+', ' ', 'g')) = v_from_key then 0 else 1 end
  ) order by item.effective_month, item.category, item.repeats), '[]'::jsonb)
  into v_rules
  from public.category_budget_rules item
  where item.household_id = p_household_id
    and lower(regexp_replace(btrim(item.category), '\s+', ' ', 'g')) in (v_from_key, v_to_key);

  select count(*)::integer into v_count
  from jsonb_array_elements(v_exact || v_rules) item
  where (item->>'side')::integer = 0;
  -- Retrying a committed rename/merge must not re-add the target to itself.
  if v_count = 0 then return 0; end if;

  with
  exact_rows as (
    select * from jsonb_to_recordset(v_exact) as item(
      user_id uuid, budget_id uuid, category text,
      effective_month date, amount numeric, side integer
    )
  ),
  rules as (
    select * from jsonb_to_recordset(v_rules) as item(
      user_id uuid, budget_id uuid, category text,
      effective_month date, amount numeric, repeats boolean, side integer
    )
  ),
  source_scopes as (
    select distinct budget_id, case when budget_id is null then user_id end as user_scope
    from (
      select budget_id, user_id from exact_rows where side = 0
      union all
      select budget_id, user_id from rules where side = 0
    ) item
  ),
  scopes as (
    select source_scopes.*,
      coalesce(
        (select item.user_id from exact_rows item
         where item.side = 0
           and item.budget_id is not distinct from source_scopes.budget_id
           and (source_scopes.budget_id is not null or item.user_id = source_scopes.user_scope)
         limit 1),
        (select item.user_id from rules item
         where item.side = 0 and item.budget_id = source_scopes.budget_id
         limit 1)
      ) as author_id
    from source_scopes
  ),
  repeating_dates as (
    select distinct scope.budget_id, scope.user_scope, scope.author_id, rule.effective_month
    from scopes scope
    join rules rule on rule.budget_id = scope.budget_id and rule.repeats
  ),
  merged_repeating as (
    select boundary.budget_id, boundary.author_id, boundary.effective_month,
      case when source_rule.amount is null and target_rule.amount is null then null
        else coalesce(source_rule.amount, 0) + coalesce(target_rule.amount, 0) end as amount
    from repeating_dates boundary
    left join lateral (
      select rule.amount from rules rule
      where rule.budget_id = boundary.budget_id and rule.side = 0 and rule.repeats
        and rule.effective_month <= boundary.effective_month
      order by rule.effective_month desc, rule.category
      limit 1
    ) source_rule on true
    left join lateral (
      select rule.amount from rules rule
      where rule.budget_id = boundary.budget_id and rule.side = 1 and rule.repeats
        and rule.effective_month <= boundary.effective_month
      order by rule.effective_month desc, rule.category
      limit 1
    ) target_rule on true
  ),
  override_dates as (
    select budget_id, user_scope, author_id, effective_month,
      bool_or(is_exact) as has_exact,
      bool_or(is_oneoff) as has_oneoff
    from (
      select scope.budget_id, scope.user_scope, scope.author_id, item.effective_month,
        true as is_exact, false as is_oneoff
      from scopes scope
      join exact_rows item on item.budget_id is not distinct from scope.budget_id
        and (scope.budget_id is not null or item.user_id = scope.user_scope)
      union all
      select scope.budget_id, scope.user_scope, scope.author_id, rule.effective_month,
        false as is_exact, true as is_oneoff
      from scopes scope
      join rules rule on rule.budget_id = scope.budget_id and not rule.repeats
    ) dates
    group by budget_id, user_scope, author_id, effective_month
  ),
  override_sides as (
    select boundary.*, category_side.side,
      case when exact_value.present > 0 then exact_value.amount
        when oneoff.present then oneoff.amount
        else recurring.amount end as amount
    from override_dates boundary
    cross join (values (0), (1)) category_side(side)
    left join lateral (
      select count(*) as present, sum(item.amount) as amount
      from exact_rows item
      where item.budget_id is not distinct from boundary.budget_id
        and (boundary.budget_id is not null or item.user_id = boundary.user_scope)
        and item.side = category_side.side and item.effective_month = boundary.effective_month
    ) exact_value on true
    left join lateral (
      select true as present, rule.amount from rules rule
      where rule.budget_id = boundary.budget_id and rule.side = category_side.side
        and not rule.repeats and rule.effective_month = boundary.effective_month
      order by rule.category
      limit 1
    ) oneoff on true
    left join lateral (
      select rule.amount from rules rule
      where rule.budget_id = boundary.budget_id and rule.side = category_side.side and rule.repeats
        and rule.effective_month <= boundary.effective_month
      order by rule.effective_month desc, rule.category
      limit 1
    ) recurring on true
  ),
  merged_overrides as (
    select budget_id, user_scope, author_id, effective_month, has_exact, has_oneoff,
      case when count(amount) = 0 then null else sum(amount) end as amount
    from override_sides
    group by budget_id, user_scope, author_id, effective_month, has_exact, has_oneoff
  ),
  prepared_rules as (
    select budget_id, author_id as user_id, effective_month, amount, true as repeats
    from merged_repeating
    union all
    select budget_id, author_id as user_id, effective_month, amount, false as repeats
    from merged_overrides
    where has_oneoff and budget_id is not null
  ),
  prepared_exact as (
    select budget_id, author_id as user_id,
      extract(year from effective_month)::integer as year,
      extract(month from effective_month)::integer - 1 as month,
      amount
    from merged_overrides where has_exact
  )
  select
    coalesce((select jsonb_agg(to_jsonb(scope)) from scopes scope), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(rule)) from prepared_rules rule), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(item)) from prepared_exact item), '[]'::jsonb)
  into v_scopes, v_new_rules, v_new_exact;

  delete from public.category_budget_rules item
  where item.household_id = p_household_id
    and lower(regexp_replace(btrim(item.category), '\s+', ' ', 'g')) in (v_from_key, v_to_key)
    and exists (
      select 1 from jsonb_to_recordset(v_scopes) scope(budget_id uuid, user_scope uuid)
      where scope.budget_id = item.budget_id
    );
  delete from public.category_budgets item
  where item.household_id = p_household_id
    and lower(regexp_replace(btrim(item.category), '\s+', ' ', 'g')) in (v_from_key, v_to_key)
    and exists (
      select 1 from jsonb_to_recordset(v_scopes) scope(budget_id uuid, user_scope uuid)
      where scope.budget_id is not distinct from item.budget_id
        and (scope.budget_id is not null or item.user_id = scope.user_scope)
    );

  insert into public.category_budget_rules (
    user_id, household_id, budget_id, category, effective_month, amount, repeats
  )
  select item.user_id, p_household_id, item.budget_id, p_to_name,
    item.effective_month, item.amount, item.repeats
  from jsonb_to_recordset(v_new_rules) item(
    user_id uuid, budget_id uuid, effective_month date, amount numeric, repeats boolean
  );

  insert into public.category_budgets (
    user_id, household_id, budget_id, category, month, year, amount, updated_at
  )
  select item.user_id, p_household_id, item.budget_id, p_to_name,
    item.month, item.year, item.amount, now()
  from jsonb_to_recordset(v_new_exact) item(
    user_id uuid, budget_id uuid, month integer, year integer, amount numeric
  );
  return v_count;
end;
$$;

revoke all on function private.merge_household_category_budgets(uuid, text, text)
from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
