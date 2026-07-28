create index if not exists money_health_runs_checked_by_idx
  on public.money_health_runs (checked_by)
  where checked_by is not null;

drop policy if exists "Approved admins can read money health runs"
  on public.money_health_runs;

create policy "Approved admins can read money health runs"
  on public.money_health_runs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.feedback_admins admin
      where admin.user_id = (select auth.uid())
    )
  );
