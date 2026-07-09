drop policy if exists "feedback admins can delete feedback" on public.app_feedback;

create policy "feedback admins can delete feedback"
on public.app_feedback
for delete
to authenticated
using (
  exists (
    select 1
    from public.feedback_admins admins
    where admins.user_id = (select auth.uid())
  )
);

grant delete on public.app_feedback to authenticated;
