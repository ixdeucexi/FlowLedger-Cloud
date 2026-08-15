export const FLOW_SCORE_WEIGHTS = {
  planCoverage: 40,
  requiredPayments: 30,
  backupProgress: 30,
} as const;

export const FLOW_SCORE_BACKUP_MILESTONES = [
  { days: 0, points: 0 },
  { days: 7, points: 10 },
  { days: 30, points: 20 },
  { days: 90, points: 27 },
  { days: 180, points: 30 },
] as const;

export const FLOW_SCORE_GUIDE = [
  {
    id: "plan-coverage",
    label: "Plan to next payday",
    points: FLOW_SCORE_WEIGHTS.planCoverage,
    description: "Up to 40 based on the share of forecast days through your next paycheck that protect your safety floor. If no paycheck is scheduled, FlowLedger uses the next 30 forecast days.",
  },
  {
    id: "required-payments",
    label: "Must Pay current",
    points: FLOW_SCORE_WEIGHTS.requiredPayments,
    description: "Up to 30 based on the required amount due through today that is paid, confirmed, or covered by a matched pending payment. Future payments do not lower the score.",
  },
  {
    id: "backup-progress",
    label: "Backup progress",
    points: FLOW_SCORE_WEIGHTS.backupProgress,
    description: "Up to 30 as Protected Days reach the 7, 30, 90, and 180-day milestones. The first backup days earn points fastest.",
  },
] as const;

export const FLOW_SCORE_MAX_POINTS = FLOW_SCORE_GUIDE.reduce((sum, item) => sum + item.points, 0);

export type FlowScoreComponentId = "planCoverage" | "requiredPayments" | "backupProgress";

export type FlowScoreComponent = {
  id: FlowScoreComponentId;
  label: string;
  earned: number;
  maximum: number;
};

export type FlowScoreCalculation = {
  score: number;
  label: string;
  components: FlowScoreComponent[];
};

export function calculateFlowScore(input: {
  safeForecastDays: number;
  forecastDays: number;
  requiredAmountDue: number;
  requiredAmountCovered: number;
  protectedDays: number;
}): FlowScoreCalculation {
  const components: FlowScoreComponent[] = [
    {
      id: "planCoverage",
      label: "Plan to next payday",
      earned: proportionalPoints(input.safeForecastDays, input.forecastDays, FLOW_SCORE_WEIGHTS.planCoverage),
      maximum: FLOW_SCORE_WEIGHTS.planCoverage,
    },
    {
      id: "requiredPayments",
      label: "Must Pay current",
      earned: input.requiredAmountDue <= 0.005
        ? FLOW_SCORE_WEIGHTS.requiredPayments
        : proportionalPoints(input.requiredAmountCovered, input.requiredAmountDue, FLOW_SCORE_WEIGHTS.requiredPayments),
      maximum: FLOW_SCORE_WEIGHTS.requiredPayments,
    },
    {
      id: "backupProgress",
      label: "Backup progress",
      earned: backupProgressPoints(input.protectedDays),
      maximum: FLOW_SCORE_WEIGHTS.backupProgress,
    },
  ];
  const score = clamp(Math.round(components.reduce((sum, component) => sum + component.earned, 0)), 0, FLOW_SCORE_MAX_POINTS);
  return { score, label: flowScoreLabel(score), components };
}

export function backupProgressPoints(protectedDays: number): number {
  const days = clamp(Number(protectedDays) || 0, 0, 180);
  for (let index = 1; index < FLOW_SCORE_BACKUP_MILESTONES.length; index += 1) {
    const upper = FLOW_SCORE_BACKUP_MILESTONES[index];
    const lower = FLOW_SCORE_BACKUP_MILESTONES[index - 1];
    if (days <= upper.days) {
      const progress = (days - lower.days) / (upper.days - lower.days);
      return Math.round(lower.points + progress * (upper.points - lower.points));
    }
  }
  return FLOW_SCORE_WEIGHTS.backupProgress;
}

export function flowScoreLabel(score: number): string {
  if (score >= 90) return "Well protected";
  if (score >= 75) return "Strong";
  if (score >= 60) return "Steady";
  if (score >= 40) return "Building";
  return "Getting started";
}

function proportionalPoints(numerator: number, denominator: number, maximum: number): number {
  if (denominator <= 0) return 0;
  return Math.round(clamp((Number(numerator) || 0) / denominator, 0, 1) * maximum);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
