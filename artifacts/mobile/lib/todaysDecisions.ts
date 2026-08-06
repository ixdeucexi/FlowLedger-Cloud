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
  nextBill?: { name: string; amount: number; dateLabel: string; daysAway: number } | null;
  snowballTarget?: { name: string; balance: number } | null;
  goal?: { name: string; current: number; target: number } | null;
  safeToSpend: number;
};

function money(value: number) {
  return Math.max(0, Number.isFinite(value) ? value : 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
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
    decisions.push({
      id: "bill-due",
      title: `${input.nextBill.name} is coming up`,
      reason: `${money(input.nextBill.amount)} is due ${input.nextBill.dateLabel}.`,
      actionLabel: "Review Bills",
      route: "/(tabs)/bills",
      params: { filter: "bills" },
      tone: input.nextBill.daysAway <= 1 ? "watch" : "info",
    });
  }

  if (input.snowballTarget && input.snowballTarget.balance > 0) {
    decisions.push({
      id: "snowball-target",
      title: `Keep targeting ${input.snowballTarget.name}`,
      reason: `${money(input.snowballTarget.balance)} remains on your current lowest-balance debt.`,
      actionLabel: "View Snowball",
      route: "/(tabs)/bills",
      params: { filter: "debt" },
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
