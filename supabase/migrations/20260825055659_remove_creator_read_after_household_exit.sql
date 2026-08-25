-- Financial plan rows belong to a household once household_id is present.
-- The creator id is attribution, not a permanent ownership bypass. Restricting
-- that bypass ensures a removed member cannot keep reading the shared plan
-- through PostgREST while preserving the legacy personal-row fallback.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select *
    from (values
      ('account_balances', 'account_balances: authenticated read'),
      ('accounts', 'accounts: authenticated read'),
      ('bill_date_moves', 'bill_date_moves: authenticated read'),
      ('bills', 'bills: authenticated read'),
      ('categories', 'categories: authenticated read'),
      ('category_budgets', 'category_budgets: authenticated read'),
      ('decisions', 'decisions: authenticated read'),
      ('extra_payments', 'extra_payments: authenticated read'),
      ('goals', 'goals: authenticated read'),
      ('incomes', 'incomes: authenticated read'),
      ('monthly_overrides', 'monthly_overrides: authenticated read'),
      ('transactions', 'transactions: authenticated read')
    ) as policies(table_name, policy_name)
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      policy_row.policy_name,
      policy_row.table_name
    );
    execute format(
      'create policy %I on public.%I for select to authenticated using (
        (household_id is null and user_id = (select auth.uid()))
        or
        (household_id is not null and (select private.is_household_member(household_id)))
      )',
      policy_row.policy_name,
      policy_row.table_name
    );
  end loop;
end
$$;

;
