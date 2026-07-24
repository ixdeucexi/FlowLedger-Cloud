-- Flo foundation: rolling memory, lifecycle fields and privacy-safe usage.
create table if not exists flo_memory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  summary text not null default '',
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  check (length(summary) <= 4000)
);
alter table flo_memory enable row level security;
drop policy if exists "flo memory: user owns row" on flo_memory;
create policy "flo memory: user owns row" on flo_memory for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists flo_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null,
  tool_names text[] not null default '{}',
  duration_ms integer,
  created_at timestamptz not null default now()
);
alter table flo_usage enable row level security;
drop policy if exists "flo usage: user inserts" on flo_usage;
create policy "flo usage: user inserts" on flo_usage for insert with check (auth.uid() = user_id);

alter table decisions add column if not exists remind_at timestamptz;
alter table decisions add column if not exists actual_amount numeric;
alter table decisions add column if not exists completed_at timestamptz;
alter table decisions add column if not exists next_due_date date;

-- Preserve the current records while adopting clearer lifecycle names.
alter table decisions drop constraint if exists decisions_status_check;
update decisions set status = 'planned' where status = 'calendar';
update decisions set status = 'completed', completed_at = coalesce(completed_at, updated_at) where status = 'applied';
update decisions set status = 'reversed' where status = 'reversed';
alter table decisions add constraint decisions_status_check check (status in ('saved','planned','completed','cancelled','reversed'));

