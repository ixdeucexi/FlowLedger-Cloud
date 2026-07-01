const DEV_DEMO_AUTH_KEY = "@flowledger_dev_demo_auth";
const REAL_AUTH_VALUE = "real";
const DEMO_AUTH_VALUE = "demo";

function readDemoAuthPreference(): string | null {
  try {
    return globalThis.localStorage?.getItem(DEV_DEMO_AUTH_KEY) ?? null;
  } catch {
    return null;
  }
}

export function disableDevDemoMode() {
  try {
    globalThis.localStorage?.setItem(DEV_DEMO_AUTH_KEY, REAL_AUTH_VALUE);
  } catch {
    // Ignore storage failures. The in-memory auth state still clears.
  }
}

export function enableDevDemoMode() {
  try {
    globalThis.localStorage?.setItem(DEV_DEMO_AUTH_KEY, DEMO_AUTH_VALUE);
  } catch {
    // Ignore storage failures. The in-memory auth state still enables.
  }
}

export function isDevDemoMode(hostname = globalThis.location?.hostname ?? "", authPreference = readDemoAuthPreference()): boolean {
  return false;
}

export const DEV_DEMO_USER_ID = "dev-demo-user";
