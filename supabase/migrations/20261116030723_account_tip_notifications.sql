-- Educational tips use the existing private outbox and preference boundary.
-- Existing notification rows and delivery/receipt claims remain unchanged.
alter table public.user_notification_preferences
  add column if not exists account_tips boolean not null default true;

alter table public.push_notification_events
  drop constraint if exists push_notification_events_event_type_check;

alter table public.push_notification_events
  add constraint push_notification_events_event_type_check
  check (
    (event_type = 'posted'
      and transaction_id is not null and plaid_transaction_id is null
      and bill_id is null and occurrence_date is null)
    or
    (event_type = 'pending'
      and transaction_id is null and plaid_transaction_id is not null
      and bill_id is null and occurrence_date is null)
    or
    (event_type = 'overdue_bill'
      and transaction_id is null and plaid_transaction_id is null
      and bill_id is not null and occurrence_date is not null)
    or
    (event_type = 'account_tip'
      and transaction_id is null and plaid_transaction_id is null
      and bill_id is null and household_id is not null
      and occurrence_date is not null
      and extract(isodow from occurrence_date) = 1
      and event_key is not null
      and event_key = 'account-tip:' || occurrence_date::text)
  );

comment on column public.user_notification_preferences.account_tips is
  'One weekly educational account tip in the notification bell and enabled push destinations.';
comment on column public.push_notification_events.event_type is
  'posted, pending, overdue_bill, or account_tip; tips share a user-wide UTC Monday week key and contain no account data.';

-- Preserve service-only access; clients change choices through the authenticated API.
alter table public.user_notification_preferences enable row level security;
alter table public.push_notification_events enable row level security;
revoke all on table public.user_notification_preferences, public.push_notification_events
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.user_notification_preferences, public.push_notification_events to service_role;
