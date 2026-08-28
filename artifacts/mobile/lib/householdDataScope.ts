export type HouseholdDataScope = {
  householdId: string | null;
  isPersonal: boolean;
  role?: "owner" | "manager" | "editor" | "viewer" | null;
};

/**
 * Legacy rows without a household id belong only to the owner of the original
 * personal plan. A household may retain its database `is_personal` flag after
 * another person joins, so that flag alone is not an authorization decision.
 */
export function ownsLegacyPersonalRows(scope: HouseholdDataScope | null | undefined) {
  return scope?.isPersonal === true && scope.role === "owner";
}

/**
 * Decide against the scope that is committed when an asynchronous household
 * discovery finishes. A cache may commit the same household while discovery
 * is in flight, so comparing with a pre-request snapshot creates a false
 * transition and clears the plan that is already ready to reveal.
 */
export function householdResolutionChangesCommittedScope(
  committedHouseholdId: string | null,
  resolvedHouseholdId: string | null,
): boolean {
  return committedHouseholdId !== resolvedHouseholdId;
}
