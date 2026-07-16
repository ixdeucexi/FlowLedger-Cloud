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
} as const;

export type StabilityStage = "stabilize" | "next_paycheck" | "breathing_room" | "reserve" | "standing";

export interface StabilityBalanceDay {
  day: number;
  balance: number;
}

export interface StabilityProgressInput {
  balances: StabilityBalanceDay[];
  todayDay: number;
  safetyFloor: number;
  monthlyRequiredOutflow: number;
  overdueBills: number;
  forecastConfidence: "high" | "medium" | "low";
}

export interface StabilityProgress {
  stage: StabilityStage;
  stageLabel: string;
  status: "safe" | "watch" | "risk";
  protectedAmount: number;
  reserveTarget: number;
  reserveProgress: number;
  protectedDays: number;
  safeForecastDays: number;
  riskDays: number;
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
  const reserveProgress = reserveTarget > 0 ? clamp(protectedAmount / reserveTarget, 0, 1) : 0;
  const protectedDays = reserveTarget > 0
    ? Math.floor(clamp((protectedAmount / reserveTarget) * STABILITY_POLICY.reserveGoalDays, 0, 90))
    : 0;
  const riskDays = future.filter(day => day.balance < floor).length;
  const firstRiskIndex = future.findIndex(day => day.balance < floor);
  const safeForecastDays = firstRiskIndex >= 0 ? firstRiskIndex : future.length;

  if (input.overdueBills > 0 || riskDays > 0) {
    return {
      stage: "stabilize",
      stageLabel: "Protect the plan",
      status: "risk",
      protectedAmount,
      reserveTarget,
      reserveProgress,
      protectedDays,
      safeForecastDays,
      riskDays,
      headline: riskDays > 0
        ? `${riskDays} upcoming day${riskDays === 1 ? " falls" : "s fall"} below your safety floor.`
        : `${input.overdueBills} required bill${input.overdueBills === 1 ? " needs" : "s need"} attention.`,
      explanation: "Start by protecting required bills and keeping the next low-balance day above your floor.",
      nextAction: input.overdueBills > 0 ? "Handle the most urgent required bill first." : "Review what is pulling the forecast below your floor.",
      nextMilestone: "Reach the next paycheck safely",
      nextMilestoneAmount: roundCurrency(Math.max(0, floor - lowestBalance)),
    };
  }

  if (reserveTarget <= 0) {
    return {
      stage: "next_paycheck",
      stageLabel: "Build the first plan",
      status: "watch",
      protectedAmount,
      reserveTarget,
      reserveProgress,
      protectedDays,
      safeForecastDays,
      riskDays,
      headline: "Add required bills to measure your breathing room.",
      explanation: "Once the essentials are listed, FlowLedger can show how many days your available money protects.",
      nextAction: "Add the bills and minimum payments you must cover each month.",
      nextMilestone: "Build a complete required-expense plan",
      nextMilestoneAmount: 0,
    };
  }

  if (protectedDays < 7) {
    return stageResult("next_paycheck", "Reach the next paycheck", "watch", 7);
  }
  if (protectedDays < 14) {
    return stageResult("breathing_room", "Build breathing room", "watch", 14);
  }
  if (protectedDays < STABILITY_POLICY.reserveGoalDays) {
    return stageResult("reserve", "Build your stability reserve", "safe", STABILITY_POLICY.reserveGoalDays);
  }
  return {
    stage: "standing",
    stageLabel: "Keep the plan steady",
    status: input.forecastConfidence === "high" ? "safe" : "watch",
    protectedAmount,
    reserveTarget,
    reserveProgress,
    protectedDays,
    safeForecastDays,
    riskDays,
    headline: `${protectedDays} days of required expenses are protected.`,
    explanation: "Your forecast stays above the floor and your one-month stability reserve is covered.",
    nextAction: input.forecastConfidence === "high"
      ? "Keep bills current and review the plan when income or expenses change."
      : "Reconcile your accounts so the plan stays trustworthy.",
    nextMilestone: "Maintain one month of protected expenses",
    nextMilestoneAmount: 0,
  };

  function stageResult(
    stage: StabilityStage,
    stageLabel: string,
    status: StabilityProgress["status"],
    milestoneDays: number,
  ): StabilityProgress {
    const milestoneAmount = reserveTarget * (milestoneDays / STABILITY_POLICY.reserveGoalDays);
    const remaining = roundCurrency(Math.max(0, milestoneAmount - protectedAmount));
    return {
      stage,
      stageLabel,
      status,
      protectedAmount,
      reserveTarget,
      reserveProgress,
      protectedDays,
      safeForecastDays,
      riskDays,
      headline: `${protectedDays} day${protectedDays === 1 ? "" : "s"} of required expenses protected.`,
      explanation: `Your next milestone is ${milestoneDays} protected days without using money reserved for bills or your safety floor.`,
      nextAction: remaining > 0
        ? `Keep the next $${remaining.toFixed(0)} of safe extra money available.`
        : "Keep required bills protected through the next paycheck.",
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
