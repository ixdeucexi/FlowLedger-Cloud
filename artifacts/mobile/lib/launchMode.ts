/**
 * Public v1 launches as Founding Free. Set the explicit paid value only after
 * the store products, Plaid production access, and subscription support flow
 * have passed release validation.
 */
export const FOUNDING_FREE_LAUNCH = process.env.EXPO_PUBLIC_LAUNCH_MODE !== "paid";

export const FOUNDING_FREE_NAME = "Founding Free";
export const PRO_AVAILABILITY = "Pro is planned for 2027";

export function hasAdminProAccess(plan: { tier?: string; source?: string } | null | undefined) {
  return plan?.tier === "pro" && plan.source === "admin";
}

export function canPersistPlanSimulations(
  plan: { tier?: string; source?: string } | null | undefined,
  foundingFreeLaunch = FOUNDING_FREE_LAUNCH,
) {
  return hasAdminProAccess(plan) || (!foundingFreeLaunch && plan?.tier === "pro");
}
