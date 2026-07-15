create index if not exists transactions_reviewed_by_idx
  on public.transactions (reviewed_by);
