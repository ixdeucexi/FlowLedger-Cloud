-- Remember an explicit recurring merchant -> existing bill choice at household
-- scope so future Plaid charges can prefer that bill during review.

create table if not exists public.subscription_bill_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  merchant_key text not null check (length(merchant_key) between 1 and 200),
  merchant_label text not null check (length(merchant_label) between 1 and 240),
  bill_id text not null references public.bills(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, merchant_key)
);
create index if not exists subscription_bill_links_bill_idx on public.subscription_bill_links (bill_id);
alter table public.subscription_bill_links enable row level security;
drop policy if exists "subscription bill links: household members read" on public.subscription_bill_links;
create policy "subscription bill links: household members read" on public.subscription_bill_links for select to authenticated using ((select private.is_household_member(household_id)));
drop policy if exists "subscription bill links: household editors insert" on public.subscription_bill_links;
create policy "subscription bill links: household editors insert" on public.subscription_bill_links for insert to authenticated with check (user_id = (select auth.uid()) and (select private.is_household_editor(household_id)));
drop policy if exists "subscription bill links: household editors update" on public.subscription_bill_links;
create policy "subscription bill links: household editors update" on public.subscription_bill_links for update to authenticated using ((select private.is_household_editor(household_id))) with check (user_id = (select auth.uid()) and (select private.is_household_editor(household_id)));
drop policy if exists "subscription bill links: household editors delete" on public.subscription_bill_links;
create policy "subscription bill links: household editors delete" on public.subscription_bill_links for delete to authenticated using ((select private.is_household_editor(household_id)));
create or replace function private.validate_subscription_bill_link()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  new.merchant_key := lower(btrim(new.merchant_key));
  new.merchant_label := btrim(new.merchant_label);
  new.updated_at := now();
  if new.user_id is distinct from (select auth.uid()) then raise exception 'Subscription bill links must be saved by the signed-in user'; end if;
  if new.merchant_key = '' or new.merchant_key !~ '^[a-z0-9]+([ ][a-z0-9]+)*$' then raise exception 'A normalized subscription merchant is required'; end if;
  if not exists (
    select 1 from public.bills b where b.id = new.bill_id and b.household_id = new.household_id
      and b.is_debt is not true and (b.end_date is null or b.end_date >= current_date::text)
  ) then raise exception 'Choose an active non-debt bill from this household'; end if;
  return new;
end;
$$;
drop trigger if exists validate_subscription_bill_link on public.subscription_bill_links;
create trigger validate_subscription_bill_link before insert or update on public.subscription_bill_links for each row execute function private.validate_subscription_bill_link();
revoke all on public.subscription_bill_links from public, anon;
grant select, insert, update, delete on public.subscription_bill_links to authenticated, service_role;
comment on table public.subscription_bill_links is 'Household-scoped recurring merchant links used to prefer an existing bill during posted transaction review.';;
