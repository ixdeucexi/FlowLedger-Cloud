import type { StabilityProgress } from "./stability";

export const PAYDAY_REVIEW_PROMPT = "Review my next payday plan using my actual account data. Tell me the next expected paycheck date and amount, bills and debt minimums due before it, the tightest forecast point and its date, my protected safety cushion, and how much I can safely spend. Explain any missing data or risk and give me a practical next step.";
/** Dashboard review is a local message overlay, never an AI request or route. */
export function stabilityPlanAction(_progress: Pick<StabilityProgress, "reserveTarget" | "safeUntilPayday">): { label: string; mode: "payday" } {
  return { label: "Review my payday plan", mode: "payday" };
}
