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
  if (normalizedPath === "/how-flowledger-works") return "/(tabs)";
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

/**
 * A new JS runtime starts empty. Backgrounding an existing app keeps its memory;
 * closing/reloading it does not restore a page from durable preferences.
 */
export function createAppRouteMemory() {
  const users = new Map<string, Map<string, string>>();
  return {
    read(userId: string, householdId: string): string | null {
      return users.get(userId)?.get(householdId) ?? null;
    },
    remember(userId: string, householdId: string, route: string) {
      const safeRoute = normalizeRestorableRoute(route);
      if (!userId || !householdId || !safeRoute) return;
      let households = users.get(userId);
      if (!households) {
        households = new Map();
        users.set(userId, households);
      }
      households.set(householdId, safeRoute);
    },
    clear(userId?: string) {
      if (userId) users.delete(userId);
    },
  };
}

const runtimeRoutes = createAppRouteMemory();
export const readLastAppRoute = runtimeRoutes.read;
export const rememberAppRoute = runtimeRoutes.remember;
export const clearLastAppRoute = runtimeRoutes.clear;

/** Resolve only at an eligible entry screen, after scoped privacy/core readiness. */
export function resolveAppEntryRoute({
  applyReady,
  expectedScopeKey,
  currentScopeKey,
  eligibleEntry,
  readRoute,
}: {
  applyReady: boolean;
  expectedScopeKey: string;
  currentScopeKey: string | null;
  eligibleEntry: boolean;
  readRoute: () => string | null;
}): string | null {
  if (!applyReady || !eligibleEntry || !expectedScopeKey || currentScopeKey !== expectedScopeKey) return null;
  return normalizeRestorableRoute(readRoute()) ?? "/(tabs)";
}
