import { Platform } from "react-native";

export const PLAID_LAUNCH_PENDING_KEY = "flowledger_plaid_launch_pending";

let memoryPlaidLaunchPending = false;

function canUseBrowserStorage() {
  return Platform.OS === "web" && typeof window !== "undefined";
}

function sanitizeLogDetails(details?: Record<string, unknown>) {
  if (!details) return {};
  return Object.fromEntries(
    Object.entries(details).filter(([, value]) =>
      value === null ||
      ["string", "number", "boolean"].includes(typeof value)
    )
  );
}

export function setPlaidLaunchPending(value = true) {
  memoryPlaidLaunchPending = value;
  if (!canUseBrowserStorage()) return;
  try {
    if (value) {
      window.sessionStorage.setItem(PLAID_LAUNCH_PENDING_KEY, "true");
    } else {
      window.sessionStorage.removeItem(PLAID_LAUNCH_PENDING_KEY);
    }
  } catch {}
}

export function clearPlaidLaunchPending() {
  setPlaidLaunchPending(false);
}

export function isPlaidLaunchPending() {
  if (memoryPlaidLaunchPending) return true;
  if (!canUseBrowserStorage()) return false;
  try {
    return window.sessionStorage.getItem(PLAID_LAUNCH_PENDING_KEY) === "true";
  } catch {
    return false;
  }
}

export function logPlaidClientStage(stage: string, details?: Record<string, unknown>) {
  if (Platform.OS !== "web" || typeof console === "undefined") return;
  console.info("[plaid-client]", {
    stage,
    ...sanitizeLogDetails(details),
  });
}

export function logRouteReplaceAttempt(destinationPathname: string, reason: string) {
  let currentPathname = "";
  if (canUseBrowserStorage()) {
    try {
      currentPathname = `${window.location.pathname}${window.location.search}`;
    } catch {}
  }
  logPlaidClientStage("ROUTE_REPLACE_ATTEMPTED", {
    currentPathname,
    destinationPathname,
    reason,
    plaidLaunchPending: isPlaidLaunchPending(),
  });
}

export function ensurePlaidBankSyncUrl() {
  if (!canUseBrowserStorage()) return;
  try {
    const alreadyOnPlaidSection =
      window.location.pathname === "/more" &&
      new URLSearchParams(window.location.search).get("section") === "plaid";
    if (alreadyOnPlaidSection) return;
    logRouteReplaceAttempt("/more?section=plaid", "plaid_bank_sync_url_guard");
    window.history.replaceState(window.history.state, "", "/more?section=plaid");
  } catch {}
}
