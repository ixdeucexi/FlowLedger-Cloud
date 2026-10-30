-- Emergency only: first restore the saved frontend deployment. Retain journal
-- data. Never restore Undo grants after a capture gap without a reviewed
-- epoch/cutoff migration permanently rejecting every pre-gap inverse.
begin;
revoke all on function public.undo_recent_change(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.undo_recent_change(uuid,uuid,uuid) from public,anon,authenticated,service_role;
alter table public.bills disable trigger recent_changes_capture;
alter table public.incomes disable trigger recent_changes_capture;
alter table public.goals disable trigger recent_changes_capture;
alter table public.transactions disable trigger recent_changes_capture;
commit;
notify pgrst, 'reload schema';
