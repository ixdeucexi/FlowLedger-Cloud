-- Schema-only source SHA256 dfa21cdaccf1ddc1f25f6ec1907ec692e10eeec1435af4df8ac1f10645676489
drop table public.accounts;
create table public.households("id" uuid default gen_random_uuid() not null,
"name" text default 'My Household'::text not null,
"created_by" uuid not null,
"is_personal" boolean default false not null,
"created_at" timestamp with time zone default now() not null);
create table public.budgets("id" uuid default gen_random_uuid() not null,
"household_id" uuid not null,
"name" text default 'Main Budget'::text not null,
"is_default" boolean default true not null,
"created_at" timestamp with time zone default now() not null,
constraint "budgets_pkey" PRIMARY KEY (id));
create table public.accounts("id" text not null,
"user_id" uuid not null,
"household_id" uuid,
"budget_id" uuid,
"name" text not null,
"account_type" text not null,
"current_balance" numeric default 0 not null,
"balance_as_of" date default CURRENT_DATE not null,
"last_reconciled_at" timestamp with time zone,
"is_active" boolean default true not null,
"created_at" timestamp with time zone default now() not null,
"last_mutation_id" text,
"last_mutation_intent" jsonb,
constraint "accounts_account_type_check" CHECK ((account_type = ANY (ARRAY['checking'::text, 'savings'::text, 'cash'::text, 'credit_card'::text]))),
constraint "accounts_pkey" PRIMARY KEY (id));
CREATE OR REPLACE FUNCTION public.assign_personal_budget()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.household_id is null or new.budget_id is null then
    select h.id, b.id into new.household_id, new.budget_id
      from households h join budgets b on b.household_id = h.id and b.is_default
      where h.created_by = new.user_id and h.is_personal limit 1;
  end if;
  return new;
end $function$
;
CREATE TRIGGER assign_transactions_budget BEFORE INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION assign_personal_budget();
CREATE OR REPLACE FUNCTION public.restore_debt_transaction_before_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if old.debt_applied_bill_id is not null and old.debt_applied_amount > 0 then
    update bills set balance = balance + old.debt_applied_amount
    where id = old.debt_applied_bill_id and user_id = old.user_id and is_debt;
    perform recalculate_debt_minimum_boosts();
  end if;
  return old;
end;
$function$
;
CREATE TRIGGER restore_debt_transaction_on_delete BEFORE DELETE ON public.transactions FOR EACH ROW EXECUTE FUNCTION restore_debt_transaction_before_delete();
CREATE OR REPLACE FUNCTION public.preserve_reconciled_bill_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_bill_id text;
begin
  if new.review_status = 'matched'
    and new.review_resolution = 'bill'
    and new.match_reason = 'confirmed_bill_match'
  then
    select allocation ->> 'targetId'
      into v_bill_id
    from jsonb_array_elements(coalesce(new.review_allocations, '[]'::jsonb)) as allocation
    where allocation ->> 'type' = 'bill'
      and nullif(allocation ->> 'targetId', '') is not null
    limit 1;

    new.linked_bill_id := coalesce(new.linked_bill_id, v_bill_id);
    if new.linked_bill_id is not null then
      new.match_confidence := 1;
    end if;
  end if;
  return new;
end;
$function$
;
CREATE TRIGGER transactions_preserve_reconciled_bill_link BEFORE INSERT OR UPDATE OF review_status, review_resolution, review_allocations, linked_bill_id, match_reason ON public.transactions FOR EACH ROW EXECUTE FUNCTION preserve_reconciled_bill_link();
-- Unrelated household audit and operating-anchor triggers are excluded; account rows are validated/locked, never mutated by transfer RPCs.
