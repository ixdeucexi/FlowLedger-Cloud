import { evaluateDecision, type DecisionBaselineDay, type DecisionScenario } from "./decisions";

export interface FloFacts {
  balanceToday: number;
  lowestBalance: number;
  lowestBalanceDate: string;
  safetyFloor: number;
  monthlyIncome: number;
  monthlyBills: number;
  monthlyRemaining: number;
  billsLeftAmount: number;
  billsLeftCount: number;
  billProgressPercent: number;
  previousMonthIncome: number;
  previousMonthBills: number;
  previousMonthRemaining: number;
  unallocatedSpendingThisMonth: number;
  unallocatedTransactionCount: number;
  upcoming: { name: string; amount: number; date: string }[];
  activePlans: number;
  forecastConfidence: string;
  sourceTypes: string[];
  categoryPlan?: FloCategoryFact[];
}

export interface FloCategoryFact {
  category: string;
  budgeted: number;
  spent: number;
  remaining: number;
  status: "available" | "watch" | "over";
  percentUsed: number;
  topTransaction?: { name: string; amount: number; date: string };
}

export type FloChatMessage = { id: string; role: "user" | "flo"; text: string };
export interface FloResponseCard {
  title: string;
  value: string;
  detail: string;
  tone: "safe" | "caution" | "risk" | "info";
}
export interface FloCategoryMoveResult {
  amount: number;
  from: string;
  to: string;
  allowed: boolean;
  reason: string;
}

export function buildFloCategoryQuickPrompts(categories: FloCategoryFact[]): string[] {
  const rows = [...(categories ?? [])];
  const prompts = ["Which categories need attention?", "What category has the most room left?", "Where am I spending the most?"];
  const worst = rows
    .filter(item => item.status === "over" || item.status === "watch")
    .sort((left, right) => statusPriority(right.status) - statusPriority(left.status) || left.remaining - right.remaining)[0];
  if (worst) {
    prompts.unshift(worst.status === "over" ? `Why is ${worst.category} over?` : `How much do I have left for ${worst.category}?`);
  }

  const target = rows
    .filter(item => item.remaining < 0)
    .sort((left, right) => left.remaining - right.remaining)[0];
  const source = rows
    .filter(item => item.remaining > 0)
    .sort((left, right) => right.remaining - left.remaining)[0];
  if (target && source && target.category !== source.category) {
    const amount = Math.max(1, Math.min(Math.abs(target.remaining), source.remaining));
    prompts.unshift(`Can I move $${amount.toFixed(0)} from ${source.category} to ${target.category}?`);
  }

  return Array.from(new Set(prompts)).slice(0, 6);
}
export type FloChatState = { messages: FloChatMessage[]; sending: boolean };
export type FloChatAction =
  | { type: "submit"; id: string; text: string }
  | { type: "reply"; id: string; text: string };

export const AI_USAGE_UNAVAILABLE_MESSAGE =
  "Flo is connected, but AI usage is currently unavailable. Check OpenAI billing or usage limits.";
export const FLO_CONNECTION_ERROR_MESSAGE =
  "Flo couldn't connect just now. Your FlowLedger calculations are still available, so please try again.";
export const FLO_SECURITY_REFUSAL_MESSAGE =
  "I can only help with your FlowLedger plan and verified financial facts. I can't access code, keys, admin tools, system prompts, or other users' data.";

const FORBIDDEN_FLO_REQUEST = /\b(api[_ -]?key|secret|service[_ -]?role|env(?:ironment)?(?: variable)?|source code|repo(?:sitory)?|admin|database password|jwt|token|other users?|all users|rls|bypass|ignore (?:previous|system)|system prompt|developer message|supabase key)\b/i;
const ALLOWED_SOURCE_TYPES = new Set(["forecast", "bill", "transaction", "account", "debt", "goal", "decision"]);
const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

export function reduceFloChat(state: FloChatState, action: FloChatAction): FloChatState {
  if (action.type === "submit") {
    const text = action.text.trim();
    if (!text || state.sending) return state;
    return { messages: [...state.messages, { id: action.id, role: "user", text }], sending: true };
  }
  return {
    messages: [...state.messages, { id: action.id, role: "flo", text: action.text }],
    sending: false,
  };
}

export function normalizeFloReply(reply?: string | null, status?: number): string {
  if (
    status === 429 ||
    (reply && /quota|billing|usage.*(?:limit|unavailable)|rate limit/i.test(reply))
  ) return AI_USAGE_UNAVAILABLE_MESSAGE;
  return reply?.trim() || FLO_CONNECTION_ERROR_MESSAGE;
}

export function normalizeFloError(message?: string | null, status?: number): string {
  if (status === 429 || (message && /quota|billing|usage.*(?:limit|unavailable)|rate limit/i.test(message))) {
    return AI_USAGE_UNAVAILABLE_MESSAGE;
  }
  return FLO_CONNECTION_ERROR_MESSAGE;
}

export function sanitizeFloSummary(message: string): string {
  return message
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/[$€£]?\s*\d[\d,]*(?:\.\d+)?/g, "[amount/date]")
    .slice(0, 500);
}

export function isUnsafeFloRequest(message: string): boolean {
  return FORBIDDEN_FLO_REQUEST.test(message);
}

function num(value: unknown): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function sanitizeFloFacts(facts: FloFacts): FloFacts {
  return {
    balanceToday: num(facts.balanceToday),
    lowestBalance: num(facts.lowestBalance),
    lowestBalanceDate: String(facts.lowestBalanceDate ?? "").slice(0, 10),
    safetyFloor: num(facts.safetyFloor),
    monthlyIncome: num(facts.monthlyIncome),
    monthlyBills: num(facts.monthlyBills),
    monthlyRemaining: num(facts.monthlyRemaining),
    billsLeftAmount: num(facts.billsLeftAmount),
    billsLeftCount: Math.max(0, Math.round(num(facts.billsLeftCount))),
    billProgressPercent: Math.max(0, Math.min(100, Math.round(num(facts.billProgressPercent)))),
    previousMonthIncome: num(facts.previousMonthIncome),
    previousMonthBills: num(facts.previousMonthBills),
    previousMonthRemaining: num(facts.previousMonthRemaining),
    unallocatedSpendingThisMonth: num(facts.unallocatedSpendingThisMonth),
    unallocatedTransactionCount: Math.max(0, Math.round(num(facts.unallocatedTransactionCount))),
    upcoming: (facts.upcoming ?? []).slice(0, 8).map(item => ({
      name: String(item.name ?? "Upcoming item").slice(0, 80),
      amount: num(item.amount),
      date: String(item.date ?? "").slice(0, 10),
    })),
    activePlans: Math.max(0, Math.round(num(facts.activePlans))),
    forecastConfidence: ["high", "medium", "low"].includes(String(facts.forecastConfidence)) ? String(facts.forecastConfidence) : "low",
    sourceTypes: Array.from(new Set((facts.sourceTypes ?? []).map(source => String(source)).filter(source => ALLOWED_SOURCE_TYPES.has(source)))).slice(0, 12),
    categoryPlan: (facts.categoryPlan ?? []).slice(0, 20).map(item => ({
      category: String(item.category ?? "Other").slice(0, 50),
      budgeted: num(item.budgeted),
      spent: num(item.spent),
      remaining: num(item.remaining),
      status: item.status === "over" || item.status === "watch" || item.status === "available" ? item.status : "available",
      percentUsed: Math.max(0, Math.min(999, Math.round(num(item.percentUsed)))),
      topTransaction: item.topTransaction ? {
        name: String(item.topTransaction.name ?? "Transaction").slice(0, 80),
        amount: num(item.topTransaction.amount),
        date: String(item.topTransaction.date ?? "").slice(0, 10),
      } : undefined,
    })),
  };
}

export function localFloAnswer(message: string, facts: FloFacts, days: DecisionBaselineDay[]): string | null {
  if (isUnsafeFloRequest(message)) return FLO_SECURITY_REFUSAL_MESSAGE;
  const lower = message.toLowerCase();
  const scenario = buildFloDecisionScenario(message);
  if (scenario) {
    const result = evaluateDecision(days, scenario, facts.safetyFloor);
    const lead = result.verdict === "safe"
      ? "Yes."
      : result.verdict === "caution"
        ? "Yes, but it would be tight."
        : "Not safely.";
    return `${lead} ${result.explanation} Your lowest projected balance would be $${result.lowestBalance.toFixed(0)} on ${result.lowestBalanceDate}.`;
  }
  const categoryAnswer = localCategoryAnswer(message, facts);
  if (categoryAnswer) return categoryAnswer;
  if (lower.includes("why") && (lower.includes("negative") || lower.includes("balance"))) {
    return `Your current forecast reaches its lowest point at $${facts.lowestBalance.toFixed(0)} on ${facts.lowestBalanceDate}. The largest near-term obligations are ${facts.upcoming.slice(0, 3).map(i => `${i.name} ($${i.amount.toFixed(0)})`).join(", ") || "not yet available"}.`;
  }
  if ((lower.includes("left") || lower.includes("remaining")) && lower.includes("bill")) {
    return facts.billsLeftCount > 0
      ? `You have ${facts.billsLeftCount} bill${facts.billsLeftCount === 1 ? "" : "s"} left this month, totaling $${facts.billsLeftAmount.toFixed(2)}. Your bill progress is ${facts.billProgressPercent}%.`
      : `I don't see any bills left this month. Your bill progress is ${facts.billProgressPercent}%.`;
  }
  if (lower.includes("next") && (lower.includes("bill") || lower.includes("due"))) {
    return facts.upcoming.length
      ? `Your next obligations are ${facts.upcoming.slice(0, 3).map(i => `${i.name} for $${i.amount.toFixed(0)} on ${i.date}`).join(", ")}.`
      : "I don't see any upcoming bills in the current forecast.";
  }
  if (lower.includes("changed") && lower.includes("last month")) {
    const incomeDelta = facts.monthlyIncome - facts.previousMonthIncome;
    const billsDelta = facts.monthlyBills - facts.previousMonthBills;
    const remainingDelta = facts.monthlyRemaining - facts.previousMonthRemaining;
    return `Compared with last month, income changed by ${formatSignedDollars(incomeDelta)}, bills changed by ${formatSignedDollars(billsDelta)}, and projected leftover changed by ${formatSignedDollars(remainingDelta)}.`;
  }
  if (/leftover|extra money|money left|available money|what should i do with/i.test(lower)) {
    if (facts.monthlyRemaining <= 0) return `I don't see extra money this month. Your current monthly plan is short by $${Math.abs(facts.monthlyRemaining).toFixed(2)}, so I would protect the forecast before adding new spending.`;
    const cushion = facts.lowestBalance - facts.safetyFloor;
    return cushion > 0
      ? `You have about $${facts.monthlyRemaining.toFixed(2)} left in this month's plan. Since your lowest forecast stays $${cushion.toFixed(2)} above the safety floor, the safest choices are savings, the next snowball debt, or keeping it available for upcoming bills.`
      : `You show $${facts.monthlyRemaining.toFixed(2)} left this month, but your forecast is too close to the safety floor. I would keep it available until the low-balance date passes.`;
  }
  if (lower.includes("fix") && lower.includes("forecast")) {
    return facts.forecastConfidence === "high"
      ? "Your forecast confidence is high. To keep it strong, reconcile accounts regularly and make sure bills, income, and one-time transactions are current."
      : "To fix the forecast, start with the oldest account reconciliation, then confirm income dates, recurring bills, and any manual transactions. Forecast confidence improves when those facts are current.";
  }
  if (lower.includes("income") && (lower.includes("add") || lower.includes("enter") || lower.includes("set up"))) {
    return "Open More, choose Income, then tap Add Income. Enter the amount, frequency, and next pay date so FlowLedger can include it in your forecast.";
  }
  const asksAboutUnallocated = /unallocated|non[- ]?allocated|none allocated|not allocated|not linked/.test(lower);
  const asksAboutSpending = /spent|spending|expense|how much/.test(lower);
  if (asksAboutUnallocated && asksAboutSpending) {
    const countLabel = `${facts.unallocatedTransactionCount} unallocated expense transaction${facts.unallocatedTransactionCount === 1 ? "" : "s"}`;
    return facts.unallocatedTransactionCount > 0
      ? `You have spent $${facts.unallocatedSpendingThisMonth.toFixed(2)} across ${countLabel} this month. These are expenses that are not linked to a bill.`
      : "You have $0.00 in unallocated spending this month. Every recorded expense is linked to a bill, or there are no expense transactions yet.";
  }
  return null;
}

function localCategoryAnswer(message: string, facts: FloFacts): string | null {
  const lower = message.toLowerCase();
  const categories = facts.categoryPlan ?? [];
  if (/unallocated|non[- ]?allocated|none allocated|not allocated|not linked/.test(lower)) return null;
  if (/leftover|extra money|money left|available money|what should i do with/i.test(lower) && !/(categor|budget)/i.test(lower)) return null;
  const requestedMove = parseRequestedCategoryMove(message);
  const categoryIntent = /(categor|budget|spend|spending|spent|over|left|remaining|move|room)/i.test(lower);
  if (!categoryIntent) return null;
  if (!categories.length) {
    return requestedMove
      ? "I don't see category budget data for this month yet, so I can't safely move money between categories."
      : "I don't see category budget data for this month yet. Add category budgets or transactions first, then I can explain the category plan.";
  }

  const named = findMentionedCategory(message, categories);
  const move = evaluateFloCategoryMove(message, facts);
  if (requestedMove && move) {
    return move.reason;
  }

  if (/(need attention|attention|problem|over|overspend|overspending|watch)/i.test(lower) && !named) {
    const attention = categories
      .filter(item => item.status === "over" || item.status === "watch")
      .sort((left, right) => statusPriority(right.status) - statusPriority(left.status) || left.remaining - right.remaining)
      .slice(0, 3);
    return attention.length
      ? `The categories needing attention are ${attention.map(item => `${item.category} (${item.status === "over" ? `$${Math.abs(item.remaining).toFixed(2)} over` : `${item.percentUsed}% used`})`).join(", ")}.`
      : "Your categories look on plan right now. I don't see an over-budget or watch category this month.";
  }

  if (/(most room|most left|room left|available category|where.*room)/i.test(lower)) {
    const best = categories
      .filter(item => item.remaining > 0)
      .sort((left, right) => right.remaining - left.remaining)[0];
    return best
      ? `${best.category} has the most room left with $${best.remaining.toFixed(2)} available.`
      : "I don't see any category with money left right now.";
  }

  if (named && /(why|over|overspend|overspending)/i.test(lower)) {
    if (named.remaining >= 0) {
      return `${named.category} is not over. You have $${named.remaining.toFixed(2)} left after spending $${named.spent.toFixed(2)} of $${named.budgeted.toFixed(2)}.`;
    }
    const top = named.topTransaction
      ? ` The biggest transaction I see is ${named.topTransaction.name} for $${Math.abs(named.topTransaction.amount).toFixed(2)} on ${named.topTransaction.date}.`
      : "";
    return `${named.category} is over by $${Math.abs(named.remaining).toFixed(2)}. You've spent $${named.spent.toFixed(2)} against a $${named.budgeted.toFixed(2)} plan.${top}`;
  }

  if (named && /(left|remaining|how much|available|budget)/i.test(lower)) {
    return named.remaining >= 0
      ? `${named.category} has $${named.remaining.toFixed(2)} left. You've spent $${named.spent.toFixed(2)} of $${named.budgeted.toFixed(2)}.`
      : `${named.category} is $${Math.abs(named.remaining).toFixed(2)} over plan. You've spent $${named.spent.toFixed(2)} against $${named.budgeted.toFixed(2)}.`;
  }

  if (/(where.*spend|spending|spent|categories)/i.test(lower)) {
    const top = [...categories].sort((left, right) => right.spent - left.spent).slice(0, 3);
    return top.length
      ? `Your top spending categories this month are ${top.map(item => `${item.category} ($${item.spent.toFixed(2)})`).join(", ")}.`
      : "I don't see category spending yet this month.";
  }

  return null;
}

function findMentionedCategory(message: string, categories: FloCategoryFact[]): FloCategoryFact | null {
  const lower = message.toLowerCase();
  return [...categories]
    .sort((left, right) => right.category.length - left.category.length)
    .find(item => lower.includes(item.category.toLowerCase())) ?? null;
}

export function evaluateFloCategoryMove(message: string, facts: FloFacts): FloCategoryMoveResult | null {
  const requested = parseRequestedCategoryMove(message);
  if (!requested) return null;
  const categories = facts.categoryPlan ?? [];
  if (!categories.length) {
    return {
      amount: requested.amount,
      from: requested.from,
      to: requested.to,
      allowed: false,
      reason: "I don't see category budget data for this month yet, so I can't safely move money between categories.",
    };
  }
  const source = findCategoryByName(requested.from, categories);
  const target = findCategoryByName(requested.to, categories);
  if (!source) {
    return {
      amount: requested.amount,
      from: requested.from,
      to: requested.to,
      allowed: false,
      reason: `I don't see ${requested.from} with available category budget this month, so I can't safely move money from it.`,
    };
  }
  if (!target) {
    return {
      amount: requested.amount,
      from: source.category,
      to: requested.to,
      allowed: false,
      reason: `I don't see ${requested.to} in this month's category plan yet. Add a budget or transaction for that category first.`,
    };
  }
  if (requested.amount > source.remaining + 0.005) {
    return {
      amount: requested.amount,
      from: source.category,
      to: target.category,
      allowed: false,
      reason: `Not from ${source.category}. It only has $${Math.max(0, source.remaining).toFixed(2)} left, so moving $${requested.amount.toFixed(2)} would put that category over plan.`,
    };
  }
  return {
    amount: requested.amount,
    from: source.category,
    to: target.category,
    allowed: true,
    reason: `Yes. You can move $${requested.amount.toFixed(2)} from ${source.category} to ${target.category}. ${source.category} would have $${(source.remaining - requested.amount).toFixed(2)} left, and ${target.category} would improve to $${(target.remaining + requested.amount).toFixed(2)} left.`,
  };
}

function parseRequestedCategoryMove(message: string) {
  if (!/\bmove\b/i.test(message)) return null;
  const amount = Number(message.match(/\$?\s*([\d,]+(?:\.\d{1,2})?)/)?.[1]?.replace(/,/g, "") ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const match = message.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?:[?.!]|$)/i);
  if (!match) return null;
  const from = cleanupCategoryName(match[1]);
  const to = cleanupCategoryName(match[2]);
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return null;
  return { amount, from, to };
}

function findCategoryByName(name: string, categories: FloCategoryFact[]) {
  const normalized = cleanupCategoryName(name).toLowerCase();
  return categories.find(item => item.category.toLowerCase() === normalized)
    ?? categories.find(item => item.category.toLowerCase().includes(normalized) || normalized.includes(item.category.toLowerCase()));
}

function cleanupCategoryName(value: string) {
  return value.replace(/\$?\s*[\d,]+(?:\.\d{1,2})?/g, "").replace(/\bcategory\b/gi, "").trim();
}

function statusPriority(status: FloCategoryFact["status"]) {
  if (status === "over") return 3;
  if (status === "watch") return 2;
  return 1;
}

function formatSignedDollars(amount: number): string {
  const sign = amount >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

export function floResponseCards(message: string, facts: FloFacts, days: DecisionBaselineDay[]): FloResponseCard[] {
  const lower = message.toLowerCase();
  const scenario = buildFloDecisionScenario(message);
  if (scenario) {
    const result = evaluateDecision(days, scenario, facts.safetyFloor);
    return [
      { title: "Purchase Decision", value: result.verdict.toUpperCase(), detail: result.explanation, tone: result.verdict === "safe" ? "safe" : result.verdict === "caution" ? "caution" : "risk" },
      { title: "Lowest Balance", value: `$${result.lowestBalance.toFixed(0)}`, detail: result.lowestBalanceDate, tone: result.lowestBalance < facts.safetyFloor ? "risk" : "info" },
      { title: "Safer Amount", value: `$${result.saferAmount.toFixed(0)}`, detail: "Based on your safety floor", tone: "info" },
    ];
  }
  const categoryCards = floCategoryCards(message, facts);
  if (categoryCards.length) return categoryCards;
  if (lower.includes("why") && (lower.includes("negative") || lower.includes("balance"))) {
    return [
      { title: "Lowest Forecast", value: `$${facts.lowestBalance.toFixed(0)}`, detail: facts.lowestBalanceDate, tone: facts.lowestBalance < facts.safetyFloor ? "risk" : "caution" },
      { title: "Safe Cushion", value: `$${(facts.lowestBalance - facts.safetyFloor).toFixed(0)}`, detail: `Safety floor: $${facts.safetyFloor.toFixed(0)}`, tone: facts.lowestBalance < facts.safetyFloor ? "risk" : "safe" },
    ];
  }
  if ((lower.includes("left") || lower.includes("remaining")) && lower.includes("bill")) {
    return [
      { title: "Bills Left", value: String(facts.billsLeftCount), detail: `$${facts.billsLeftAmount.toFixed(2)} remaining`, tone: facts.billsLeftCount > 0 ? "caution" : "safe" },
      { title: "Bill Progress", value: `${facts.billProgressPercent}%`, detail: "Based on bill count", tone: facts.billProgressPercent >= 80 ? "safe" : "info" },
    ];
  }
  if (/leftover|extra money|money left|available money|what should i do with/i.test(lower)) {
    return [
      { title: "Monthly Leftover", value: `${formatSignedDollars(facts.monthlyRemaining)}`, detail: "Income minus bills, plans, and transactions", tone: facts.monthlyRemaining >= 0 ? "safe" : "risk" },
      { title: "Recommended Next Step", value: facts.monthlyRemaining > 0 ? "Protect plan" : "Hold spending", detail: facts.monthlyRemaining > 0 ? "Savings, debt, or keep available" : "Fix the shortfall first", tone: facts.monthlyRemaining > 0 ? "info" : "risk" },
    ];
  }
  if (lower.includes("fix") && lower.includes("forecast")) {
    return [
      { title: "Forecast Confidence", value: facts.forecastConfidence.toUpperCase(), detail: "Uses accounts, income, and bills", tone: facts.forecastConfidence === "high" ? "safe" : facts.forecastConfidence === "medium" ? "caution" : "risk" },
      { title: "Best First Step", value: "Reconcile", detail: "Then review income and recurring bills", tone: "info" },
    ];
  }
  return [];
}

function floCategoryCards(message: string, facts: FloFacts): FloResponseCard[] {
  const categories = facts.categoryPlan ?? [];
  if (!categories.length) return [];
  const named = findMentionedCategory(message, categories);
  const lower = message.toLowerCase();
  if (named && /(categor|budget|spend|spending|spent|over|left|remaining)/i.test(lower)) {
    return [
      { title: "Category Status", value: named.status.toUpperCase(), detail: `${named.percentUsed}% used`, tone: named.status === "over" ? "risk" : named.status === "watch" ? "caution" : "safe" },
      { title: "Remaining", value: `${formatSignedDollars(named.remaining)}`, detail: `$${named.spent.toFixed(2)} spent of $${named.budgeted.toFixed(2)}`, tone: named.remaining < 0 ? "risk" : "safe" },
    ];
  }
  if (/(need attention|attention|problem|over|overspend|watch|most room|most left)/i.test(lower)) {
    const overCount = categories.filter(item => item.status === "over").length;
    const best = categories.filter(item => item.remaining > 0).sort((left, right) => right.remaining - left.remaining)[0];
    return [
      { title: "Categories Over", value: String(overCount), detail: "Current month category plan", tone: overCount ? "risk" : "safe" },
      { title: "Most Room", value: best ? best.category : "None", detail: best ? `$${best.remaining.toFixed(2)} left` : "No category has room left", tone: best ? "info" : "caution" },
    ];
  }
  return [];
}

export function buildFloDecisionScenario(message: string, today = new Date().toISOString().slice(0, 10)): DecisionScenario | null {
  const lower = message.toLowerCase();
  const match = message.match(/\$?\s*([\d,]+(?:\.\d{1,2})?)/);
  if (!(lower.includes("afford") || lower.includes("buy") || lower.includes("spend")) || !match) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return {
    type: "one_time_purchase",
    name: `Flo plan: $${amount.toFixed(amount % 1 === 0 ? 0 : 2)}`,
    amount,
    date: parseFloDate(message, today),
    frequency: "once",
  };
}

function parseFloDate(message: string, today: string): string {
  const iso = message.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (iso) return iso;
  const base = new Date(`${today}T00:00:00Z`);
  const monthMatch = message.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(20\d{2}))?\b/i);
  if (monthMatch) {
    const month = MONTHS[monthMatch[1].toLowerCase().replace(".", "")];
    const day = Number(monthMatch[2]);
    let year = monthMatch[3] ? Number(monthMatch[3]) : base.getUTCFullYear();
    const candidate = clampDate(year, month, day);
    if (!monthMatch[3] && candidate < today) year += 1;
    return clampDate(year, month, day);
  }
  const slashMatch = message.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}|\d{2}))?\b/);
  if (slashMatch) {
    const month = Number(slashMatch[1]);
    const day = Number(slashMatch[2]);
    let year = slashMatch[3] ? Number(slashMatch[3]) : base.getUTCFullYear();
    if (year < 100) year += 2000;
    const candidate = clampDate(year, month, day);
    if (!slashMatch[3] && candidate < today) year += 1;
    return clampDate(year, month, day);
  }
  return today;
}

function clampDate(year: number, month: number, day: number): string {
  const safeMonth = Math.max(1, Math.min(12, month));
  const lastDay = new Date(Date.UTC(year, safeMonth, 0)).getUTCDate();
  const safeDay = Math.max(1, Math.min(lastDay, day));
  return `${year}-${String(safeMonth).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}
