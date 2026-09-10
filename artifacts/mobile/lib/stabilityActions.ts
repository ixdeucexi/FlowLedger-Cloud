import type { StabilityProgress } from "./stability";

/** Routes existing forecast guidance to a next step; never calculates spending capacity. */
export function stabilityPlanAction(progress: Pick<StabilityProgress, "reserveTarget" | "safeUntilPayday">) {
  if (progress.reserveTarget <= 0) {
    return { label: "Review required bills", pathname: "/(tabs)/bills", params: { view: "bills" } };
  }
  if (progress.safeUntilPayday === null) {
    return { label: "Confirm next paycheck", pathname: "/(tabs)/more", params: { section: "money" } };
  }
  return { label: "Review my payday plan", pathname: "/(tabs)/monthly", params: undefined };
}
