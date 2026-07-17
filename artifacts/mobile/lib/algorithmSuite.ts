import { ALGORITHM_CATALOG, isAlgorithmEnabled, type AlgorithmId, type AlgorithmSettingsShape } from "./algorithmCatalog";
import { buildStabilityProgress, STABILITY_POLICY, type StabilityProgress } from "./stability";

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
  includeInSnowball?: boolean;
  category: string;
  due_day: number;
  is_debt: boolean;
  is_recurring: boolean;
  balance?: number;
  interest_rate?: number;
  paidAmount?: number;
  occurrenceDays?: number[];
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

export type AlgorithmStatus = "safe" | "watch" | "risk";

export interface AlgorithmSourceNumber {
  label: string;
  value: string;
  tone?: "safe" | "watch" | "risk" | "info";
}

export interface AlgorithmDecisionDetail {
  id: AlgorithmId;
  status: AlgorithmStatus;
  headline: string;
  whatIFound: string;
  whyItMatters: string;
  nextAction: string;
  floPrompt: string;
  sourceNumbers: AlgorithmSourceNumber[];
}

export interface AlgorithmSuiteResult {
  activeCount: number;
  algorithmDetails: Record<AlgorithmId, AlgorithmDecisionDetail>;
  stability: StabilityProgress;
  flowScore: {
    score: number;
    grade: string;
    label: string;
    topReason: string;
    topAction: string;
    positiveFactors: string[];
    negativeFactors: string[];
    breakdownItems: { label: string; value: string; tone: "safe" | "watch" | "risk" | "info" }[];
    confidence: "high" | "medium" | "low";
    factors: string[];
  };
  safeCushion: {
    amount: number;
    label: string;
    status: "safe" | "watch" | "risk";
    lowestBalance: number;
    lowestDay: number | null;
    safetyFloor: number;
    reservedAmount: number;
    reservedLabel: string;
    compactReason: string;
    calendarHint: string;
    topReason: string;
    topAction: string;
    breakdownItems: { label: string; value: string; tone: "safe" | "watch" | "risk" | "info" }[];
  };
  purchaseDecision: {
    safeNowLimit: number;
    action: "safe" | "wait" | "split" | "avoid";
    detail: string;
    nextMove: string;
    bestDay: number | null;
    confidence: "high" | "medium" | "low";
  };
  billPriority: {
    bills: { id: string; name: string; amount: number; dueDay: number; score: number; reason: string; urgency: "now" | "soon" | "planned" }[];
    nextBill: { id: string; name: string; amount: number; dueDay: number; score: number; reason: string; urgency: "now" | "soon" | "planned" } | null;
    summary: string;
    nextMove: string;
  };
  paydaySplit: {
    bills: number;
    spending: number;
    savings: number;
    debt: number;
    goals: number;
    dollars: { bills: number; spending: number; savings: number; debt: number; goals: number };
    summary: string;
    nextMove: string;
  };
  debtPayoff: {
    nextDebtName: string | null;
    snowballBalance: number;
    avalancheName: string | null;
    cashFlowReliefName: string | null;
    cashFlowReliefAmount: number;
    safeExtraAmount: number;
    rolloverAmount: number;
    nextDebtNameAfterTarget: string | null;
    totalMonthlyMinimum: number;
    nextMove: string;
    status: "ready" | "hold" | "done";
    detail: string;
    whyItMatters: string;
    sourceNumbers: AlgorithmSourceNumber[];
    comparison: { method: "snowball" | "avalanche" | "cashFlow"; targetName: string | null; reason: string }[];
  };
  forecastConfidence: { score: number; label: string; reason: string };
  lowBalanceWarning: { status: "safe" | "watch" | "risk"; day: number | null; balance: number | null; message: string };
  subscriptionCreep: { count: number; items: string[] };
  goalAcceleration: { amount: number; goalName: string | null; detail: string };
  spendingPattern: { topCategory: string | null; spikeCount: number; detail: string };
  billShock: { count: number; items: string[] };
  cashFlowGap: {
    startDay: number | null;
    endDay: number | null;
    lowestBalance: number;
    detail: string;
    causes: { label: string; amount: number; type: "bill" | "spending" | "debt" }[];
  };
  incomeStability: { score: number; label: string; detail: string };
  extraMoneyRouter: {
    amount: number;
    detail: string;
    recommendation: "debt" | "savings" | "bill" | "available";
    targetLabel: string;
    nextMove: string;
    options: { route: "debt" | "savings" | "bill" | "available"; label: string; amount: number; reason: string }[];
  };
  riskDay: { safe: number; watch: number; risk: number };
  smartReminder: { reminders: string[] };
  monthlyHealth: { score: number; grade: string; summary: string };
  spendingLimit: { daily: number; weekly: number; detail: string; status: "safe" | "watch" | "risk"; paceLabel: string; remainingDays: number };
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
  const billSchedule = input.bills.map(bill => ({ bill, ...buildBillScheduleStatus(bill, input.todayDay) }));
  const dueBills = billSchedule.filter(status => status.dueAmount > 0.005);
  const paidDueBills = dueBills.filter(status => (status.bill.paidAmount ?? 0) + 0.005 >= status.dueAmount).length;
  const overdueBills = billSchedule
    .filter(status => status.overdueAmount > 0.005)
    .sort((left, right) => (left.firstOverdueDay ?? 99) - (right.firstOverdueDay ?? 99) || right.overdueAmount - left.overdueAmount);
  const billReadiness = dueBills.length ? paidDueBills / dueBills.length : 1;
  const incomeStability = scoreIncomeStability(input.incomes, input.transactions);
  const confidenceScore = input.forecastConfidence.level === "high" ? 92 : input.forecastConfidence.level === "medium" ? 68 : 42;
  const debtTotal = input.bills.filter(bill => bill.is_debt).reduce((sum, bill) => sum + Math.max(0, bill.balance ?? bill.amount), 0);
  const monthlyNonDebtBills = input.bills
    .filter(bill => !bill.is_debt)
    .reduce((sum, bill) => sum + Math.max(0, bill.amount), 0);
  const monthlyDebtMinimums = input.bills
    .filter(bill => bill.is_debt && (bill.balance ?? bill.amount) > 0)
    .reduce((sum, bill) => sum + Math.max(0, bill.amount), 0);
  const debtPressure = input.cashFlow.monthlyIncome > 0
    ? Math.min(25, (monthlyDebtMinimums / input.cashFlow.monthlyIncome) * 75)
    : monthlyDebtMinimums > 0 ? 18 : 0;
  const categoryPressure = (input.categoryPlan ?? []).filter(row => row.status !== "available");
  const monthlyRequiredOutflow = estimateMonthlyRequiredOutflow(input);
  const stability = buildStabilityProgress({
    balances,
    todayDay: input.todayDay,
    safetyFloor: input.safetyFloor,
    monthlyRequiredOutflow,
    overdueBills: overdueBills.length,
    attentionBill: overdueBills[0]
      ? {
          name: overdueBills[0].bill.name,
          overdueAmount: overdueBills[0].overdueAmount,
          dueLabel: formatMonthDay(input, overdueBills[0].firstOverdueDay ?? overdueBills[0].bill.due_day),
        }
      : null,
    forecastConfidence: input.forecastConfidence.level,
  });
  const riskDayCounts = remainingBalances.reduce(
    (counts, day) => {
      if (day.balance < input.safetyFloor) counts.risk += 1;
      else if (day.balance < input.safetyFloor + STABILITY_POLICY.watchCushion) counts.watch += 1;
      else counts.safe += 1;
      return counts;
    },
    { safe: 0, watch: 0, risk: 0 },
  );
  const safetyPoints = riskDayCounts.risk === 0 ? 30 : 0;
  const billStandingPoints = overdueBills.length > 0
    ? Math.max(0, 20 - overdueBills.length * 10)
    : Math.round(billReadiness * 20);
  const reservePoints = stability.reserveTarget > 0 ? stability.reserveProgress * 20 : 0;
  const forecastCoveragePoints = remainingBalances.length
    ? Math.min(15, (stability.safeForecastDays / remainingBalances.length) * 15)
    : 0;
  const confidencePoints = input.forecastConfidence.level === "high" ? 10 : input.forecastConfidence.level === "medium" ? 6 : 2;
  const spendingPoints = categoryPressure.some(row => row.status === "over") ? 0 : categoryPressure.length ? 2 : 5;
  const flowScore = clamp(Math.round(
    safetyPoints + billStandingPoints + reservePoints + forecastCoveragePoints + confidencePoints + spendingPoints
  ), 0, 100);
  const flowGrade = scoreGrade(flowScore);
  const flowLabel = scoreLabel(flowScore);
  const lowBalanceWarning = buildLowBalanceWarning(lowestBalance, lowestDay, input.safetyFloor, input);
  const billPriority = prioritizeBills(input.bills, input.todayDay, input.safetyFloor, lowestDay, input);
  const activeDebts = input.bills.filter(bill => bill.is_debt && bill.includeInSnowball !== false && (bill.balance ?? 0) > 0.009);
  const topDebtSnowball = activeDebts.slice().sort((a, b) => (a.balance ?? 0) - (b.balance ?? 0) || a.name.localeCompare(b.name))[0] ?? null;
  const topDebtAvalanche = activeDebts.slice().sort((a, b) => (b.interest_rate ?? 0) - (a.interest_rate ?? 0) || (a.balance ?? 0) - (b.balance ?? 0) || a.name.localeCompare(b.name))[0] ?? null;
  const topDebtCashFlow = activeDebts.slice().sort((a, b) => {
    const aMinimum = Math.max(0.01, a.amount);
    const bMinimum = Math.max(0.01, b.amount);
    const aMonths = (a.balance ?? 0) / aMinimum;
    const bMonths = (b.balance ?? 0) / bMinimum;
    return aMonths - bMonths || bMinimum - aMinimum || (a.balance ?? 0) - (b.balance ?? 0) || a.name.localeCompare(b.name);
  })[0] ?? null;
  const remainingDays = Math.max(1, remainingBalances.length || 1);
  const monthlyFreeCash = roundCurrency(Math.max(0, input.cashFlow.remaining));
  const decisionRoom = roundCurrency(Math.min(safeCushionAmount, monthlyFreeCash));
  const spendingLimits = buildSpendingLimitDetails(decisionRoom, remainingDays);
  const planDelayDay = findPlanDelayDay(remainingBalances, input.safetyFloor);
  const subscriptionCreep = findSubscriptionCreep(input.bills);
  const billShock = findBillShock(input.bills, input.cashFlow.monthlyIncome);
  const spendingPattern = summarizeSpendingPattern(input.categoryPlan ?? [], input.transactions);
  const goalAcceleration = buildGoalAcceleration(input.goals, safeCushionAmount);
  const rawExtraMoneyAmount = decisionRoom > STABILITY_POLICY.extraMoneyRoomMinimum
    ? Math.min(decisionRoom * 0.35, monthlyFreeCash * 0.25)
    : 0;
  const extraMoneyAmount = roundCurrency(rawExtraMoneyAmount >= STABILITY_POLICY.extraMoneyMinimum ? rawExtraMoneyAmount : 0);
  const priorityBillNeedsProtection = Boolean(billPriority.nextBill && billPriority.nextBill.urgency === "now");
  const extraMoneyRecommendation = priorityBillNeedsProtection
      ? "bill" as const
      : debtTotal > 0
        ? "debt" as const
        : input.goals.some(goal => goal.goal_type === "savings" && goal.current_amount < goal.target_amount)
          ? "savings" as const
          : "available" as const;
  const paydaySplit = buildPaydaySplit(
    input.cashFlow.monthlyIncome,
    monthlyNonDebtBills,
    input.cashFlow.goalAllocations,
    monthlyDebtMinimums,
    debtTotal,
    stability,
  );
  const cashFlowGap = findCashFlowGap(remainingBalances, input.safetyFloor, input);
  const purchaseDecision = buildPurchaseDecisionDetails(decisionRoom, planDelayDay, input.forecastConfidence.level, monthlyFreeCash, safeCushionAmount, input);

  const reminders = buildSmartReminders(lowBalanceWarning, billPriority.bills, goalAcceleration.goalName, input);
  const safeCushionDetails = buildSafeCushionDetails(input, {
    safeCushionAmount,
    lowestBalance,
    lowestDay,
    lowBalanceWarning,
  });
  const flowScoreDetails = buildFlowScoreDetails(input, {
    flowScore,
    flowLabel,
    lowestBalance,
    lowestDay,
    safeCushionAmount,
    billReadiness,
    paidBills,
    dueBillsCount: dueBills.length,
    paidDueBills,
    overdueBillsCount: overdueBills.length,
    debtPressure,
    monthlyDebtMinimums,
    lowBalanceWarning,
    categoryPressure,
    confidenceScore,
    stability,
    riskDays: riskDayCounts.risk,
    remainingDays: remainingBalances.length,
  });
  const insights = buildInsights(input, {
    flowScore,
    flowGrade,
    flowLabel,
    safeCushionAmount,
    lowBalanceWarning,
    billPriority,
    extraMoneyAmount,
    extraMoneyRecommendation,
    spendingLimits,
    subscriptionCreep,
    billShock,
  });
  const debtPayoff = buildDebtPayoffDetails({
    debts: activeDebts,
    snowball: topDebtSnowball,
    avalanche: topDebtAvalanche,
    cashFlow: topDebtCashFlow,
    safeCushionAmount,
  });
  const extraMoneyRouter = buildExtraMoneyRouterDetails({
    amount: extraMoneyAmount,
    recommendation: extraMoneyRecommendation,
    debtTargetName: topDebtSnowball?.name ?? null,
    savingsTargetName: input.goals.find(goal => goal.goal_type === "savings" && goal.current_amount < goal.target_amount)?.name ?? null,
    priorityBillName: billPriority.nextBill?.name ?? null,
  });
  const algorithmDetails = buildAlgorithmDecisionDetails(input, {
    flowScore,
    flowLabel,
    flowScoreDetails,
    safeCushionAmount,
    safeCushionDetails,
    purchaseDecision,
    billPriority,
    paydaySplit,
    cashFlowGap,
    debtPayoff,
    spendingLimits,
    extraMoneyRouter,
    monthlyFreeCash,
    decisionRoom,
    monthlyDebtMinimums,
    debtTotal,
    lowestBalance,
    lowestDay,
    riskDayCounts,
  });

  return {
    activeCount: ALGORITHM_CATALOG.filter(algorithm => isAlgorithmEnabled(input.settings, algorithm.id)).length,
    algorithmDetails,
    stability,
    flowScore: {
      score: isAlgorithmEnabled(input.settings, "flowScore") ? flowScore : 0,
      grade: flowGrade,
      label: flowLabel,
      topReason: flowScoreDetails.topReason,
      topAction: flowScoreDetails.topAction,
      positiveFactors: flowScoreDetails.positiveFactors,
      negativeFactors: flowScoreDetails.negativeFactors,
      breakdownItems: flowScoreDetails.breakdownItems,
      confidence: input.forecastConfidence.level,
      factors: [
      `Forecast confidence: ${input.forecastConfidence.label}`,
      `Lowest balance: $${lowestBalance.toFixed(0)}${lowestDay ? ` on ${formatMonthDay(input, lowestDay)}` : ""}`,
      dueBills.length ? `${paidDueBills}/${dueBills.length} due bills cleared` : "No bills are due yet",
      ],
    },
    safeCushion: {
      ...safeCushionDetails,
      amount: isAlgorithmEnabled(input.settings, "safeCushion") ? safeCushionAmount : 0,
    },
    purchaseDecision,
    billPriority,
    paydaySplit,
    debtPayoff,
    forecastConfidence: { score: confidenceScore, label: input.forecastConfidence.label, reason: input.forecastConfidence.reasons[0] ?? "Forecast inputs look current." },
    lowBalanceWarning,
    subscriptionCreep,
    goalAcceleration,
    spendingPattern,
    billShock,
    cashFlowGap,
    incomeStability,
    extraMoneyRouter,
    riskDay: riskDayCounts,
    smartReminder: { reminders },
    monthlyHealth: { score: flowScore, grade: flowGrade, summary: `${flowLabel} plan based on cushion, bills, forecast confidence, and risk days.` },
    spendingLimit: spendingLimits,
    planDelay: { day: planDelayDay, detail: planDelayDay ? `The next safer purchase window appears around ${formatMonthDay(input, planDelayDay)}.` : "No safer date appears inside this month yet." },
    insights: insights.filter(insight => isAlgorithmEnabled(input.settings, insight.id as any) || insight.id === "flowScore").slice(0, 4),
  };
}

function prioritizeBills(bills: AlgorithmBill[], todayDay: number, safetyFloor: number, lowestDay: number | null, input: AlgorithmSuiteInput) {
  const ranked = bills
    .map(bill => ({ bill, status: buildBillScheduleStatus(bill, todayDay) }))
    .filter(({ status }) => status.remainingAmount > 0.005 && status.nextDueDay !== null)
    .map(({ bill, status }) => {
      const dueDay = status.nextDueDay ?? bill.due_day;
      const daysUntilDue = Math.max(0, dueDay - todayDay);
      const unpaid = status.remainingAmount;
      const urgencyScore = daysUntilDue <= 0 ? 45 : daysUntilDue <= 3 ? 34 : daysUntilDue <= 7 ? 22 : 8;
      const urgency: "now" | "soon" | "planned" = daysUntilDue <= 0 ? "now" : daysUntilDue <= 7 ? "soon" : "planned";
      const size = Math.min(28, unpaid / 45);
      const risk = lowestDay !== null && dueDay <= lowestDay ? 18 : 0;
      const debt = bill.is_debt ? 8 : 0;
      const score = Math.round(urgencyScore + size + risk + debt);
      const reason = daysUntilDue <= 0
        ? "due now"
        : daysUntilDue <= 7
          ? `due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}`
          : unpaid > safetyFloor
            ? "large impact"
            : "planned";
      return { id: bill.id, name: bill.name, amount: unpaid, dueDay, score, reason, urgency };
    })
    .sort((a, b) => b.score - a.score || a.dueDay - b.dueDay)
    .slice(0, 5);
  const nextBill = ranked[0] ?? null;
  const dueNow = ranked.filter(item => item.urgency === "now").length;
  const summary = nextBill
    ? dueNow > 0
      ? `${dueNow} bill${dueNow === 1 ? "" : "s"} need attention now.`
      : `${nextBill.name} is the next priority bill.`
    : "No unpaid bills need priority attention.";
  const nextMove = nextBill
    ? nextBill.urgency === "now"
      ? `Clear or confirm ${nextBill.name} first.`
      : `Keep ${nextBill.name} visible before ${formatMonthDay(input, nextBill.dueDay)}.`
    : "No bill action needed right now.";
  return { bills: ranked, nextBill, summary, nextMove };
}

interface BillScheduleStatus {
  dueAmount: number;
  overdueAmount: number;
  remainingAmount: number;
  nextDueDay: number | null;
  firstOverdueDay: number | null;
}

function buildBillScheduleStatus(bill: AlgorithmBill, todayDay: number): BillScheduleStatus {
  const configuredOccurrences = (bill.occurrenceDays ?? [])
    .filter(day => Number.isInteger(day) && day > 0)
    .sort((left, right) => left - right);
  const occurrences = Array.from(new Set(configuredOccurrences.length ? configuredOccurrences : [bill.due_day]));
  const totalAmount = Math.max(0, Number(bill.amount) || 0);
  const paidAmount = Math.max(0, Number(bill.paidAmount) || 0);
  const remainingAmount = roundCurrency(Math.max(0, totalAmount - paidAmount));
  if (occurrences.length === 0 || totalAmount <= 0.005) {
    return { dueAmount: 0, overdueAmount: 0, remainingAmount, nextDueDay: null, firstOverdueDay: null };
  }

  const occurrenceAmount = totalAmount / occurrences.length;
  const dueCount = occurrences.filter(day => day <= todayDay).length;
  const overdueCount = occurrences.filter(day => day < todayDay).length;
  const dueAmount = roundCurrency(occurrenceAmount * dueCount);
  const overdueAmount = roundCurrency(Math.max(0, occurrenceAmount * overdueCount - paidAmount));
  const firstUnpaidIndex = occurrences.findIndex((_day, index) => paidAmount + 0.005 < occurrenceAmount * (index + 1));
  const firstOverdueIndex = occurrences.findIndex((day, index) => day < todayDay && paidAmount + 0.005 < occurrenceAmount * (index + 1));

  return {
    dueAmount,
    overdueAmount,
    remainingAmount,
    nextDueDay: firstUnpaidIndex >= 0 ? occurrences[firstUnpaidIndex] : null,
    firstOverdueDay: firstOverdueIndex >= 0 ? occurrences[firstOverdueIndex] : null,
  };
}

function buildLowBalanceWarning(lowestBalance: number, lowestDay: number | null, safetyFloor: number, input: AlgorithmSuiteInput): AlgorithmSuiteResult["lowBalanceWarning"] {
  const dateLabel = lowestDay ? formatMonthDay(input, lowestDay) : "the low point";
  if (lowestBalance < 0) {
    return { status: "risk", day: lowestDay, balance: lowestBalance, message: `Projected negative balance on ${dateLabel}.` };
  }
  if (lowestBalance < safetyFloor) {
    return { status: "risk", day: lowestDay, balance: lowestBalance, message: `Projected below your $${safetyFloor.toFixed(0)} floor on ${dateLabel}.` };
  }
  if (lowestBalance < safetyFloor + STABILITY_POLICY.watchCushion) {
    return { status: "watch", day: lowestDay, balance: lowestBalance, message: `Lowest projected balance leaves less than $${STABILITY_POLICY.watchCushion} of breathing room.` };
  }
  return { status: "safe", day: lowestDay, balance: lowestBalance, message: "No low-balance risk detected in this month." };
}

function buildPaydaySplit(
  monthlyIncome: number,
  bills: number,
  goals: number,
  monthlyDebtMinimums: number,
  debtTotal: number,
  stability: StabilityProgress,
) {
  const income = Math.max(0, monthlyIncome);
  if (income <= 0) {
    return {
      bills: 0,
      spending: 0,
      savings: 0,
      debt: 0,
      goals: 0,
      dollars: { bills: 0, spending: 0, savings: 0, debt: 0, goals: 0 },
      summary: "Add income so I can show where each paycheck should go.",
      nextMove: "Add your next paycheck date and amount first.",
    };
  }
  let unassignedShare = 100;
  const billShare = Math.min(unassignedShare, 85, Math.round((bills / income) * 100));
  unassignedShare -= billShare;
  const minimumDebtShare = debtTotal > 0 ? Math.min(unassignedShare, 35, Math.round((monthlyDebtMinimums / income) * 100)) : 0;
  unassignedShare -= minimumDebtShare;
  const goalsShare = Math.min(unassignedShare, 20, Math.round((goals / income) * 100));
  unassignedShare -= goalsShare;
  const reserveShareTarget = stability.protectedDays < STABILITY_POLICY.reserveGoalDays ? 10 : 5;
  const savingsShare = Math.min(unassignedShare, reserveShareTarget);
  unassignedShare -= savingsShare;
  const extraDebtShareTarget = debtTotal > 0
    ? stability.protectedDays >= STABILITY_POLICY.reserveGoalDays ? 8 : stability.protectedDays >= 14 ? 4 : 0
    : 0;
  const extraDebtShare = Math.min(unassignedShare, extraDebtShareTarget);
  unassignedShare -= extraDebtShare;
  const debtShare = minimumDebtShare + extraDebtShare;
  const spendingShare = unassignedShare;
  const billDollars = roundCurrency(Math.min(income, Math.max(0, bills)));
  const debtDollars = roundCurrency(Math.min(Math.max(0, income - billDollars), Math.max(monthlyDebtMinimums, income * debtShare / 100)));
  const goalDollars = roundCurrency(Math.min(Math.max(0, income - billDollars - debtDollars), Math.max(0, goals)));
  const savingsDollars = roundCurrency(Math.min(Math.max(0, income - billDollars - debtDollars - goalDollars), income * savingsShare / 100));
  const dollars = {
    bills: billDollars,
    spending: roundCurrency(Math.max(0, income - billDollars - debtDollars - goalDollars - savingsDollars)),
    savings: savingsDollars,
    debt: debtDollars,
    goals: goalDollars,
  };
  const summary = `Protect ${billShare}% for bills, ${debtShare}% for debt, ${savingsShare}% for your stability reserve, ${goalsShare}% for goals, and leave ${spendingShare}% for spending.`;
  const nextMove = billShare >= 60
    ? "Cover bills first. Spend only after those are protected."
    : stability.protectedDays < 7
      ? "Build enough breathing room to reach the next paycheck safely."
      : debtTotal > 0
        ? "After bills are safe, send extra money to the next debt."
        : "After bills are safe, send extra money to savings or goals.";
  return { bills: billShare, spending: spendingShare, savings: savingsShare, debt: debtShare, goals: goalsShare, dollars, summary, nextMove };
}

function buildPurchaseDecisionDetails(
  decisionRoom: number,
  planDelayDay: number | null,
  confidence: AlgorithmSuiteResult["purchaseDecision"]["confidence"],
  monthlyFreeCash: number,
  safeCushionAmount: number,
  input: AlgorithmSuiteInput,
): AlgorithmSuiteResult["purchaseDecision"] {
  if (monthlyFreeCash <= 0) {
    return {
      safeNowLimit: 0,
      action: "avoid",
      confidence,
      bestDay: planDelayDay,
      detail: "Your plan already uses this month’s money. The balance may look okay, but that money already has a job.",
      nextMove: "Wait, lower another planned expense, or ask Flo what is squeezing the month.",
    };
  }
  if (decisionRoom >= STABILITY_POLICY.purchaseSafeMinimum) {
    return {
      safeNowLimit: decisionRoom,
      action: "safe",
      confidence,
      bestDay: planDelayDay,
      detail: `Up to $${decisionRoom.toFixed(0)} fits right now. That is the smaller of this month's free cash and your protected breathing room.`,
      nextMove: "Check the exact amount and date before you commit.",
    };
  }
  if (decisionRoom >= STABILITY_POLICY.purchaseSplitMinimum) {
    return {
      safeNowLimit: decisionRoom,
      action: "split",
      confidence,
      bestDay: planDelayDay,
      detail: `A small purchase may work, but I would keep it at $${decisionRoom.toFixed(0)} or less so your cushion stays protected.`,
      nextMove: planDelayDay ? `Try it after ${formatMonthDay(input, planDelayDay)}, or split it into smaller pieces.` : "Split it smaller or wait for more breathing room.",
    };
  }
  if (decisionRoom > 0) {
    return {
      safeNowLimit: decisionRoom,
      action: "wait",
      confidence,
      bestDay: planDelayDay,
      detail: `This month is tight. I only see about $${decisionRoom.toFixed(0)} that is not already needed by the plan.`,
      nextMove: planDelayDay ? `Check again around ${formatMonthDay(input, planDelayDay)}.` : "Hold the purchase until the forecast improves.",
    };
  }
  return {
    safeNowLimit: 0,
    action: "avoid",
    confidence,
    bestDay: planDelayDay,
    detail: safeCushionAmount <= 0 ? "I would not add new spending until the forecast improves." : "You have some cushion, but this month’s money is already spoken for.",
    nextMove: "Protect the safety floor first.",
  };
}

function buildSpendingLimitDetails(safeCushionAmount: number, remainingDays: number): AlgorithmSuiteResult["spendingLimit"] {
  const daily = roundCurrency(safeCushionAmount / remainingDays);
  const weekly = roundCurrency(daily * 7);
  const status: AlgorithmSuiteResult["spendingLimit"]["status"] = safeCushionAmount <= 0 ? "risk" : daily < STABILITY_POLICY.spendingWatchPerDay ? "watch" : "safe";
  const paceLabel = status === "safe" ? "safe pace" : status === "watch" ? "tight pace" : "pause spending";
  const detail = status === "risk"
    ? "I would pause extra spending until the cushion improves."
    : `To stay safe, keep extra spending near $${daily.toFixed(0)}/day or $${weekly.toFixed(0)}/week.`;
  return { daily, weekly, status, paceLabel, remainingDays, detail };
}

function buildExtraMoneyRouterDetails(args: {
  amount: number;
  recommendation: AlgorithmSuiteResult["extraMoneyRouter"]["recommendation"];
  debtTargetName: string | null;
  savingsTargetName: string | null;
  priorityBillName: string | null;
}): AlgorithmSuiteResult["extraMoneyRouter"] {
  const amount = roundCurrency(Math.max(0, args.amount));
  const targetLabel = args.recommendation === "debt"
    ? args.debtTargetName ?? "next debt"
    : args.recommendation === "bill"
      ? args.priorityBillName ?? "upcoming bills"
      : args.recommendation === "savings"
        ? args.savingsTargetName ?? "savings"
        : "available cash";
  const detail = amount > 0
    ? args.recommendation === "debt"
      ? `I can safely send up to $${amount.toFixed(0)} to ${targetLabel} without breaking your floor.`
      : args.recommendation === "bill"
        ? `I can safely hold up to $${amount.toFixed(0)} for ${targetLabel} before extra spending.`
        : args.recommendation === "savings"
          ? `I can safely move up to $${amount.toFixed(0)} toward ${targetLabel} after the plan is protected.`
          : `I would keep up to $${amount.toFixed(0)} available without crossing your floor.`
    : args.recommendation === "bill"
      ? `I do not see safe leftover money yet. I’m holding cash for ${targetLabel} because it is a required bill.`
      : "I do not see safe leftover money yet.";
  const nextMove = amount > 0
    ? args.recommendation === "debt"
      ? `Preview adding $${amount.toFixed(0)} to ${targetLabel}.`
      : args.recommendation === "bill"
        ? `Hold it for ${targetLabel} before spending it.`
        : args.recommendation === "savings"
          ? `Preview moving $${amount.toFixed(0)} toward ${targetLabel}.`
          : "Keep it available until the tightest forecast day passes."
    : args.recommendation === "bill"
      ? `Keep extra cash available for ${targetLabel} until I see safe room.`
      : "Keep extra cash available until I see safe room.";
  const options = amount > 0 ? [
    { route: "debt" as const, label: args.debtTargetName ? `Debt: ${args.debtTargetName}` : "Debt payoff", amount, reason: "Fastest path away from paycheck-to-paycheck when debt is active." },
    { route: "savings" as const, label: args.savingsTargetName ? `Savings: ${args.savingsTargetName}` : "Savings cushion", amount, reason: "Builds protection before investing or larger plans." },
    { route: "bill" as const, label: args.priorityBillName ? `Bill: ${args.priorityBillName}` : "Upcoming bills", amount, reason: "Prevents bill timing from squeezing the next paycheck." },
    { route: "available" as const, label: "Keep available", amount, reason: "Best when the forecast is close to the safety floor." },
  ] : [];
  return { amount, recommendation: args.recommendation, targetLabel, detail, nextMove, options };
}

function buildDebtPayoffDetails(targets: {
  debts: AlgorithmBill[];
  snowball: AlgorithmBill | null;
  avalanche: AlgorithmBill | null;
  cashFlow: AlgorithmBill | null;
  safeCushionAmount: number;
}): AlgorithmSuiteResult["debtPayoff"] {
  const orderedDebts = targets.debts
    .slice()
    .filter(debt => (debt.balance ?? 0) > 0.009)
    .sort((a, b) => (a.balance ?? 0) - (b.balance ?? 0) || a.name.localeCompare(b.name));
  const totalMonthlyMinimum = roundCurrency(orderedDebts.reduce((sum, debt) => sum + Math.max(0, debt.amount), 0));

  if (!targets.snowball) {
    return {
      nextDebtName: null,
      snowballBalance: 0,
      avalancheName: null,
      cashFlowReliefName: null,
      cashFlowReliefAmount: 0,
      safeExtraAmount: 0,
      rolloverAmount: 0,
      nextDebtNameAfterTarget: null,
      totalMonthlyMinimum,
      status: "done",
      nextMove: "No active debt is left to attack.",
      detail: "No active debt is left to attack.",
      whyItMatters: "Once active debts are gone, I stop pushing payoff moves and help send money toward savings and goals.",
      sourceNumbers: [
        { label: "Active debts", value: "0", tone: "safe" },
        { label: "Minimums", value: `$${totalMonthlyMinimum.toFixed(0)}/mo`, tone: "safe" },
      ],
      comparison: [
        { method: "snowball", targetName: null, reason: "No active debt balance found." },
        { method: "avalanche", targetName: null, reason: "No active debt balance found." },
        { method: "cashFlow", targetName: null, reason: "No active debt balance found." },
      ],
    };
  }

  const cashFlowReliefAmount = roundCurrency(targets.cashFlow?.amount ?? 0);
  const snowballMinimum = roundCurrency(Math.max(0, targets.snowball.amount));
  const nextDebtNameAfterTarget = orderedDebts.find(debt => debt.id !== targets.snowball?.id)?.name ?? null;
  const safeExtraAmount = roundCurrency(Math.max(0, targets.safeCushionAmount));
  const status: AlgorithmSuiteResult["debtPayoff"]["status"] = targets.safeCushionAmount > 0 ? "ready" : "hold";
  const nextMove = status === "ready"
    ? `Attack ${targets.snowball.name} first with any safe extra money.`
    : `Hold extra debt payments until your cushion is safe, then attack ${targets.snowball.name}.`;
  const detail = `I’d attack ${targets.snowball.name} first because it has the smallest balance. Avalanche would chase ${targets.avalanche?.name ?? targets.snowball.name} for interest, and cash-flow relief would close ${targets.cashFlow?.name ?? targets.snowball.name} to free monthly room.`;
  const whyItMatters = nextDebtNameAfterTarget
    ? `When ${targets.snowball.name} is paid off, its $${snowballMinimum.toFixed(0)}/mo minimum rolls into ${nextDebtNameAfterTarget} instead of disappearing.`
    : `When ${targets.snowball.name} is paid off, its $${snowballMinimum.toFixed(0)}/mo minimum becomes cash-flow room for the next goal.`;

  return {
    nextDebtName: targets.snowball.name,
    snowballBalance: roundCurrency(targets.snowball.balance ?? 0),
    avalancheName: targets.avalanche?.name ?? targets.snowball.name,
    cashFlowReliefName: targets.cashFlow?.name ?? targets.snowball.name,
    cashFlowReliefAmount,
    safeExtraAmount,
    rolloverAmount: snowballMinimum,
    nextDebtNameAfterTarget,
    totalMonthlyMinimum,
    status,
    nextMove,
    detail,
    whyItMatters,
    sourceNumbers: [
      { label: "Current target", value: targets.snowball.name, tone: "info" },
      { label: "Target balance", value: `$${(targets.snowball.balance ?? 0).toFixed(0)}`, tone: "watch" },
      { label: "Safe extra", value: `$${safeExtraAmount.toFixed(0)}`, tone: safeExtraAmount > 0 ? "safe" : "watch" },
      { label: "Rolling minimum", value: `$${snowballMinimum.toFixed(0)}/mo`, tone: "safe" },
      { label: "Total minimums", value: `$${totalMonthlyMinimum.toFixed(0)}/mo`, tone: "info" },
    ],
    comparison: [
      {
        method: "snowball",
        targetName: targets.snowball.name,
        reason: `Smallest balance ($${(targets.snowball.balance ?? 0).toFixed(0)}) gives the fastest win.`,
      },
      {
        method: "avalanche",
        targetName: targets.avalanche?.name ?? targets.snowball.name,
        reason: `${(targets.avalanche?.interest_rate ?? targets.snowball.interest_rate ?? 0).toFixed(2)}% APR has the highest interest pressure.`,
      },
      {
        method: "cashFlow",
        targetName: targets.cashFlow?.name ?? targets.snowball.name,
        reason: `Closing it frees about $${cashFlowReliefAmount.toFixed(0)}/month the fastest.`,
      },
    ],
  };
}

function buildAlgorithmDecisionDetails(
  input: AlgorithmSuiteInput,
  facts: {
    flowScore: number;
    flowLabel: string;
    flowScoreDetails: Pick<AlgorithmSuiteResult["flowScore"], "topReason" | "topAction" | "breakdownItems">;
    safeCushionAmount: number;
    safeCushionDetails: Omit<AlgorithmSuiteResult["safeCushion"], "amount">;
    purchaseDecision: AlgorithmSuiteResult["purchaseDecision"];
    billPriority: AlgorithmSuiteResult["billPriority"];
    paydaySplit: AlgorithmSuiteResult["paydaySplit"];
    cashFlowGap: AlgorithmSuiteResult["cashFlowGap"];
    debtPayoff: AlgorithmSuiteResult["debtPayoff"];
    spendingLimits: AlgorithmSuiteResult["spendingLimit"];
    extraMoneyRouter: AlgorithmSuiteResult["extraMoneyRouter"];
    monthlyFreeCash: number;
    decisionRoom: number;
    monthlyDebtMinimums: number;
    debtTotal: number;
    lowestBalance: number;
    lowestDay: number | null;
    riskDayCounts: AlgorithmSuiteResult["riskDay"];
  },
): Record<AlgorithmId, AlgorithmDecisionDetail> {
  const lowestDate = facts.lowestDay ? formatMonthDay(input, facts.lowestDay) : "this month";
  const flowStatus = statusFromScore(facts.flowScore);
  const bill = facts.billPriority.nextBill;
  const billStatus: AlgorithmStatus = bill?.urgency === "now" ? "risk" : bill?.urgency === "soon" ? "watch" : "safe";
  const purchaseStatus: AlgorithmStatus = facts.purchaseDecision.action === "safe" ? "safe" : facts.purchaseDecision.action === "avoid" ? "risk" : "watch";
  const paydayStatus: AlgorithmStatus = input.cashFlow.monthlyIncome <= 0 ? "risk" : facts.paydaySplit.spending <= 8 ? "watch" : "safe";
  const gapStatus: AlgorithmStatus = facts.lowestBalance < input.safetyFloor ? "risk" : facts.safeCushionAmount < 250 ? "watch" : "safe";
  const debtStatus: AlgorithmStatus = facts.debtPayoff.status === "done" ? "safe" : facts.debtPayoff.status === "hold" ? "watch" : "safe";
  const routerStatus: AlgorithmStatus = facts.extraMoneyRouter.amount > 0 ? "safe" : facts.safeCushionAmount <= 0 ? "risk" : "watch";
  const routerIsHoldingForBill = facts.extraMoneyRouter.amount <= 0 && facts.extraMoneyRouter.recommendation === "bill";
  const routerHeadline = facts.extraMoneyRouter.amount > 0
    ? `Next Dollar: ${facts.extraMoneyRouter.targetLabel}`
    : routerIsHoldingForBill
      ? "Next Dollar: Hold cash"
      : "Next Dollar: No extra route yet";
  const routerSourceNumbers: AlgorithmDecisionDetail["sourceNumbers"] = [
    { label: "Safe extra", value: money(facts.extraMoneyRouter.amount), tone: routerStatus },
    { label: "Best use", value: facts.extraMoneyRouter.amount > 0 ? capitalize(facts.extraMoneyRouter.recommendation) : "Hold cash", tone: "info" },
    ...(facts.extraMoneyRouter.amount > 0
      ? [{ label: "Target", value: facts.extraMoneyRouter.targetLabel, tone: "info" as const }]
      : routerIsHoldingForBill
        ? [{ label: "Protecting", value: facts.extraMoneyRouter.targetLabel, tone: "info" as const }]
        : []),
  ];

  return {
    flowScore: {
      id: "flowScore",
      status: flowStatus,
      headline: `${facts.flowScore} - ${facts.flowLabel}`,
      whatIFound: facts.flowScoreDetails.topReason,
      whyItMatters: "This is your money weather report. I check cushion, bills, debt, confidence, and risk days so you know what to fix first.",
      nextAction: facts.flowScoreDetails.topAction,
      floPrompt: `Why is my Flow Score ${facts.flowScore}?`,
      sourceNumbers: [
        { label: "Flow Score", value: `${facts.flowScore}`, tone: flowStatus },
        { label: "Breathing room", value: money(facts.safeCushionAmount), tone: facts.safeCushionDetails.status },
        { label: "Risk days", value: `${facts.riskDayCounts.risk}`, tone: facts.riskDayCounts.risk ? "risk" : "safe" },
        { label: "Forecast confidence", value: input.forecastConfidence.label, tone: input.forecastConfidence.level === "high" ? "safe" : input.forecastConfidence.level === "medium" ? "watch" : "risk" },
      ],
    },
    safeCushion: {
      id: "safeCushion",
      status: facts.safeCushionDetails.status,
      headline: `Breathing Room: ${money(facts.safeCushionAmount)}`,
      whatIFound: facts.safeCushionDetails.topReason,
      whyItMatters: "This is the money I’m protecting for you. If it is thin, I should not suggest spending, extra debt payments, or savings moves that break your floor.",
      nextAction: facts.safeCushionDetails.topAction,
      floPrompt: `Why is my breathing room ${money(facts.safeCushionAmount)}?`,
      sourceNumbers: [
        { label: "Lowest forecast", value: `${money(facts.lowestBalance)} on ${lowestDate}`, tone: facts.lowestBalance < input.safetyFloor ? "risk" : "info" },
        { label: "Safety floor", value: money(input.safetyFloor), tone: "info" },
        { label: "Protected room", value: money(facts.safeCushionAmount), tone: facts.safeCushionDetails.status },
        { label: "Reserved plan", value: money(facts.safeCushionDetails.reservedAmount), tone: "info" },
      ],
    },
    purchaseDecision: {
      id: "purchaseDecision",
      status: purchaseStatus,
      headline: `Purchase Decision: ${capitalize(facts.purchaseDecision.action)}`,
      whatIFound: facts.purchaseDecision.detail,
      whyItMatters: "This keeps a purchase from using money that already belongs to bills, debt, goals, or your safety floor.",
      nextAction: facts.purchaseDecision.nextMove,
      floPrompt: "Can I afford this purchase?",
      sourceNumbers: [
        { label: "Safe now", value: money(facts.purchaseDecision.safeNowLimit), tone: purchaseStatus },
        { label: "Monthly free cash", value: money(facts.monthlyFreeCash), tone: facts.monthlyFreeCash > 0 ? "safe" : "risk" },
        { label: "Breathing room", value: money(facts.safeCushionAmount), tone: facts.safeCushionDetails.status },
        { label: "Safer date", value: facts.purchaseDecision.bestDay ? formatMonthDay(input, facts.purchaseDecision.bestDay) : "Not found", tone: facts.purchaseDecision.bestDay ? "info" : "watch" },
      ],
    },
    billPriority: {
      id: "billPriority",
      status: billStatus,
      headline: bill ? `Bill Priority: ${bill.name}` : "Bill Priority: On track",
      whatIFound: facts.billPriority.summary,
      whyItMatters: "Bills are normal. I just show which one needs attention first so it does not surprise the forecast or hit before cash is ready.",
      nextAction: facts.billPriority.nextMove,
      floPrompt: bill ? `Why is ${bill.name} my priority bill?` : "What bills need attention?",
      sourceNumbers: [
        { label: "Priority bill", value: bill?.name ?? "None", tone: billStatus },
        { label: "Unpaid amount", value: bill ? money(bill.amount) : money(0), tone: billStatus },
        { label: "Due date", value: bill ? formatMonthDay(input, bill.dueDay) : "None", tone: "info" },
        { label: "Ranked bills", value: `${facts.billPriority.bills.length}`, tone: facts.billPriority.bills.length ? "watch" : "safe" },
      ],
    },
    paydaySplit: {
      id: "paydaySplit",
      status: paydayStatus,
      headline: "Paycheck Plan",
      whatIFound: facts.paydaySplit.summary,
      whyItMatters: "This gives every paycheck a job: bills first, debt and goals next, then only the spending your cushion can handle.",
      nextAction: facts.paydaySplit.nextMove,
      floPrompt: "How should I split my next paycheck?",
      sourceNumbers: [
        { label: "Bills", value: money(facts.paydaySplit.dollars.bills), tone: "info" },
        { label: "Debt", value: money(facts.paydaySplit.dollars.debt), tone: facts.paydaySplit.dollars.debt > 0 ? "watch" : "info" },
        { label: "Savings", value: money(facts.paydaySplit.dollars.savings), tone: "safe" },
        { label: "Spending", value: money(facts.paydaySplit.dollars.spending), tone: paydayStatus },
      ],
    },
    cashFlowGap: {
      id: "cashFlowGap",
      status: gapStatus,
      headline: facts.cashFlowGap.startDay === facts.cashFlowGap.endDay && facts.cashFlowGap.startDay
        ? `Cash Flow Gap: ${formatMonthDay(input, facts.cashFlowGap.startDay)}`
        : "Cash Flow Gap",
      whatIFound: facts.cashFlowGap.detail,
      whyItMatters: "Paycheck-to-paycheck stress usually comes from a few tight days. I find those days so you can fix timing instead of guessing.",
      nextAction: gapStatus === "safe" ? "Keep this schedule and review again after new bills or plans are added." : "Review the bills, plans, or debt moves around the tight stretch.",
      floPrompt: "Why is my cash flow tight?",
      sourceNumbers: [
        { label: "Low point", value: money(facts.cashFlowGap.lowestBalance), tone: gapStatus },
        { label: "Safety floor", value: money(input.safetyFloor), tone: "info" },
        { label: "Start", value: facts.cashFlowGap.startDay ? formatMonthDay(input, facts.cashFlowGap.startDay) : "None", tone: "info" },
        { label: "End", value: facts.cashFlowGap.endDay ? formatMonthDay(input, facts.cashFlowGap.endDay) : "None", tone: "info" },
        ...(facts.cashFlowGap.causes.length
          ? [{ label: "Main pressure", value: facts.cashFlowGap.causes.map(cause => cause.label).join(", "), tone: "watch" as const }]
          : []),
      ],
    },
    debtPayoff: {
      id: "debtPayoff",
      status: debtStatus,
      headline: facts.debtPayoff.nextDebtName ? `Debt Payoff: ${facts.debtPayoff.nextDebtName}` : "Debt Payoff: Complete",
      whatIFound: facts.debtPayoff.detail,
      whyItMatters: facts.debtPayoff.whyItMatters,
      nextAction: facts.debtPayoff.nextMove,
      floPrompt: "Explain my debt payoff plan.",
      sourceNumbers: facts.debtPayoff.sourceNumbers,
    },
    spendingLimit: {
      id: "spendingLimit",
      status: facts.spendingLimits.status,
      headline: `Spending Pace: ${money(facts.spendingLimits.daily)}/day`,
      whatIFound: facts.spendingLimits.detail,
      whyItMatters: "This gives everyday spending a safe line so groceries, gas, and small purchases do not eat the cushion before the tight day passes.",
      nextAction: facts.spendingLimits.status === "risk" ? "Pause extra spending until the forecast has room again." : "Use this as the flexible spending pace until the next paycheck or tight day.",
      floPrompt: "What can I spend until payday?",
      sourceNumbers: [
        { label: "Daily limit", value: money(facts.spendingLimits.daily), tone: facts.spendingLimits.status },
        { label: "Weekly limit", value: money(facts.spendingLimits.weekly), tone: facts.spendingLimits.status },
        { label: "Remaining days", value: `${facts.spendingLimits.remainingDays}`, tone: "info" },
        { label: "Decision room", value: money(facts.decisionRoom), tone: facts.decisionRoom > 0 ? "safe" : "risk" },
      ],
    },
    extraMoneyRouter: {
      id: "extraMoneyRouter",
      status: routerStatus,
      headline: routerHeadline,
      whatIFound: facts.extraMoneyRouter.detail,
      whyItMatters: "Every extra dollar needs a job. I protect the floor first, then choose debt, savings, bills, or cash based on what helps you escape paycheck-to-paycheck fastest.",
      nextAction: facts.extraMoneyRouter.nextMove,
      floPrompt: "Where should extra money go?",
      sourceNumbers: routerSourceNumbers,
    },
  };
}

function estimateMonthlyRequiredOutflow(input: AlgorithmSuiteInput) {
  const billTotalsByCategory = new Map<string, number>();
  const requiredBills = input.bills.reduce((sum, bill) => {
    const amount = Math.max(0, bill.amount);
    const category = (bill.category || "Other").toLowerCase();
    billTotalsByCategory.set(category, (billTotalsByCategory.get(category) ?? 0) + amount);
    return sum + amount;
  }, 0);
  const essentialCategories = new Set([
    "food", "groceries", "transportation", "gas", "health", "medical", "childcare", "household",
  ]);
  const essentialFlexible = (input.categoryPlan ?? []).reduce((sum, row) => {
    const category = row.category.toLowerCase();
    if (!essentialCategories.has(category)) return sum;
    const planned = Math.max(0, row.budgeted, row.spent);
    const categoryBills = billTotalsByCategory.get(category) ?? 0;
    return sum + Math.max(0, planned - categoryBills);
  }, 0);
  const billBaseline = requiredBills > 0 ? requiredBills : Math.max(0, input.cashFlow.totalBillsDue);
  return roundCurrency(billBaseline + essentialFlexible);
}

function scoreIncomeStability(incomes: AlgorithmIncome[], transactions: AlgorithmTransaction[]) {
  if (!incomes.length) return { score: 20, label: "Not set up", detail: "Add recurring income so the forecast knows when money arrives." };
  const deposits = transactions
    .filter(transaction => transaction.amount > 0)
    .map(transaction => ({ date: transaction.date.slice(0, 10), amount: transaction.amount }))
    .sort((left, right) => left.date.localeCompare(right.date));

  if (deposits.length < 3) {
    return {
      score: 55,
      label: "Building history",
      detail: "Income is scheduled, but three or more actual deposits are needed to measure consistency.",
    };
  }

  const amounts = deposits.map(deposit => deposit.amount);
  const averageAmount = amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length;
  const amountVariation = averageAmount > 0
    ? amounts.reduce((sum, amount) => sum + Math.abs(amount - averageAmount), 0) / amounts.length / averageAmount
    : 1;
  const gaps = deposits.slice(1).map((deposit, index) => {
    const previous = new Date(`${deposits[index].date}T00:00:00Z`).getTime();
    const current = new Date(`${deposit.date}T00:00:00Z`).getTime();
    return Math.max(0, Math.round((current - previous) / 86_400_000));
  });
  const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / Math.max(1, gaps.length);
  const gapVariation = averageGap > 0
    ? gaps.reduce((sum, gap) => sum + Math.abs(gap - averageGap), 0) / Math.max(1, gaps.length) / averageGap
    : 1;
  const score = clamp(Math.round(100 - amountVariation * 70 - gapVariation * 30), 0, 100);
  return {
    score,
    label: score >= 80 ? "Steady" : score >= 60 ? "Moderate" : "Variable",
    detail: score >= 80
      ? "Recent deposit dates and amounts look consistent."
      : "Recent deposits vary, so review the forecast when income arrives.",
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

function findCashFlowGap(balances: AlgorithmDailyBalance[], safetyFloor: number, input: AlgorithmSuiteInput): AlgorithmSuiteResult["cashFlowGap"] {
  const sorted = balances.slice().sort((a, b) => a.day - b.day);
  const lowest = minBy(sorted, day => day.balance);
  let startDay: number | null = null;
  let endDay: number | null = null;
  let currentStart: number | null = null;
  let bestLength = 0;
  sorted.forEach(day => {
    if (day.balance < safetyFloor + STABILITY_POLICY.cashFlowGapBuffer) {
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
  const stretchLabel = startDay && endDay
    ? startDay === endDay
      ? formatMonthDay(input, startDay)
      : `${formatMonthDay(input, startDay)} through ${formatMonthDay(input, endDay)}`
    : null;
  const causes = findCashFlowGapCauses(input, startDay, endDay);
  const causeLabel = causes.length
    ? ` Main pressure: ${causes.map(cause => `${cause.label} ${money(cause.amount)}`).join(", ")}.`
    : "";
  return {
    startDay,
    endDay,
    lowestBalance: lowest?.balance ?? 0,
    detail: stretchLabel
      ? startDay === endDay
        ? `Tightest stretch is ${stretchLabel}.${causeLabel}`
        : `Tightest stretch runs ${stretchLabel}.${causeLabel}`
      : "No tight cash-flow stretch detected.",
    causes,
  };
}

function findCashFlowGapCauses(input: AlgorithmSuiteInput, startDay: number | null, endDay: number | null) {
  if (!startDay || !endDay) return [];
  const inWindow = (day: number) => day >= startDay && day <= endDay;
  const billCauses = input.bills
    .filter(bill => inWindow(bill.due_day))
    .map(bill => ({
      label: bill.name,
      amount: roundCurrency(Math.max(0, bill.amount - (bill.paidAmount ?? 0))),
      type: bill.is_debt ? "debt" as const : "bill" as const,
    }))
    .filter(cause => cause.amount > 0);
  const spendingCauses = input.transactions
    .filter(tx => tx.amount < 0 && inWindow(dayFromDateString(tx.date, input) ?? -1))
    .map(tx => ({
      label: tx.note || tx.category || "Spending",
      amount: roundCurrency(Math.abs(tx.amount)),
      type: "spending" as const,
    }));
  return [...billCauses, ...spendingCauses]
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label))
    .slice(0, 3);
}

function dayFromDateString(date: string, input: Pick<AlgorithmSuiteInput, "month" | "year">) {
  const match = /(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return null;
  if (Number(match[1]) !== input.year || Number(match[2]) !== input.month + 1) return null;
  return Number(match[3]);
}

function findPlanDelayDay(balances: AlgorithmDailyBalance[], safetyFloor: number) {
  const day = balances.find(item => item.balance >= safetyFloor + STABILITY_POLICY.saferPurchaseBuffer);
  return day?.day ?? null;
}

function buildSmartReminders(lowBalance: AlgorithmSuiteResult["lowBalanceWarning"], bills: AlgorithmSuiteResult["billPriority"]["bills"], goalName: string | null, input: AlgorithmSuiteInput) {
  const reminders: string[] = [];
  if (lowBalance.status !== "safe" && lowBalance.day) reminders.push(`Review low balance risk before ${formatMonthDay(input, lowBalance.day)}.`);
  bills.slice(0, 2).forEach(bill => reminders.push(`Confirm ${bill.name} before ${formatMonthDay(input, bill.dueDay)}.`));
  if (goalName) reminders.push(`Check if extra savings can go to ${goalName}.`);
  return reminders.slice(0, 4);
}

function buildSafeCushionDetails(
  input: AlgorithmSuiteInput,
  facts: {
    safeCushionAmount: number;
    lowestBalance: number;
    lowestDay: number | null;
    lowBalanceWarning: AlgorithmSuiteResult["lowBalanceWarning"];
  },
): Omit<AlgorithmSuiteResult["safeCushion"], "amount"> {
  const remainingBills = Math.max(0, input.cashFlow.totalBillsDue - input.cashFlow.totalPaid);
  const plannedOutflow = Math.max(0, -input.cashFlow.netTransactions) + Math.max(0, input.cashFlow.goalAllocations);
  const reservedAmount = roundCurrency(remainingBills + plannedOutflow);
  const lowestLabel = facts.lowestDay ? formatMonthDay(input, facts.lowestDay) : "the low point";
  const floorGap = roundCurrency(facts.lowestBalance - input.safetyFloor);
  const status: AlgorithmSuiteResult["safeCushion"]["status"] = facts.safeCushionAmount <= 0
    ? "risk"
    : facts.safeCushionAmount < STABILITY_POLICY.watchCushion
      ? "watch"
      : "safe";
  const label = status === "safe" ? "healthy cushion" : status === "watch" ? "thin cushion" : "no safe cushion";
  const reservedLabel = reservedAmount > 0
    ? `$${reservedAmount.toFixed(0)} is already reserved for bills, spending, and goals in this month.`
    : "No remaining planned outflow is reserved in this month.";
  const compactReason = status === "safe"
    ? `${lowestLabel} stays protected`
    : status === "watch"
      ? `Tightest on ${lowestLabel}`
      : `Below floor on ${lowestLabel}`;
  const calendarHint = facts.lowestDay
    ? `Monthly will point you to ${formatMonthDay(input, facts.lowestDay)}, where the cushion is tightest.`
    : "Monthly will show the first date that starts to pressure your cushion.";
  const topReason = status === "safe"
    ? `Your lowest forecast stays $${facts.safeCushionAmount.toFixed(0)} above the $${input.safetyFloor.toFixed(0)} floor.`
    : status === "watch"
      ? `Your lowest forecast leaves only $${facts.safeCushionAmount.toFixed(0)} above the $${input.safetyFloor.toFixed(0)} floor.`
      : facts.lowBalanceWarning.message;
  const topAction = status === "safe"
    ? "Use this as the limit before adding new spending, extra debt payments, or savings moves."
    : status === "watch"
      ? "Keep extra money available until the tight day passes, or find a safer date."
      : "Pause new spending and protect the floor from the bill, plan, or debt move creating pressure.";
  return {
    label,
    status,
    lowestBalance: roundCurrency(facts.lowestBalance),
    lowestDay: facts.lowestDay,
    safetyFloor: input.safetyFloor,
    reservedAmount,
    reservedLabel,
    compactReason,
    calendarHint,
    topReason,
    topAction,
    breakdownItems: [
      { label: "Safe amount", value: `$${facts.safeCushionAmount.toFixed(0)}`, tone: status },
      { label: "Lowest balance", value: `$${facts.lowestBalance.toFixed(0)}${facts.lowestDay ? ` ${formatMonthDay(input, facts.lowestDay)}` : ""}`, tone: facts.lowestBalance < input.safetyFloor ? "risk" : "info" },
      { label: "Safety floor", value: `$${input.safetyFloor.toFixed(0)}`, tone: "info" },
      { label: "Room vs floor", value: floorGap >= 0 ? `+$${floorGap.toFixed(0)}` : `-$${Math.abs(floorGap).toFixed(0)}`, tone: floorGap > STABILITY_POLICY.watchCushion ? "safe" : floorGap > 0 ? "watch" : "risk" },
      { label: "Reserved plan", value: `$${reservedAmount.toFixed(0)}`, tone: reservedAmount > facts.safeCushionAmount ? "watch" : "info" },
    ],
  };
}

function buildFlowScoreDetails(
  input: AlgorithmSuiteInput,
  facts: {
    flowScore: number;
    flowLabel: string;
    lowestBalance: number;
    lowestDay: number | null;
    safeCushionAmount: number;
    billReadiness: number;
    paidBills: number;
    dueBillsCount: number;
    paidDueBills: number;
    overdueBillsCount: number;
    debtPressure: number;
    monthlyDebtMinimums: number;
    lowBalanceWarning: AlgorithmSuiteResult["lowBalanceWarning"];
    categoryPressure: AlgorithmCategoryRow[];
    confidenceScore: number;
    stability: StabilityProgress;
    riskDays: number;
    remainingDays: number;
  },
) {
  const positiveFactors: string[] = [];
  const negativeFactors: string[] = [];
  const breakdownItems: AlgorithmSuiteResult["flowScore"]["breakdownItems"] = [];

  if (facts.safeCushionAmount >= STABILITY_POLICY.watchCushion) positiveFactors.push(`You have $${facts.safeCushionAmount.toFixed(0)} of breathing room above your floor.`);
  else if (facts.safeCushionAmount > 0) negativeFactors.push(`Breathing room is thin at $${facts.safeCushionAmount.toFixed(0)} above your floor.`);
  else negativeFactors.push("The forecast does not have extra room above your safety floor.");

  if (facts.lowBalanceWarning.status === "safe") positiveFactors.push("No low-balance risk is showing in this month.");
  else negativeFactors.push(facts.lowBalanceWarning.message);

  if (facts.overdueBillsCount > 0) {
    negativeFactors.push(`${facts.overdueBillsCount} overdue bill${facts.overdueBillsCount === 1 ? "" : "s"} need attention.`);
  } else if (facts.dueBillsCount > 0 && facts.billReadiness < 1) {
    negativeFactors.push(`${facts.dueBillsCount - facts.paidDueBills} bill${facts.dueBillsCount - facts.paidDueBills === 1 ? "" : "s"} due so far still need attention.`);
  } else if (facts.dueBillsCount > 0) {
    positiveFactors.push(`${facts.paidDueBills}/${facts.dueBillsCount} due bills are cleared.`);
  } else if (input.bills.length > 0) {
    positiveFactors.push(`${input.bills.length} upcoming bill${input.bills.length === 1 ? " is" : "s are"} planned in the forecast.`);
  }

  if (facts.stability.reserveTarget > 0 && facts.stability.protectedDays >= STABILITY_POLICY.reserveGoalDays) {
    positiveFactors.push("One month of required expenses is protected.");
  } else if (facts.stability.reserveTarget > 0) {
    negativeFactors.push(`${facts.stability.protectedDays} of 30 stability days are protected.`);
  }

  if (input.forecastConfidence.level === "high") positiveFactors.push("Forecast confidence is high.");
  else negativeFactors.push(`Forecast confidence is ${input.forecastConfidence.label.toLowerCase()}.`);

  if (facts.debtPressure > 15) negativeFactors.push(`Debt minimums use about $${facts.monthlyDebtMinimums.toFixed(0)} of monthly income.`);
  else if (input.bills.some(bill => bill.is_debt)) positiveFactors.push("Debt pressure is manageable in this plan.");

  if (facts.categoryPressure.length) {
    const top = facts.categoryPressure.slice().sort((a, b) => a.remaining - b.remaining)[0];
    negativeFactors.push(`${top.category} is ${top.remaining < 0 ? `$${Math.abs(top.remaining).toFixed(0)} over plan` : "close to its limit"}.`);
  }

  breakdownItems.push({
    label: "Safe Forecast Days",
    value: `${Math.max(0, facts.remainingDays - facts.riskDays)}/${facts.remainingDays}`,
    tone: facts.riskDays > 0 ? "risk" : "safe",
  });
  breakdownItems.push({
    label: "Due Bills",
    value: facts.dueBillsCount ? `${facts.paidDueBills}/${facts.dueBillsCount}` : "On track",
    tone: facts.overdueBillsCount > 0 ? "risk" : facts.dueBillsCount && facts.billReadiness < 1 ? "watch" : "safe",
  });
  breakdownItems.push({
    label: "Forecast Confidence",
    value: input.forecastConfidence.label,
    tone: input.forecastConfidence.level === "high" ? "safe" : input.forecastConfidence.level === "medium" ? "watch" : "risk",
  });
  breakdownItems.push({
    label: "Stability Reserve",
    value: facts.stability.reserveTarget > 0 ? `${facts.stability.protectedDays}/30 days` : "Needs bills",
    tone: facts.stability.protectedDays >= 30 ? "safe" : facts.stability.protectedDays > 0 ? "watch" : "risk",
  });
  if (facts.categoryPressure.length) {
    breakdownItems.push({
      label: "Spending Pressure",
      value: `${facts.categoryPressure.length} categor${facts.categoryPressure.length === 1 ? "y" : "ies"}`,
      tone: facts.categoryPressure.some(row => row.status === "over") ? "risk" : "watch",
    });
  }

  const topReason = negativeFactors[0] ?? positiveFactors[0] ?? "Your plan has enough information for a basic Flow Score.";
  const topAction = flowScoreAction(facts, input);

  return {
    topReason,
    topAction,
    positiveFactors: positiveFactors.slice(0, 3),
    negativeFactors: negativeFactors.slice(0, 3),
    breakdownItems,
  };
}

function flowScoreAction(
  facts: {
    safeCushionAmount: number;
    lowBalanceWarning: AlgorithmSuiteResult["lowBalanceWarning"];
    billReadiness: number;
    categoryPressure: AlgorithmCategoryRow[];
    overdueBillsCount: number;
  },
  input: AlgorithmSuiteInput,
) {
  if (facts.lowBalanceWarning.status !== "safe" && facts.lowBalanceWarning.day) return `Review why ${formatMonthDay(input, facts.lowBalanceWarning.day)} is tight.`;
  if (facts.safeCushionAmount <= 0) return "Protect your safety floor before adding new spending.";
  const priorityBill = prioritizeBills(input.bills, input.todayDay, input.safetyFloor, facts.lowBalanceWarning.day, input).bills[0];
  if (priorityBill && facts.overdueBillsCount > 0) return `Review ${priorityBill.name} first.`;
  if (facts.categoryPressure.length) return `Review ${facts.categoryPressure[0].category} spending.`;
  if (facts.safeCushionAmount > STABILITY_POLICY.watchCushion) return "Review what the next safe dollar should do.";
  return "No action needed right now.";
}

function buildInsights(
  input: AlgorithmSuiteInput,
  facts: {
    flowScore: number;
    flowGrade: string;
    flowLabel: string;
    safeCushionAmount: number;
    lowBalanceWarning: AlgorithmSuiteResult["lowBalanceWarning"];
    billPriority: AlgorithmSuiteResult["billPriority"];
    extraMoneyAmount: number;
    extraMoneyRecommendation: "debt" | "savings" | "bill" | "available";
    spendingLimits: { daily: number; weekly: number };
    subscriptionCreep: { count: number; items: string[] };
    billShock: { count: number; items: string[] };
  },
): AlgorithmInsight[] {
  const insights: AlgorithmInsight[] = [
    {
      id: "flowScore",
      algorithm: "Flow Score",
      title: `${facts.flowScore} · ${facts.flowLabel}`,
      detail: `Plan health uses cushion, bills, risk days, and forecast confidence.`,
      tone: facts.flowScore >= 75 ? "safe" : facts.flowScore >= 55 ? "watch" : "risk",
    },
    {
      id: "safeCushion",
      algorithm: "Breathing Room",
      title: `$${facts.safeCushionAmount.toFixed(0)} safe cushion`,
      detail: facts.safeCushionAmount > 0 ? "This is the current extra room above your floor." : "No safe cushion is available yet.",
      tone: facts.safeCushionAmount > STABILITY_POLICY.watchCushion ? "safe" : facts.safeCushionAmount > 0 ? "watch" : "risk",
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
  if (facts.extraMoneyAmount > 0) {
    insights.push({
      id: "extraMoneyRouter",
      algorithm: "Next Dollar",
      title: `$${facts.extraMoneyAmount.toFixed(0)} can be routed safely`,
      detail: facts.extraMoneyRecommendation === "debt"
        ? "Debt payoff is the best first route while the safety floor stays protected."
        : facts.extraMoneyRecommendation === "bill"
          ? "Upcoming bills should be protected before extra spending."
          : facts.extraMoneyRecommendation === "savings"
            ? "Savings is a safe route after bills and the floor are protected."
            : "Keeping it available is safest right now.",
      tone: "safe",
    });
  }
  if (facts.spendingLimits.daily > 0) {
    insights.push({
      id: "spendingLimit",
      algorithm: "Spending Pace",
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

function scoreLabel(score: number) {
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Strong";
  if (score >= 65) return "Stable";
  if (score >= 45) return "Tight";
  return "Needs attention";
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

function money(value: number) {
  const rounded = roundCurrency(value);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}$${Math.abs(rounded).toFixed(Math.abs(rounded) >= 100 || Number.isInteger(rounded) ? 0 : 2)}`;
}

function statusFromScore(score: number): AlgorithmStatus {
  if (score >= 70) return "safe";
  if (score >= 45) return "watch";
  return "risk";
}

const MONTH_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatMonthDay(input: Pick<AlgorithmSuiteInput, "month" | "year">, day: number | null | undefined) {
  if (!day) return "the low point";
  return `${MONTH_FULL[input.month] ?? "Month"} ${day}, ${input.year}`;
}

function capitalize(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}
