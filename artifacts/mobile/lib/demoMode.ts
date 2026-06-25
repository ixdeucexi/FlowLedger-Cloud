export function isDevDemoMode(hostname = globalThis.location?.hostname ?? ""): boolean {
  return hostname.includes("flow-ledger-cloud-git-dev-") || hostname === "localhost" || hostname === "127.0.0.1";
}

export const DEV_DEMO_USER_ID = "dev-demo-user";
