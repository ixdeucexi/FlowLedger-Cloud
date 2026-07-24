-- Store browser push endpoints only for trusted server-side delivery.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 10 and 4096),
  p256dh text not null check (char_length(p256dh) between 20 and 512),
  auth text not null check (char_length(auth) between 8 and 256),
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on table public.push_subscriptions to service_role;

-- An outbox makes delivery idempotent and lets a later Plaid sync retry a transient push failure.
create table if not exists public.push_notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id text not null references public.transactions(id) on delete cascade,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_error text,
  unique (user_id, transaction_id)
);

create index if not exists push_notification_events_pending_idx
  on public.push_notification_events (user_id, created_at)
  where delivered_at is null;

create index if not exists push_notification_events_transaction_idx
  on public.push_notification_events (transaction_id);

alter table public.push_notification_events enable row level security;
revoke all on table public.push_notification_events from public, anon, authenticated;
grant select, insert, update, delete on table public.push_notification_events to service_role;
