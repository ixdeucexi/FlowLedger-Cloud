import { Platform } from "react-native";

const LAST_APP_ROUTE_KEY = "flowledger_last_app_route";

const MAIN_APP_PREFIXES = [
  "/",
  "/bills",
  "/transactions",
  "/monthly",
  "/more",
  "/flo",
  "/category-budget",
] as const;

const BLOCKED_PREFIXES = [
  "/login",
  "/setup",
  "/plaid/oauth",
] as const;

function normalizeRoute(route: string | null | undefined) {
  if (!route) return null;
  const trimmed = route.trim();
  if (!trimmed.startsWith("/")) return null;

  const [withoutHash] = trimmed.split("#");
  const [pathOnly, query = ""] = withoutHash.split("?");
  if (BLOCKED_PREFIXES.some(prefix => pathOnly === prefix || pathOnly.startsWith(`${prefix}/`))) return null;
  if (!MAIN_APP_PREFIXES.some(prefix => pathOnly === prefix || pathOnly.startsWith(`${prefix}/`))) return null;

  if (pathOnly === "/more" && query.startsWith("section=")) return `${pathOnly}?${query}`;
  return pathOnly;
}

export function readLastAppRoute() {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  try {
    const route = normalizeRoute(window.localStorage.getItem(LAST_APP_ROUTE_KEY));
    return route === "/" ? "/(tabs)" : route;
  } catch {
    return null;
  }
}

export function rememberCurrentAppRoute() {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  const route = normalizeRoute(`${window.location.pathname}${window.location.search}`);
  if (!route) return;
  try {
    window.localStorage.setItem(LAST_APP_ROUTE_KEY, route);
  } catch {}
}

export function clearLastAppRoute() {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LAST_APP_ROUTE_KEY);
  } catch {}
}
