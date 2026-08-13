import { fetch as expoFetch } from "expo/fetch";

import { supabase, supabaseAnonKey, supabaseUrl } from "@/lib/supabase";
import { humanizeFloText } from "@/lib/floLanguage";
import { collectFloHistoryPages, type FloReviewProposal } from "@/lib/floExperience";
import { FLO_CLIENT_RESPONSE_TIMEOUT_MS, isFloTerminalEvent, parseFloSseChunk, type FloSource, type FloStreamEvent } from "@/lib/floStream";

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
  followUps: string[];
  proposal: FloReviewProposal | null;
  dataAsOf?: string;
  coverage?: Record<string, unknown>;
  partial?: boolean;
  caveat?: string;
  createdAt: string;
}

export const FLO_STALE_STREAM_MS = 60_000;

export function mapFloStoredMessage(row: Record<string, any>, now = Date.now()): FloStoredMessage {
  const assistant = row.role === "assistant";
  const createdAt = String(row.created_at);
  const status = String(row.status ?? "completed") as FloStoredMessage["status"];
  const createdTime = Date.parse(createdAt);
  const staleStream = assistant && status === "streaming" && Number.isFinite(createdTime) && now - createdTime >= FLO_STALE_STREAM_MS;
  const storedText = String(row.content ?? "");
  const text = assistant
    ? staleStream
      ? "That earlier Flo check was interrupted. Ask again when you're ready."
      : status === "streaming" && !storedText.trim()
        ? "Flo is finishing this account check..."
        : humanizeFloText(storedText)
    : storedText;
  return {
    id: String(row.id),
    role: assistant ? "flo" : "user",
    text,
    status: staleStream ? "error" : status,
    sources: Array.isArray(row.source_refs) ? row.source_refs as FloSource[] : [],
    followUps: Array.isArray(row.followups) ? row.followups.filter((item: unknown) => typeof item === "string") as string[] : [],
    proposal: row.proposal && typeof row.proposal === "object" ? row.proposal as FloReviewProposal : null,
    dataAsOf: typeof row.data_as_of === "string" ? row.data_as_of : undefined,
    coverage: row.coverage && typeof row.coverage === "object" ? row.coverage as Record<string, unknown> : undefined,
    partial: staleStream || row.partial === true,
    caveat: row.answer && typeof row.answer === "object" && typeof (row.answer as Record<string, unknown>).caveat === "string"
      ? String((row.answer as Record<string, unknown>).caveat).trim().slice(0, 500)
      : undefined,
    createdAt,
  };
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
  return collectFloHistoryPages(async (from, to) => {
    const { data, error } = await supabase
      .from("flo_conversations")
      .select("id,household_id,title,summary,message_count,created_at,updated_at")
      .eq("household_id", householdId)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (error) throw error;
    return (data ?? []).map(row => mapConversation(row as Record<string, unknown>));
  });
}

export async function searchFloConversationContent(conversationIds: string[], query: string): Promise<Set<string>> {
  const needle = query.trim().toLocaleLowerCase().slice(0, 100);
  if (!needle || !conversationIds.length) return new Set();
  const matches = new Set<string>();
  for (let start = 0; start < conversationIds.length; start += 100) {
    const ids = conversationIds.slice(start, start + 100);
    const rows = await collectFloHistoryPages(async (from, to) => {
      const { data, error } = await supabase
        .from("flo_messages")
        .select("conversation_id,content")
        .in("conversation_id", ids)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw error;
      return data ?? [];
    }, 200);
    rows.forEach(row => {
      if (String(row.content ?? "").toLocaleLowerCase().includes(needle)) matches.add(String(row.conversation_id));
    });
  }
  return matches;
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
  const { data, error } = await supabase
    .from("flo_conversations")
    .delete()
    .eq("id", conversationId)
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("Flo chat was not found or could not be deleted.");
}

export async function deleteAllFloConversations(householdId: string): Promise<void> {
  const { error } = await supabase
    .from("flo_conversations")
    .delete()
    .eq("household_id", householdId);
  if (error) throw error;
  const { count, error: verifyError } = await supabase
    .from("flo_conversations")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId);
  if (verifyError) throw verifyError;
  if ((count ?? 0) > 0) throw new Error("Some Flo conversations could not be deleted.");
}

export async function updateFloHouseholdMemory(input: {
  householdId: string;
  userId: string;
  enabled: boolean;
  preferences?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.from("flo_household_memory").upsert({
    household_id: input.householdId,
    user_id: input.userId,
    enabled: input.enabled,
    preferences: input.enabled ? input.preferences ?? {} : {},
    updated_at: new Date().toISOString(),
  }, { onConflict: "household_id,user_id" });
  if (error) throw error;
}

export async function readFloHouseholdMemory(householdId: string, userId: string): Promise<{ enabled: boolean; note: string }> {
  const { data, error } = await supabase
    .from("flo_household_memory")
    .select("enabled,preferences")
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const preferences = data?.preferences && typeof data.preferences === "object" ? data.preferences as Record<string, unknown> : {};
  return {
    enabled: data?.enabled === true,
    note: typeof preferences.note === "string" ? preferences.note.trim().slice(0, 240) : "",
  };
}

export async function resetFloHouseholdMemory(householdId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("flo_household_memory")
    .delete()
    .eq("household_id", householdId)
    .eq("user_id", userId);
  if (error) throw error;
  const { data, error: verifyError } = await supabase
    .from("flo_household_memory")
    .select("household_id")
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .maybeSingle();
  if (verifyError) throw verifyError;
  if (data) throw new Error("Flo memory could not be reset.");
}

export async function confirmFloRecurringBillProposal(proposalId: string): Promise<{
  billId: string;
  previousAmount: number;
  newAmount: number;
  confirmedAt: string;
  auditId: number;
}> {
  const { data, error } = await supabase.rpc("confirm_flo_recurring_bill_proposal", { p_proposal_id: proposalId });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row || typeof row.billId !== "string") throw new Error("proposal_confirmation_invalid");
  const receipt = {
    billId: row.billId,
    previousAmount: Number(row.previousAmount),
    newAmount: Number(row.newAmount),
    confirmedAt: String(row.confirmedAt),
    auditId: Number(row.auditId),
  };
  if (!receipt.billId || !Number.isFinite(receipt.previousAmount) || receipt.previousAmount < 0 || !Number.isFinite(receipt.newAmount) || receipt.newAmount <= 0 || !Number.isFinite(receipt.auditId) || !Number.isFinite(Date.parse(receipt.confirmedAt))) {
    throw new Error("proposal_confirmation_invalid");
  }
  return receipt;
}

export async function readAuthoritativeFloProposal(proposalId: string): Promise<FloReviewProposal> {
  const { data, error } = await supabase
    .from("flo_proposals")
    .select("id,kind,title,summary,payload,reversible,status,expires_at")
    .eq("id", proposalId)
    .single();
  if (error) throw error;
  return {
    id: String(data.id),
    kind: String(data.kind),
    title: String(data.title),
    summary: String(data.summary ?? ""),
    payload: data.payload && typeof data.payload === "object" ? data.payload as Record<string, unknown> : {},
    reversible: data.reversible === true,
    status: String(data.status ?? "review"),
    expiresAt: String(data.expires_at),
  };
}

export async function listFloMessages(
  conversationId: string,
  before?: string,
): Promise<{ messages: FloStoredMessage[]; nextCursor: string | null }> {
  let query = supabase
    .from("flo_messages")
    .select("id,role,content,status,source_refs,proposal,answer,followups,data_as_of,coverage,partial,created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(50);
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  const messages = rows.map(row => mapFloStoredMessage(row as Record<string, any>)).reverse();
  return {
    messages,
    nextCursor: rows.length === 50 ? String(rows[rows.length - 1]?.created_at) : null,
  };
}

export async function streamFloChat(input: {
  conversationId?: string;
  householdId: string;
  userMessageId: string;
  assistantMessageId: string;
  text: string;
  timezone: string;
  context?: { route?: string; entityType?: string; entityId?: string; date?: string; label?: string };
  historyEnabled?: boolean;
  previewTier?: "free" | "pro" | null;
  signal?: AbortSignal;
  onEvent: (event: FloStreamEvent) => void;
}): Promise<void> {
  const requestController = new AbortController();
  let timedOut = false;
  const stopForCaller = () => requestController.abort();
  if (input.signal?.aborted) stopForCaller();
  else input.signal?.addEventListener("abort", stopForCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, FLO_CLIENT_RESPONSE_TIMEOUT_MS);

  try {
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
        version: 3,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        householdId: input.householdId,
        userMessage: { id: input.userMessageId, text: input.text },
        assistantMessageId: input.assistantMessageId,
        context: input.context,
        historyEnabled: input.historyEnabled !== false,
        timezone: input.timezone,
        previewTier: input.previewTier ?? null,
      }),
      signal: requestController.signal,
    });
    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
      throw new Error(payload.error || payload.message || `flo_http_${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let terminal = false;
    let ephemeralCleaned = input.historyEnabled !== false;
    const emit = (event: FloStreamEvent) => {
      if (isFloTerminalEvent(event)) terminal = true;
      if (event.type === "ephemeral-cleanup" && event.status === "completed") ephemeralCleaned = true;
      input.onEvent(event);
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const parsed = parseFloSseChunk(pending, decoder.decode(value, { stream: true }));
      pending = parsed.pending;
      parsed.events.forEach(emit);
    }
    const final = parseFloSseChunk(pending, "\n\n");
    final.events.forEach(emit);
    if (!terminal) throw new Error("flo_stream_incomplete");
    if (!ephemeralCleaned) throw new Error("ephemeral_cleanup_failed");
  } catch (error) {
    if (timedOut) throw new Error("flo_timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", stopForCaller);
  }
}

export async function listAllFloMessages(conversationId: string): Promise<FloStoredMessage[]> {
  const rows = await collectFloHistoryPages(async (from, to) => {
    const { data, error } = await supabase
      .from("flo_messages")
      .select("id,role,content,status,source_refs,proposal,answer,followups,data_as_of,coverage,partial,created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw error;
    return data ?? [];
  });
  return rows.map(row => mapFloStoredMessage(row as Record<string, any>));
}
