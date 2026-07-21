-- Extend the private, service-only push outbox with an occurrence-specific
-- overdue bill event. The occurrence date prevents weekly/biweekly bills from
-- suppressing or duplicating unrelated payments.
alter table public.push_notification_events
  add column if not exists bill_id text references public.bills(id) on delete cascade,
  add column if not exists occurrence_date date;

alter table public.push_notification_events
  drop constraint if exists push_notification_events_event_type_check;

alter table public.push_notification_events
  add constraint push_notification_events_event_type_check
  check (
    (
      event_type = 'posted'
      and transaction_id is not null
      and plaid_transaction_id is null
      and bill_id is null
      and occurrence_date is null
    )
    or
    (
      event_type = 'pending'
      and transaction_id is null
      and plaid_transaction_id is not null
      and bill_id is null
      and occurrence_date is null
    )
    or
    (
      event_type = 'overdue_bill'
      and transaction_id is null
      and plaid_transaction_id is null
      and bill_id is not null
      and occurrence_date is not null
    )
  );

create index if not exists push_notification_events_bill_occurrence_idx
  on public.push_notification_events (bill_id, occurrence_date);

comment on column public.push_notification_events.event_type is
  'posted opens Review Center; pending opens Activity; overdue_bill opens Bills without exposing private bill details.';

alter table public.push_notification_events enable row level security;
revoke all on table public.push_notification_events from public, anon, authenticated;
grant select, insert, update, delete on table public.push_notification_events to service_role;
