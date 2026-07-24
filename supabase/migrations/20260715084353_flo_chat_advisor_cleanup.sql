-- Advisor cleanup for the Flo Pro chat path.
create index if not exists flo_conversations_household_idx
  on public.flo_conversations (household_id);
create index if not exists flo_usage_user_idx
  on public.flo_usage (user_id);

drop policy if exists "flo usage: user inserts" on public.flo_usage;
create policy "flo usage: user inserts"
on public.flo_usage for insert to authenticated
with check ((select auth.uid()) = user_id);
