export const STABILITY_POLICY = {
  watchCushion: 250,
  purchaseSplitMinimum: 75,
  purchaseSafeMinimum: 250,
  saferPurchaseBuffer: 300,
  cashFlowGapBuffer: 200,
  spendingWatchPerDay: 10,
  extraMoneyMinimum: 25,
  extraMoneyRoomMinimum: 250,
  reserveGoalDays: 30,
  freedomGoalDays: 90,
} as const;

export type StabilityStage =
  | "stabilize"
  | "next_paycheck"
  | "breathing_room"
  | "reserve"
  | "momentum"
  | "freedom"
  | "standing";

export interface StabilityBalanceDay {
  day: number;
  balance: number;
  income?: number;
}

export interface StabilityProgressInput {
  balances: StabilityBalanceDay[];
  todayDay: number;
  safetyFloor: number;
  monthlyRequiredOutflow: number;
  overdueBills: number;
  attentionBill?: {
    name: string;
    overdueAmount: number;
    dueLabel: string;
  } | null;
  forecastConfidence: "high" | "medium" | "low";
  nextPaycheckLabel?: string | null;
}

export interface StabilityProgress {
  stage: StabilityStage;
  stageLabel: string;
  status: "safe" | "watch" | "risk";
  protectedAmount: number;
  reserveTarget: number;
  reserveProgress: number;
  backupTarget: number;
  backupProgress: number;
  protectedDays: number;
  safeForecastDays: number;
  riskDays: number;
  safeUntilPayday: boolean | null;
  nextPaycheckDay: number | null;
  nextPaycheckLabel: string | null;
  paydayLowestBalance: number | null;
  paydayShortfall: number;
  headline: string;
  explanation: string;
  nextAction: string;
  nextMilestone: string;
  nextMilestoneAmount: number;
}

export function buildStabilityProgress(input: StabilityProgressInput): StabilityProgress {
  const future = input.balances
    .filter(day => day.day >= input.todayDay)
    .slice()
    .sort((left, right) => left.day - right.day);
  const floor = Math.max(0, Number(input.safetyFloor) || 0);
  const lowestBalance = future.reduce<number | null>(
    (lowest, day) => lowest === null || day.balance < lowest ? day.balance : lowest,
    null,
  ) ?? 0;
  const protectedAmount = roundCurrency(Math.max(0, lowestBalance - floor));
  const reserveTarget = roundCurrency(Math.max(0, Number(input.monthlyRequiredOutflow) || 0));
  const backupTarget = roundCurrency(reserveTarget * (STABILITY_POLICY.freedomGoalDays / STABILITY_POLICY.reserveGoalDays));
  const protectedDays = reserveTarget > 0
    ? Math.floor(clamp((protectedAmount / reserveTarget) * STABILITY_POLICY.reserveGoalDays, 0, STABILITY_POLICY.freedomGoalDays))
    : 0;
  const reserveProgress = reserveTarget > 0 ? clamp(protectedAmount / reserveTarget, 0, 1) : 0;
  const backupProgress = backupTarget > 0 ? clamp(protectedAmount / backupTarget, 0, 1) : 0;
  const riskDays = future.filter(day => day.balance < floor).length;
  const firstRiskIndex = future.findIndex(day => day.balance < floor);
  const safeForecastDays = firstRiskIndex >= 0 ? firstRiskIndex : future.length;
  const nextPaycheckDay = future.find(day => day.day > input.todayDay && Math.max(0, Number(day.income) || 0) > 0.005)?.day ?? null;
  const paydayDays = nextPaycheckDay === null ? [] : future.filter(day => day.day <= nextPaycheckDay);
  const paydayLowestBalance = paydayDays.length
    ? paydayDays.reduce((lowest, day) => Math.min(lowest, day.balance), paydayDays[0].balance)
    : null;
  const safeUntilPayday = paydayLowestBalance === null ? null : paydayLowestBalance >= floor;
  const paydayShortfall = roundCurrency(paydayLowestBalance === null ? 0 : Math.max(0, floor - paydayLowestBalance));
  const nextPaycheckLabel = nextPaycheckDay === null ? null : input.nextPaycheckLabel ?? `day ${nextPaycheckDay}`;
  const base = {
    protectedAmount,
    reserveTarget,
    reserveProgress,
    backupTarget,
    backupProgress,
    protectedDays,
    safeForecastDays,
    riskDays,
    safeUntilPayday,
    nextPaycheckDay,
    nextPaycheckLabel,
    paydayLowestBalance,
    paydayShortfall,
  };

  if (input.overdueBills > 0 || riskDays > 0) {
    const attentionBill = input.attentionBill;
    return {
      ...base,
      stage: "stabilize",
      stageLabel: "Protect the plan",
      status: "risk",
      headline: riskDays > 0
        ? `${riskDays} upcoming day${riskDays === 1 ? " falls" : "s fall"} below your safety floor.`
        : attentionBill
          ? `${attentionBill.name} still needs ${formatCurrency(attentionBill.overdueAmount)}${input.overdueBills > 1 ? `, with ${input.overdueBills - 1} more Must Pay bill${input.overdueBills === 2 ? "" : "s"} open` : ""}.`
          : `${input.overdueBills} Must Pay bill${input.overdueBills === 1 ? " needs" : "s need"} attention.`,
      explanation: attentionBill && riskDays === 0
        ? `${attentionBill.dueLabel} has passed and this amount is still open. Clear it or correct the payment if it already posted.`
        : "Fix the shortfall before building backup days.",
      nextAction: input.overdueBills > 0
        ? attentionBill ? `Review ${attentionBill.name} first.` : "Handle the most urgent Must Pay bill first."
        : "Review what is pulling the forecast below your floor.",
      nextMilestone: "Reach the next paycheck safely",
      nextMilestoneAmount: paydayShortfall || roundCurrency(Math.max(0, floor - lowestBalance)),
    };
  }

  if (reserveTarget <= 0) {
    return {
      ...base,
      stage: "next_paycheck",
      stageLabel: "Build the first plan",
      status: "watch",
      headline: "Tell Flo which bills are Must Pay.",
      explanation: "Once required expenses are labeled, FlowLedger can turn your backup money into easy-to-understand days.",
      nextAction: "Add or edit your bills and mark the ones you cannot skip as Must Pay.",
      nextMilestone: "Build a complete Must Pay plan",
      nextMilestoneAmount: 0,
    };
  }

  if (safeUntilPayday === null) {
    return {
      ...base,
      stage: "next_paycheck",
      stageLabel: "Confirm the next paycheck",
      status: "watch",
      headline: "Add your next paycheck date.",
      explanation: "Flo needs the next income date before saying whether the current plan is safe until payday.",
      nextAction: "Confirm the next date and amount in Income.",
      nextMilestone: "Reach the next paycheck safely",
      nextMilestoneAmount: 0,
    };
  }

  if (protectedDays < 7) return stageResult("breathing_room", "watch", 7);
  if (protectedDays < 30) return stageResult("reserve", "watch", 30);
  if (protectedDays < 60) return stageResult("momentum", "safe", 60);
  if (protectedDays < 90) return stageResult("freedom", "safe", 90);

  return {
    ...base,
    stage: "standing",
    stageLabel: "Protect your freedom buffer",
    status: input.forecastConfidence === "high" ? "safe" : "watch",
    headline: "You have 90 days of Must Pay expenses backed up.",
    explanation: "A surprise can happen without immediately pushing you back to the next paycheck.",
    nextAction: input.forecastConfidence === "high"
      ? "Keep bills current and rebuild the buffer whenever you use it."
      : "Reconcile your accounts so the 90-day number stays trustworthy.",
    nextMilestone: "Maintain 90 protected days",
    nextMilestoneAmount: 0,
  };

  function stageResult(
    stage: StabilityStage,
    status: StabilityProgress["status"],
    milestoneDays: number,
  ): StabilityProgress {
    const milestoneAmount = reserveTarget * (milestoneDays / STABILITY_POLICY.reserveGoalDays);
    const remaining = roundCurrency(Math.max(0, milestoneAmount - protectedAmount));
    return {
      ...base,
      stage,
      stageLabel: "Build your backup",
      status,
      headline: `Your backup could cover ${protectedDays} day${protectedDays === 1 ? "" : "s"} of Must Pay expenses.`,
      explanation: "Keep building this cushion so one surprise does not have to wait for the next paycheck.",
      nextAction: remaining > 0
        ? `Keep the next $${remaining.toFixed(0)} of safe extra money as backup.`
        : "Keep Must Pay bills protected through the next paycheck.",
      nextMilestone: `${milestoneDays} protected days`,
      nextMilestoneAmount: remaining,
    };
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function formatCurrency(value: number) {
  return roundCurrency(Math.max(0, value)).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
