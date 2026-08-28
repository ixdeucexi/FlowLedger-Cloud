export const WEB_STARTUP_COVER_ID = "flowledger-web-startup-cover";
export const WEB_STARTUP_ROOT_ID = "root";
export const WEB_WORKSPACE_READY_EVENT = "flowledger:workspace-ready";

export type WebStartupCoverReason = "initial" | "resume" | null;

export interface WebWorkspaceReadyDetail {
  scopeKey: string;
  ready: boolean;
}

export interface WebStartupReleaseState {
  visible: boolean;
  readyToReveal: boolean;
  terminalErrorReady: boolean;
  workspaceRoute: boolean;
  currentScopeKey: string | null;
  verifiedScopeKey: string | null;
  workspaceReadyScopeKey: string | null;
}

let currentWorkspaceReadyScopeKey: string | null = null;

export function currentWebWorkspaceReadyScopeKey(): string | null {
  return currentWorkspaceReadyScopeKey;
}

export function publishWebWorkspaceReadiness(
  scopeKey: string,
  ready: boolean,
): void {
  if (typeof window === "undefined") return;
  if (ready) currentWorkspaceReadyScopeKey = scopeKey;
  else if (currentWorkspaceReadyScopeKey === scopeKey) {
    currentWorkspaceReadyScopeKey = null;
  }
  window.dispatchEvent(new CustomEvent<WebWorkspaceReadyDetail>(
    WEB_WORKSPACE_READY_EVENT,
    { detail: { scopeKey, ready } },
  ));
}

export function webStartupCoverReason(): WebStartupCoverReason {
  if (typeof document === "undefined") return null;
  const reason = document.getElementById(WEB_STARTUP_COVER_ID)?.dataset.reason;
  return reason === "initial" || reason === "resume" ? reason : null;
}

export function shouldReleaseWebStartupCover({
  visible,
  readyToReveal,
  terminalErrorReady,
  workspaceRoute,
  currentScopeKey,
  verifiedScopeKey,
  workspaceReadyScopeKey,
}: WebStartupReleaseState): boolean {
  if (!visible || (!readyToReveal && !terminalErrorReady)) return false;
  if (terminalErrorReady || !workspaceRoute) return true;
  return Boolean(
    currentScopeKey
    && verifiedScopeKey === currentScopeKey
    && workspaceReadyScopeKey === currentScopeKey,
  );
}

/**
 * Reveal the already-mounted application beneath the static web boot cover.
 * The cover itself is never removed so pagehide can synchronously re-arm it
 * before a PWA task snapshot or bfcache restore.
 */
export function releaseWebStartupCover(): void {
  if (typeof document === "undefined") return;
  const cover = document.getElementById(WEB_STARTUP_COVER_ID);
  const root = document.getElementById(WEB_STARTUP_ROOT_ID);
  if (!cover || !root) return;

  root.removeAttribute("inert");
  root.removeAttribute("aria-hidden");
  cover.setAttribute("aria-hidden", "true");
  cover.dataset.state = "hidden";
  delete cover.dataset.reason;
  document.documentElement.dataset.flowledgerReady = "true";
}
