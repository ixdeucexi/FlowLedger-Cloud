import type { StabilityProgress } from "./stability";

export const PAYDAY_REVIEW_PROMPT = "Review my next payday plan using my actual account data. Tell me the next expected paycheck date and amount, bills and debt minimums due before it, the tightest forecast point and its date, my protected safety cushion, and how much I can safely spend. Explain any missing data or risk and give me a practical next step.";
let invocation = 0;

/** Routes existing forecast guidance to a next step; never calculates spending capacity. */
export function stabilityPlanAction(progress: Pick<StabilityProgress, "reserveTarget" | "safeUntilPayday">): { label: string; pathname: string; params: Record<string, string> } {
  if (progress.reserveTarget <= 0) {
    return { label: "Review required bills", pathname: "/(tabs)/bills", params: { view: "bills" } };
  }
  if (progress.safeUntilPayday === null) {
    return { label: "Confirm next paycheck", pathname: "/(tabs)/more", params: { section: "money" } };
  }
  return { label: "Review my payday plan", pathname: "/(tabs)/flo", params: { prompt: PAYDAY_REVIEW_PROMPT, promptId: `payday-review-${Date.now()}-${++invocation}` } };
}
