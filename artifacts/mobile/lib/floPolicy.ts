import { evaluateDecision, type DecisionBaselineDay, type DecisionScenario } from "./decisions";
import type { PaycheckPlanResult } from "./paycheckPlanning";

export interface FloBillMoveFact {
  id: string;
  billId: string;
  billName: string;
  fromDate: string;
  toDate: string;
}

export interface FloTodayForecastFact {
  date: string;
  projectedClose: number;
  net: number;
  sources: {
    group: string;
    label: string;
    amount: number;
    status: string;
  }[];
}

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
  todayForecast?: FloTodayForecastFact;
  categoryPlan?: FloCategoryFact[];
  decisionHistory?: FloDecisionHistoryFacts;
  paycheckPlan?: PaycheckPlanResult;
  billDateMoves?: FloBillMoveFact[];
  debts?: FloDebtFact[];
  recurringBills?: FloRecurringBillFact[];
  flowScore?: {
    score: number;
    label: string;
    topReason: string;
    topAction: string;
    positiveFactors: string[];
    negativeFactors: string[];
  };
  safeCushion?: {
    amount: number;
    label: string;
    status: "safe" | "watch" | "risk";
    lowestBalance: number;
    lowestDay: number | null;
    safetyFloor: number;
    reservedAmount: number;
    topReason: string;
    topAction: string;
  };
  purchaseDecision?: {
    safeNowLimit: number;
    action: "safe" | "wait" | "split" | "avoid";
    detail: string;
    nextMove: string;
    bestDay: number | null;
    confidence: "high" | "medium" | "low";
  };
  billPriority?: {
    nextBill: { name: string; amount: number; dueDay: number; reason: string; urgency: "now" | "soon" | "planned" } | null;
    summary: string;
    nextMove: string;
    bills: { name: string; amount: number; dueDay: number; reason: string; urgency: "now" | "soon" | "planned" }[];
  };
  paydaySplitAlgo?: {
    bills: number;
    spending: number;
    savings: number;
    debt: number;
    goals: number;
    dollars: { bills: number; spending: number; savings: number; debt: number; goals: number };
    summary: string;
    nextMove: string;
  };
  debtPayoff?: {
    nextDebtName: string | null;
    snowballBalance: number;
    avalancheName: string | null;
    cashFlowReliefName: string | null;
    cashFlowReliefAmount: number;
    nextMove: string;
    status: "ready" | "hold" | "done";
    detail: string;
  };
  spendingLimit?: {
    daily: number;
    weekly: number;
    status: "safe" | "watch" | "risk";
    paceLabel: string;
    remainingDays: number;
    detail: string;
  };
  extraMoneyRouter?: {
    amount: number;
    recommendation: "debt" | "savings" | "bill" | "available";
    targetLabel: string;
    detail: string;
    nextMove: string;
  };
}

export interface FloDebtFact {
  id: string;
  name: string;
  balance: number;
  minimumPayment: number;
  dueDay: number;
}

export interface FloRecurringBillFact {
  id: string;
  name: string;
  amount: number;
  dueDay: number;
  category: string;
}

export interface FloDecisionHistoryFact {
  name: string;
  date: string;
  plannedAmount: number;
  actualAmount?: number;
  varianceLabel?: string;
  status: "upcoming" | "due" | "completed" | "postponed" | "cancelled" | "saved";
}

export interface FloDecisionHistoryFacts {
  due: FloDecisionHistoryFact[];
  upcoming: FloDecisionHistoryFact[];
  completed: FloDecisionHistoryFact[];
  changed: FloDecisionHistoryFact[];
  risky?: FloDecisionHistoryFact[];
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

export type FloChatMessage = { id: string; role: "user" | "flo"; text: string; thinking?: boolean };
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
export interface FloBillDateMoveResult {
  billId: string;
  billName: string;
  fromDate: string;
  toDate: string;
  toDay: number;
  allowed: boolean;
  reason: string;
}
export interface FloDebtPaymentResult {
  amount: number;
  debtId: string;
  debtName: string;
  date: string;
  balanceBefore: number;
  balanceAfter: number;
  allowed: boolean;
  reason: string;
}
export interface FloRecurringBillChangeResult {
  billId: string;
  billName: string;
  oldAmount: number;
  newAmount: number;
  startDate: string;
  preserveCurrentMonth: boolean;
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
    .filter(item => target ? item.remaining >= Math.abs(target.remaining) : item.remaining > 0)
    .sort((left, right) => right.remaining - left.remaining)[0];
  if (target && source && target.category !== source.category) {
    const amount = Math.abs(target.remaining);
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
    return {
      messages: [
        ...state.messages,
        { id: action.id, role: "user", text },
        { id: `${action.id}-thinking`, role: "flo", text: "Flo thinking...", thinking: true },
      ],
      sending: true,
    };
  }
  return {
    messages: [
      ...state.messages.filter(message => !message.thinking),
      { id: action.id, role: "flo", text: action.text },
    ],
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
    todayForecast: facts.todayForecast ? {
      date: String(facts.todayForecast.date ?? "").slice(0, 10),
      projectedClose: num(facts.todayForecast.projectedClose),
      net: num(facts.todayForecast.net),
      sources: (facts.todayForecast.sources ?? []).slice(0, 20).map(source => ({
        group: String(source.group ?? "Activity").slice(0, 40),
        label: String(source.label ?? "Item").slice(0, 80),
        amount: num(source.amount),
        status: String(source.status ?? "").slice(0, 30),
      })),
    } : undefined,
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
    decisionHistory: sanitizeDecisionHistoryFacts(facts.decisionHistory),
    paycheckPlan: facts.paycheckPlan ? sanitizePaycheckPlan(facts.paycheckPlan) : undefined,
    billDateMoves: sanitizeBillMoveFacts(facts.billDateMoves),
    debts: sanitizeDebtFacts(facts.debts),
    recurringBills: sanitizeRecurringBillFacts(facts.recurringBills),
    flowScore: facts.flowScore ? {
      score: num(facts.flowScore.score),
      label: String(facts.flowScore.label ?? "").slice(0, 40),
      topReason: String(facts.flowScore.topReason ?? "").slice(0, 180),
      topAction: String(facts.flowScore.topAction ?? "").slice(0, 120),
      positiveFactors: (facts.flowScore.positiveFactors ?? []).slice(0, 3).map(item => String(item).slice(0, 140)),
      negativeFactors: (facts.flowScore.negativeFactors ?? []).slice(0, 3).map(item => String(item).slice(0, 140)),
    } : undefined,
    safeCushion: facts.safeCushion ? {
      amount: num(facts.safeCushion.amount),
      label: String(facts.safeCushion.label ?? "").slice(0, 40),
      status: facts.safeCushion.status === "safe" || facts.safeCushion.status === "watch" || facts.safeCushion.status === "risk" ? facts.safeCushion.status : "risk",
      lowestBalance: num(facts.safeCushion.lowestBalance),
      lowestDay: facts.safeCushion.lowestDay === null ? null : num(facts.safeCushion.lowestDay),
      safetyFloor: num(facts.safeCushion.safetyFloor),
      reservedAmount: num(facts.safeCushion.reservedAmount),
      topReason: String(facts.safeCushion.topReason ?? "").slice(0, 180),
      topAction: String(facts.safeCushion.topAction ?? "").slice(0, 120),
    } : undefined,
    purchaseDecision: facts.purchaseDecision ? {
      safeNowLimit: Math.max(0, num(facts.purchaseDecision.safeNowLimit)),
      action: ["safe", "wait", "split", "avoid"].includes(String(facts.purchaseDecision.action)) ? facts.purchaseDecision.action : "wait",
      detail: String(facts.purchaseDecision.detail ?? "").slice(0, 180),
      nextMove: String(facts.purchaseDecision.nextMove ?? "").slice(0, 160),
      bestDay: facts.purchaseDecision.bestDay === null ? null : Math.max(1, Math.min(31, Math.round(num(facts.purchaseDecision.bestDay)))),
      confidence: facts.purchaseDecision.confidence === "high" || facts.purchaseDecision.confidence === "medium" || facts.purchaseDecision.confidence === "low" ? facts.purchaseDecision.confidence : "low",
    } : undefined,
    billPriority: facts.billPriority ? {
      nextBill: facts.billPriority.nextBill ? {
        name: String(facts.billPriority.nextBill.name ?? "Bill").slice(0, 80),
        amount: Math.max(0, num(facts.billPriority.nextBill.amount)),
        dueDay: Math.max(1, Math.min(31, Math.round(num(facts.billPriority.nextBill.dueDay) || 1))),
        reason: String(facts.billPriority.nextBill.reason ?? "").slice(0, 80),
        urgency: facts.billPriority.nextBill.urgency === "now" || facts.billPriority.nextBill.urgency === "soon" || facts.billPriority.nextBill.urgency === "planned" ? facts.billPriority.nextBill.urgency : "planned",
      } : null,
      summary: String(facts.billPriority.summary ?? "").slice(0, 160),
      nextMove: String(facts.billPriority.nextMove ?? "").slice(0, 160),
      bills: (facts.billPriority.bills ?? []).slice(0, 5).map(bill => ({
        name: String(bill.name ?? "Bill").slice(0, 80),
        amount: Math.max(0, num(bill.amount)),
        dueDay: Math.max(1, Math.min(31, Math.round(num(bill.dueDay) || 1))),
        reason: String(bill.reason ?? "").slice(0, 80),
        urgency: bill.urgency === "now" || bill.urgency === "soon" || bill.urgency === "planned" ? bill.urgency : "planned",
      })),
    } : undefined,
    paydaySplitAlgo: facts.paydaySplitAlgo ? {
      bills: Math.max(0, num(facts.paydaySplitAlgo.bills)),
      spending: Math.max(0, num(facts.paydaySplitAlgo.spending)),
      savings: Math.max(0, num(facts.paydaySplitAlgo.savings)),
      debt: Math.max(0, num(facts.paydaySplitAlgo.debt)),
      goals: Math.max(0, num(facts.paydaySplitAlgo.goals)),
      dollars: {
        bills: Math.max(0, num(facts.paydaySplitAlgo.dollars?.bills)),
        spending: Math.max(0, num(facts.paydaySplitAlgo.dollars?.spending)),
        savings: Math.max(0, num(facts.paydaySplitAlgo.dollars?.savings)),
        debt: Math.max(0, num(facts.paydaySplitAlgo.dollars?.debt)),
        goals: Math.max(0, num(facts.paydaySplitAlgo.dollars?.goals)),
      },
      summary: String(facts.paydaySplitAlgo.summary ?? "").slice(0, 180),
      nextMove: String(facts.paydaySplitAlgo.nextMove ?? "").slice(0, 160),
    } : undefined,
    debtPayoff: facts.debtPayoff ? {
      nextDebtName: facts.debtPayoff.nextDebtName === null ? null : String(facts.debtPayoff.nextDebtName ?? "").slice(0, 80),
      snowballBalance: Math.max(0, num(facts.debtPayoff.snowballBalance)),
      avalancheName: facts.debtPayoff.avalancheName === null ? null : String(facts.debtPayoff.avalancheName ?? "").slice(0, 80),
      cashFlowReliefName: facts.debtPayoff.cashFlowReliefName === null ? null : String(facts.debtPayoff.cashFlowReliefName ?? "").slice(0, 80),
      cashFlowReliefAmount: Math.max(0, num(facts.debtPayoff.cashFlowReliefAmount)),
      nextMove: String(facts.debtPayoff.nextMove ?? "").slice(0, 160),
      status: facts.debtPayoff.status === "ready" || facts.debtPayoff.status === "hold" || facts.debtPayoff.status === "done" ? facts.debtPayoff.status : "hold",
      detail: String(facts.debtPayoff.detail ?? "").slice(0, 220),
    } : undefined,
    spendingLimit: facts.spendingLimit ? {
      daily: Math.max(0, num(facts.spendingLimit.daily)),
      weekly: Math.max(0, num(facts.spendingLimit.weekly)),
      status: facts.spendingLimit.status === "safe" || facts.spendingLimit.status === "watch" || facts.spendingLimit.status === "risk" ? facts.spendingLimit.status : "risk",
      paceLabel: String(facts.spendingLimit.paceLabel ?? "").slice(0, 40),
      remainingDays: Math.max(1, Math.round(num(facts.spendingLimit.remainingDays) || 1)),
      detail: String(facts.spendingLimit.detail ?? "").slice(0, 180),
    } : undefined,
    extraMoneyRouter: facts.extraMoneyRouter ? {
      amount: Math.max(0, num(facts.extraMoneyRouter.amount)),
      recommendation: facts.extraMoneyRouter.recommendation === "debt" || facts.extraMoneyRouter.recommendation === "savings" || facts.extraMoneyRouter.recommendation === "bill" || facts.extraMoneyRouter.recommendation === "available" ? facts.extraMoneyRouter.recommendation : "available",
      targetLabel: String(facts.extraMoneyRouter.targetLabel ?? "available cash").slice(0, 80),
      detail: String(facts.extraMoneyRouter.detail ?? "").slice(0, 180),
      nextMove: String(facts.extraMoneyRouter.nextMove ?? "").slice(0, 160),
    } : undefined,
  };
}

export function localFloAnswer(message: string, facts: FloFacts, days: DecisionBaselineDay[]): string | null {
  if (isUnsafeFloRequest(message)) return FLO_SECURITY_REFUSAL_MESSAGE;
  const lower = message.toLowerCase();
  const asksTodayForecast = /\b(today|available today|balance today|current balance|today's balance|dashboard number|command balance)\b/.test(lower)
    && /\b(why|balance|available|number|forecast|close|source|explain)\b/.test(lower);
  if (asksTodayForecast && facts.todayForecast) {
    const sources = facts.todayForecast.sources;
    const grouped = sources.reduce<Record<string, typeof sources>>((acc, source) => {
      acc[source.group] = [...(acc[source.group] ?? []), source];
      return acc;
    }, {});
    const sourceText = Object.entries(grouped)
      .slice(0, 5)
      .map(([group, items]) => `${group}: ${items.slice(0, 4).map(item => `${item.label} ${formatSignedDollars(item.amount)}`).join(", ")}`)
      .join("; ");
    const netText = facts.todayForecast.net === 0 ? "no net change" : `${formatSignedDollars(facts.todayForecast.net)} net change`;
    return sources.length
      ? `Today's projected close is $${facts.todayForecast.projectedClose.toFixed(2)} on ${facts.todayForecast.date}. I get there from ${netText}. Sources: ${sourceText}.`
      : `Today's projected close is $${facts.todayForecast.projectedClose.toFixed(2)} on ${facts.todayForecast.date}. I don't see dated income, bills, transactions, debt payments, goals, or plans on today, so it is mainly carrying forward the previous day.`;
  }
  const asksFlowScore = lower.includes("flow score") || (lower.includes("score") && (lower.includes("why") || lower.includes("improve") || lower.includes("hurt") || lower.includes("help")));
  if (asksFlowScore && facts.flowScore) {
    const working = facts.flowScore.positiveFactors.length ? facts.flowScore.positiveFactors.join(" ") : "I don't see a major positive driver yet.";
    const attention = facts.flowScore.negativeFactors.length ? facts.flowScore.negativeFactors.join(" ") : "I don't see a major pressure point right now.";
    const topAction = replaceDayReferences(facts, facts.flowScore.topAction);
    if (lower.includes("improve")) return `I have your Flow Score at ${facts.flowScore.score} - ${facts.flowScore.label}. I’m grading how much breathing room your plan has after bills, debt, spending, and the safety floor. Best next move: ${topAction} Needs attention: ${replaceDayReferences(facts, attention)}`;
    if (lower.includes("hurt")) return `I have your Flow Score at ${facts.flowScore.score} - ${facts.flowScore.label}. I’m not judging anything as bad — I’m pointing out pressure points needing attention so we can fix them. Needs attention: ${replaceDayReferences(facts, attention)} Best next move: ${topAction}`;
    if (lower.includes("help")) return `Your Flow Score is ${facts.flowScore.score} - ${facts.flowScore.label}. Working well: ${working}`;
    return `I have your Flow Score at ${facts.flowScore.score} - ${facts.flowScore.label}. I’m using that card to summarize your overall money pressure. ${replaceDayReferences(facts, facts.flowScore.topReason)} Working: ${working} Needs attention: ${replaceDayReferences(facts, attention)} Best next move: ${topAction}`;
  }
  const asksSpendingLimit = /\b(daily limit|weekly limit|spending limit|safe pace|safe daily|safe weekly|how much.*spend.*day|how much.*spend.*week)\b/.test(lower);
  if (asksSpendingLimit && facts.spendingLimit) {
    return facts.spendingLimit.status === "risk"
      ? `Your Spending Limit is $0 right now. ${facts.spendingLimit.detail} I would keep money available until the cushion improves.`
      : `Your Spending Limit is about $${facts.spendingLimit.daily.toFixed(2)}/day or $${facts.spendingLimit.weekly.toFixed(2)}/week. That is a ${facts.spendingLimit.paceLabel} for the next ${facts.spendingLimit.remainingDays} day${facts.spendingLimit.remainingDays === 1 ? "" : "s"}.`;
  }
  const asksBillPriority = /\b(priority bill|bill priority|which bill.*first|what bill.*first|which bill.*pay|what bill.*pay|bill.*attention|review.*bill)\b/.test(lower);
  if (asksBillPriority && facts.billPriority) {
    const next = facts.billPriority.nextBill;
    return next
      ? `${facts.billPriority.summary} ${replaceDayReferences(facts, facts.billPriority.nextMove)} ${next.name} has $${next.amount.toFixed(2)} left and is ${next.reason}.`
      : facts.billPriority.summary || "No unpaid bills need priority attention right now.";
  }
  const asksPaydaySplitAlgo = /\b(payday split|split.*paycheck|divide.*paycheck|paycheck breakdown|where should my paycheck go)\b/.test(lower);
  if (asksPaydaySplitAlgo && facts.paydaySplitAlgo) {
    const split = facts.paydaySplitAlgo;
    return `${split.summary} In dollars, that is about $${split.dollars.bills.toFixed(0)} bills, $${split.dollars.spending.toFixed(0)} spending, $${split.dollars.savings.toFixed(0)} savings, $${split.dollars.debt.toFixed(0)} debt, and $${split.dollars.goals.toFixed(0)} goals. ${split.nextMove}`;
  }
  const asksExtraMoneyRouter = /\b(extra money|leftover|money left|available money|route money|where should.*money|what should i do with.*money|safe leftover)\b/.test(lower);
  if (asksExtraMoneyRouter && facts.extraMoneyRouter) {
    return facts.extraMoneyRouter.amount > 0
      ? `${facts.extraMoneyRouter.detail} Best route: ${facts.extraMoneyRouter.targetLabel}. ${facts.extraMoneyRouter.nextMove}`
      : `${facts.extraMoneyRouter.detail} I would not route extra money yet because the forecast needs protection first.`;
  }
  const asksPurchaseDecision = /\b(purchase decision|plan purchase|buy|purchase|should i wait|best date|safer date)\b/.test(lower) && !/\$?\s*\d/.test(lower);
  if (asksPurchaseDecision && facts.purchaseDecision) {
    const bestDay = facts.purchaseDecision.bestDay ? ` A safer date may be around ${formatFloMonthDay(facts, facts.purchaseDecision.bestDay)}.` : "";
    return `I’m checking two things for the Purchase Decision: whether the month has free cash left, and whether the lowest forecast still stays above your safety floor. ${replaceDayReferences(facts, facts.purchaseDecision.detail)} ${replaceDayReferences(facts, facts.purchaseDecision.nextMove)}${bestDay}`;
  }
  const asksSafeCushion = lower.includes("safe cushion") || lower.includes("cushion") || /safely spend|safe to spend|how much can i spend|available to spend/.test(lower);
  if (asksSafeCushion && facts.safeCushion) {
    const dayText = facts.safeCushion.lowestDay ? ` on ${formatFloMonthDay(facts, facts.safeCushion.lowestDay)}` : "";
    if (lower.includes("low") || lower.includes("why")) {
      return `I’m using Safe Cushion to show the money left after protecting your floor. It is $${facts.safeCushion.amount.toFixed(0)} - ${facts.safeCushion.label}. ${replaceDayReferences(facts, facts.safeCushion.topReason)} I see your lowest projected balance at $${facts.safeCushion.lowestBalance.toFixed(0)}${dayText}, with a $${facts.safeCushion.safetyFloor.toFixed(0)} floor. ${replaceDayReferences(facts, facts.safeCushion.topAction)}`;
    }
    return `I’m using Safe Cushion as your spendable breathing room after the current plan is protected. It is $${facts.safeCushion.amount.toFixed(0)} - ${facts.safeCushion.label}. ${replaceDayReferences(facts, facts.safeCushion.topReason)} I’m already reserving about $${facts.safeCushion.reservedAmount.toFixed(0)} for the current plan. ${replaceDayReferences(facts, facts.safeCushion.topAction)}`;
  }
  const asksDebtPayoff = /\b(debt payoff|payoff plan|snowball target|avalanche target|which debt|what debt|pay off first|next debt|paid off|payoff|roll over|rollover|closed)\b/.test(lower);
  if (asksDebtPayoff && facts.debtPayoff) {
    if (facts.debtPayoff.status === "done") return "I don't see an active debt balance right now. Add a debt in Bills if you want payoff guidance.";
    const rolloverAnswer = localDebtRolloverAnswer(message, facts);
    if (rolloverAnswer) return rolloverAnswer;
    const hold = facts.debtPayoff.status === "hold" ? " I would hold extra payments until your Safe Cushion is protected." : "";
    return `${facts.debtPayoff.nextMove}${hold} Snowball target: ${facts.debtPayoff.nextDebtName ?? "none"}${facts.debtPayoff.nextDebtName ? ` ($${facts.debtPayoff.snowballBalance.toFixed(0)} balance)` : ""}. Avalanche target: ${facts.debtPayoff.avalancheName ?? "none"}. Cash-flow relief target: ${facts.debtPayoff.cashFlowReliefName ?? "none"}${facts.debtPayoff.cashFlowReliefAmount > 0 ? `, freeing about $${facts.debtPayoff.cashFlowReliefAmount.toFixed(0)}/month when closed` : ""}.`;
  }
  const debtPayment = evaluateFloDebtPayment(message, facts);
  if (debtPayment) {
    if (!debtPayment.allowed) return debtPayment.reason;
    const result = evaluateDecision(days, buildDebtPaymentScenario(debtPayment), facts.safetyFloor);
    const lead = result.verdict === "safe"
      ? "Yes."
      : result.verdict === "caution"
        ? "Yes, but keep an eye on the cushion."
        : "Not safely.";
    return `${lead} ${debtPayment.reason} Your lowest projected balance would be $${result.lowestBalance.toFixed(0)} on ${result.lowestBalanceDate}.`;
  }
  const billChange = evaluateFloRecurringBillChange(message, facts);
  if (billChange) return billChange.reason;
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
  const decisionHistoryAnswer = localDecisionHistoryAnswer(message, facts);
  if (decisionHistoryAnswer) return decisionHistoryAnswer;
  const movedBillAnswer = localMovedBillAnswer(message, facts);
  if (movedBillAnswer) return movedBillAnswer;
  const billMove = evaluateFloBillDateMove(message, facts);
  if (billMove) return billMove.reason;
  const paycheckAnswer = localPaycheckAnswer(message, facts);
  if (paycheckAnswer) return paycheckAnswer;
  const monthlyReviewAnswer = localMonthlyReviewAnswer(message, facts);
  if (monthlyReviewAnswer) return monthlyReviewAnswer;
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

function localDebtRolloverAnswer(message: string, facts: FloFacts): string | null {
  const lower = message.toLowerCase();
  if (!/\b(after|when|once|next|roll over|rollover|paid off|closed)\b/.test(lower)) return null;
  const debts = sanitizeDebtFacts(facts.debts).sort((left, right) => left.balance - right.balance || left.name.localeCompare(right.name));
  if (!debts.length) return null;
  const namedDebt = debts.find(debt => lower.includes(debt.name.toLowerCase()));
  const current = namedDebt ?? debts.find(debt => debt.name === facts.debtPayoff?.nextDebtName) ?? debts[0];
  if (!current) return null;
  const currentIndex = debts.findIndex(debt => debt.id === current.id);
  const next = currentIndex >= 0 ? debts[currentIndex + 1] : null;
  if (!next) {
    return `When ${current.name} is paid off, there is no next snowball debt in the current list. Its $${current.minimumPayment.toFixed(2)}/mo payment becomes cash-flow room unless you add another debt or route it to savings.`;
  }
  const rolledPayment = current.minimumPayment + next.minimumPayment;
  return `When ${current.name} is paid off, its $${current.minimumPayment.toFixed(2)}/mo minimum does not disappear. FlowLedger rolls it into ${next.name}, so ${next.name}'s snowball payment becomes at least $${rolledPayment.toFixed(2)}/mo before any extra safe payment.`;
}

function sanitizeDebtFacts(debts?: FloDebtFact[]): FloDebtFact[] {
  return (debts ?? []).slice(0, 40).map(debt => ({
    id: String(debt.id ?? "").slice(0, 80),
    name: String(debt.name ?? "Debt").slice(0, 80),
    balance: Math.max(0, num(debt.balance)),
    minimumPayment: Math.max(0, num(debt.minimumPayment)),
    dueDay: Math.max(1, Math.min(31, Math.round(num(debt.dueDay) || 1))),
  })).filter(debt => debt.id && debt.name && debt.balance > 0);
}

function sanitizeRecurringBillFacts(bills?: FloRecurringBillFact[]): FloRecurringBillFact[] {
  return (bills ?? []).slice(0, 60).map(bill => ({
    id: String(bill.id ?? "").slice(0, 80),
    name: String(bill.name ?? "Bill").slice(0, 80),
    amount: Math.max(0, num(bill.amount)),
    dueDay: Math.max(1, Math.min(31, Math.round(num(bill.dueDay) || 1))),
    category: String(bill.category ?? "Other").slice(0, 50),
  })).filter(bill => bill.id && bill.name && bill.amount >= 0);
}

function sanitizeBillMoveFacts(moves?: FloBillMoveFact[]): FloBillMoveFact[] {
  return (moves ?? []).slice(0, 12).map(move => ({
    id: String(move.id ?? "").slice(0, 80),
    billId: String(move.billId ?? "").slice(0, 80),
    billName: String(move.billName ?? "Bill").slice(0, 80),
    fromDate: String(move.fromDate ?? "").slice(0, 10),
    toDate: String(move.toDate ?? "").slice(0, 10),
  })).filter(move => move.id && move.billId && move.fromDate && move.toDate);
}

export function evaluateFloBillMoveUndo(message: string, facts: FloFacts): FloBillMoveFact | null {
  const lower = message.toLowerCase();
  if (!/\b(undo|restore|move back|put back|reverse)\b/.test(lower) || !/\b(bill|move|moved|due)\b/.test(lower)) return null;
  const moves = sanitizeBillMoveFacts(facts.billDateMoves);
  if (!moves.length) return null;
  const named = [...moves].sort((a, b) => b.billName.length - a.billName.length).find(move => lower.includes(move.billName.toLowerCase()));
  return named ?? moves[0];
}

function localMovedBillAnswer(message: string, facts: FloFacts): string | null {
  const lower = message.toLowerCase();
  const asksMovedBills = /\b(show|what|which|list|any)\b/.test(lower) && /\b(moved|rescheduled|bill moves|bill move)\b/.test(lower);
  const undo = evaluateFloBillMoveUndo(message, facts);
  if (undo) return `I can restore ${undo.billName} back to ${undo.fromDate}. Tap Undo to remove the one-time move from ${undo.fromDate} to ${undo.toDate}.`;
  if (!asksMovedBills) return null;
  const moves = sanitizeBillMoveFacts(facts.billDateMoves);
  return moves.length
    ? `Moved bills: ${moves.slice(0, 5).map(move => `${move.billName} from ${move.fromDate} to ${move.toDate}`).join("; ")}.`
    : "I don't see any one-time moved bills right now.";
}

export function evaluateFloBillDateMove(message: string, facts: FloFacts, today = new Date().toISOString().slice(0, 10)): FloBillDateMoveResult | null {
  const lower = message.toLowerCase();
  const plan = facts.paycheckPlan ? sanitizePaycheckPlan(facts.paycheckPlan) : null;
  const hasMoveVerb = /\b(move|change|shift|push|reschedule)\b/.test(lower);
  const asksMoveBillLanguage = hasMoveVerb && /\b(bill|due|paycheck|payday|pay day|after pay|after payday)\b/.test(lower);
  const asksRecommendation = /\b(what|which|show|suggest|recommend)\b/.test(lower) && /\b(bill|due)\b/.test(lower) && /\b(move|shift|change|reschedule)\b/.test(lower);
  if (!plan || !plan.nextPaycheck || !plan.billsDue.length) {
    return asksMoveBillLanguage || asksRecommendation
      ? {
        billId: "",
        billName: "",
        fromDate: "",
        toDate: "",
        toDay: 0,
        allowed: false,
        reason: "I don't see any unpaid bills before your next paycheck that I can safely move from here.",
      }
      : null;
  }
  const mentionedBill = findBillMention(message, plan.billsDue);
  const candidate = mentionedBill
    ?? (asksRecommendation ? [...plan.billsDue].sort((left, right) => right.amount - left.amount || left.dueDate.localeCompare(right.dueDate))[0] : null);
  const asksMoveBill = asksMoveBillLanguage || Boolean(hasMoveVerb && candidate);
  if (!candidate) return asksMoveBill
    ? {
      billId: "",
      billName: "",
      fromDate: "",
      toDate: "",
      toDay: 0,
      allowed: false,
      reason: `I can help, but I need the bill name. Bills before payday are ${plan.billsDue.slice(0, 3).map(bill => bill.name).join(", ")}.`,
    }
    : null;

  if (asksRecommendation && !mentionedBill) {
    const suggestedDate = addDaysIso(plan.nextPaycheck.date, 1);
    return {
      billId: String(candidate.id ?? ""),
      billName: candidate.name,
      fromDate: candidate.dueDate,
      toDate: suggestedDate,
      toDay: Number(suggestedDate.slice(8, 10)),
      allowed: false,
      reason: `${candidate.name} is the best bill to consider moving because it is $${candidate.amount.toFixed(2)} before payday. A safer date would be ${suggestedDate}, just after your next paycheck.`,
    };
  }

  const targetDate = /after (?:my |the )?(?:next )?(?:paycheck|payday|pay day|pay)/i.test(message)
    ? addDaysIso(plan.nextPaycheck.date, 1)
    : parseFloDate(message, today);
  if (!targetDate || targetDate === today && !/\b(today|20\d{2}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(message)) {
    return {
      billId: String(candidate.id ?? ""),
      billName: candidate.name,
      fromDate: candidate.dueDate,
      toDate: "",
      toDay: 0,
      allowed: false,
      reason: `I found ${candidate.name}, but I need the new date. Try “Move ${candidate.name} to ${addDaysIso(plan.nextPaycheck.date, 1)}.”`,
    };
  }
  if (!candidate.id) {
    return {
      billId: "",
      billName: candidate.name,
      fromDate: candidate.dueDate,
      toDate: targetDate,
      toDay: Number(targetDate.slice(8, 10)),
      allowed: false,
      reason: `I found ${candidate.name}, but it is missing the saved bill ID needed to update the due date.`,
    };
  }
  return {
    billId: String(candidate.id),
    billName: candidate.name,
    fromDate: candidate.dueDate,
    toDate: targetDate,
    toDay: Number(targetDate.slice(8, 10)),
    allowed: true,
    reason: `I can move ${candidate.name} from ${candidate.dueDate} to ${targetDate} for this one occurrence only. Preview first: this should put the bill after payday and keep the paycheck window cleaner.`,
  };
}

function findBillMention(message: string, bills: PaycheckPlanResult["billsDue"]) {
  const lower = message.toLowerCase();
  return [...bills]
    .sort((left, right) => right.name.length - left.name.length)
    .find(bill => lower.includes(bill.name.toLowerCase()))
    ?? null;
}

function addDaysIso(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function sanitizePaycheckPlan(plan: PaycheckPlanResult): PaycheckPlanResult {
  const status = ["safe", "tight", "risk", "empty"].includes(String(plan.status)) ? plan.status : "empty";
  return {
    nextPaycheck: plan.nextPaycheck ? {
      id: plan.nextPaycheck.id ? String(plan.nextPaycheck.id).slice(0, 80) : undefined,
      name: String(plan.nextPaycheck.name ?? "Next paycheck").slice(0, 80),
      amount: num(plan.nextPaycheck.amount),
      date: String(plan.nextPaycheck.date ?? "").slice(0, 10),
    } : null,
    windowStart: String(plan.windowStart ?? "").slice(0, 10),
    windowEnd: String(plan.windowEnd ?? "").slice(0, 10),
    billsDue: (plan.billsDue ?? []).slice(0, 8).map(bill => ({
      id: bill.id ? String(bill.id).slice(0, 80) : undefined,
      name: String(bill.name ?? "Bill").slice(0, 80),
      amount: num(bill.amount),
      dueDate: String(bill.dueDate ?? "").slice(0, 10),
    })),
    billsTotal: num(plan.billsTotal),
    safeToSpend: Math.max(0, num(plan.safeToSpend)),
    lowestBalance: num(plan.lowestBalance),
    lowestBalanceDate: String(plan.lowestBalanceDate ?? "").slice(0, 10),
    status,
  };
}

function localPaycheckAnswer(message: string, facts: FloFacts): string | null {
  const lower = message.toLowerCase();
  const asksPaycheck = /paycheck|pay day|payday|until pay|before i get paid|before next pay|next pay|spend until|safe to spend|what can i spend|bills before pay|this paycheck|eating up.*paycheck|okay before/i.test(lower);
  if (!asksPaycheck) return null;
  const plan = facts.paycheckPlan ? sanitizePaycheckPlan(facts.paycheckPlan) : null;
  if (!plan || !plan.nextPaycheck || plan.status === "empty") {
    return "I don't see an upcoming paycheck in the forecast yet. Add recurring income with a next pay date and I can plan the window before payday.";
  }
  const nextPayDate = plan.nextPaycheck.date;
  const billList = plan.billsDue.slice(0, 3).map(bill => `${bill.name} ($${bill.amount.toFixed(0)} on ${bill.dueDate})`).join(", ");
  if (/bill|due|eating up|taking|why|what.*before/i.test(lower)) {
    return plan.billsDue.length
      ? `Before your next paycheck on ${nextPayDate}, I see ${plan.billsDue.length} bill${plan.billsDue.length === 1 ? "" : "s"} totaling $${plan.billsTotal.toFixed(2)}: ${billList}. Your safe-to-spend before payday is about $${plan.safeToSpend.toFixed(2)}.`
      : `I don't see bills due before your next paycheck on ${nextPayDate}. Your safe-to-spend before payday is about $${plan.safeToSpend.toFixed(2)}.`;
  }
  if (plan.status === "risk") {
    return `Not safely. Before your next paycheck on ${nextPayDate}, your forecast drops to $${plan.lowestBalance.toFixed(2)} on ${plan.lowestBalanceDate}, which is below your $${facts.safetyFloor.toFixed(0)} floor. Bills before payday total $${plan.billsTotal.toFixed(2)}.`;
  }
  if (plan.status === "tight") {
    return `Yes, but tight. You can spend about $${plan.safeToSpend.toFixed(2)} before your next paycheck on ${nextPayDate}. Your lowest balance in that window is $${plan.lowestBalance.toFixed(2)} on ${plan.lowestBalanceDate}.`;
  }
  return `You can spend about $${plan.safeToSpend.toFixed(2)} before your next paycheck on ${nextPayDate}. I see ${plan.billsDue.length} bill${plan.billsDue.length === 1 ? "" : "s"} due before then totaling $${plan.billsTotal.toFixed(2)}, and your lowest balance should be $${plan.lowestBalance.toFixed(2)} on ${plan.lowestBalanceDate}.`;
}

function localMonthlyReviewAnswer(message: string, facts: FloFacts): string | null {
  const lower = message.toLowerCase();
  if (!/(monthly review|review.*month|improve next month|next month|what should i improve|biggest leak|best win)/i.test(lower)) return null;
  const categories = facts.categoryPlan ?? [];
  const over = [...categories].filter(item => item.remaining < 0).sort((left, right) => left.remaining - right.remaining)[0];
  const best = [...categories].filter(item => item.remaining > 0).sort((left, right) => right.remaining - left.remaining)[0];
  const history = sanitizeDecisionHistoryFacts(facts.decisionHistory);
  const reviewCount = history.due.length + (history.risky?.length ?? 0);
  const billText = facts.billsLeftCount > 0
    ? `You still have ${facts.billsLeftCount} bill${facts.billsLeftCount === 1 ? "" : "s"} left totaling $${facts.billsLeftAmount.toFixed(2)}.`
    : "Your bill checklist looks caught up.";
  const categoryText = over
    ? `Biggest leak: ${over.category} is $${Math.abs(over.remaining).toFixed(2)} over plan.`
    : best
      ? `Best cushion: ${best.category} has $${best.remaining.toFixed(2)} left.`
      : "I don't see category budget data yet.";
  const decisionText = reviewCount > 0
    ? `${reviewCount} planned decision${reviewCount === 1 ? " needs" : "s need"} review before you trust next month.`
    : `${history.completed.length} decision${history.completed.length === 1 ? "" : "s"} completed and no planned decisions need review right now.`;
  const improvement = over
    ? `For next month, tighten ${over.category}, move money into it from a category with room, or lower spending before it repeats.`
    : facts.monthlyRemaining < 0
      ? "For next month, fix the monthly shortfall first before adding new plans."
      : "For next month, keep the cushion protected and decide whether leftover money should go to savings, debt, or upcoming bills.";
  return `${billText} ${categoryText} ${decisionText} ${improvement}`;
}

function sanitizeDecisionHistoryFacts(history?: FloDecisionHistoryFacts): FloDecisionHistoryFacts {
  const cleanItems = (items?: FloDecisionHistoryFact[]) => (items ?? []).slice(0, 8).map(item => ({
    name: String(item.name ?? "Decision").slice(0, 80),
    date: String(item.date ?? "").slice(0, 10),
    plannedAmount: num(item.plannedAmount),
    actualAmount: item.actualAmount === undefined ? undefined : num(item.actualAmount),
    varianceLabel: item.varianceLabel ? String(item.varianceLabel).slice(0, 40) : undefined,
    status: ["upcoming", "due", "completed", "postponed", "cancelled", "saved"].includes(String(item.status))
      ? item.status
      : "upcoming",
  })) as FloDecisionHistoryFact[];
  return {
    due: cleanItems(history?.due),
    upcoming: cleanItems(history?.upcoming),
    completed: cleanItems(history?.completed),
    changed: cleanItems(history?.changed),
    risky: cleanItems(history?.risky),
  };
}

function localDecisionHistoryAnswer(message: string, facts: FloFacts): string | null {
  const lower = message.toLowerCase();
  const asksDecision = /(decision|plan|planned|review|completed|cancelled|canceled|postponed|coming up|upcoming|last decision)/i.test(lower);
  const asksReduction = /((reduce|lower|cut|postpone).*(planned|decision|spending))|((planned|decision|spending).*(reduce|lower|cut|postpone))|(planned spending)/i.test(lower);
  if (!asksDecision && !asksReduction) return null;
  const history = sanitizeDecisionHistoryFacts(facts.decisionHistory);
  const list = (items: FloDecisionHistoryFact[]) => items
    .slice(0, 3)
    .map(item => `${item.name} on ${item.date} (${item.actualAmount === undefined ? `planned $${item.plannedAmount.toFixed(2)}` : `planned $${item.plannedAmount.toFixed(2)}, actual $${item.actualAmount.toFixed(2)}`})`)
    .join("; ");

  if (asksReduction) {
    const target = [...(history.risky ?? []), ...history.due, ...history.upcoming]
      .sort((left, right) => right.plannedAmount - left.plannedAmount || left.date.localeCompare(right.date))[0];
    if (!target) return "I don't see upcoming planned decisions to reduce or postpone right now.";
    const reason = (history.risky ?? []).some(item => item.name === target.name && item.date === target.date)
      ? "because it is no longer safe in the current forecast"
      : "because it is one of the largest upcoming planned decisions";
    return `The best plan to adjust is ${target.name} on ${target.date} for $${target.plannedAmount.toFixed(2)} ${reason}. You can postpone it, lower the amount, or cancel it.`;
  }

  if (/no longer safe|risky|unsafe|risk|became unsafe/.test(lower)) {
    return (history.risky ?? []).length
      ? `${history.risky!.length} planned decision${history.risky!.length === 1 ? " is" : "s are"} no longer safe: ${list(history.risky!)}. Review them before the planned date.`
      : "I don't see any planned decisions that are currently below your safety floor.";
  }
  if (/need.*review|review|past due|overdue/.test(lower)) {
    return history.due.length
      ? `You have ${history.due.length} decision${history.due.length === 1 ? "" : "s"} needing review: ${list(history.due)}. Complete, postpone, or cancel them from Decision History.`
      : "You don't have any planned decisions needing review right now.";
  }
  if (/coming up|upcoming|planned decisions?|what.*planned|next plans?/.test(lower)) {
    return history.upcoming.length
      ? `Your upcoming planned decisions are ${list(history.upcoming)}.`
      : "I don't see any upcoming planned decisions right now.";
  }
  if (/last decision|how.*last|last.*go/.test(lower)) {
    const last = [...history.completed].sort((left, right) => right.date.localeCompare(left.date))[0];
    if (!last) return "I don't see a completed decision yet. Complete one from Decision History and I'll compare actual versus planned.";
    const variance = last.varianceLabel ? ` ${last.varianceLabel}.` : "";
    return `${last.name} was completed on ${last.date}. It was planned at $${last.plannedAmount.toFixed(2)}${last.actualAmount === undefined ? "" : ` and actual was $${last.actualAmount.toFixed(2)}`}.${variance}`;
  }
  if (/cancelled|canceled|postponed|changed/.test(lower)) {
    return history.changed.length
      ? `Your changed decisions are ${list(history.changed)}.`
      : "I don't see any cancelled or postponed decisions right now.";
  }
  if (/completed|done|finished/.test(lower)) {
    return history.completed.length
      ? `Your completed decisions are ${list(history.completed)}.`
      : "I don't see any completed decisions yet.";
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
  const target = findCategoryByName(requested.to, categories) ?? debtCategoryFallback(requested.to);
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
  if (target.remaining + requested.amount < -0.005) {
    const remainingShort = Math.abs(target.remaining + requested.amount);
    return {
      amount: requested.amount,
      from: source.category,
      to: target.category,
      allowed: false,
      reason: `That would help, but it would still leave ${target.category} $${remainingShort.toFixed(2)} over plan. I won't apply a move that leaves the target category negative. Try moving at least $${Math.abs(target.remaining).toFixed(2)}, or adjust the budget manually if no category has enough room.`,
    };
  }
  return {
    amount: requested.amount,
    from: source.category,
    to: target.category,
    allowed: true,
    reason: target.category === "Debt"
      ? `Yes. You can move $${requested.amount.toFixed(2)} from ${source.category} to Debt. ${source.category} would have $${(source.remaining - requested.amount).toFixed(2)} left, and the money can be reserved for debt payoff instead of extra spending.`
      : `Yes. You can move $${requested.amount.toFixed(2)} from ${source.category} to ${target.category}. ${source.category} would have $${(source.remaining - requested.amount).toFixed(2)} left, and ${target.category} would improve to $${(target.remaining + requested.amount).toFixed(2)} left.`,
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

function debtCategoryFallback(name: string): FloCategoryFact | null {
  const normalized = cleanupCategoryName(name).toLowerCase();
  if (!/\b(debt|snowball|extra debt|debt payoff|payoff)\b/.test(normalized)) return null;
  return {
    category: "Debt",
    budgeted: 0,
    spent: 0,
    remaining: 0,
    status: "available",
    percentUsed: 0,
  };
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

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatFloMonthDay(facts: FloFacts, day: number) {
  const anchor = facts.todayForecast?.date || facts.lowestBalanceDate || facts.upcoming[0]?.date || "";
  const monthIndex = Number(anchor.slice(5, 7)) - 1;
  return `${MONTH_SHORT[monthIndex] ?? "Month"} ${day}`;
}

function replaceDayReferences(facts: FloFacts, text: string) {
  return text.replace(/\bday (\d{1,2})\b/gi, (_, day) => formatFloMonthDay(facts, Number(day)));
}

export function floResponseCards(message: string, facts: FloFacts, days: DecisionBaselineDay[]): FloResponseCard[] {
  const lower = message.toLowerCase();
  const debtPayment = evaluateFloDebtPayment(message, facts);
  if (debtPayment) {
    const result = debtPayment.allowed ? evaluateDecision(days, buildDebtPaymentScenario(debtPayment), facts.safetyFloor) : null;
    return [
      {
        title: "Extra Debt Payment",
        value: debtPayment.allowed && result ? result.verdict.toUpperCase() : "NEEDS CHECK",
        detail: debtPayment.reason,
        tone: debtPayment.allowed && result ? (result.verdict === "safe" ? "safe" : result.verdict === "caution" ? "caution" : "risk") : "risk",
      },
      {
        title: "Debt Balance After",
        value: `$${debtPayment.balanceAfter.toFixed(0)}`,
        detail: debtPayment.debtName || "Select a debt",
        tone: debtPayment.allowed ? "info" : "risk",
      },
    ];
  }
  const billChange = evaluateFloRecurringBillChange(message, facts);
  if (billChange) {
    return [
      {
        title: "Recurring Bill Change",
        value: billChange.allowed ? "READY" : "NEEDS BILL",
        detail: billChange.reason,
        tone: billChange.allowed ? "safe" : "risk",
      },
      {
        title: "Monthly Change",
        value: formatSignedDollars(billChange.newAmount - billChange.oldAmount),
        detail: `${billChange.billName || "Bill"} starting ${billChange.startDate}`,
        tone: billChange.newAmount <= billChange.oldAmount ? "safe" : "caution",
      },
    ];
  }
  const scenario = buildFloDecisionScenario(message);
  if (scenario) {
    const result = evaluateDecision(days, scenario, facts.safetyFloor);
    return [
      { title: "Purchase Decision", value: result.verdict.toUpperCase(), detail: `I’m testing whether this purchase keeps the plan above your $${facts.safetyFloor.toFixed(0)} floor. ${result.explanation}`, tone: result.verdict === "safe" ? "safe" : result.verdict === "caution" ? "caution" : "risk" },
      { title: "Lowest Balance", value: `$${result.lowestBalance.toFixed(0)}`, detail: `I see this as the lowest projected balance after the purchase: ${result.lowestBalanceDate}.`, tone: result.lowestBalance < facts.safetyFloor ? "risk" : "info" },
      { title: "Safer Amount", value: `$${result.saferAmount.toFixed(0)}`, detail: "I calculated this as the largest amount that still protects your safety floor on the tightest forecast date.", tone: "info" },
    ];
  }
  const categoryCards = floCategoryCards(message, facts);
  if (categoryCards.length) return categoryCards;
  const paycheckCards = floPaycheckCards(message, facts);
  if (paycheckCards.length) return paycheckCards;
  if (lower.includes("why") && (lower.includes("negative") || lower.includes("balance"))) {
    return [
      { title: "Lowest Forecast", value: `$${facts.lowestBalance.toFixed(0)}`, detail: facts.lowestBalanceDate, tone: facts.lowestBalance < facts.safetyFloor ? "risk" : "caution" },
      { title: "Safe Cushion", value: `$${(facts.lowestBalance - facts.safetyFloor).toFixed(0)}`, detail: `I’m showing the room between your lowest forecast and your $${facts.safetyFloor.toFixed(0)} floor.`, tone: facts.lowestBalance < facts.safetyFloor ? "risk" : "safe" },
    ];
  }
  if ((lower.includes("left") || lower.includes("remaining")) && lower.includes("bill")) {
    return [
      { title: "Bills Left", value: String(facts.billsLeftCount), detail: `$${facts.billsLeftAmount.toFixed(2)} still needs to clear this month.`, tone: facts.billsLeftCount > 0 ? "caution" : "safe" },
      { title: "Bill Progress", value: `${facts.billProgressPercent}%`, detail: "This tracks how many bills are cleared, not just how many dollars are paid.", tone: facts.billProgressPercent >= 80 ? "safe" : "info" },
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

function floPaycheckCards(message: string, facts: FloFacts): FloResponseCard[] {
  const lower = message.toLowerCase();
  if (!/paycheck|pay day|payday|until pay|before i get paid|before next pay|next pay|spend until|safe to spend|what can i spend|bills before pay|this paycheck/i.test(lower)) return [];
  const plan = facts.paycheckPlan ? sanitizePaycheckPlan(facts.paycheckPlan) : null;
  if (!plan || !plan.nextPaycheck || plan.status === "empty") {
    return [
      { title: "Paycheck Plan", value: "NEEDS INCOME", detail: "Add recurring income with a next pay date", tone: "caution" },
    ];
  }
  const tone = plan.status === "risk" ? "risk" : plan.status === "tight" ? "caution" : "safe";
  return [
    { title: "Safe Until Payday", value: `$${plan.safeToSpend.toFixed(0)}`, detail: `Next pay: ${plan.nextPaycheck.date}`, tone },
    { title: "Bills Before Pay", value: String(plan.billsDue.length), detail: `$${plan.billsTotal.toFixed(2)} total`, tone: plan.billsDue.length ? "caution" : "safe" },
    { title: "Lowest Balance", value: `$${plan.lowestBalance.toFixed(0)}`, detail: plan.lowestBalanceDate, tone: plan.lowestBalance < facts.safetyFloor ? "risk" : "info" },
  ];
}

function floCategoryCards(message: string, facts: FloFacts): FloResponseCard[] {
  const categories = facts.categoryPlan ?? [];
  const move = evaluateFloCategoryMove(message, facts);
  if (move) {
    return [
      {
        title: "Budget Move",
        value: move.allowed ? "READY" : "NOT SAFE",
        detail: move.allowed ? `$${move.amount.toFixed(2)} from ${move.from} to ${move.to}` : move.reason,
        tone: move.allowed ? "safe" : "risk",
      },
    ];
  }
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
  const amount = parseFloDecisionAmount(message);
  const hasSavingsIntent = /\b(add|put|move|transfer|contribute|save)\b/.test(lower)
    && /\b(savings?|emergency fund|rainy day)\b/.test(lower);
  if (hasSavingsIntent) {
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return {
      type: "savings_contribution",
      name: `Savings contribution: $${amount.toFixed(amount % 1 === 0 ? 0 : 2)}`,
      amount,
      date: parseFloDate(message, today),
      frequency: "once",
    };
  }
  const hasDecisionIntent = lower.includes("afford")
    || lower.includes("buy")
    || lower.includes("spend")
    || isFloPlanCreateCommand(message);
  if (!hasDecisionIntent) return null;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return {
    type: "one_time_purchase",
    name: `Flo plan: $${amount.toFixed(amount % 1 === 0 ? 0 : 2)}`,
    amount,
    date: parseFloDate(message, today),
    frequency: "once",
  };
}

export function evaluateFloDebtPayment(message: string, facts: FloFacts, today = new Date().toISOString().slice(0, 10)): FloDebtPaymentResult | null {
  const lower = message.toLowerCase();
  const hasIntent = /\b(pay|payment|put|apply|send|add)\b/.test(lower)
    && /\b(debt|snowball|toward|towards|payoff|principal)\b/.test(lower);
  if (!hasIntent) return null;
  const amount = parseFloDecisionAmount(message);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const debts = sanitizeDebtFacts(facts.debts);
  const debt = findNamedItem(message, debts);
  if (!debts.length) {
    return {
      amount,
      debtId: "",
      debtName: "",
      date: parseFloDate(message, today),
      balanceBefore: 0,
      balanceAfter: 0,
      allowed: false,
      reason: "I don't see any active debts I can apply this payment to yet.",
    };
  }
  if (!debt) {
    return {
      amount,
      debtId: "",
      debtName: "",
      date: parseFloDate(message, today),
      balanceBefore: 0,
      balanceAfter: 0,
      allowed: false,
      reason: `I can help, but I need the debt name. Active debts include ${debts.slice(0, 4).map(item => item.name).join(", ")}.`,
    };
  }
  if (amount > debt.balance + 0.005) {
    return {
      amount,
      debtId: debt.id,
      debtName: debt.name,
      date: parseFloDate(message, today),
      balanceBefore: debt.balance,
      balanceAfter: debt.balance,
      allowed: false,
      reason: `${debt.name} only has $${debt.balance.toFixed(2)} left, so I won't create a $${amount.toFixed(2)} debt payment for it.`,
    };
  }
  const date = parseFloDate(message, today);
  const balanceAfter = roundCents(Math.max(0, debt.balance - amount));
  return {
    amount,
    debtId: debt.id,
    debtName: debt.name,
    date,
    balanceBefore: debt.balance,
    balanceAfter,
    allowed: true,
    reason: `I can apply $${amount.toFixed(2)} to ${debt.name} on ${date}. The debt balance would move from $${debt.balance.toFixed(2)} to $${balanceAfter.toFixed(2)} when that date arrives.`,
  };
}

export function evaluateFloRecurringBillChange(message: string, facts: FloFacts, today = new Date().toISOString().slice(0, 10)): FloRecurringBillChangeResult | null {
  const lower = message.toLowerCase();
  const hasIntent = /\b(change|update|set|make)\b/.test(lower)
    && /\b(bill|payment|monthly|starting|next month|due)\b/.test(lower)
    && /\$?\s*[\d,]+(?:\.\d{1,2})?/.test(message);
  if (!hasIntent) return null;
  const amount = parseFloDecisionAmount(message);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const bills = sanitizeRecurringBillFacts(facts.recurringBills);
  const bill = findNamedItem(message, bills);
  const startDate = parseBillChangeStartDate(message, today);
  const preserveCurrentMonth = isFutureMonth(startDate, today);
  if (!bills.length) {
    return {
      billId: "",
      billName: "",
      oldAmount: 0,
      newAmount: amount,
      startDate,
      preserveCurrentMonth,
      allowed: false,
      reason: "I don't see recurring bills I can update from here yet.",
    };
  }
  if (!bill) {
    return {
      billId: "",
      billName: "",
      oldAmount: 0,
      newAmount: amount,
      startDate,
      preserveCurrentMonth,
      allowed: false,
      reason: `I can update a recurring bill, but I need the bill name. I see ${bills.slice(0, 4).map(item => item.name).join(", ")}.`,
    };
  }
  return {
    billId: bill.id,
    billName: bill.name,
    oldAmount: bill.amount,
    newAmount: amount,
    startDate,
    preserveCurrentMonth,
    allowed: true,
    reason: `I can change ${bill.name} from $${bill.amount.toFixed(2)} to $${amount.toFixed(2)} starting ${startDate}.${preserveCurrentMonth ? " I will preserve this month's amount and apply the new amount moving forward." : ""}`,
  };
}

export function buildDebtPaymentScenario(payment: FloDebtPaymentResult): DecisionScenario {
  return {
    type: "extra_debt_payment",
    name: `Extra debt payment: ${payment.debtName}`,
    amount: payment.amount,
    date: payment.date,
    frequency: "once",
    sourceId: payment.debtId,
  };
}

function parseBillChangeStartDate(message: string, today: string): string {
  if (/\bnext month\b/i.test(message)) {
    const base = new Date(`${today}T00:00:00Z`);
    return `${base.getUTCFullYear() + (base.getUTCMonth() === 11 ? 1 : 0)}-${String((base.getUTCMonth() + 1) % 12 + 1).padStart(2, "0")}-01`;
  }
  if (/\b(today|20\d{2}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(message)) {
    return parseFloDate(message, today);
  }
  return today;
}

function isFutureMonth(date: string, today: string): boolean {
  return date.slice(0, 7) > today.slice(0, 7);
}

function findNamedItem<T extends { name: string }>(message: string, items: T[]): T | null {
  const lower = message.toLowerCase();
  return [...items]
    .sort((left, right) => right.name.length - left.name.length)
    .find(item => lower.includes(item.name.toLowerCase())) ?? null;
}

function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function isFloPlanCreateCommand(message: string): boolean {
  const lower = message.toLowerCase();
  return /\b(add|create|save|schedule|make|put)\b/.test(lower)
    && /\b(plan|planned|decision|purchase|expense|transaction)\b/.test(lower);
}

function parseFloDecisionAmount(message: string): number {
  const dollar = message.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
  if (dollar) return Number(dollar[1].replace(/,/g, ""));

  const trailingAmount = message.match(/\b(?:for|of|amount|cost(?:ing)?|price(?:d)?(?: at)?)\s+\$?\s*([\d,]+(?:\.\d{1,2})?)\s*$/i);
  if (trailingAmount) return Number(trailingAmount[1].replace(/,/g, ""));

  const withoutDates = message
    .replace(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*20\d{2})?\b/gi, "")
    .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, "")
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/(?:20\d{2}|\d{2}))?\b/g, "");
  const numbers = [...withoutDates.matchAll(/\b([\d,]+(?:\.\d{1,2})?)\b/g)].map(match => Number(match[1].replace(/,/g, "")));
  return numbers.length ? numbers[numbers.length - 1] : 0;
}

export function parseFloDate(message: string, today: string): string {
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
