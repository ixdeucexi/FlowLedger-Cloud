-- Cover the complete parent-scope foreign key for scoped parent changes/deletion.
-- Additive index only; the previously applied planning migration is unchanged.
create index planned_account_transfer_occurrences_parent_scope_idx
 on public.planned_account_transfer_occurrences(transfer_id,household_id,budget_id);
