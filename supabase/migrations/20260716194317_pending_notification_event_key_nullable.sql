-- Keep this column nullable during the rolling deployment so the previous API
-- can continue inserting posted notification rows until every instance updates.
alter table public.push_notification_events
  alter column event_key drop not null;
