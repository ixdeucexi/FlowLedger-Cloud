let currentNetworkStatus: boolean | null = typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
  ? navigator.onLine
  : null;

export class OfflineMutationError extends Error {
  readonly code = "OFFLINE_MUTATION_BLOCKED";

  constructor() {
    super("You’re offline. This change was not saved. Reconnect and try again.");
    this.name = "OfflineMutationError";
  }
}

export function reachableNetworkState(state: { isConnected: boolean | null; isInternetReachable: boolean | null }): boolean | null {
  if (state.isConnected === false || state.isInternetReachable === false) return false;
  if (state.isConnected !== true || state.isInternetReachable !== true) return null;
  return true;
}

export function publishNetworkStatus(status: boolean | null): void {
  currentNetworkStatus = status;
}

export function knownNetworkStatus(): boolean | null {
  return currentNetworkStatus;
}

export function isMutationRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = String(init?.method || (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return false;
  const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  return /(?:\/rest\/v1\/|\/functions\/v1\/|^\/api\/)/i.test(target);
}

export function assertMutationOnline(input: RequestInfo | URL, init?: RequestInit): void {
  if (isMutationRequest(input, init) && currentNetworkStatus !== true) throw new OfflineMutationError();
}

export function assertFinancialMutationOnline(): void {
  if (currentNetworkStatus !== true) throw new OfflineMutationError();
}

export function guardedMutationFetch(fetchImplementation: typeof fetch): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    assertMutationOnline(input, init);
    return fetchImplementation(input, init);
  }) as typeof fetch;
}
