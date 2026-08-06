import {
  clearInterfacePreferencesForUser,
  readInterfacePreferences,
  updateInterfacePreferences,
} from "./interfacePreferences";

const MAIN_APP_ROUTES = new Set([
  "/",
  "/bills",
  "/transactions",
  "/monthly",
  "/more",
  "/flo",
  "/category-budget",
  "/accounts",
  "/zero-budget-lab",
  "/how-flowledger-works",
  "/reports",
  "/review",
]);

const SAFE_QUERY_KEYS: Record<string, Set<string>> = {
  "/more": new Set(["section"]),
  "/monthly": new Set(["month", "year", "date"]),
  "/transactions": new Set(["range", "start", "end", "account", "category", "type", "sort"]),
};

function safeParamValue(value: string) {
  return value.length <= 100 && /^[\w .:@,+-]*$/.test(value);
}

export function normalizeRestorableRoute(route: string | null | undefined) {
  if (!route) return null;
  const trimmed = route.trim();
  if (!trimmed.startsWith("/") || trimmed.length > 500) return null;

  const withoutHash = trimmed.split("#", 1)[0];
  const questionAt = withoutHash.indexOf("?");
  const pathOnly = questionAt >= 0 ? withoutHash.slice(0, questionAt) : withoutHash;
  const query = questionAt >= 0 ? withoutHash.slice(questionAt + 1) : "";
  const normalizedPath = pathOnly === "/(tabs)" || pathOnly === "/(tabs)/" ? "/" : pathOnly.replace("/(tabs)", "");
  if (!MAIN_APP_ROUTES.has(normalizedPath)) return null;

  const allowed = SAFE_QUERY_KEYS[normalizedPath];
  const safeQuery = new URLSearchParams();
  if (allowed && query) {
    const source = new URLSearchParams(query);
    for (const key of allowed) {
      const value = source.get(key);
      if (value && safeParamValue(value)) safeQuery.set(key, value);
    }
  }

  if (normalizedPath === "/more" && safeQuery.get("section") === "admin") {
    safeQuery.delete("section");
  }
  const destination = normalizedPath === "/" ? "/(tabs)" : normalizedPath;
  const serialized = safeQuery.toString();
  return serialized ? `${destination}?${serialized}` : destination;
}

export async function readLastAppRoute(userId: string, householdId: string) {
  const preferences = await readInterfacePreferences(userId, householdId);
  return normalizeRestorableRoute(preferences.lastRoute);
}

export async function rememberAppRoute(
  userId: string,
  householdId: string,
  route: string,
) {
  const safeRoute = normalizeRestorableRoute(route);
  if (!safeRoute) return;
  await updateInterfacePreferences(userId, householdId, { lastRoute: safeRoute });
}

export async function clearLastAppRoute(userId?: string) {
  if (!userId) return;
  await clearInterfacePreferencesForUser(userId);
}
