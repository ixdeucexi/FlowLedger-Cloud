-- Make a Flo request's terminal message, usage record, and terminal audit one
-- idempotent database transaction. Tool audits remain separate progress facts.

alter table public.flo_messages
  add column if not exists request_id uuid,
  add column if not exists processing_started_at timestamptz;

create unique index if not exists flo_messages_assistant_request_unique_idx
  on public.flo_messages (request_id)
  where request_id is not null and role = 'assistant';

alter table public.flo_usage
  add column if not exists request_id uuid,
  add column if not exists message_id uuid references public.flo_messages(id) on delete set null;

do $$
begin
  if exists (
    select 1 from public.flo_usage
    where request_id is not null
    group by request_id having count(*) > 1
  ) then
    raise exception 'flo_usage contains duplicate request_id values; reconcile them before this migration';
  end if;
  if exists (
    select 1 from public.flo_audit_events
    where event_type in ('answer', 'failure')
    group by request_id having count(*) > 1
  ) then
    raise exception 'flo_audit_events contains duplicate terminal events; reconcile them before this migration';
  end if;
end;
$$;

create unique index if not exists flo_usage_request_unique_idx
  on public.flo_usage (request_id)
  where request_id is not null;

create index if not exists flo_usage_message_idx
  on public.flo_usage (message_id)
  where message_id is not null;

create unique index if not exists flo_audit_events_terminal_request_unique_idx
  on public.flo_audit_events (request_id)
  where event_type in ('answer', 'failure');

create or replace function public.finalize_flo_response(
  p_request_id uuid,
  p_message_id uuid,
  p_conversation_id uuid,
  p_household_id uuid,
  p_user_id uuid,
  p_content text,
  p_message_status text,
  p_error_code text,
  p_source_refs jsonb,
  p_proposal jsonb,
  p_answer jsonb,
  p_followups jsonb,
  p_data_as_of timestamptz,
  p_coverage jsonb,
  p_partial boolean,
  p_model text,
  p_operation text,
  p_tool_names text[],
  p_duration_ms integer,
  p_input_tokens integer,
  p_output_tokens integer,
  p_terminal_event_type text,
  p_terminal_parameters jsonb,
  p_row_count integer,
  p_terminal_status text,
  p_policy_version text,
  p_ephemeral boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_message_status not in ('completed', 'error')
    or (p_message_status = 'completed' and (p_terminal_event_type <> 'answer' or p_terminal_status not in ('completed', 'partial')))
    or (p_message_status = 'error' and (p_terminal_event_type <> 'failure' or p_terminal_status <> 'error' or p_error_code is null))
    or p_duration_ms is null or p_duration_ms < 0
    or (p_input_tokens is not null and p_input_tokens < 0)
    or (p_output_tokens is not null and p_output_tokens < 0)
    or (p_row_count is not null and p_row_count < 0)
    or jsonb_typeof(coalesce(p_source_refs, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_followups, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_coverage, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_terminal_parameters, '{}'::jsonb)) <> 'object'
  then
    raise exception using errcode = '22023', message = 'flo_terminal_payload_invalid';
  end if;

  update public.flo_messages
  set content = coalesce(p_content, ''),
      status = p_message_status,
      error_code = p_error_code,
      source_refs = coalesce(p_source_refs, '[]'::jsonb),
      proposal = p_proposal,
      answer = p_answer,
      followups = coalesce(p_followups, '[]'::jsonb),
      data_as_of = p_data_as_of,
      coverage = coalesce(p_coverage, '{}'::jsonb),
      partial = coalesce(p_partial, true),
      model = p_model,
      completed_at = now()
  where id = p_message_id
    and conversation_id = p_conversation_id
    and household_id = p_household_id
    and created_by = p_user_id
    and role = 'assistant'
    and request_id = p_request_id
    and status = 'streaming';

  if not found then
    return exists (
      select 1 from public.flo_usage where request_id = p_request_id
    ) and exists (
      select 1 from public.flo_audit_events
      where request_id = p_request_id and event_type in ('answer', 'failure')
    );
  end if;

  insert into public.flo_usage (
    request_id, message_id, user_id, household_id, conversation_id,
    operation, tool_names, duration_ms, model, input_tokens, output_tokens,
    status, error_code
  ) values (
    p_request_id, p_message_id, p_user_id, p_household_id, p_conversation_id,
    p_operation, coalesce(p_tool_names, '{}'::text[]), p_duration_ms, p_model,
    p_input_tokens, p_output_tokens, p_terminal_status, p_error_code
  );

  insert into public.flo_audit_events (
    request_id, user_id, household_id, conversation_id, message_id,
    event_type, parameters, row_count, data_as_of, model, policy_version,
    duration_ms, input_tokens, output_tokens, status, error_code
  ) values (
    p_request_id, p_user_id, p_household_id, p_conversation_id, p_message_id,
    p_terminal_event_type, coalesce(p_terminal_parameters, '{}'::jsonb),
    p_row_count, p_data_as_of, p_model, p_policy_version, p_duration_ms,
    p_input_tokens, p_output_tokens, p_terminal_status, p_error_code
  );

  if p_ephemeral then
    delete from public.flo_conversations
    where id = p_conversation_id
      and household_id = p_household_id
      and created_by = p_user_id
      and is_ephemeral = true;
    if not found then
      raise exception using errcode = 'P0001', message = 'ephemeral_cleanup_failed';
    end if;
  end if;

  return true;
end;
$$;

revoke all on function public.finalize_flo_response(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, jsonb, jsonb,
  jsonb, timestamptz, jsonb, boolean, text, text, text[], integer, integer,
  integer, text, jsonb, integer, text, text, boolean
) from public, anon, authenticated;

grant execute on function public.finalize_flo_response(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, jsonb, jsonb,
  jsonb, timestamptz, jsonb, boolean, text, text, text[], integer, integer,
  integer, text, jsonb, integer, text, text, boolean
) to service_role;

comment on function public.finalize_flo_response(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, jsonb, jsonb,
  jsonb, timestamptz, jsonb, boolean, text, text, text[], integer, integer,
  integer, text, jsonb, integer, text, text, boolean
) is 'Atomically and idempotently completes one Flo assistant request, usage record, and terminal audit.';

create or replace function public.reconcile_stale_flo_responses(
  p_household_id uuid,
  p_user_id uuid,
  p_before timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_request_id uuid;
  v_count integer := 0;
begin
  if p_before is null or p_before > now() then
    raise exception using errcode = '22023', message = 'flo_reconcile_cutoff_invalid';
  end if;

  for v_row in
    select message.id, message.conversation_id, message.request_id, message.model,
           coalesce(message.processing_started_at, message.created_at) as started_at,
           conversation.is_ephemeral
    from public.flo_messages as message
    join public.flo_conversations as conversation on conversation.id = message.conversation_id
    where message.household_id = p_household_id
      and message.created_by = p_user_id
      and message.role = 'assistant'
      and message.status = 'streaming'
      and coalesce(message.processing_started_at, message.created_at) < p_before
    for update of message skip locked
  loop
    v_request_id := coalesce(v_row.request_id, gen_random_uuid());
    update public.flo_messages
    set request_id = v_request_id,
        status = 'error',
        error_code = 'response_interrupted',
        partial = true,
        completed_at = now()
    where id = v_row.id and status = 'streaming';
    if not found then continue; end if;

    insert into public.flo_usage (
      request_id, message_id, user_id, household_id, conversation_id,
      operation, tool_names, duration_ms, model, status, error_code
    ) values (
      v_request_id, v_row.id, p_user_id, p_household_id, v_row.conversation_id,
      'account_chat_v3', '{}'::text[], greatest(0, floor(extract(epoch from (now() - v_row.started_at)) * 1000)::integer),
      v_row.model, 'error', 'response_interrupted'
    ) on conflict (request_id) where request_id is not null do nothing;

    insert into public.flo_audit_events (
      request_id, user_id, household_id, conversation_id, message_id,
      event_type, parameters, model, policy_version, duration_ms, status, error_code
    ) values (
      v_request_id, p_user_id, p_household_id, v_row.conversation_id, v_row.id,
      'failure', jsonb_build_object('reconciled', true), v_row.model,
      'flo-v3.0.0', greatest(0, floor(extract(epoch from (now() - v_row.started_at)) * 1000)::integer),
      'error', 'response_interrupted'
    ) on conflict (request_id) where event_type in ('answer', 'failure') do nothing;

    if v_row.is_ephemeral then
      delete from public.flo_conversations
      where id = v_row.conversation_id and household_id = p_household_id
        and created_by = p_user_id and is_ephemeral = true;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.reconcile_stale_flo_responses(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.reconcile_stale_flo_responses(uuid, uuid, timestamptz)
  to service_role;
