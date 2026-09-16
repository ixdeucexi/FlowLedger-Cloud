/** Authored, read-only takeaways. No forecast, settlement, or affordability calculations. */
export type FloDailyHistory = { day: string; topic: string }[];
export type FloDailyTip = {
  topic: string;
  title: string;
  details: string[];
  actionLabel: string;
  route: string;
  params?: Record<string, string>;
  urgent: boolean;
};
export type FloDailyFacts = {
  today: string;
  decisions: { id: string; tone: string }[];
  reviewCount: number;
  upcoming: {
    name: string;
    amount: number;
    day: number;
    month: number;
    year: number;
    pending: boolean;
  }[];
  goals: {
    name: string;
    current_amount: number;
    target_amount: number;
    closed_at?: string;
    calendar_marker_only?: boolean;
  }[];
  payday?: { date: string; income: number } | null;
  categories?: {
    category: string;
    budgeted: number;
    spent: number;
    status: string;
  }[];
  /** Prepared month totals used to turn general guidance into account-specific coaching. */
  monthlyIncome?: number;
  monthlyBills?: number;
  safetyFloor?: number;
  cashFlowRisk?: { lowestBalance: number; safetyFloor: number };
  accountHealth?: {
    checkingBalance: number | null;
    pendingCount: number;
    confidence: "high" | "medium" | "low";
  };
};
const money = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    amount,
  );
export function selectTodayWithFlo(
  facts: FloDailyFacts,
  history: FloDailyHistory,
): FloDailyTip | null {
  const tips: FloDailyTip[] = [];
  if (
    facts.cashFlowRisk &&
    Number.isFinite(facts.cashFlowRisk.lowestBalance) &&
    Number.isFinite(facts.cashFlowRisk.safetyFloor) &&
    facts.cashFlowRisk.lowestBalance < facts.cashFlowRisk.safetyFloor
  ) {
    tips.push({
      topic: "forecast-risk",
      title: "Give your upcoming plan a closer look",
      details: [
        "Your prepared forecast flagged pressure on your cushion.",
        "Review scheduled outflows and your actual balance before making extra payments.",
      ],
      actionLabel: "Review forecast",
      route: "/(tabs)/monthly",
      urgent: true,
    });
  }
  if (Number.isInteger(facts.reviewCount) && facts.reviewCount > 0) {
    tips.push({
      topic: "review",
      title: "A quick review can keep your plan accurate",
      details: [
        `${facts.reviewCount} item${facts.reviewCount === 1 ? " needs" : "s need"} your review.`,
        "Confirm matches and details before relying on the plan.",
      ],
      actionLabel: "Review items",
      route: "/(tabs)/review",
      urgent: false,
    });
  }
  const accountHealth = facts.accountHealth;
  const checkingBalance = accountHealth?.checkingBalance;
  if (
    accountHealth &&
    (accountHealth.checkingBalance === null ||
      Number.isFinite(accountHealth.checkingBalance))
  ) {
    tips.push({
      topic: "account-balance-review",
      title:
        accountHealth.checkingBalance === null
          ? "Give your plan a checking balance to work from"
          : "Reconcile checking before your next move",
      details: [
        accountHealth.checkingBalance === null
          ? "Your prepared view does not have an available checking-balance snapshot."
          : `Your prepared view records ${money(accountHealth.checkingBalance)} in checking.`,
        "Review your accounts and compare with your bank. A recorded balance is not a promise of available spending money.",
      ],
      actionLabel: "Review accounts",
      route: "/(tabs)/more",
      params: { section: "accounts" },
      urgent: false,
    });
  }
  if (
    accountHealth &&
    typeof checkingBalance === "number" &&
    Number.isFinite(checkingBalance) &&
    typeof facts.safetyFloor === "number" &&
    Number.isFinite(facts.safetyFloor) &&
    checkingBalance < facts.safetyFloor
  ) {
    const gap = facts.safetyFloor - checkingBalance;
    tips.push({
      topic: "buffer-build",
      title: "Build a small cash buffer first",
      details: [
        `Your recorded checking balance is ${money(gap)} below the ${money(facts.safetyFloor)} safety floor.`,
        "Start with a small fixed amount each payday, then increase it when your cash flow allows.",
      ],
      actionLabel: "Plan my buffer",
      route: "/(tabs)/monthly",
      urgent: false,
    });
  }
  if (
    typeof facts.monthlyIncome === "number" &&
    Number.isFinite(facts.monthlyIncome) &&
    facts.monthlyIncome > 0 &&
    typeof facts.monthlyBills === "number" &&
    Number.isFinite(facts.monthlyBills) &&
    facts.monthlyBills >= facts.monthlyIncome * 0.6
  ) {
    const committedPercent = Math.round((facts.monthlyBills / facts.monthlyIncome) * 100);
    tips.push({
      topic: "paycheck-commitments",
      title: "Lower what is committed before payday",
      details: [
        `About ${committedPercent}% of this month's recorded income is committed to bills.`,
        "Use a cash-flow budget to assign each paycheck before it arrives, then target one flexible expense to reduce.",
      ],
      actionLabel: "Open cash-flow plan",
      route: "/(tabs)/monthly",
      urgent: false,
    });
  }
  if (
    accountHealth &&
    Number.isInteger(accountHealth.pendingCount) &&
    accountHealth.pendingCount > 0
  ) {
    tips.push({
      topic: "account-pending-review",
      title: "Keep pending activity in view",
      details: [
        `Your prepared view includes ${accountHealth.pendingCount} pending checking transaction${accountHealth.pendingCount === 1 ? "" : "s"}.`,
        "Amounts or dates can change before posting. Review activity before recording a payment again.",
      ],
      actionLabel: "Review activity",
      route: "/(tabs)/transactions",
      urgent: false,
    });
  }
  if (accountHealth && ["low", "medium"].includes(accountHealth.confidence)) {
    tips.push({
      topic: "plan-input-review",
      title: "Strengthen the inputs behind your plan",
      details: [
        `The prepared forecast has ${accountHealth.confidence.toLowerCase()} input confidence.`,
        "Review account balances, income timing and bills before relying on future projections.",
      ],
      actionLabel: "Review plan settings",
      route: "/(tabs)/more",
      params: { section: "money" },
      urgent: false,
    });
  }
  const goal = facts.goals.find(
    (g) =>
      !g.closed_at &&
      !g.calendar_marker_only &&
      Number.isFinite(g.current_amount) &&
      g.current_amount > 0 &&
      Number.isFinite(g.target_amount) &&
      g.target_amount > g.current_amount,
  );
  if (goal)
    tips.push({
      topic: "goal-earmark",
      title: `Keep ${goal.name} in view`,
      details: [
        `${money(goal.current_amount)} is recorded toward a ${money(goal.target_amount)} goal.`,
        "Goal earmarks are not a separate available-cash balance. Review funding before adding more.",
      ],
      actionLabel: "Review goals",
      route: "/(tabs)/more",
      params: { section: "goals" },
      urgent: false,
    });
  const completeGoal = facts.goals.find(
    (g) =>
      !g.closed_at &&
      !g.calendar_marker_only &&
      Number.isFinite(g.current_amount) &&
      Number.isFinite(g.target_amount) &&
      g.target_amount > 0 &&
      g.current_amount >= g.target_amount,
  );
  if (completeGoal)
    tips.push({
      topic: "goal-progress",
      title: `${completeGoal.name} has reached its recorded target`,
      details: [
        `${money(completeGoal.current_amount)} is recorded against a ${money(completeGoal.target_amount)} target.`,
        "Confirm that the money is still set aside before marking the goal complete or using it.",
      ],
      actionLabel: "Review goal progress",
      route: "/(tabs)/more",
      params: { section: "goals" },
      urgent: false,
    });
  if (
    facts.payday &&
    facts.payday.date > facts.today &&
    Number.isFinite(facts.payday.income) &&
    facts.payday.income > 0
  )
    tips.push({
      topic: "payday",
      title: "Give your next paycheck a job",
      details: [
        `Your prepared forecast includes ${money(facts.payday.income)} of scheduled income on ${facts.payday.date}.`,
        "Expected income is not money received. Assign essentials first, protect a small buffer, then decide what can go to debt or spending.",
      ],
      actionLabel: "View payday in forecast",
      route: "/(tabs)/monthly",
      urgent: false,
    });
  const category =
    facts.categories?.find(
      (row) =>
        row.status === "over" &&
        Number.isFinite(row.spent) &&
        row.spent > 0 &&
        Number.isFinite(row.budgeted) &&
        row.budgeted > 0,
    ) ??
    facts.categories?.find(
      (row) =>
        Number.isFinite(row.spent) &&
        row.spent > 0 &&
        Number.isFinite(row.budgeted) &&
        row.budgeted > 0,
    );
  if (category)
    tips.push({
      topic: "category-spending",
      title: `${category.category} is a place to free up cash`,
      details: [
        `This month's plan shows ${money(category.spent)} spent against ${money(category.budgeted)} budgeted.`,
        "Review the underlying activity and choose one realistic reduction before the next payday.",
      ],
      actionLabel: "Review spending",
      route: "/(tabs)/transactions",
      urgent: false,
    });
  if (
    typeof facts.safetyFloor === "number" &&
    Number.isFinite(facts.safetyFloor) &&
    facts.safetyFloor > 0
  )
    tips.push({
      topic: "cushion-review",
      title: "Protect your cash cushion",
      details: [
        `Your prepared plan uses a ${money(facts.safetyFloor)} safety floor.`,
        "Treat it as do-not-spend money until your next paycheck clears; check actual balances before extra spending.",
      ],
      actionLabel: "Review cushion in forecast",
      route: "/(tabs)/monthly",
      urgent: false,
    });
  if (facts.decisions.some((d) => d.id === "snowball-target"))
    tips.push({
      topic: "debt-plan",
      title: "Protect minimums, then attack one debt",
      details: [
        "Keep every minimum payment covered, then direct extra money to your current payoff target.",
        "Check bills, actual balances, and your cushion before sending anything extra.",
      ],
      actionLabel: "Review debt plan",
      route: "/snowball-plan",
      urgent: false,
    });
  const urgent = tips.find((t) => t.urgent);
  if (urgent) return urgent;
  // Daily coaching is reserved for actions that improve the user's position;
  // routine bill reminders are intentionally never selected here.
  const pool = tips;
  // Rotate useful coaching; an undifferentiated review count wins only after
  // equally recent account/plan tips, rather than permanently starving them.
  const selected =
    pool.sort(
      (a, b) =>
        (history.find((h) => h.topic === a.topic)?.day ?? "").localeCompare(
          history.find((h) => h.topic === b.topic)?.day ?? "",
        ) || Number(a.topic === "review") - Number(b.topic === "review"),
    )[0] ?? null;
  if (selected && history.some((h) => h.topic === selected.topic)) {
    const repeatTitles: Record<string, string> = {
      payday: "Before payday, check what comes next",
      "cushion-review": "Does your cushion still fit your plan?",
      "debt-plan": "Review your next payoff step",
      "category-spending": `Take another look at ${category?.category ?? "your category plan"}`,
      "buffer-build": "What would close your buffer gap fastest?",
      "paycheck-commitments": "Find one expense to free up before payday",
    };
    if (repeatTitles[selected.topic])
      return { ...selected, title: repeatTitles[selected.topic] };
  }
  return selected;
}

export function dailySnapshotMatches(
  identity: { userId: string; householdId: string; budgetId: string | null },
  expected: { userId: string; householdId: string; budgetId: string | null },
  snapshotDay: string,
  today: string,
) {
  return (
    identity.userId === expected.userId &&
    identity.householdId === expected.householdId &&
    identity.budgetId === expected.budgetId &&
    snapshotDay === today
  );
}
