alter table public.app_feedback
  add column if not exists admin_note text,
  add column if not exists archived_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists updated_by uuid,
  add column if not exists submitter_notified_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_feedback_admin_note_length_check'
      and conrelid = 'public.app_feedback'::regclass
  ) then
    alter table public.app_feedback
      add constraint app_feedback_admin_note_length_check
      check (admin_note is null or char_length(admin_note) <= 1000);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_feedback_updated_by_fkey'
      and conrelid = 'public.app_feedback'::regclass
  ) then
    alter table public.app_feedback
      add constraint app_feedback_updated_by_fkey
      foreign key (updated_by) references auth.users(id) on delete set null;
  end if;
end $$;

create index if not exists app_feedback_active_status_created_idx
  on public.app_feedback (status, created_at desc)
  where archived_at is null;

create index if not exists app_feedback_updated_by_idx
  on public.app_feedback (updated_by)
  where updated_by is not null;

comment on column public.app_feedback.admin_note is
  'Optional plain-language reply shown to the tester in My Feedback.';
comment on column public.app_feedback.archived_at is
  'Hides feedback from the active admin inbox without deleting tester history.';
comment on column public.app_feedback.resolved_at is
  'Set when feedback is marked updated or not planned.';
comment on column public.app_feedback.submitter_notified_at is
  'Last successful tester push notification for an admin response or outcome.';
