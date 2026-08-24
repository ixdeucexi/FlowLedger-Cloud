export interface NativeNotificationDestination { route: string; householdId: string | null }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function notificationRoute(value: unknown): string | null {
  const route = String(value || "");
  if (/^\/bills(?:\?attention=overdue)?$/.test(route) || route === "/transactions" || /^\/more\?section=(review|feedback)$/.test(route)) return route;
  return null;
}

export function notificationDestination(data: unknown): NativeNotificationDestination | null {
  if (!data || typeof data !== "object") return null;
  const candidate = data as { route?: unknown; householdId?: unknown };
  const route = notificationRoute(candidate.route);
  if (!route) return null;
  const householdId = candidate.householdId == null ? null : String(candidate.householdId);
  if (householdId !== null && !UUID_PATTERN.test(householdId)) return null;
  return { route, householdId };
}

export function notificationHouseholdAction(currentHouseholdId: string | null, membershipIds: string[], requestedHouseholdId: string | null): "current" | "switch" | "reject" {
  if (!requestedHouseholdId) return "current";
  if (!membershipIds.includes(requestedHouseholdId)) return "reject";
  return requestedHouseholdId === currentHouseholdId ? "current" : "switch";
}
