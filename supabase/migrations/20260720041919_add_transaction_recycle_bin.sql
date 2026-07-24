alter table public.transactions
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

create index if not exists transactions_household_deleted_at_idx
  on public.transactions (household_id, deleted_at desc)
  where deleted_at is not null;

create index if not exists transactions_deleted_by_idx
  on public.transactions (deleted_by)
  where deleted_by is not null;

comment on column public.transactions.deleted_at is
  'User-initiated archive timestamp. Separate from removed_at, which records removal by the bank provider.';

comment on column public.transactions.deleted_by is
  'Authenticated household member who moved the transaction to Recently Deleted.';
