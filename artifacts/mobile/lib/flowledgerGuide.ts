import type { StabilityStage } from "./stability";

export interface StabilityPathGuideStep {
  id: StabilityStage;
  title: string;
  range: string;
  description: string;
}

export interface AlgorithmGuideItem {
  id: string;
  title: string;
  description: string;
}

export const STABILITY_PATH_GUIDE: readonly StabilityPathGuideStep[] = [
  {
    id: "stabilize",
    title: "Protect the plan",
    range: "When a required bill is overdue or a forecast day falls below the safety floor",
    description: "FlowLedger first identifies the bill, spending, or timing issue creating the shortfall.",
  },
  {
    id: "next_paycheck",
    title: "Reach the next paycheck",
    range: "0-6 protected days",
    description: "The immediate goal is keeping required expenses covered through the next income date.",
  },
  {
    id: "breathing_room",
    title: "Build breathing room",
    range: "7-13 protected days",
    description: "A small buffer begins absorbing normal timing changes without using the safety floor.",
  },
  {
    id: "reserve",
    title: "Build the stability reserve",
    range: "14-29 protected days",
    description: "Safe extra money builds toward one full month of required expenses.",
  },
  {
    id: "standing",
    title: "Keep the plan steady",
    range: "30-90 protected days",
    description: "The plan maintains at least one protected month while longer-term protection continues to grow.",
  },
] as const;

export const ALGORITHM_GUIDE: readonly AlgorithmGuideItem[] = [
  { id: "forecast", title: "Daily Forecast", description: "Projects checking money day by day from posted activity, planned income, bills, and spending." },
  { id: "stability", title: "Stability Path", description: "Measures the lowest upcoming checking balance above the safety floor against required monthly expenses." },
  { id: "flow-score", title: "Flow Score", description: "Summarizes cushion, bill readiness, forecast risk, spending pressure, and data confidence." },
  { id: "breathing-room", title: "Breathing Room", description: "Shows money remaining above the safety floor at the lowest point in the forecast." },
  { id: "bill-priority", title: "Bill Priority", description: "Ranks required bills by due date, payment status, and their effect on upcoming low-balance days." },
  { id: "spending-pace", title: "Spending Pace", description: "Estimates a safe daily and weekly pace only after bills and the safety floor remain protected." },
  { id: "next-dollar", title: "Next Dollar", description: "Suggests whether safe extra money should remain available or go toward bills, savings, or debt." },
  { id: "debt-payoff", title: "Debt Payoff", description: "Models minimum payments and snowball or avalanche progress without spending protected money." },
  { id: "risk-alerts", title: "Risk Alerts", description: "Calls attention to low-balance days, unusual bill pressure, and changes that need review." },
] as const;

export const FLOWLEDGER_MONEY_RULES = [
  "Checking drives the spendable forecast. Savings stays separate.",
  "Pending bank activity is visible but is not counted until it posts.",
  "A posted bank transaction is counted once, even after it is matched to a planned item.",
  "Reconciliation updates the plan and calendar; it does not invent or remove real bank money.",
] as const;
