import { isAlgorithmEnabled, type AlgorithmSettingsShape } from "./algorithmCatalog";

export interface AlgorithmDailyBalance {
  day: number;
  income: number;
  bills: number;
  expense: number;
  net: number;
  balance: number;
}

export interface AlgorithmBill {
  id: string;
  name: string;
  amount: number;
  category: string;
  due_day: number;
  is_debt: boolean;
  is_recurring: boolean;
  balance?: number;
  interest_rate?: number;
  paidAmount?: number;
}

export interface AlgorithmTransaction {
  id: string;
  date: string;
  amount: number;
  category: string;
  note?: string;
}

export interface AlgorithmIncome {
  id: string;
  name: string;
  amount: number;
  frequency: "monthly" | "biweekly" | "weekly";
}

export interface AlgorithmGoal {
  id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  target_date: string;
  goal_type: "savings" | "planned_expense";
}

export interface AlgorithmCategoryRow {
  category: string;
  budgeted: number;
  spent: number;
  remaining: number;
  status: "available" | "watch" | "over";
}

export interface AlgorithmSuiteInput {
  month: number;
  year: number;
  todayDay: number;
  safetyFloor: number;
  cashFlow: {
    monthlyIncome: number;
    totalBillsDue: number;
    totalPaid: number;
    netTransactions: number;
    remaining: number;
    goalAllocations: number;
  };
  dailyBalances: AlgorithmDailyBalance[];
  bills: AlgorithmBill[];
  transactions: AlgorithmTransaction[];
  incomes: AlgorithmIncome[];
  goals: AlgorithmGoal[];
  categoryPlan?: AlgorithmCategoryRow[];
  forecastConfidence: { level: "high" | "medium" | "low"; label: string; reasons: string[] };
  settings: AlgorithmSettingsShape;
}

export interface AlgorithmInsight {
  id: string;
  title: string;
  detail: string;
  tone: "safe" | "watch" | "risk" | "info";
  algorithm: string;
}

export interface AlgorithmSuiteResult {
  activeCount: number;
  flowScore: { score: number; grade: string; label: string; factors: string[] };
  safeCushion: { amount: number; label: string };
  purchaseDecision: { safeNowLimit: number; action: "safe" | "wait" | "split" | "avoid"; detail: string };
  billPriority: { bills: { id: string; name: string; amount: number; dueDay: number; score: number; reason: string }[] };
  paydaySplit: { bills: number; spending: number; savings: number; debt: number; goals: number };
  debtPayoff: { nextDebtName: string | null; snowballBalance: number; avalancheName: string | null; detail: string };
  forecastConfidence: { score: number; label: string; reason: string };
  lowBalanceWarning: { status: "safe" | "watch" | "risk"; day: number | null; balance: number | null; message: string };
  subscriptionCreep: { count: number; items: string[] };
  goalAcceleration: { amount: number; goalName: string | null; detail: string };
  spendingPattern: { topCategory: string | null; spikeCount: number; detail: string };
  billShock: { count: number; items: string[] };
  cashFlowGap: { startDay: number | null; endDay: number | null; lowestBalance: number; detail: string };
  incomeStability: { score: number; label: string; detail: string };
  savingsSweep: { amount: number; detail: string };
  riskDay: { safe: number; watch: number; risk: number };
  smartReminder: { reminders: string[] };
  monthlyHealth: { score: number; grade: string; summary: string };
  spendingLimit: { daily: number; weekly: number; detail: string };
  planDelay: { day: number | null; detail: string };
  insights: AlgorithmInsight[];
}

export function buildAlgorithmSuite(input: AlgorithmSuiteInput): AlgorithmSuiteResult {
  const balances = input.dailyBalances.slice().sort((a, b) => a.day - b.day);
  const remainingBalances = balances.filter(day => day.day >= input.todayDay);
  const lowest = minBy(remainingBalances.length ? remainingBalances : balances, day => day.balance);
  const lowestBalance = lowest?.balance ?? 0;
  const lowestDay = lowest?.day ?? null;
  const safeCushionAmount = roundCurrency(Math.max(0, lowestBalance - input.safetyFloor));
  const paidBills = input.bills.filter(bill => (bill.paidAmount ?? 0) >= Math.max(0.01, bill.amount)).length;
  const billProgress = input.bills.length ? paidBills / input.bills.length : 1;
  const incomeStability = scoreIncomeStability(input.incomes);
  const confidenceScore = input.forecastConfidence.level === "high" ? 92 : input.forecastConfidence.level === "medium" ? 68 : 42;
  const debtTotal = input.bills.filter(bill => bill.is_debt).reduce((sum, bill) => sum + Math.max(0, bill.balance ?? bill.amount), 0);
  const debtPressure = input.cashFlow.monthlyIncome > 0 ? Math.min(25, (debtTotal / input.cashFlow.monthlyIncome) * 2) : debtTotal > 0 ? 18 : 0;
  const lowBalancePenalty = lowestBalance < 0 ? 35 : lowestBalance < input.safetyFloor ? 22 : safeCushionAmount < 100 ? 10 : 0;
  const flowScore = clamp(
    Math.round(42 + confidenceScore * 0.2 + billProgress * 18 + incomeStability.score * 0.14 + Math.min(16, safeCushionAmount / 60) - lowBalancePenalty - debtPressure),
    0,
    100,
  );
  const flowGrade = scoreGrade(flowScore);
  const lowBalanceWarning = buildLowBalanceWarning(lowestBalance, lowestDay, input.safetyFloor);
  const billPriority = prioritizeBills(input.bills, input.todayDay, input.safetyFloor, lowestDay);
  const topDebtSnowball = input.bills.filter(bill => bill.is_debt && (bill.balance ?? 0) > 0).sort((a, b) => (a.balance ?? 0) - (b.balance ?? 0))[0] ?? null;
  const topDebtAvalanche = input.bills.filter(bill => bill.is_debt && (bill.balance ?? 0) > 0).sort((a, b) => (b.interest_rate ?? 0) - (a.interest_rate ?? 0))[0] ?? null;
  const spendingLimits = {
    daily: roundCurrency(safeCushionAmount / Math.max(1, remainingBalances.length || 1)),
    weekly: roundCurrency((safeCushionAmount / Math.max(1, remainingBalances.length || 1)) * 7),
  };
  const planDelayDay = findPlanDelayDay(remainingBalances, input.safetyFloor);
  const subscriptionCreep = findSubscriptionCreep(input.bills);
  const billShock = findBillShock(input.bills, input.cashFlow.monthlyIncome);
  const spendingPattern = summarizeSpendingPattern(input.categoryPlan ?? [], input.transactions);
  const goalAcceleration = buildGoalAcceleration(input.goals, safeCushionAmount);
  const savingsSweepAmount = roundCurrency(safeCushionAmount > 250 ? Math.min(safeCushionAmount * 0.35, Math.max(25, input.cashFlow.remaining * 0.25)) : 0);
  const paydaySplit = buildPaydaySplit(input.cashFlow.monthlyIncome, input.cashFlow.totalBillsDue, input.cashFlow.goalAllocations, debtTotal, safeCushionAmount);
  const cashFlowGap = findCashFlowGap(balances, input.safetyFloor);
  const riskDayCounts = balances.reduce(
    (counts, day) => {
      if (day.balance < input.safetyFloor) counts.risk += 1;
      else if (day.balance < input.safetyFloor + 250) counts.watch += 1;
      else counts.safe += 1;
      return counts;
    },
    { safe: 0, watch: 0, risk: 0 },
  );
  const purchaseDecision = safeCushionAmount >= 250
    ? { safeNowLimit: safeCushionAmount, action: "safe" as const, detail: `Purchases up to $${safeCushionAmount.toFixed(0)} keep the safety floor intact.` }
    : safeCushionAmount >= 75
      ? { safeNowLimit: safeCushionAmount, action: "split" as const, detail: "Small purchases may work, but larger ones should be split or delayed." }
      : safeCushionAmount > 0
        ? { safeNowLimit: safeCushionAmount, action: "wait" as const, detail: "This month is tight. Wait for more cushion before adding new spending." }
        : { safeNowLimit: 0, action: "avoid" as const, detail: "New spending is unsafe until the forecast improves." };

  const reminders = buildSmartReminders(lowBalanceWarning, billPriority.bills, goalAcceleration.goalName);
  const insights = buildInsights(input, {
    flowScore,
    flowGrade,
    safeCushionAmount,
    lowBalanceWarning,
    billPriority,
    savingsSweepAmount,
    spendingLimits,
    subscriptionCreep,
    billShock,
  });

  return {
    activeCount: [
      "flowScore", "safeCushion", "purchaseDecision", "billPriority", "paydaySplit",
      "debtPayoff", "forecastConfidence", "lowBalanceWarning", "subscriptionCreep", "goalAcceleration",
      "spendingPattern", "billShock", "cashFlowGap", "incomeStability", "savingsSweep",
      "riskDay", "smartReminder", "monthlyHealth", "spendingLimit", "planDelay",
    ].filter(id => isAlgorithmEnabled(input.settings, id as any)).length,
    flowScore: {
      score: isAlgorithmEnabled(input.settings, "flowScore") ? flowScore : 0,
      grade: flowGrade,
      label: flowScore >= 80 ? "Strong flow" : flowScore >= 65 ? "Stable but watchful" : flowScore >= 45 ? "Tight month" : "Needs attention",
      factors: [
        `Forecast confidence: ${input.forecastConfidence.label}`,
        `Lowest balance: $${lowestBalance.toFixed(0)}${lowestDay ? ` on day ${lowestDay}` : ""}`,
        `${paidBills}/${input.bills.length || 0} bills cleared`,
      ],
    },
    safeCushion: { amount: isAlgorithmEnabled(input.settings, "safeCushion") ? safeCushionAmount : 0, label: safeCushionAmount > 0 ? "safe after floor" : "no extra cushion" },
    purchaseDecision,
    billPriority,
    paydaySplit,
    debtPayoff: {
      nextDebtName: topDebtSnowball?.name ?? null,
      snowballBalance: roundCurrency(topDebtSnowball?.balance ?? 0),
      avalancheName: topDebtAvalanche?.name ?? null,
      detail: topDebtSnowball
        ? `Snowball targets ${topDebtSnowball.name}; avalanche targets ${topDebtAvalanche?.name ?? topDebtSnowball.name}.`
        : "No active debt payoff target found.",
    },
    forecastConfidence: { score: confidenceScore, label: input.forecastConfidence.label, reason: input.forecastConfidence.reasons[0] ?? "Forecast inputs look current." },
    lowBalanceWarning,
    subscriptionCreep,
    goalAcceleration,
    spendingPattern,
    billShock,
    cashFlowGap,
    incomeStability,
    savingsSweep: { amount: savingsSweepAmount, detail: savingsSweepAmount > 0 ? `Move up to $${savingsSweepAmount.toFixed(0)} safely without crossing the floor.` : "No safe leftover sweep is available yet." },
    riskDay: riskDayCounts,
    smartReminder: { reminders },
    monthlyHealth: { score: flowScore, grade: flowGrade, summary: `${flowGrade} month based on cushion, bills, income stability, and risk days.` },
    spendingLimit: { ...spendingLimits, detail: `About $${spendingLimits.daily.toFixed(0)}/day or $${spendingLimits.weekly.toFixed(0)}/week is safe from the current cushion.` },
    planDelay: { day: planDelayDay, detail: planDelayDay ? `The next safer purchase window appears around day ${planDelayDay}.` : "No safer date appears inside this month yet." },
    insights: insights.filter(insight => isAlgorithmEnabled(input.settings, insight.id as any) || insight.id === "flowScore").slice(0, 4),
  };
}

function prioritizeBills(bills: AlgorithmBill[], todayDay: number, safetyFloor: number, lowestDay: number | null) {
  return {
    bills: bills
      .filter(bill => Math.max(0, bill.amount - (bill.paidAmount ?? 0)) > 0.005)
      .map(bill => {
        const daysUntilDue = Math.max(0, bill.due_day - todayDay);
        const unpaid = Math.max(0, bill.amount - (bill.paidAmount ?? 0));
        const urgency = daysUntilDue <= 0 ? 45 : daysUntilDue <= 3 ? 34 : daysUntilDue <= 7 ? 22 : 8;
        const size = Math.min(28, unpaid / 45);
        const risk = lowestDay && bill.due_day <= lowestDay ? 18 : 0;
        const debt = bill.is_debt ? 8 : 0;
        const score = Math.round(urgency + size + risk + debt);
        const reason = daysUntilDue <= 0
          ? "due now"
          : daysUntilDue <= 7
            ? `due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}`
            : unpaid > safetyFloor
              ? "large impact"
              : "planned";
        return { id: bill.id, name: bill.name, amount: unpaid, dueDay: bill.due_day, score, reason };
      })
      .sort((a, b) => b.score - a.score || a.dueDay - b.dueDay)
      .slice(0, 5),
  };
}

function buildLowBalanceWarning(lowestBalance: number, lowestDay: number | null, safetyFloor: number): AlgorithmSuiteResult["lowBalanceWarning"] {
  if (lowestBalance < 0) {
    return { status: "risk", day: lowestDay, balance: lowestBalance, message: `Projected negative balance on day ${lowestDay}.` };
  }
  if (lowestBalance < safetyFloor) {
    return { status: "risk", day: lowestDay, balance: lowestBalance, message: `Projected below your $${safetyFloor.toFixed(0)} floor on day ${lowestDay}.` };
  }
  if (lowestBalance < safetyFloor + 250) {
    return { status: "watch", day: lowestDay, balance: lowestBalance, message: `Lowest projected balance leaves less than $250 extra cushion.` };
  }
  return { status: "safe", day: lowestDay, balance: lowestBalance, message: "No low-balance risk detected in this month." };
}

function buildPaydaySplit(monthlyIncome: number, bills: number, goals: number, debtTotal: number, safeCushion: number) {
  const income = Math.max(0, monthlyIncome);
  if (income <= 0) return { bills: 0, spending: 0, savings: 0, debt: 0, goals: 0 };
  const billShare = Math.min(80, Math.round((bills / income) * 100));
  const goalsShare = Math.min(20, Math.round((goals / income) * 100));
  const debtShare = debtTotal > 0 ? Math.min(15, safeCushion > 200 ? 8 : 4) : 0;
  const savingsShare = safeCushion > 250 ? 10 : safeCushion > 75 ? 5 : 0;
  const spendingShare = Math.max(0, 100 - billShare - goalsShare - debtShare - savingsShare);
  return { bills: billShare, spending: spendingShare, savings: savingsShare, debt: debtShare, goals: goalsShare };
}

function scoreIncomeStability(incomes: AlgorithmIncome[]) {
  if (!incomes.length) return { score: 20, label: "Unknown", detail: "No recurring income is set up yet." };
  const weeklyCount = incomes.filter(income => income.frequency === "weekly").length;
  const biweeklyCount = incomes.filter(income => income.frequency === "biweekly").length;
  const monthlyCount = incomes.filter(income => income.frequency === "monthly").length;
  const score = clamp(55 + monthlyCount * 12 + biweeklyCount * 18 + weeklyCount * 14 - Math.max(0, incomes.length - 3) * 6, 0, 100);
  return {
    score,
    label: score >= 80 ? "Steady" : score >= 60 ? "Moderate" : "Variable",
    detail: score >= 80 ? "Income cadence looks consistent." : "Income is usable, but the forecast should be reviewed often.",
  };
}

function findSubscriptionCreep(bills: AlgorithmBill[]) {
  const recurring = bills.filter(bill => bill.is_recurring && !bill.is_debt);
  const byCategory = new Map<string, AlgorithmBill[]>();
  recurring.forEach(bill => {
    const key = (bill.category || "Other").toLowerCase();
    byCategory.set(key, [...(byCategory.get(key) ?? []), bill]);
  });
  const stacked = Array.from(byCategory.entries())
    .filter(([, items]) => items.length >= 3)
    .map(([category, items]) => `${capitalize(category)} has ${items.length} recurring bills`);
  const duplicateAmounts = recurring
    .filter((bill, index, all) => all.findIndex(other => Math.round(other.amount) === Math.round(bill.amount) && other.id !== bill.id) !== -1)
    .slice(0, 2)
    .map(bill => `${bill.name} matches another recurring amount`);
  const items = [...stacked, ...duplicateAmounts].slice(0, 3);
  return { count: items.length, items };
}

function findBillShock(bills: AlgorithmBill[], monthlyIncome: number) {
  const nonDebt = bills.filter(bill => !bill.is_debt && bill.amount > 0);
  const avg = nonDebt.length ? nonDebt.reduce((sum, bill) => sum + bill.amount, 0) / nonDebt.length : 0;
  const threshold = Math.max(avg * 1.75, monthlyIncome * 0.18, 250);
  const items = nonDebt.filter(bill => bill.amount >= threshold).sort((a, b) => b.amount - a.amount).slice(0, 3).map(bill => `${bill.name} is $${bill.amount.toFixed(0)}`);
  return { count: items.length, items };
}

function summarizeSpendingPattern(categoryPlan: AlgorithmCategoryRow[], transactions: AlgorithmTransaction[]) {
  const pressure = categoryPlan.filter(row => row.status !== "available");
  if (pressure.length) {
    const top = pressure.sort((a, b) => a.remaining - b.remaining)[0];
    return { topCategory: top.category, spikeCount: pressure.length, detail: `${top.category} needs attention with $${Math.abs(top.remaining).toFixed(0)} ${top.remaining < 0 ? "over plan" : "left"}.` };
  }
  const spendByCategory = new Map<string, number>();
  transactions.filter(tx => tx.amount < 0).forEach(tx => {
    const category = tx.category || "Other";
    spendByCategory.set(category, (spendByCategory.get(category) ?? 0) + Math.abs(tx.amount));
  });
  const top = Array.from(spendByCategory.entries()).sort((a, b) => b[1] - a[1])[0] ?? null;
  return { topCategory: top?.[0] ?? null, spikeCount: 0, detail: top ? `${top[0]} is the largest spending area this month.` : "No spending pattern detected yet." };
}

function buildGoalAcceleration(goals: AlgorithmGoal[], safeCushion: number) {
  const openSavings = goals
    .filter(goal => goal.goal_type === "savings" && goal.target_amount > goal.current_amount)
    .sort((a, b) => (a.target_amount - a.current_amount) - (b.target_amount - b.current_amount));
  const goal = openSavings[0] ?? null;
  const amount = goal ? roundCurrency(Math.min(Math.max(0, safeCushion * 0.25), goal.target_amount - goal.current_amount)) : 0;
  return {
    amount,
    goalName: goal?.name ?? null,
    detail: goal && amount > 0 ? `$${amount.toFixed(0)} extra would speed up ${goal.name}.` : "No safe goal acceleration available yet.",
  };
}

function findCashFlowGap(balances: AlgorithmDailyBalance[], safetyFloor: number) {
  const sorted = balances.slice().sort((a, b) => a.day - b.day);
  const lowest = minBy(sorted, day => day.balance);
  let startDay: number | null = null;
  let endDay: number | null = null;
  let currentStart: number | null = null;
  let bestLength = 0;
  sorted.forEach(day => {
    if (day.balance < safetyFloor + 200) {
      if (currentStart === null) currentStart = day.day;
      const length = day.day - currentStart + 1;
      if (length >= bestLength) {
        bestLength = length;
        startDay = currentStart;
        endDay = day.day;
      }
    } else {
      currentStart = null;
    }
  });
  return {
    startDay,
    endDay,
    lowestBalance: lowest?.balance ?? 0,
    detail: startDay ? `Tightest stretch runs day ${startDay} through ${endDay}.` : "No tight cash-flow stretch detected.",
  };
}

function findPlanDelayDay(balances: AlgorithmDailyBalance[], safetyFloor: number) {
  const day = balances.find(item => item.balance >= safetyFloor + 300);
  return day?.day ?? null;
}

function buildSmartReminders(lowBalance: AlgorithmSuiteResult["lowBalanceWarning"], bills: AlgorithmSuiteResult["billPriority"]["bills"], goalName: string | null) {
  const reminders: string[] = [];
  if (lowBalance.status !== "safe" && lowBalance.day) reminders.push(`Review low balance risk before day ${lowBalance.day}.`);
  bills.slice(0, 2).forEach(bill => reminders.push(`Confirm ${bill.name} before day ${bill.dueDay}.`));
  if (goalName) reminders.push(`Check if extra savings can go to ${goalName}.`);
  return reminders.slice(0, 4);
}

function buildInsights(
  input: AlgorithmSuiteInput,
  facts: {
    flowScore: number;
    flowGrade: string;
    safeCushionAmount: number;
    lowBalanceWarning: AlgorithmSuiteResult["lowBalanceWarning"];
    billPriority: AlgorithmSuiteResult["billPriority"];
    savingsSweepAmount: number;
    spendingLimits: { daily: number; weekly: number };
    subscriptionCreep: { count: number; items: string[] };
    billShock: { count: number; items: string[] };
  },
): AlgorithmInsight[] {
  const insights: AlgorithmInsight[] = [
    {
      id: "flowScore",
      algorithm: "Flow Score",
      title: `Flow Score ${facts.flowScore}`,
      detail: `${facts.flowGrade} month. ${input.forecastConfidence.label} forecast confidence.`,
      tone: facts.flowScore >= 75 ? "safe" : facts.flowScore >= 55 ? "watch" : "risk",
    },
    {
      id: "safeCushion",
      algorithm: "Safe Cushion",
      title: `$${facts.safeCushionAmount.toFixed(0)} safe cushion`,
      detail: facts.safeCushionAmount > 0 ? "This is the current extra room above your floor." : "No safe cushion is available yet.",
      tone: facts.safeCushionAmount > 250 ? "safe" : facts.safeCushionAmount > 0 ? "watch" : "risk",
    },
  ];
  if (facts.lowBalanceWarning.status !== "safe") {
    insights.push({
      id: "lowBalanceWarning",
      algorithm: "Low Balance Warning",
      title: "Low balance risk",
      detail: facts.lowBalanceWarning.message,
      tone: facts.lowBalanceWarning.status === "risk" ? "risk" : "watch",
    });
  }
  const priority = facts.billPriority.bills[0];
  if (priority) {
    insights.push({
      id: "billPriority",
      algorithm: "Bill Priority",
      title: `${priority.name} is priority #1`,
      detail: `$${priority.amount.toFixed(0)} ${priority.reason}.`,
      tone: priority.score >= 65 ? "risk" : priority.score >= 40 ? "watch" : "info",
    });
  }
  if (facts.savingsSweepAmount > 0) {
    insights.push({
      id: "savingsSweep",
      algorithm: "Savings Sweep",
      title: `$${facts.savingsSweepAmount.toFixed(0)} could move to savings`,
      detail: "The sweep keeps your projected balance above the safety floor.",
      tone: "safe",
    });
  }
  if (facts.spendingLimits.daily > 0) {
    insights.push({
      id: "spendingLimit",
      algorithm: "Spending Limit",
      title: `$${facts.spendingLimits.daily.toFixed(0)}/day safe spending`,
      detail: `Weekly safe limit is about $${facts.spendingLimits.weekly.toFixed(0)}.`,
      tone: "info",
    });
  }
  if (facts.subscriptionCreep.count) {
    insights.push({
      id: "subscriptionCreep",
      algorithm: "Subscription Creep",
      title: "Recurring stack detected",
      detail: facts.subscriptionCreep.items[0],
      tone: "watch",
    });
  }
  if (facts.billShock.count) {
    insights.push({
      id: "billShock",
      algorithm: "Bill Shock",
      title: "Bill shock watch",
      detail: facts.billShock.items[0],
      tone: "watch",
    });
  }
  return insights;
}

function scoreGrade(score: number) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function minBy<T>(items: T[], selector: (item: T) => number): T | null {
  return items.reduce<T | null>((best, item) => !best || selector(item) < selector(best) ? item : best, null);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function capitalize(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}
