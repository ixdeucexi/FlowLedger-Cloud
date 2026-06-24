import { supabase } from "@/lib/supabase";
import type { DecisionBaselineDay } from "@/lib/decisions";
import { localFloAnswer, sanitizeFloSummary, type FloFacts } from "@/lib/floPolicy";

export type { FloFacts } from "@/lib/floPolicy";
export type FloMessage = { id: string; role: "user" | "flo"; text: string };

export async function askFlo(message: string, facts: FloFacts, summary: string, days: DecisionBaselineDay[]): Promise<string> {
  const deterministic = localFloAnswer(message, facts, days);
  if (deterministic) return deterministic;
  const { data, error } = await supabase.functions.invoke("flo-chat", { body: { message, facts, summary } });
  if (error || data?.error === "flo_not_connected") return "I can already answer affordability, forecast-balance, and upcoming-bill questions from FlowLedger’s verified calculations. My broader AI connection still needs its secure OpenAI key before I can help with general app questions.";
  return data?.reply ?? "I couldn't answer that reliably yet.";
}

export async function loadFloMemory(userId: string): Promise<string> {
  const { data } = await supabase.from("flo_memory").select("summary").eq("user_id", userId).maybeSingle(); return data?.summary ?? "";
}
export async function updateFloMemory(userId: string, message: string): Promise<void> {
  const summary = `Recent topic: ${sanitizeFloSummary(message)}`;
  await supabase.from("flo_memory").upsert({ user_id: userId, summary, updated_at: new Date().toISOString() });
}
export async function resetFloMemory(userId: string): Promise<void> { await supabase.from("flo_memory").delete().eq("user_id", userId); }
