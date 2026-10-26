export const FLO_V4_POLICY_VERSION = "flo-v4-preview.0";
export const FLO_V4_MAX_BODY_BYTES = 65_536;
export const FLO_V4_UNSUPPORTED_ANSWER = "I couldn’t verify that request yet. I can help you check recorded balances, bills, income, debt, spending, and buckets, or show you where to find things in the app.";

export type FloV4Request = {
  version: 4;
  householdId: string;
  question: string;
  timezone: string;
  conversationContext?: Array<{ role: "user" | "assistant"; content: string }>;
};

type QueryClient = { from: (table: string) => any };

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function validateFloV4Request(value: unknown): { request?: FloV4Request; error?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "invalid_request" };
  const body = value as Record<string, unknown>;
  if (body.version !== 4) return { error: "flo_v4_required" };
  const allowed = new Set(["version", "householdId", "question", "timezone", "conversationContext"]);
  if (Object.keys(body).some(key => !allowed.has(key))) return { error: "invalid_request" };
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const timezone = typeof body.timezone === "string" ? body.timezone.trim() : "";
  if (!isUuid(body.householdId) || !question || question.length > 4000 || !timezone || timezone.length > 80) return { error: "invalid_request" };
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); } catch { return { error: "invalid_request" }; }
  if (Object.hasOwn(body, "conversationContext")) {
    const context = body.conversationContext;
    if (!Array.isArray(context) || context.length > 12 || context.some(turn => !turn || typeof turn !== "object" || Array.isArray(turn) || Object.keys(turn).some(key => !["role", "content"].includes(key)) || !["user", "assistant"].includes(turn.role) || typeof turn.content !== "string" || !turn.content.trim() || turn.content.length > 2000) || new TextEncoder().encode(JSON.stringify(context)).byteLength > 24_000) return { error: "invalid_request" };
    return { request: { version: 4, householdId: body.householdId, question, timezone, conversationContext: context.map(turn => ({ role: turn.role, content: turn.content })) } };
  }
  return { request: { version: 4, householdId: body.householdId, question, timezone } };
}

export async function authorizeFloV4(client: QueryClient, userId: string, householdId: string): Promise<{ authorized: true; role: "owner" } | { authorized: false; error: string }> {
  const adminResult = await client.from("feedback_admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (adminResult.error) return { authorized: false, error: "authorization_unavailable" };
  if (!adminResult.data || adminResult.data.user_id !== userId) return { authorized: false, error: "preview_access_denied" };

  const preferenceResult = await client.from("user_preferences").select("active_household_id").eq("user_id", userId).maybeSingle();
  if (preferenceResult.error) return { authorized: false, error: "authorization_unavailable" };
  if (preferenceResult.data?.active_household_id !== householdId) return { authorized: false, error: "active_household_access_denied" };

  const membershipResult = await client.from("household_members").select("role,household_id,user_id").eq("household_id", householdId).eq("user_id", userId).maybeSingle();
  if (membershipResult.error) return { authorized: false, error: "authorization_unavailable" };
  const membership = membershipResult.data;
  if (!membership || membership.household_id !== householdId || membership.user_id !== userId) return { authorized: false, error: "active_household_access_denied" };
  if (membership.role !== "owner") return { authorized: false, error: "owner_access_required" };
  return { authorized: true, role: "owner" };
}

export function unsupportedFloV4Result(_now: string) {
  return {
    answer: {
      answer: FLO_V4_UNSUPPORTED_ANSWER,
      claims: [],
      caveat: "No account or plan changes were made.",
      evidenceIds: [],
      followups: [],
    },
    sources: [],
    aggregate: { dataAsOf: null, coverage: { complete: false, reasons: ["unsupported_by_v4_analysis"] }, partial: true },
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

export async function runFloV4Pipeline<T>(runAnalysis: (options: any) => Promise<T | null>, options: any, now: string): Promise<T | ReturnType<typeof unsupportedFloV4Result>> {
  return await runAnalysis(options) ?? unsupportedFloV4Result(now);
}

export function floV4AuditParameters(input: { outcome: string; toolNames?: string[]; partial?: boolean }) {
  return {
    engine: "v4",
    mode: "owner_read_only_history_off",
    outcome: input.outcome.slice(0, 64),
    toolNames: [...new Set(input.toolNames ?? [])].map(value => String(value).slice(0, 80)).slice(0, 40),
    partial: input.partial === true,
  };
}

const publicCodes = new Set(["answer_failed", "answer_timeout", "rate_limited", "daily_limit_reached", "safety_request_rejected", "audit_unavailable", "usage_persistence_failed"]);
export function safeFloV4ErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "answer_failed";
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) return "answer_timeout";
  return publicCodes.has(message) ? message : "answer_failed";
}
