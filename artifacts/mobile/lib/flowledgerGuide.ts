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

export const FLOW_GUIDE_SECTIONS = [
  { id: "overview", title: "Overview", description: "Where you stand, what is protected, and what comes next." },
  { id: "flow-score", title: "Flow Score", description: "What is helping or lowering your score" },
  { id: "protected-days", title: "Protected Days", description: "How your backup becomes days of Must Pay protection" },
  { id: "stability", title: "Stability Path", description: "The steps from today to a stronger buffer" },
  { id: "backup", title: "Backup Goal", description: "Your next milestone and long-term target" },
  { id: "algorithms", title: "How calculations work", description: "How FlowLedger builds your guidance" },
  { id: "faq", title: "FAQs", description: "Straight answers about the calculation rules" },
] as const;

export type FlowGuideSectionId = (typeof FLOW_GUIDE_SECTIONS)[number]["id"];

export function flowGuideSectionIndex(value?: string) {
  const normalized = value === "path" ? "stability" : value;
  const index = FLOW_GUIDE_SECTIONS.findIndex(section => section.id === normalized);
  return index >= 0 ? index : 0;
}

export function guideTabScrollOffset(itemStart: number, itemSize: number, viewportSize: number) {
  return Math.max(0, itemStart - Math.max(0, (viewportSize - itemSize) / 2));
}

export interface FlowGuideRouteFacts {
  section?: FlowGuideSectionId;
  stage: StabilityStage;
  stageLabel: string;
  protectedDays: number;
  protectedAmount: number;
  reserveTarget: number;
  backupTarget: number;
  safeUntilPayday: boolean | null;
  nextPaycheckLabel: string | null;
  nextAction: string;
  nextMilestone: string;
  nextMilestoneAmount: number;
  lowestBalance: number;
  safetyFloor: number;
  confidence: string;
  flowScore: number;
  flowScoreLabel: string;
}

/** Keeps both dashboard launchers on the same primitive-only route contract. */
export function buildFlowGuideRouteParams(facts: FlowGuideRouteFacts): Record<string, string> {
  return {
    ...(facts.section ? { section: facts.section } : {}),
    stage: facts.stage,
    stageLabel: facts.stageLabel,
    protectedDays: String(facts.protectedDays),
    protectedAmount: String(facts.protectedAmount),
    reserveTarget: String(facts.reserveTarget),
    backupTarget: String(facts.backupTarget),
    safeUntilPayday: facts.safeUntilPayday === null ? "unknown" : String(facts.safeUntilPayday),
    nextPaycheckLabel: facts.nextPaycheckLabel ?? "",
    nextAction: facts.nextAction,
    nextMilestone: facts.nextMilestone,
    nextMilestoneAmount: String(facts.nextMilestoneAmount),
    lowestBalance: String(facts.lowestBalance),
    safetyFloor: String(facts.safetyFloor),
    confidence: facts.confidence,
    flowScore: String(facts.flowScore),
    flowScoreLabel: facts.flowScoreLabel,
  };
}

export const STABILITY_PATH_GUIDE: readonly StabilityPathGuideStep[] = [
  {
    id: "stabilize",
    title: "Protect the plan",
    range: "When a required bill still needs to clear or a forecast day can use more breathing room",
    description: "FlowLedger identifies the bill, spending, or timing change that can strengthen the plan.",
  },
  {
    id: "next_paycheck",
    title: "Confirm the next paycheck",
    range: "Before backup days are measured",
    description: "Flo first needs the next income date to check that Must Pay bills and the safety floor stay covered until payday.",
  },
  {
    id: "breathing_room",
    title: "Build a 7-day backup",
    range: "0-6 protected days",
    description: "The first backup goal can cover one week of Must Pay expenses if income is late or a surprise happens.",
  },
  {
    id: "reserve",
    title: "Build a 30-day backup",
    range: "7-29 protected days",
    description: "One month of Must Pay expenses gives the household room to handle a bigger surprise.",
  },
  {
    id: "momentum",
    title: "Build a 60-day backup",
    range: "30-59 protected days",
    description: "Two protected months create real distance from living paycheck to paycheck.",
  },
  {
    id: "freedom",
    title: "Build a 180-day backup",
    range: "60-179 protected days",
    description: "Reach 90 days, then keep building toward six protected months.",
  },
  {
    id: "standing",
    title: "Protect the freedom buffer",
    range: "180 protected days",
    description: "Keep the buffer full, and rebuild it after using it for a real need.",
  },
] as const;

export const ALGORITHM_GUIDE: readonly AlgorithmGuideItem[] = [
  { id: "forecast", title: "Daily Forecast", description: "Projects checking money day by day from posted activity, planned income, bills, and spending." },
  { id: "stability", title: "Stability Path", description: "Checks safety through payday, then turns backup money into 7, 30, 60, 90, and 180 days of Must Pay protection." },
  { id: "flow-score", title: "Flow Score", description: "Summarizes cushion, bill readiness, forecast risk, spending pressure, and data confidence." },
  { id: "breathing-room", title: "Breathing Room", description: "Shows money remaining above the safety floor at the tightest point in the forecast." },
  { id: "bill-priority", title: "Bill Priority", description: "Ranks required bills by due date, payment status, and their effect on the tightest cash-flow days." },
  { id: "spending-pace", title: "Spending Pace", description: "Estimates a safe daily and weekly pace only after bills and the safety floor remain protected." },
  { id: "next-dollar", title: "Next Dollar", description: "Suggests whether safe extra money should remain available or go toward bills, savings, or debt." },
  { id: "debt-payoff", title: "Debt Payoff", description: "Models minimum payments and snowball or avalanche progress without spending protected money." },
  { id: "risk-alerts", title: "Plan Opportunities", description: "Highlights dates where bill timing or a small adjustment can create more breathing room." },
] as const;

export const FLOWLEDGER_MONEY_RULES = [
  "Checking drives the spendable forecast. Savings stays separate.",
  "Pending bank activity is visible but is not counted until it posts.",
  "A posted bank transaction is counted once, even after it is matched to a planned item.",
  "Reconciliation updates the plan and calendar; it does not invent or remove real bank money.",
] as const;
