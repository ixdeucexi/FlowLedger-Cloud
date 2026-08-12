-- Trigger helpers are internal implementation details, not Data API RPCs.
-- Triggers continue to execute as their owning role after these grants are removed.
revoke all on function public.sync_flo_conversation_message_count()
  from public, anon, authenticated;
revoke all on function public.guard_flo_ephemeral_conversations()
  from public, anon, authenticated;
revoke all on function public.guard_flo_assistant_messages()
  from public, anon, authenticated;
