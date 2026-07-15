create index if not exists push_notification_events_transaction_idx
  on public.push_notification_events (transaction_id);
