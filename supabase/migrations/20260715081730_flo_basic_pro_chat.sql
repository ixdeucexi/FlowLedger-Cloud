-- Basic Flo + private, household-scoped Flo Pro conversations.

create table if not exists public.flo_conversations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New Flo chat' check (char_length(title) between 1 and 80),
  summary text not null default '' check (char_length(summary) <= 8000),
  message_count integer not null default 0 check (message_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists flo_conversations_creator_household_updated_idx
  on public.flo_conversations (created_by, household_id, updated_at desc);

create table if not exists public.flo_messages (
  id uuid primary key,
  conversation_id uuid not null references public.flo_conversations(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '' check (char_length(content) <= 50000),
  status text not null default 'completed' check (status in ('pending', 'streaming', 'completed', 'error', 'stopped')),
  source_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(source_refs) = 'array'),
  proposal jsonb check (proposal is null or jsonb_typeof(proposal) = 'object'),
  model text,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists flo_messages_conversation_created_idx
  on public.flo_messages (conversation_id, created_at desc, id desc);
create index if not exists flo_messages_creator_idx
  on public.flo_messages (created_by);
create index if not exists flo_messages_household_idx
  on public.flo_messages (household_id);

alter table public.flo_conversations enable row level security;
alter table public.flo_messages enable row level security;

revoke all on table public.flo_conversations from anon, authenticated;
revoke all on table public.flo_messages from anon, authenticated;
grant select, insert, update, delete on table public.flo_conversations to authenticated;
grant select, insert, update, delete on table public.flo_messages to authenticated;

drop policy if exists "flo conversations: creator reads private chats" on public.flo_conversations;
create policy "flo conversations: creator reads private chats"
on public.flo_conversations for select to authenticated
using (
  created_by = (select auth.uid())
  and public.is_household_member(household_id)
);

drop policy if exists "flo conversations: creator inserts private chats" on public.flo_conversations;
create policy "flo conversations: creator inserts private chats"
on public.flo_conversations for insert to authenticated
with check (
  created_by = (select auth.uid())
  and public.is_household_member(household_id)
);

drop policy if exists "flo conversations: creator updates private chats" on public.flo_conversations;
create policy "flo conversations: creator updates private chats"
on public.flo_conversations for update to authenticated
using (
  created_by = (select auth.uid())
  and public.is_household_member(household_id)
)
with check (
  created_by = (select auth.uid())
  and public.is_household_member(household_id)
);

drop policy if exists "flo conversations: creator deletes private chats" on public.flo_conversations;
create policy "flo conversations: creator deletes private chats"
on public.flo_conversations for delete to authenticated
using (
  created_by = (select auth.uid())
  and public.is_household_member(household_id)
);

drop policy if exists "flo messages: creator reads private history" on public.flo_messages;
create policy "flo messages: creator reads private history"
on public.flo_messages for select to authenticated
using (
  created_by = (select auth.uid())
  and public.is_household_member(household_id)
  and exists (
    select 1 from public.flo_conversations conversation
    where conversation.id = conversation_id
      and conversation.household_id = flo_messages.household_id
      and conversation.created_by = (select auth.uid())
  )
);

drop policy if exists "flo messages: creator inserts private history" on public.flo_messages;
create policy "flo messages: creator inserts private history"
on public.flo_messages for insert to authenticated
with check (
  created_by = (select auth.uid())
  and public.is_household_member(household_id)
  and exists (
    select 1 from public.flo_conversations conversation
    where conversation.id = conversation_id
      and conversation.household_id = flo_messages.household_id
      and conversation.created_by = (select auth.uid())
  )
);

drop policy if exists "flo messages: creator updates private history" on public.flo_messages;
create policy "flo messages: creator updates private history"
on public.flo_messages for update to authenticated
using (
  created_by = (select auth.uid())
  and public.is_household_member(household_id)
)
with check (
  created_by = (select auth.uid())
  and public.is_household_member(household_id)
  and exists (
    select 1 from public.flo_conversations conversation
    where conversation.id = conversation_id
      and conversation.household_id = flo_messages.household_id
      and conversation.created_by = (select auth.uid())
  )
);

drop policy if exists "flo messages: creator deletes private history" on public.flo_messages;
create policy "flo messages: creator deletes private history"
on public.flo_messages for delete to authenticated
using (
  created_by = (select auth.uid())
  and public.is_household_member(household_id)
);

alter table public.flo_usage add column if not exists household_id uuid references public.households(id) on delete set null;
alter table public.flo_usage add column if not exists conversation_id uuid references public.flo_conversations(id) on delete set null;
alter table public.flo_usage add column if not exists model text;
alter table public.flo_usage add column if not exists input_tokens integer;
alter table public.flo_usage add column if not exists output_tokens integer;
alter table public.flo_usage add column if not exists status text;
alter table public.flo_usage add column if not exists error_code text;

create index if not exists flo_usage_household_created_idx
  on public.flo_usage (household_id, created_at desc);
create index if not exists flo_usage_conversation_idx
  on public.flo_usage (conversation_id);

grant select, insert, update, delete on table public.flo_memory to authenticated;
grant insert on table public.flo_usage to authenticated;

comment on table public.flo_conversations is
  'Creator-private Flo Pro conversations scoped to one accessible household.';
comment on table public.flo_messages is
  'Creator-private Flo Pro message history. Financial records remain household-scoped through RLS.';
