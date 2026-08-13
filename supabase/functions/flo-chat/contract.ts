export const FLO_V3_POLICY_VERSION = "flo-v3.0.0";
export const FLO_V3_MAX_TOOL_STEPS = 8;
export const FLO_V3_MAX_ROWS = 200;
export const FLO_V3_MAX_BODY_BYTES = 65_536;

export type FloCoverage = {
  complete: boolean;
  returned: number;
  limit: number;
  startDate?: string;
  endDate?: string;
  exclusions?: string[];
  reason?: string;
};

export type FloSourceRef = {
  id: string;
  type: string;
  label: string;
  recordId?: string;
  route?: string;
  asOf: string | null;
  freshness: "current" | "stale" | "unknown";
  startDate?: string;
  endDate?: string;
};

export type FloToolEnvelope = {
  status: "ok" | "partial" | "unavailable";
  dataAsOf: string | null;
  coverage: FloCoverage;
  evidence: FloSourceRef[];
  records: unknown[];
  summary?: Record<string, unknown>;
  message?: string;
};

export type FloProposal = {
  id: string;
  kind: "planned_decision" | "bill_date_change" | "category_budget_change" | "extra_debt_payment" | "recurring_bill_change";
  title: string;
  summary: string;
  impact?: Record<string, unknown>;
  reversible: boolean;
  expiresAt: string;
  status: "review" | "confirmed" | "expired" | "rejected" | "failed";
  payload: Record<string, unknown>;
};

export type FloGroundedAnswer = {
  answer: string;
  claims: Array<{
    kind: "amount" | "date" | "entity" | "count" | "status";
    label: string;
    field: string;
    value: string;
    evidenceIds: string[];
  }>;
  caveat: string | null;
  evidenceIds: string[];
  followups: string[];
};

export type FloCapabilityGuidance = {
  answer: string;
  source: FloSourceRef;
};

export type FloVerifiedFallback = {
  answer: string;
  sources: FloSourceRef[];
  dataAsOf: string | null;
  coverage: Record<string, unknown>;
  partial: true;
  caveat: string;
  followups: string[];
};

const helpSource = (id: string, label: string, route: string): FloSourceRef => ({
  id: `help:${id}`,
  type: "help",
  label,
  route,
  asOf: null,
  freshness: "unknown",
});

export function floCapabilityGuidance(question: string): FloCapabilityGuidance | null {
  const normalized = question.trim().toLowerCase();
  if (/\bflow\s*score\b/.test(normalized)) {
    return {
      answer: "Flo cannot verify the exact Flow Score breakdown in chat yet. Open How FlowLedger Works to see the factors the live Dashboard uses and what each part means.",
      source: helpSource("flow-score", "How FlowLedger Works", "/(tabs)/how-flowledger-works"),
    };
  }
  if ((/\b(?:safe|safely|afford|extra)\b.*\bdebt\b/.test(normalized) || /\bdebt\b.*\b(?:safe|safely|afford|extra)\b/.test(normalized))) {
    return {
      answer: "The Debt Payoff Planner is the verified place to test a safe extra debt payment because it uses your full Forecast. Open the planner to preview the amount and date without changing your plan.",
      source: helpSource("debt-payoff-planner", "Debt Payoff Planner", "/snowball-plan"),
    };
  }
  if (/\b(?:can i afford|safe to spend|spend safely|safe cushion|lowest (?:projected )?balance|until payday|through payday)\b/.test(normalized)) {
    return {
      answer: "Use Plan Simulator to test this against the live Forecast without changing your real plan. Flo cannot reproduce that full safety calculation in chat yet.",
      source: helpSource("plan-simulator", "Plan Simulator", "/plan-simulator"),
    };
  }
  return null;
}

export function verifiedFallbackForTool(
  question: string,
  toolName: string,
  payload: FloToolEnvelope,
): FloVerifiedFallback {
  const normalized = question.toLowerCase();
  const safeDebtQuestion = toolName === "getBillsAndDebt"
    && (/\b(?:safe|safely|afford|extra)\b.*\bdebt\b/.test(normalized) || /\bdebt\b.*\b(?:safe|safely|afford|extra)\b/.test(normalized));
  const routes: Record<string, { label: string; route: string; answer: string }> = {
    getAccountOverview: { label: "Accounts", route: "/(tabs)/more", answer: "I checked your account records, but the full explanation did not finish. Open Accounts to review the verified balances, or tap Retry." },
    searchTransactions: { label: "Activity", route: "/(tabs)/transactions", answer: "I checked your recent Activity records, but the full explanation did not finish. Open Activity to review them, or tap Retry." },
    getBillsAndDebt: { label: "Bills and debt", route: "/(tabs)/bills", answer: "I checked your bills and debt records, but the full explanation did not finish. Open Bills to review them, or tap Retry." },
    getBillPlanDetails: { label: "Forecast", route: "/(tabs)/monthly", answer: "I checked the planned payment records, but the full explanation did not finish. Open Forecast to review the plan, or tap Retry." },
    getIncomeSchedule: { label: "Income", route: "/(tabs)/bills", answer: "I checked your income schedule, but the full explanation did not finish. Open Bills to review it, or tap Retry." },
    getBudgetsAndGoals: { label: "Budgets and goals", route: "/(tabs)/bills", answer: "I checked your budgets and goals, but the full explanation did not finish. Open Bills to review them, or tap Retry." },
    getDecisionsAndSimulations: { label: "Plan Simulator", route: "/plan-simulator", answer: "I checked your saved plans and simulations, but the full explanation did not finish. Open Plan Simulator to review them, or tap Retry." },
    getDebtPlanHistory: { label: "Debt Payoff Planner", route: "/snowball-plan", answer: "I checked your debt-plan history, but the full explanation did not finish. Open the Debt Payoff Planner to review it, or tap Retry." },
    getConnectionHealth: { label: "Connected accounts", route: "/(tabs)/more", answer: "I checked your connection records, but the full explanation did not finish. Open Accounts to review connection status, or tap Retry." },
    getHouseholdAndSettings: { label: "Settings", route: "/(tabs)/more", answer: "I checked your household settings, but the full explanation did not finish. Open Settings to review them, or tap Retry." },
    getFlowLedgerHelp: { label: "FlowLedger guide", route: "/(tabs)/more", answer: "I found the FlowLedger guidance, but the full explanation did not finish. Open Settings and the User Guide, or tap Retry." },
  };
  const destination = safeDebtQuestion
    ? { label: "Debt Payoff Planner", route: "/snowball-plan", answer: "The Debt Payoff Planner is the verified place to test a safe extra debt payment because it uses your full Forecast. Open the planner to preview the amount and date without changing your plan." }
    : routes[toolName] ?? { label: "FlowLedger", route: "/(tabs)/index", answer: "I checked the requested FlowLedger records, but the full explanation did not finish. Tap Retry to check again." };
  const sources = payload.evidence.length
    ? payload.evidence.slice(0, 12)
    : [helpSource(`recovery-${toolName}`, destination.label, destination.route)];
  if (!sources.some(source => source.route === destination.route)) {
    sources.push(helpSource(`recovery-${toolName}`, destination.label, destination.route));
  }
  return {
    answer: destination.answer,
    sources,
    dataAsOf: payload.dataAsOf,
    coverage: {
      complete: false,
      tools: 1,
      partialTools: payload.status === "ok" && payload.coverage.complete ? 0 : 1,
      exclusions: payload.coverage.exclusions ?? [],
      reasons: ["assistant_synthesis_unavailable", ...(payload.coverage.reason ? [payload.coverage.reason] : [])],
      dateRanges: payload.coverage.startDate || payload.coverage.endDate
        ? [{ startDate: payload.coverage.startDate, endDate: payload.coverage.endDate }]
        : [],
    },
    partial: true,
    caveat: "Flo completed the account check, but used a verified recovery answer because the full explanation was interrupted.",
    followups: [],
  };
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

export function boundedLimit(value: unknown, fallback = 50): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(FLO_V3_MAX_ROWS, Math.floor(parsed)));
}

export function sanitizeContext(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const output: Record<string, string> = {};
  for (const key of ["route", "entityType", "entityId", "date", "label"]) {
    const candidate = input[key];
    if (typeof candidate === "string" && candidate.trim()) output[key] = candidate.trim().slice(0, key === "label" ? 100 : 120);
  }
  return Object.keys(output).length ? output : undefined;
}

export function safeSearchTerm(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/[%_*,()]/g, " ").replace(/\s+/g, " ").slice(0, 80);
  return cleaned || undefined;
}

export function money(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

export function freshness(asOf: unknown, now = Date.now()): FloSourceRef["freshness"] {
  const parsed = Date.parse(String(asOf ?? ""));
  if (!Number.isFinite(parsed)) return "unknown";
  return now - parsed <= 7 * 86_400_000 ? "current" : "stale";
}

function numericLeavesForClaim(value: unknown, field: string, output: number[]) {
  if (Array.isArray(value)) return value.forEach(item => numericLeavesForClaim(item, field, output));
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === field && typeof item === "number" && Number.isFinite(item)) {
      const normalized = money(item); if (normalized !== null) output.push(normalized);
    }
    if (item && typeof item === "object") numericLeavesForClaim(item, field, output);
  }
}

function leafValuesAtField(value: unknown, field: string, output: unknown[]) {
  if (Array.isArray(value)) return value.forEach(item => leafValuesAtField(item, field, output));
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === field && (typeof item === "string" || typeof item === "boolean")) output.push(item);
    if (item && typeof item === "object") leafValuesAtField(item, field, output);
  }
}

function recordMatchesSource(value: unknown, recordId: string): unknown[] {
  const matches: unknown[] = [];
  const visit = (item: unknown) => {
    if (Array.isArray(item)) return item.forEach(visit);
    if (!item || typeof item !== "object") return;
    const row = item as Record<string, unknown>;
    const candidate = row.id ?? row.account_id ?? row.category ?? row.household_id;
    if (candidate != null && String(candidate) === recordId) matches.push(row);
    Object.values(row).forEach(visit);
  };
  visit(value);
  return matches;
}

export function validateGroundedAnswer(
  answer: FloGroundedAnswer,
  evidence: FloSourceRef[],
  toolPayloads: FloToolEnvelope[],
): { valid: boolean; code?: string } {
  if (!answer.answer.trim() || answer.answer.length > 4000) return { valid: false, code: "invalid_answer" };
  const knownIds = new Set(evidence.map(source => source.id));
  if (!answer.evidenceIds.length || answer.evidenceIds.some(id => !knownIds.has(id))) {
    return { valid: false, code: "unverified_evidence" };
  }
  if (answer.followups.length > 6 || answer.claims.length > 12) return { valid: false, code: "answer_too_large" };
  if (answer.followups.some(value => /[$%\d]|\b(?:afford|safe|healthy|dangerous|stable|unstable)\b/i.test(value))) return { valid: false, code: "unsafe_followup" };
  if (answer.claims.some(claim => !claim.evidenceIds.length || claim.evidenceIds.some(id => !knownIds.has(id)))) {
    return { valid: false, code: "unverified_claim" };
  }
  const sourceById = new Map(evidence.map(source => [source.id, source]));
  for (const claim of answer.claims) {
    const scopedRecords = claim.evidenceIds.flatMap(id => {
      const source = sourceById.get(id);
      if (!source?.recordId) return [];
      return toolPayloads
        .filter(payload => payload.evidence.some(item => item.id === id))
        .flatMap(payload => recordMatchesSource({ records: payload.records, summary: payload.summary }, source.recordId!));
    });
    const fieldLeaves: unknown[] = [];
    leafValuesAtField(scopedRecords, claim.field, fieldLeaves);
    if (!scopedRecords.length && !claim.evidenceIds.every(id => id.startsWith("policy:") || id.startsWith("help:"))) {
      return { valid: false, code: "evidence_record_missing" };
    }
    if (claim.kind === "amount" || claim.kind === "count") {
      const claimed = money(claim.value.replace(/[$,%]/g, "").replace(/,/g, ""));
      const supported: number[] = [];
      numericLeavesForClaim(scopedRecords, claim.field, supported);
      if (claimed === null || !supported.some(value => Math.abs(value - claimed) < 0.005)) return { valid: false, code: "unsupported_amount" };
    } else if (!claim.value.trim() || (!claim.evidenceIds.every(id => id.startsWith("policy:") || id.startsWith("help:")) && !fieldLeaves.some(value => String(value).trim().toLowerCase() === claim.value.trim().toLowerCase()))) {
      return { valid: false, code: "unsupported_claim" };
    }
  }
  const payloadText = JSON.stringify(toolPayloads.map(payload => ({ records: payload.records, summary: payload.summary, coverage: payload.coverage, evidence: payload.evidence }))).toLowerCase();

  const proseDates = Array.from(answer.answer.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)).map(match => match[0].toLowerCase());
  if (proseDates.some(value => !payloadText.includes(value))) return { valid: false, code: "unsupported_date" };
  const claimNumbers = answer.claims.flatMap(claim => Array.from(claim.value.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)))
    .map(match => Number(match[0].replace(/,/g, ""))).filter(Number.isFinite);
  const proseNumbers = Array.from(answer.answer.matchAll(/-?\d[\d,]*(?:\.\d+)?/g))
    .map(match => Number(match[0].replace(/,/g, ""))).filter(Number.isFinite);
  if (proseNumbers.some(value => !claimNumbers.some(claim => Math.abs(claim - value) < 0.0001))) return { valid: false, code: "unstructured_numeric_claim" };
  return { valid: true };
}

export function aggregateCoverage(payloads: FloToolEnvelope[]) {
  const partial = payloads.length === 0 || payloads.some(payload => payload.status !== "ok" || !payload.coverage.complete);
  const dates = payloads.map(payload => payload.dataAsOf ? Date.parse(payload.dataAsOf) : Number.NaN).filter(Number.isFinite);
  return {
    partial,
    dataAsOf: dates.length ? new Date(Math.min(...dates)).toISOString() : null,
    coverage: {
      complete: !partial,
      tools: payloads.length,
      partialTools: payloads.filter(payload => payload.status !== "ok" || !payload.coverage.complete).length,
      exclusions: Array.from(new Set(payloads.flatMap(payload => payload.coverage.exclusions ?? []))),
      reasons: Array.from(new Set(payloads.map(payload => payload.coverage.reason).filter((value): value is string => Boolean(value)))),
      dateRanges: payloads.filter(payload => payload.coverage.startDate || payload.coverage.endDate).map(payload => ({ startDate: payload.coverage.startDate, endDate: payload.coverage.endDate })),
    },
  };
}
