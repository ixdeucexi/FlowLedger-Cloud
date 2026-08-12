alter table public.plaid_accounts
  add column if not exists display_name text;

alter table public.plaid_accounts
  drop constraint if exists plaid_accounts_display_name_check;

alter table public.plaid_accounts
  add constraint plaid_accounts_display_name_check
  check (
    display_name is null
    or (
      display_name = btrim(display_name)
      and char_length(display_name) between 1 and 80
    )
  );

comment on column public.plaid_accounts.display_name is
  'Optional household nickname. Plaid sync continues to own name and official_name.';
