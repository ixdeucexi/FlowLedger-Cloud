drop policy if exists "feedback admins can read admin list" on public.feedback_admins;

create policy "feedback admins can read own admin row"
on public.feedback_admins
for select
to authenticated
using ((select auth.uid()) = user_id);
