import type { DatedDebtAllocation } from "./snowball";

export type TodayDecisionTone = "safe" | "watch" | "risk" | "info";

export type TodayDecision = {
  id: string;
  title: string;
  reason: string;
  actionLabel: string;
  route: string;
  params?: Record<string, string>;
  tone: TodayDecisionTone;
};

export type TodayDecisionInput = {
  reviewCount: number;
  lowestBalance: number;
  lowestDate?: string | null;
  safetyFloor: number;
  nextBill?: {
    id: string;
    name: string;
    amount: number;
    dateLabel: string;
    daysAway: number;
    isDebt?: boolean;
    frequency?: "monthly" | "quarterly" | "biweekly" | "weekly";
    paidOff?: boolean;
    rollover?: { name: string; amount: number } | null;
  } | null;
  snowballTarget?: { name: string; balance: number } | null;
  goal?: { name: string; current: number; target: number } | null;
  safeToSpend: number;
};

export type DatedDebtDecisionPayment = {
  date: string;
  name: string;
  amount: number;
  paidOff: boolean;
  rollover: { name: string; amount: number } | null;
};

/** Turns a source creditor's split dated allocations into one honest dashboard summary. */
export function summarizeDatedDebtDecision(
  allocations: readonly DatedDebtAllocation[],
  sourceBillId: string,
): DatedDebtDecisionPayment | null {
  const sourced = allocations
    .filter(allocation => allocation.sourceBillId === sourceBillId && allocation.amount > 0.005)
    .sort((left, right) => left.date.localeCompare(right.date));
  const date = sourced[0]?.date;
  if (!date) return null;

  const sameDay = sourced.filter(allocation => allocation.date === date);
  const primary = sameDay.find(allocation => allocation.targetBillId === sourceBillId) ?? sameDay[0];
  if (!primary) return null;

  const rollovers = sameDay.filter(allocation => allocation.id !== primary.id && allocation.amount > 0.005);
  const rolloverAmount = rollovers.reduce((sum, allocation) => sum + allocation.amount, 0);
  const rolloverNames = [...new Set(rollovers.map(allocation => allocation.targetBillName))];
  const rolloverName = rolloverNames.length === 1
    ? rolloverNames[0]
    : rolloverNames.length === 2
      ? `${rolloverNames[0]} and ${rolloverNames[1]}`
      : rolloverNames.length > 2
        ? "your next debts"
        : null;

  return {
    date,
    name: primary.targetBillName,
    amount: primary.amount,
    paidOff: primary.paidOff,
    rollover: rolloverName && rolloverAmount > 0.005
      ? { name: rolloverName, amount: rolloverAmount }
      : null,
  };
}

function money(value: number) {
  return Math.max(0, Number.isFinite(value) ? value : 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function paymentCadenceLabel(
  frequency?: "monthly" | "quarterly" | "biweekly" | "weekly",
) {
  switch (frequency) {
    case "weekly":
      return " weekly payment";
    case "biweekly":
      return " biweekly payment";
    case "monthly":
      return " monthly payment";
    case "quarterly":
      return " quarterly payment";
    default:
      return "";
  }
}

export function buildTodaysDecisions(input: TodayDecisionInput): TodayDecision[] {
  const decisions: TodayDecision[] = [];

  if (input.lowestBalance < input.safetyFloor) {
    const shortfall = input.safetyFloor - input.lowestBalance;
    decisions.push({
      id: "low-balance-risk",
      title: "Protect your forecast",
      reason: `Your projected balance falls ${money(shortfall)} below your safety floor${input.lowestDate ? ` on ${input.lowestDate}` : ""}.`,
      actionLabel: "Review Monthly",
      route: "/(tabs)/monthly",
      tone: "risk",
    });
  }

  if (input.reviewCount > 0) {
    decisions.push({
      id: "review-center",
      title: `${input.reviewCount} ${input.reviewCount === 1 ? "item needs" : "items need"} review`,
      reason: "Confirm posted activity so your plan and forecast stay accurate.",
      actionLabel: "Open Review Center",
      route: "/(tabs)/review",
      tone: "watch",
    });
  }

  if (input.nextBill && input.nextBill.daysAway >= 0 && input.nextBill.daysAway <= 3) {
    const debtPayoffWithRollover = Boolean(
      input.nextBill.isDebt && input.nextBill.paidOff && input.nextBill.rollover,
    );
    decisions.push({
      id: "bill-due",
      title: debtPayoffWithRollover
        ? `${input.nextBill.name} payoff is coming up`
        : `${input.nextBill.name} is coming up`,
      reason: debtPayoffWithRollover && input.nextBill.rollover
        ? `${money(input.nextBill.amount)} pays off ${input.nextBill.name} ${input.nextBill.dateLabel}. ${money(input.nextBill.rollover.amount)} rolls to ${input.nextBill.rollover.name} the same day.`
        : `${money(input.nextBill.amount)}${paymentCadenceLabel(input.nextBill.frequency)} is due ${input.nextBill.dateLabel}.`,
      actionLabel: input.nextBill.isDebt ? "Review Debt" : "Review Bills",
      route: "/(tabs)/bills",
      params: input.nextBill.isDebt
        ? { view: "debt", debtId: input.nextBill.id }
        : { view: "bills" },
      tone: input.nextBill.daysAway <= 1 ? "watch" : "info",
    });
  }

  if (input.snowballTarget && input.snowballTarget.balance > 0) {
    decisions.push({
      id: "snowball-target",
      title: `Keep targeting ${input.snowballTarget.name}`,
      reason: `${money(input.snowballTarget.balance)} remains on your current lowest-balance debt.`,
      actionLabel: "Open Planner",
      route: "/snowball-plan",
      tone: "info",
    });
  }

  const goalProgress = input.goal && input.goal.target > 0
    ? input.goal.current / input.goal.target
    : 0;
  if (input.goal && goalProgress >= 0.8 && goalProgress < 1) {
    decisions.push({
      id: "goal-close",
      title: `${input.goal.name} is nearly complete`,
      reason: `${Math.round(goalProgress * 100)}% funded with ${money(input.goal.target - input.goal.current)} remaining.`,
      actionLabel: "Open Goals",
      route: "/(tabs)/more",
      params: { section: "goals" },
      tone: "safe",
    });
  }

  if (decisions.length === 0 && input.safeToSpend > 0) {
    decisions.push({
      id: "all-clear",
      title: "Your plan is clear today",
      reason: `${money(input.safeToSpend)} currently remains above your safety floor based on the forecast.`,
      actionLabel: "View Monthly",
      route: "/(tabs)/monthly",
      tone: "safe",
    });
  }

  if (decisions.length === 0) {
    decisions.push({
      id: "check-plan",
      title: "No urgent action right now",
      reason: "Your current records do not show a supported action that needs attention today.",
      actionLabel: "Review Monthly",
      route: "/(tabs)/monthly",
      tone: "safe",
    });
  }

  return decisions.slice(0, 3);
}
