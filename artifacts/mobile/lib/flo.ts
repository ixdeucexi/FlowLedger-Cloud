import { supabase } from "@/lib/supabase";
import type { DecisionBaselineDay } from "@/lib/decisions";
import {
  FLO_CONNECTION_ERROR_MESSAGE,
  localFloAnswer,
  normalizeFloError,
  normalizeFloReply,
  sanitizeFloSummary,
  type FloChatMessage,
  type FloFacts,
} from "@/lib/floPolicy";

export type { FloFacts } from "@/lib/floPolicy";
export type FloMessage = FloChatMessage;

export async function askFlo(message: string, facts: FloFacts, summary: string, days: DecisionBaselineDay[]): Promise<string> {
  const deterministic = localFloAnswer(message, facts, days);
  if (deterministic) return deterministic;
  const { data, error } = await supabase.functions.invoke("flo-chat", { body: { message, facts, summary } });
  const status = (error as { context?: { status?: number } } | null)?.context?.status;
  if (error) return normalizeFloError(error.message, status);
  if (data?.error === "flo_not_connected") return FLO_CONNECTION_ERROR_MESSAGE;
  return normalizeFloReply(data?.reply);
}

export async function loadFloMemory(userId: string): Promise<string> {
  const { data } = await supabase.from("flo_memory").select("summary").eq("user_id", userId).maybeSingle();
  return data?.summary ?? "";
}

export async function updateFloMemory(userId: string, message: string): Promise<void> {
  const summary = `Recent topic: ${sanitizeFloSummary(message)}`;
  await supabase.from("flo_memory").upsert({ user_id: userId, summary, updated_at: new Date().toISOString() });
}

export async function resetFloMemory(userId: string): Promise<void> {
  await supabase.from("flo_memory").delete().eq("user_id", userId);
}
