create table if not exists public.bill_date_moves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bill_id text not null,
  from_date date not null,
  to_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, bill_id, from_date)
);

alter table public.bill_date_moves enable row level security;

drop policy if exists "Users can view their bill date moves" on public.bill_date_moves;
create policy "Users can view their bill date moves"
on public.bill_date_moves
for select
using (auth.uid() = user_id);

drop policy if exists "Users can create their bill date moves" on public.bill_date_moves;
create policy "Users can create their bill date moves"
on public.bill_date_moves
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their bill date moves" on public.bill_date_moves;
create policy "Users can update their bill date moves"
on public.bill_date_moves
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their bill date moves" on public.bill_date_moves;
create policy "Users can delete their bill date moves"
on public.bill_date_moves
for delete
using (auth.uid() = user_id);

create index if not exists bill_date_moves_user_from_idx
on public.bill_date_moves (user_id, from_date);

create index if not exists bill_date_moves_user_to_idx
on public.bill_date_moves (user_id, to_date);

create index if not exists bill_date_moves_user_bill_idx
on public.bill_date_moves (user_id, bill_id);
