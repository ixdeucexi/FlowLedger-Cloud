export type BillingIdentityAction = "configure" | "reuse" | "login";

const SUPABASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireSupabaseBillingUserId(value: string): string {
  const userId = value.trim();
  if (!SUPABASE_UUID.test(userId)) {
    throw new Error("A valid signed-in account is required for store purchases.");
  }
  return userId;
}

export function billingIdentityAction(configured: boolean, currentAppUserId: string | null, nextUserId: string): BillingIdentityAction {
  requireSupabaseBillingUserId(nextUserId);
  if (!configured) return "configure";
  return currentAppUserId === nextUserId ? "reuse" : "login";
}
