export type FloHistoryItem = {
  id: string;
  title: string;
  summary?: string;
  updatedAt: string;
};

export type FloEvidenceRef = {
  id?: string;
  type: string;
  label: string;
  recordId?: string;
  dateRange?: { start?: string; end?: string } | string;
  asOf?: string | null;
  freshness?: "live" | "recent" | "stale" | "unknown" | string;
  route?: string;
};

export type FloReviewProposal = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  impact?: string | Record<string, unknown>;
  reversible?: boolean;
  expiresAt?: string;
  status?: "draft" | "expired" | "reviewed" | string;
  payload?: Record<string, unknown>;
};

export function floProposalMatchesAuthoritative(message: FloReviewProposal, authoritative: FloReviewProposal): boolean {
  const messagePayload = message.payload ?? {};
  const authoritativePayload = authoritative.payload ?? {};
  return message.id === authoritative.id
    && message.kind === authoritative.kind
    && String(messagePayload.billId ?? "") === String(authoritativePayload.billId ?? "")
    && Number(messagePayload.newAmount) === Number(authoritativePayload.newAmount)
    && Number(messagePayload.expectedAmount) === Number(authoritativePayload.expectedAmount)
    && String(message.expiresAt ?? "") === String(authoritative.expiresAt ?? "");
}

export function isFloRequestGenerationCurrent(requestGeneration: number, currentGeneration: number): boolean {
  return requestGeneration === currentGeneration;
}

export function nextFloRequestGeneration(currentGeneration: number): number {
  return Number.isSafeInteger(currentGeneration) && currentGeneration >= 0 ? currentGeneration + 1 : 1;
}

export function floConversationForRequest(historyEnabled: boolean, activeConversationId: string | null): string | null {
  return historyEnabled ? activeConversationId : null;
}

export function floEphemeralCleanupError(cleanedUp: boolean | undefined): string | null {
  return cleanedUp === false ? "Flo answered, but the private temporary chat could not be cleaned up. Retry cleanup before continuing." : null;
}

const FLO_SOURCE_ROUTES = new Set([
  "/(tabs)",
  "/(tabs)/accounts",
  "/(tabs)/bills",
  "/(tabs)/category-budget",
  "/(tabs)/monthly",
  "/(tabs)/more",
  "/(tabs)/review",
  "/(tabs)/transactions",
  "/plan-simulator",
  "/snowball-plan",
]);

export function searchFloHistory<T extends FloHistoryItem>(items: T[], query: string): T[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return items;
  return items.filter(item => `${item.title} ${item.summary ?? ""}`.toLocaleLowerCase().includes(normalized));
}

export async function collectFloHistoryPages<T>(
  loadPage: (from: number, to: number) => Promise<T[]>,
  pageSize = 50,
): Promise<T[]> {
  const size = Math.max(1, Math.min(500, Math.floor(pageSize)));
  const collected: T[] = [];
  for (let from = 0; ; from += size) {
    const page = await loadPage(from, from + size - 1);
    collected.push(...page);
    if (page.length < size) return collected;
  }
}

export function safeFloSourceRoute(route?: string): string | null {
  if (!route || /[\\\u0000-\u001f\u007f]/.test(route) || route.includes("..") || route.startsWith("//") || route.includes("://")) return null;
  const pathname = route.split(/[?#]/, 1)[0];
  if (!FLO_SOURCE_ROUTES.has(pathname)) return null;
  return route;
}

export function floFreshnessLabel(asOf?: string | null, now = new Date()): string {
  if (!asOf) return "Freshness unavailable";
  const parsed = new Date(asOf);
  if (!Number.isFinite(parsed.getTime())) return "Freshness unavailable";
  const minutes = Math.max(0, Math.round((now.getTime() - parsed.getTime()) / 60_000));
  if (minutes < 2) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Updated ${hours} hr ago`;
  return `Updated ${parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

export function oldestFloSourceAsOf(sources: Array<{ asOf?: string | null }>): string | undefined {
  let oldest: { value: string; timestamp: number } | undefined;
  for (const source of sources) {
    if (!source.asOf) continue;
    const timestamp = Date.parse(source.asOf);
    if (!Number.isFinite(timestamp)) continue;
    if (!oldest || timestamp < oldest.timestamp) oldest = { value: source.asOf, timestamp };
  }
  return oldest?.value;
}

export function exportFloHistoryText(
  householdName: string,
  conversations: FloHistoryItem[],
): string {
  const header = `FlowLedger Flo history - ${householdName}\nExported ${new Date().toISOString()}\n`;
  const rows = conversations.map(item => {
    const summary = item.summary?.trim() ? `\n${item.summary.trim()}` : "";
    return `\n${item.title}\nUpdated ${item.updatedAt}${summary}`;
  });
  return `${header}${rows.join("\n")}\n`;
}
