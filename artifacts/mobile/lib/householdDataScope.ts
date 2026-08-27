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
