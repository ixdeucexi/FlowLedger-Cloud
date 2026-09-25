import type { FloReviewProposal } from "./floExperience";

// Must remain comfortably above the Edge Function's hard answer deadline so
// a verified multi-tool answer is not canceled by the app during synthesis.
export const FLO_CLIENT_RESPONSE_TIMEOUT_MS = 50_000;

export function isFloTimeoutCode(value: unknown): boolean {
  return value === "answer_timeout" || value === "flo_timeout";
}

export type FloFailureDisplay = { answer: string; action: string; retryable: boolean };

export function floFailureDisplay(code: unknown): FloFailureDisplay {
  if (code === "session_required" || code === "flo_http_401") {
    return { answer: "Your sign-in has expired, so I couldn't open your account records.", action: "Sign in again, then ask your question.", retryable: false };
  }
  if (code === "active_household_access_denied" || code === "authorization_failed") {
    return { answer: "I couldn't confirm access to the household selected for this chat.", action: "Choose your household again from the account menu, then reopen Flo.", retryable: false };
  }
  if (code === "conversation_deleted") {
    return { answer: "This chat was deleted while I was answering.", action: "Tap New to start a new chat and continue.", retryable: false };
  }
  if (code === "conversation_access_denied" || code === "conversation_closed" || code === "message_id_conflict") {
    return { answer: "This conversation is no longer available for that request.", action: "Tap New and ask your question in a new chat.", retryable: false };
  }
  if (code === "rate_limited" || code === "flo_http_429") {
    return { answer: "I've received too many questions in a short time.", action: "Wait a minute, then tap Retry.", retryable: true };
  }
  if (code === "usage_limited") {
    return { answer: "You've reached today's Flo question limit.", action: "Try again tomorrow. Your account screens and calculations are still available.", retryable: false };
  }
  if (code === "pro_required") {
    return { answer: "Account chat isn't included in the plan currently enabled for this household.", action: "Check your membership in Settings.", retryable: false };
  }
  if (code === "request_too_large" || code === "invalid_request") {
    return { answer: "I couldn't accept that question.", action: "Keep your question under 4,000 characters and send it again.", retryable: false };
  }
  if (code === "flo_v3_required") {
    return { answer: "This version of Flo needs an app update before I can answer.", action: "Close and reopen FlowLedger to load the latest version.", retryable: false };
  }
  if (code === "request_in_progress") {
    return { answer: "I'm still working on the earlier attempt at this question.", action: "Wait a moment, then reopen this chat or tap Retry.", retryable: true };
  }
  if (isFloTimeoutCode(code)) {
    return { answer: "I needed more time to verify this answer. Nothing changed in your plan.", action: "Tap Retry to check again.", retryable: true };
  }
  if (code === "audit_unavailable" || code === "terminal_persistence_failed" || code === "message_persistence_failed" || code === "ephemeral_conversation_failed") {
    return { answer: "I couldn't save this account check, so I couldn't finish the answer.", action: "Tap Retry. If it happens again, start a new chat.", retryable: true };
  }
  if (code === "flo_not_connected" || code === "server_configuration") {
    return { answer: "Flo's answer service is temporarily unavailable.", action: "Try again later. Your account screens and calculations are still available.", retryable: true };
  }
  return { answer: "I couldn't verify an answer from your account just now.", action: "Check your connection, then tap Retry to check your account again.", retryable: true };
}

export type FloSource = {
  id?: string;
  type: string;
  label: string;
  recordId?: string;
  route?: string;
  asOf?: string | null;
  freshness?: "current" | "stale" | "unknown" | string;
  startDate?: string;
  endDate?: string;
};

export type FloGroundedAnswer = {
  answer: string;
  claims?: Array<{ kind: string; label: string; value: string; evidenceIds: string[] }>;
  caveat?: string | null;
  evidenceIds?: string[];
  followups?: string[];
  dataAsOf?: string | null;
  coverage?: Record<string, unknown>;
  partial?: boolean;
};

export type FloVerifiedFallback = {
  answer: string;
  sources: FloSource[];
  dataAsOf?: string | null;
  coverage?: Record<string, unknown>;
  partial: true;
  caveat?: string;
  followups?: string[];
};

export type FloStreamEvent =
  | { type: "meta"; version?: number; conversationId: string; assistantMessageId: string; model?: string; asOf?: string; dataAsOf?: string | null; coverage?: Record<string, unknown>; partial?: boolean }
  | { type: "status"; message: string }
  | { type: "verified-fallback"; fallback: FloVerifiedFallback }
  | { type: "text-delta"; delta: string }
  | { type: "sources"; sources: FloSource[] }
  | { type: "followups"; items: string[] }
  | { type: "proposal"; proposal: FloReviewProposal | null }
  | { type: "ephemeral-cleanup"; status: "completed" }
  | { type: "done"; messageId: string; text?: string; answer?: FloGroundedAnswer }
  | { type: "error"; code: string; message: string };

export function isFloTerminalEvent(event: FloStreamEvent): boolean {
  return event.type === "done" || event.type === "error";
}

export function floStreamErrorCode(event: FloStreamEvent): string | null {
  return event.type === "error" ? event.code : null;
}

export function parseFloSseChunk(
  pending: string,
  chunk: string,
): { pending: string; events: FloStreamEvent[] } {
  const normalized = (pending + chunk).replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: FloStreamEvent[] = [];
  for (const block of blocks) {
    const data = block.split("\n")
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    try {
      const event = JSON.parse(data) as FloStreamEvent;
      if (event && typeof event.type === "string") events.push(event);
    } catch {
      // Ignore malformed events and preserve the rest of the stream.
    }
  }
  return { pending: rest, events };
}
