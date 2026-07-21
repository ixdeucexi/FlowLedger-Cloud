-- Account-wide alert choices. Delivery still requires an active device entry in
-- push_subscriptions; these booleans decide which types that account receives.
create table if not exists public.user_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pending_transactions boolean not null default true,
  posted_transactions boolean not null default true,
  overdue_bills boolean not null default true,
  feedback_updates boolean not null default true,
  admin_feedback boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_notification_preferences is
  'Private account-level choices for FlowLedger web-push alert types.';

alter table public.user_notification_preferences enable row level security;
revoke all on table public.user_notification_preferences from public, anon, authenticated;
grant select, insert, update, delete on table public.user_notification_preferences to service_role;
