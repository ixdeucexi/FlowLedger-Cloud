import {
  parseHouseholdFeatureAccess,
  type HouseholdFeatureAccess,
  type PlanTier,
} from "./membership";

export interface FeatureAccessScope {
  userId: string;
  householdId: string;
  previewTier: PlanTier | null;
}
export interface FeatureAccessClient {
  auth: {
    getSession(): Promise<{
      data: { session: { user: { id: string }; access_token: string } | null };
      error?: unknown;
    }>;
  };
  rpc(
    name: string,
    params: Record<string, unknown>,
    options: { headers: Record<string, string> },
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}
/** A verified token is bound to this request, never written to global headers. */
export async function requestHouseholdFeatureAccess(
  client: FeatureAccessClient,
  scope: FeatureAccessScope,
  isCurrent: () => boolean,
): Promise<HouseholdFeatureAccess | null> {
  const { data, error } = await client.auth.getSession();
  if (!isCurrent()) return null;
  const session = data.session;
  if (error || !session?.access_token || session.user.id !== scope.userId) {
    throw new Error(
      "Your signed-in account changed. Sign in again to verify your household plan.",
    );
  }
  const result = await client.rpc(
    "get_household_feature_access",
    {
      p_expected_household_id: scope.householdId,
      p_preview_tier: scope.previewTier,
    },
    { headers: { Authorization: `Bearer ${session.access_token}` } },
  );
  if (!isCurrent()) return null;
  if (result.error)
    throw new Error(
      result.error.message ||
        "Household access is temporarily unavailable. Try again.",
    );
  return parseHouseholdFeatureAccess(result.data, scope.householdId);
}
