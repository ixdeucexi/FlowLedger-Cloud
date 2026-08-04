export const FLOW_SCORE_WEIGHTS = {
  balanceSafety: 30,
  requiredBills: 20,
  backupProgress: 20,
  safeForecastDays: 15,
  forecastConfidence: 10,
  spendingPlan: 5,
} as const;

export const FLOW_SCORE_OVERDUE_BILL_PENALTY = 10;

export const FLOW_SCORE_CONFIDENCE_POINTS = {
  high: FLOW_SCORE_WEIGHTS.forecastConfidence,
  medium: 6,
  low: 2,
} as const;

export const FLOW_SCORE_SPENDING_POINTS = {
  clear: FLOW_SCORE_WEIGHTS.spendingPlan,
  pressure: 2,
  over: 0,
} as const;

export const FLOW_SCORE_GUIDE = [
  {
    id: "balance-safety",
    label: "Future balance safety",
    points: FLOW_SCORE_WEIGHTS.balanceSafety,
    description: "30 points when every upcoming day stays at or above your safety floor; otherwise 0.",
  },
  {
    id: "required-bills",
    label: "Required bills",
    points: FLOW_SCORE_WEIGHTS.requiredBills,
    description: "Up to 20 as Must Pay bills are cleared. Each overdue bill costs 10 points.",
  },
  {
    id: "backup-progress",
    label: "Backup progress",
    points: FLOW_SCORE_WEIGHTS.backupProgress,
    description: "Up to 10 for your 30-day reserve, plus up to 10 for your 180-day backup.",
  },
  {
    id: "safe-forecast-days",
    label: "Safe forecast days",
    points: FLOW_SCORE_WEIGHTS.safeForecastDays,
    description: "Up to 15 for how far the forecast stays safe before the first below-floor day.",
  },
  {
    id: "forecast-confidence",
    label: "Forecast confidence",
    points: FLOW_SCORE_WEIGHTS.forecastConfidence,
    description: "High confidence earns 10, medium earns 6, and low earns 2.",
  },
  {
    id: "spending-plan",
    label: "Spending plan",
    points: FLOW_SCORE_WEIGHTS.spendingPlan,
    description: "5 when categories are on plan, 2 near limits, and 0 when any category is over.",
  },
] as const;

export const FLOW_SCORE_MAX_POINTS = FLOW_SCORE_GUIDE.reduce((sum, item) => sum + item.points, 0);
