export type HouseholdRole = "owner" | "manager" | "editor" | "viewer";
export type HouseholdInviteRole = Exclude<HouseholdRole, "owner">;

export const HOUSEHOLD_ROLE_LABELS: Record<HouseholdRole, string> = {
  owner: "Owner",
  manager: "Manager",
  editor: "Can edit",
  viewer: "View only",
};

const ROLE_ORDER: Record<HouseholdRole, number> = {
  owner: 0,
  manager: 1,
  editor: 2,
  viewer: 3,
};

export function normalizeHouseholdRole(role: unknown): HouseholdRole {
  return role === "owner" || role === "manager" || role === "editor" || role === "viewer"
    ? role
    : "viewer";
}

export function householdRoleLabel(role?: HouseholdRole | null): string {
  return role ? HOUSEHOLD_ROLE_LABELS[role] : "Private";
}

export function canEditHouseholdPlan(role?: HouseholdRole | null): boolean {
  return !role || role === "owner" || role === "manager" || role === "editor";
}

export function canManageHouseholdMembers(role?: HouseholdRole | null): boolean {
  return role === "owner" || role === "manager";
}

export function householdInviteRolesFor(actorRole?: HouseholdRole | null): HouseholdInviteRole[] {
  if (actorRole === "owner") return ["manager", "editor", "viewer"];
  if (actorRole === "manager") return ["editor", "viewer"];
  return [];
}

export function householdAssignableRolesFor(
  actorRole: HouseholdRole | null | undefined,
  targetRole: HouseholdRole,
  isCurrentUser = false,
): HouseholdInviteRole[] {
  if (isCurrentUser || targetRole === "owner") return [];
  if (actorRole === "owner") return ["manager", "editor", "viewer"].filter(role => role !== targetRole) as HouseholdInviteRole[];
  if (actorRole === "manager" && (targetRole === "editor" || targetRole === "viewer")) {
    return ["editor", "viewer"].filter(role => role !== targetRole) as HouseholdInviteRole[];
  }
  return [];
}

export function sortHouseholdRoles(a: HouseholdRole, b: HouseholdRole): number {
  return ROLE_ORDER[a] - ROLE_ORDER[b];
}
