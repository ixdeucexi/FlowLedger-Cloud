-- Generalize the private push outbox so pending Plaid previews can notify
-- without becoming cash-flow transactions.
alter table public.push_notification_events
  add column if not exists event_type text not null default 'posted',
  add column if not exists plaid_transaction_id text,
  add column if not exists event_key text;

update public.push_notification_events
set event_key = 'posted:' || transaction_id
where event_key is null;

alter table public.push_notification_events
  alter column event_key set not null;

alter table public.push_notification_events
  alter column transaction_id drop not null;

alter table public.push_notification_events
  drop constraint if exists push_notification_events_event_type_check;

alter table public.push_notification_events
  add constraint push_notification_events_event_type_check
  check (
    (event_type = 'posted' and transaction_id is not null and plaid_transaction_id is null)
    or
    (event_type = 'pending' and transaction_id is null and plaid_transaction_id is not null)
  );

create unique index if not exists push_notification_events_user_event_key_unique
  on public.push_notification_events (user_id, event_key);

create index if not exists push_notification_events_type_pending_idx
  on public.push_notification_events (user_id, event_type, created_at)
  where delivered_at is null;

comment on column public.push_notification_events.event_type is
  'posted opens Review Center; pending opens Activity and never affects balances.';
