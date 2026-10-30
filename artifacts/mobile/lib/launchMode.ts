/** Bank connectivity stays on its existing reviewed release gate. */
export const FOUNDING_FREE_LAUNCH =
  process.env.EXPO_PUBLIC_LAUNCH_MODE !== "paid";
/** Feature eligibility is server-resolved; this flag never unlocks a tier. */
export const STORE_CHECKOUT_ENABLED =
  process.env.EXPO_PUBLIC_BILLING_CHECKOUT_ENABLED === "true";
export const FOUNDING_FREE_NAME = "Founding Free";
export const PRO_AVAILABILITY = "Pro subscriptions are not open yet";

export function hasAdminProAccess(
  plan: { tier?: string; source?: string } | null | undefined,
) {
  return plan?.tier === "pro" && plan.source === "admin";
}

/** Kept for older callers. The workspace now uses server capability flags. */
export function canPersistPlanSimulations(
  plan: { tier?: string; source?: string } | null | undefined,
  _foundingFreeLaunch = FOUNDING_FREE_LAUNCH,
) {
  return plan?.tier === "pro";
}
