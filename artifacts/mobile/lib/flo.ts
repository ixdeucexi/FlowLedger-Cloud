import { supabase } from "@/lib/supabase";
import type { DecisionBaselineDay } from "@/lib/decisions";
import {
  FLO_CONNECTION_ERROR_MESSAGE,
  FLO_SECURITY_REFUSAL_MESSAGE,
  isUnsafeFloRequest,
  localFloAnswer,
  normalizeFloError,
  normalizeFloReply,
  sanitizeFloFacts,
  sanitizeFloSummary,
  type FloChatMessage,
  type FloFacts,
} from "@/lib/floPolicy";

export type { FloFacts } from "@/lib/floPolicy";
export type FloMessage = FloChatMessage;

export async function askFlo(message: string, facts: FloFacts, summary: string, days: DecisionBaselineDay[]): Promise<string> {
  if (isUnsafeFloRequest(message)) return FLO_SECURITY_REFUSAL_MESSAGE;
  const deterministic = localFloAnswer(message, facts, days);
  if (deterministic) return deterministic;
  const { data, error } = await supabase.functions.invoke("flo-chat", { body: { message, facts: sanitizeFloFacts(facts), summary: sanitizeFloSummary(summary) } });
  const status = (error as { context?: { status?: number } } | null)?.context?.status;
  if (error) return normalizeFloError(error.message, status);
  if (data?.error === "flo_not_connected") return FLO_CONNECTION_ERROR_MESSAGE;
  return normalizeFloReply(data?.reply);
}
