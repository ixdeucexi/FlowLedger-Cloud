import { fetch as expoFetch } from "expo/fetch";

import { supabase, supabaseAnonKey, supabaseUrl } from "@/lib/supabase";
import type { FloFacts } from "@/lib/floPolicy";
import { parseFloSseChunk, type FloSource, type FloStreamEvent } from "@/lib/floStream";

export { parseFloSseChunk } from "@/lib/floStream";
export type { FloSource, FloStreamEvent } from "@/lib/floStream";

export interface FloConversation {
  id: string;
  householdId: string;
  title: string;
  summary: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FloStoredMessage {
  id: string;
  role: "user" | "flo";
  text: string;
  status: "pending" | "streaming" | "completed" | "error" | "stopped";
  sources: FloSource[];
  createdAt: string;
}

export function createFloId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, token => {
    const value = Math.floor(Math.random() * 16);
    return (token === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

function mapConversation(row: Record<string, unknown>): FloConversation {
  return {
    id: String(row.id),
    householdId: String(row.household_id),
    title: String(row.title || "New Flo chat"),
    summary: String(row.summary || ""),
    messageCount: Number(row.message_count || 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function listFloConversations(householdId: string): Promise<FloConversation[]> {
  const { data, error } = await supabase
    .from("flo_conversations")
    .select("id,household_id,title,summary,message_count,created_at,updated_at")
    .eq("household_id", householdId)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map(row => mapConversation(row as Record<string, unknown>));
}

export async function createFloConversation(userId: string, householdId: string, firstPrompt: string): Promise<FloConversation> {
  const title = firstPrompt.replace(/\s+/g, " ").trim().slice(0, 48) || "New Flo chat";
  const id = createFloId();
  const { data, error } = await supabase
    .from("flo_conversations")
    .insert({ id, household_id: householdId, created_by: userId, title })
    .select("id,household_id,title,summary,message_count,created_at,updated_at")
    .single();
  if (error) throw error;
  return mapConversation(data as Record<string, unknown>);
}

export async function renameFloConversation(conversationId: string, title: string): Promise<void> {
  const nextTitle = title.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!nextTitle) return;
  const { error } = await supabase
    .from("flo_conversations")
    .update({ title: nextTitle, updated_at: new Date().toISOString() })
    .eq("id", conversationId);
  if (error) throw error;
}

export async function deleteFloConversation(conversationId: string): Promise<void> {
  const { error } = await supabase.from("flo_conversations").delete().eq("id", conversationId);
  if (error) throw error;
}

export async function listFloMessages(
  conversationId: string,
  before?: string,
): Promise<{ messages: FloStoredMessage[]; nextCursor: string | null }> {
  let query = supabase
    .from("flo_messages")
    .select("id,role,content,status,source_refs,created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(50);
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  const messages = rows.map(row => ({
    id: String(row.id),
    role: row.role === "assistant" ? "flo" as const : "user" as const,
    text: String(row.content ?? ""),
    status: String(row.status ?? "completed") as FloStoredMessage["status"],
    sources: Array.isArray(row.source_refs) ? row.source_refs as FloSource[] : [],
    createdAt: String(row.created_at),
  })).reverse();
  return {
    messages,
    nextCursor: rows.length === 50 ? String(rows[rows.length - 1]?.created_at) : null,
  };
}

export async function streamFloChat(input: {
  conversationId: string;
  householdId: string;
  userMessageId: string;
  assistantMessageId: string;
  text: string;
  facts: FloFacts;
  asOf: string;
  timezone: string;
  previewTier?: "free" | "pro" | null;
  signal?: AbortSignal;
  onEvent: (event: FloStreamEvent) => void;
}): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("session_required");
  const response = await expoFetch(`${supabaseUrl}/functions/v1/flo-chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      version: 2,
      conversationId: input.conversationId,
      householdId: input.householdId,
      userMessage: { id: input.userMessageId, text: input.text },
      assistantMessageId: input.assistantMessageId,
      snapshot: { asOf: input.asOf, facts: input.facts },
      timezone: input.timezone,
      previewTier: input.previewTier ?? null,
    }),
    signal: input.signal,
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
    throw new Error(payload.error || payload.message || `flo_http_${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const parsed = parseFloSseChunk(pending, decoder.decode(value, { stream: true }));
    pending = parsed.pending;
    parsed.events.forEach(input.onEvent);
  }
  const final = parseFloSseChunk(pending, "\n\n");
  final.events.forEach(input.onEvent);
}

export async function persistFloFallback(input: {
  id: string;
  conversationId: string;
  householdId: string;
  userId: string;
  text: string;
}): Promise<void> {
  await supabase.from("flo_messages").upsert({
    id: input.id,
    conversation_id: input.conversationId,
    household_id: input.householdId,
    created_by: input.userId,
    role: "assistant",
    content: input.text,
    status: "completed",
    source_refs: [{ type: "deterministic", label: "FlowLedger calculation", asOf: new Date().toISOString() }],
    completed_at: new Date().toISOString(),
  }, { onConflict: "id" });
}
