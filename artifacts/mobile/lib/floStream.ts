import type { FloReviewProposal } from "./floExperience";

export const FLO_CLIENT_RESPONSE_TIMEOUT_MS = 35_000;

export function isFloTimeoutCode(value: unknown): boolean {
  return value === "answer_timeout" || value === "flo_timeout";
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
