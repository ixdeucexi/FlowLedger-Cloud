-- Household and account deletion filter on these foreign-key columns. Keep
-- the indexes narrow so PostgreSQL can validate cascades and locate rows
-- without scanning the notification or subscription-link tables.
create index if not exists push_notification_events_household_id_idx
  on public.push_notification_events (household_id);

create index if not exists subscription_bill_links_user_id_idx
  on public.subscription_bill_links (user_id);

;
