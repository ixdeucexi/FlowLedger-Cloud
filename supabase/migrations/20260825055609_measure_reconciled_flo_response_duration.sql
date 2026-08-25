-- The production-applied 20260813204306 migration intentionally remains an
-- exact history snapshot. Improve stale-response telemetry in a follow-up so
-- migration history never needs to be rewritten or replayed.

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
      'account_chat_v3', '{}'::text[],
      least(
        2147483647,
        greatest(0, floor(extract(epoch from (now() - v_row.started_at)) * 1000)::bigint)
      )::integer,
      v_row.model, 'error', 'response_interrupted'
    ) on conflict (request_id) where request_id is not null do nothing;

    insert into public.flo_audit_events (
      request_id, user_id, household_id, conversation_id, message_id,
      event_type, parameters, model, policy_version, duration_ms, status, error_code
    ) values (
      v_request_id, p_user_id, p_household_id, v_row.conversation_id, v_row.id,
      'failure', jsonb_build_object('reconciled', true), v_row.model,
      'flo-v3.0.0',
      least(
        2147483647,
        greatest(0, floor(extract(epoch from (now() - v_row.started_at)) * 1000)::bigint)
      )::integer,
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

;
