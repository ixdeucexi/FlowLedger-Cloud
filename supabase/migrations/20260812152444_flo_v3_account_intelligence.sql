-- Flo v3: grounded answer persistence, household-scoped preference memory,
-- server-owned audit records, and review-only change proposals.

alter table public.flo_messages
  add column if not exists answer jsonb,
  add column if not exists followups jsonb not null default '[]'::jsonb,
  add column if not exists data_as_of timestamptz,
  add column if not exists coverage jsonb not null default '{}'::jsonb,
  add column if not exists partial boolean not null default false;

alter table public.flo_messages
  drop constraint if exists flo_messages_answer_object_check,
  add constraint flo_messages_answer_object_check
    check (answer is null or jsonb_typeof(answer) = 'object'),
  drop constraint if exists flo_messages_followups_array_check,
  add constraint flo_messages_followups_array_check
    check (jsonb_typeof(followups) = 'array' and jsonb_array_length(followups) <= 6),
  drop constraint if exists flo_messages_coverage_object_check,
  add constraint flo_messages_coverage_object_check
    check (jsonb_typeof(coverage) = 'object');

alter table public.flo_conversations
  add column if not exists is_ephemeral boolean not null default false;
create index if not exists flo_conversations_ephemeral_created_idx
  on public.flo_conversations (created_at) where is_ephemeral;

create or replace function public.guard_flo_ephemeral_conversations()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.role()) = 'authenticated' and ((tg_op = 'INSERT' and new.is_ephemeral) or (tg_op = 'UPDATE' and (old.is_ephemeral or new.is_ephemeral or old.is_ephemeral is distinct from new.is_ephemeral))) then
    raise exception using errcode = '42501', message = 'ephemeral_conversations_are_server_owned';
  end if;
  return new;
end;
$$;
drop trigger if exists flo_conversations_guard_server_owned_ephemeral on public.flo_conversations;
create trigger flo_conversations_guard_server_owned_ephemeral before insert or update on public.flo_conversations
for each row execute function public.guard_flo_ephemeral_conversations();

create or replace function public.guard_flo_assistant_messages()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.role()) = 'authenticated' and ((tg_op = 'INSERT' and new.role = 'assistant') or (tg_op = 'UPDATE' and (old.role = 'assistant' or new.role = 'assistant'))) then
    raise exception using errcode = '42501', message = 'assistant_messages_are_server_owned';
  end if;
  return new;
end;
$$;
drop trigger if exists flo_messages_guard_server_owned_assistant on public.flo_messages;
create trigger flo_messages_guard_server_owned_assistant before insert or update on public.flo_messages
for each row execute function public.guard_flo_assistant_messages();

-- Keep conversation counts authoritative and race-free for all Flo writers.
create or replace function public.sync_flo_conversation_message_count()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.flo_conversations set message_count = message_count + 1, updated_at = now() where id = new.conversation_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.flo_conversations set message_count = greatest(message_count - 1, 0), updated_at = now() where id = old.conversation_id;
    return old;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists flo_messages_sync_conversation_count on public.flo_messages;
create trigger flo_messages_sync_conversation_count
after insert or delete on public.flo_messages
for each row execute function public.sync_flo_conversation_message_count();

create table if not exists public.flo_household_memory (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (household_id, user_id),
  constraint flo_household_memory_preferences_object_check
    check (jsonb_typeof(preferences) = 'object' and (preferences - 'note') = '{}'::jsonb and (not (preferences ? 'note') or (jsonb_typeof(preferences -> 'note') = 'string' and char_length(preferences ->> 'note') <= 240)))
);
create index if not exists flo_household_memory_user_idx
  on public.flo_household_memory (user_id);

alter table public.flo_household_memory enable row level security;
revoke all on table public.flo_household_memory from public, anon, authenticated;
grant select, insert, update, delete on table public.flo_household_memory to authenticated;

create policy "flo household memory: member owns preference row"
on public.flo_household_memory for all to authenticated
using (
  user_id = (select auth.uid())
  and (select public.is_household_member(household_id))
)
with check (
  user_id = (select auth.uid())
  and (select public.is_household_member(household_id))
);

comment on table public.flo_household_memory is
  'Opt-in, household-scoped Flo preferences only. Financial facts are never stored as memory.';

create table if not exists public.flo_proposals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  conversation_id uuid not null references public.flo_conversations(id) on delete cascade,
  message_id uuid not null references public.flo_messages(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in (
    'planned_decision', 'bill_date_change', 'category_budget_change',
    'extra_debt_payment', 'recurring_bill_change'
  )),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  summary text not null default '' check (char_length(summary) <= 500),
  payload jsonb not null default '{}'::jsonb check (
    jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 32768
  ),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  impact jsonb check (impact is null or jsonb_typeof(impact) = 'object'),
  reversible boolean not null default true,
  status text not null default 'review' check (status in ('review', 'confirmed', 'expired', 'rejected', 'failed')),
  idempotency_key uuid not null default gen_random_uuid(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  confirmed_at timestamptz,
  result jsonb check (result is null or jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, idempotency_key)
);

create index if not exists flo_proposals_creator_created_idx
  on public.flo_proposals (created_by, created_at desc);
create index if not exists flo_proposals_household_status_idx
  on public.flo_proposals (household_id, status, expires_at);
create index if not exists flo_proposals_conversation_idx
  on public.flo_proposals (conversation_id);
create index if not exists flo_proposals_message_idx
  on public.flo_proposals (message_id);

alter table public.flo_proposals enable row level security;
revoke all on table public.flo_proposals from public, anon, authenticated;
grant select on table public.flo_proposals to authenticated;
grant select, insert, update, delete on table public.flo_proposals to service_role;

create policy "flo proposals: creator reads private proposals"
on public.flo_proposals for select to authenticated
using (
  created_by = (select auth.uid())
  and (select public.is_household_member(household_id))
);

comment on table public.flo_proposals is
  'Server-created review cards. A separate confirmed request must revalidate records and permissions before mutation.';

create table if not exists public.flo_audit_events (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  household_id uuid references public.households(id) on delete set null,
  conversation_id uuid references public.flo_conversations(id) on delete set null,
  message_id uuid references public.flo_messages(id) on delete set null,
  event_type text not null check (event_type in ('request', 'tool', 'answer', 'proposal', 'failure')),
  tool_name text,
  parameters jsonb not null default '{}'::jsonb check (jsonb_typeof(parameters) = 'object'),
  row_count integer check (row_count is null or row_count >= 0),
  data_as_of timestamptz,
  result_hash text,
  model text,
  policy_version text not null,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  status text not null check (status in ('started', 'completed', 'partial', 'rejected', 'error')),
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists flo_audit_events_household_created_idx
  on public.flo_audit_events (household_id, created_at desc);
create index if not exists flo_audit_events_request_idx
  on public.flo_audit_events (request_id, created_at);
create index if not exists flo_audit_events_user_idx
  on public.flo_audit_events (user_id);
create index if not exists flo_audit_events_conversation_idx
  on public.flo_audit_events (conversation_id);
create index if not exists flo_audit_events_message_idx
  on public.flo_audit_events (message_id);

alter table public.flo_audit_events enable row level security;
revoke all on table public.flo_audit_events from public, anon, authenticated;
grant select, insert on table public.flo_audit_events to service_role;
grant usage, select on sequence public.flo_audit_events_id_seq to service_role;

comment on table public.flo_audit_events is
  'Private server-owned Flo audit metadata. Raw prompts and financial payloads are intentionally excluded.';

-- The original user-global memory table is retained for rollback compatibility,
-- but Flo v3 cannot read or write it through the Data API.
revoke all on table public.flo_memory from authenticated;
drop policy if exists "flo usage: user inserts" on public.flo_usage;
revoke insert on table public.flo_usage from authenticated;
grant select, insert on table public.flo_usage to service_role;

create table if not exists public.flo_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, household_id)
);
create index if not exists flo_rate_limits_household_idx
  on public.flo_rate_limits (household_id);

alter table public.flo_rate_limits enable row level security;
revoke all on table public.flo_rate_limits from public, anon, authenticated;

create or replace function public.consume_flo_rate_limit(
  p_user_id uuid,
  p_household_id uuid,
  p_max_requests integer default 12,
  p_window_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean;
begin
  if p_user_id is null or p_household_id is null
    or p_max_requests not between 1 and 100
    or p_window_seconds not between 10 and 3600
  then
    return false;
  end if;

  insert into public.flo_rate_limits (user_id, household_id, window_started_at, request_count)
  values (p_user_id, p_household_id, now(), 1)
  on conflict (user_id, household_id) do update
    set window_started_at = case
          when public.flo_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
            then now()
          else public.flo_rate_limits.window_started_at
        end,
        request_count = case
          when public.flo_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
            then 1
          else public.flo_rate_limits.request_count + 1
        end
  returning request_count <= p_max_requests into v_allowed;

  return coalesce(v_allowed, false);
end;
$$;

revoke all on function public.consume_flo_rate_limit(uuid, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_flo_rate_limit(uuid, uuid, integer, integer)
  to service_role;

create table if not exists public.flo_daily_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  request_day date not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, household_id, request_day)
);
create index if not exists flo_daily_limits_household_day_idx on public.flo_daily_limits (household_id, request_day);
alter table public.flo_daily_limits enable row level security;
revoke all on table public.flo_daily_limits from public, anon, authenticated;

create or replace function public.reserve_flo_daily_request(p_user_id uuid, p_household_id uuid, p_request_day date, p_max_requests integer default 100)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_allowed boolean;
begin
  if p_user_id is null or p_household_id is null or p_request_day is null or p_max_requests not between 1 and 1000 then return false; end if;
  insert into public.flo_daily_limits (user_id, household_id, request_day, request_count)
  values (p_user_id, p_household_id, p_request_day, 1)
  on conflict (user_id, household_id, request_day) do update
  set request_count = public.flo_daily_limits.request_count + 1
  returning request_count <= p_max_requests into v_allowed;
  return coalesce(v_allowed, false);
end;
$$;
revoke all on function public.reserve_flo_daily_request(uuid, uuid, date, integer) from public, anon, authenticated;
grant execute on function public.reserve_flo_daily_request(uuid, uuid, date, integer) to service_role;

create or replace function public.confirm_flo_recurring_bill_proposal(p_proposal_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_proposal public.flo_proposals%rowtype;
  v_role text;
  v_bill public.bills%rowtype;
  v_expected_amount numeric;
  v_new_amount numeric;
  v_expected_last_reviewed_at timestamptz;
  v_audit_id bigint;
  v_result jsonb;
begin
  if v_user_id is null or p_proposal_id is null then raise exception using errcode = '42501', message = 'proposal_access_denied'; end if;
  select * into v_proposal from public.flo_proposals where id = p_proposal_id and created_by = v_user_id for update;
  if not found then raise exception using errcode = '42501', message = 'proposal_access_denied'; end if;
  select role into v_role from public.household_members where household_id = v_proposal.household_id and user_id = v_user_id;
  if v_role is null or v_role not in ('owner', 'manager', 'editor') then raise exception using errcode = '42501', message = 'proposal_role_denied'; end if;
  if not exists (select 1 from public.user_preferences where user_id = v_user_id and active_household_id = v_proposal.household_id)
    then raise exception using errcode = '42501', message = 'proposal_active_household_required'; end if;
  if not exists (select 1 from public.household_plans where household_id = v_proposal.household_id and tier = 'pro')
    then raise exception using errcode = '42501', message = 'proposal_pro_required'; end if;
  if v_proposal.status = 'confirmed' then return v_proposal.result; end if;
  if v_proposal.status <> 'review' then raise exception using errcode = 'P0001', message = 'proposal_not_reviewable'; end if;
  if v_proposal.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'proposal_expired';
  end if;
  if v_proposal.kind <> 'recurring_bill_change' then raise exception using errcode = 'P0001', message = 'proposal_kind_unsupported'; end if;
  v_expected_amount := nullif(v_proposal.payload ->> 'expectedAmount', '')::numeric;
  v_new_amount := nullif(v_proposal.payload ->> 'newAmount', '')::numeric;
  v_expected_last_reviewed_at := nullif(v_proposal.payload ->> 'expectedLastReviewedAt', '')::timestamptz;
  if v_new_amount is null or v_new_amount <= 0 or v_new_amount > 1000000 then raise exception using errcode = 'P0001', message = 'proposal_payload_invalid'; end if;
  select * into v_bill from public.bills where id = v_proposal.payload ->> 'billId' and household_id = v_proposal.household_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'proposal_target_missing'; end if;
  if v_bill.is_debt is true or v_bill.is_recurring is not true then raise exception using errcode = 'P0001', message = 'proposal_target_unsupported'; end if;
  if v_bill.amount is distinct from v_expected_amount or v_bill.last_reviewed_at is distinct from v_expected_last_reviewed_at
    then raise exception using errcode = 'P0001', message = 'proposal_stale'; end if;
  update public.bills set amount = v_new_amount, last_reviewed_at = now() where id = v_bill.id;
  insert into public.flo_audit_events (request_id, user_id, household_id, conversation_id, message_id, event_type, parameters, model, policy_version, status)
  values (gen_random_uuid(), v_user_id, v_proposal.household_id, v_proposal.conversation_id, v_proposal.message_id, 'proposal', jsonb_build_object('kind', v_proposal.kind, 'action', 'confirmed'), 'server', 'flo-v3.0.0', 'completed')
  returning id into v_audit_id;
  v_result := jsonb_build_object('billId', v_bill.id, 'previousAmount', v_bill.amount, 'newAmount', v_new_amount, 'confirmedAt', now(), 'auditId', v_audit_id);
  update public.flo_proposals set status = 'confirmed', confirmed_at = now(), result = v_result, updated_at = now() where id = v_proposal.id;
  return v_result;
end;
$$;

revoke all on function public.confirm_flo_recurring_bill_proposal(uuid) from public, anon;
grant execute on function public.confirm_flo_recurring_bill_proposal(uuid) to authenticated;
