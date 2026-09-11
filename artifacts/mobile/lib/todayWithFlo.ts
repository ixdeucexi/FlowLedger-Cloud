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
  safetyFloor?: number;
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
    facts.decisions.some(
      (d) => d.id === "breathing-room-opportunity" && d.tone === "risk",
    )
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
      urgent: true,
    });
  }
  const bill = facts.upcoming
    .filter((b) => Number.isFinite(b.amount) && b.amount > 0)
    .map((b) => ({
      ...b,
      date: `${b.year}-${String(b.month + 1).padStart(2, "0")}-${String(b.day).padStart(2, "0")}`,
    }))
    .filter((b) => b.date >= facts.today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (bill)
    tips.push({
      topic: bill.pending ? "pending-payment" : "upcoming-bill",
      title: bill.pending
        ? `Check ${bill.name} before paying again`
        : `Keep ${bill.name} on your radar`,
      details: [
        `${money(bill.amount)} is scheduled for ${bill.date}.`,
        bill.pending
          ? "A payment is pending. Review its status before paying again."
          : "Check payment status and your account balance before paying.",
      ],
      actionLabel: "Review bills",
      route: "/(tabs)/bills",
      urgent:
        Date.parse(`${bill.date}T00:00:00Z`) -
          Date.parse(`${facts.today}T00:00:00Z`) <=
        3 * 86400000,
    });
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
      title: "Give your next paycheck a plan",
      details: [
        `Your prepared forecast includes ${money(facts.payday.income)} of scheduled income on ${facts.payday.date}.`,
        "Expected income is not money received. Review bills around that date before assigning the rest.",
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
      title: `Check in on ${category.category}`,
      details: [
        `This month's plan shows ${money(category.spent)} spent against ${money(category.budgeted)} budgeted.`,
        "Review the underlying activity before changing your category plan.",
      ],
      actionLabel: "Review spending",
      route: "/(tabs)/transactions",
      urgent: category.status === "over",
    });
  if (
    typeof facts.safetyFloor === "number" &&
    Number.isFinite(facts.safetyFloor) &&
    facts.safetyFloor > 0
  )
    tips.push({
      topic: "cushion-review",
      title: "Keep your cushion intentional",
      details: [
        `Your prepared plan uses a ${money(facts.safetyFloor)} safety floor.`,
        "That is a planning setting—not proof the cash is available. Check actual balances and upcoming bills before extra spending.",
      ],
      actionLabel: "Review cushion in forecast",
      route: "/(tabs)/monthly",
      urgent: false,
    });
  if (facts.decisions.some((d) => d.id === "snowball-target"))
    tips.push({
      topic: "debt-plan",
      title: "Keep your next debt step intentional",
      details: [
        "Review your current payoff target and required payments together.",
        "Check bills, actual balances, and your cushion before sending extra money.",
      ],
      actionLabel: "Review debt plan",
      route: "/snowball-plan",
      urgent: false,
    });
  const urgent = tips.find((t) => t.urgent);
  if (urgent) return urgent;
  // Least recently shown eligible topic wins. No random filler or all-clear guarantees.
  const selected =
    tips.sort((a, b) =>
      (history.find((h) => h.topic === a.topic)?.day ?? "").localeCompare(
        history.find((h) => h.topic === b.topic)?.day ?? "",
      ),
    )[0] ?? null;
  if (selected && history.some((h) => h.topic === selected.topic)) {
    const repeatTitles: Record<string, string> = {
      payday: "Before payday, check what comes next",
      "cushion-review": "Does your cushion still fit your plan?",
      "debt-plan": "Review your next payoff step",
      "category-spending": `Take another look at ${category?.category ?? "your category plan"}`,
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
