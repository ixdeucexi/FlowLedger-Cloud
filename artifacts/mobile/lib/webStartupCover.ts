export const WEB_STARTUP_COVER_ID = "flowledger-web-startup-cover";
export const WEB_STARTUP_ROOT_ID = "root";
export const WEB_WORKSPACE_READY_EVENT = "flowledger:workspace-ready";
export const WEB_STARTUP_COVER_ARMED_EVENT = "flowledger:startup-cover-armed";

export type WebStartupCoverReason = "initial" | "resume" | "scope-change" | null;

export interface WebWorkspaceReadyDetail {
  scopeKey: string;
  ready: boolean;
  generation: number;
}

export interface WebStartupCoverArmedDetail {
  generation: number;
  reason: Exclude<WebStartupCoverReason, null>;
}

export interface WebWorkspaceRevealTransition {
  revealedScopeKey: string | null;
  currentScopeKey: string | null;
  readinessSatisfied: boolean;
}

export interface WebStartupReleaseState {
  visible: boolean;
  readyToReveal: boolean;
  terminalErrorReady: boolean;
  protectedRoute: boolean;
  workspaceRoute: boolean;
  currentScopeKey: string | null;
  verifiedScopeKey: string | null;
  workspaceReadyScopeKey: string | null;
  coverGeneration: number;
  workspaceReadyGeneration: number | null;
}

const PUBLIC_WEB_ROOT_SEGMENTS = new Set([
  "auth",
  "delete-account",
  "index",
  "login",
  "support",
]);

/**
 * Route protection must outlive the auth session for the render in which a
 * sign-out is redirecting. Otherwise the public release path can uncover the
 * still-mounted private screen before /login commits.
 */
export function webStartupRouteIsProtected(
  firstRootSegment: string | undefined,
): boolean {
  return Boolean(
    firstRootSegment
    && !PUBLIC_WEB_ROOT_SEGMENTS.has(firstRootSegment),
  );
}

let currentWorkspaceReadiness: {
  scopeKey: string;
  generation: number;
} | null = null;

export function currentWebWorkspaceReadyScopeKey(): string | null {
  return currentWorkspaceReadiness?.scopeKey ?? null;
}

export function currentWebWorkspaceReadyGeneration(): number | null {
  return currentWorkspaceReadiness?.generation ?? null;
}

/**
 * A revealed workspace is monotonic only for the same exact scope. Transient
 * cache/background refresh state cannot put a blocking layer back over an
 * interactive plan, while a real user/household change immediately becomes
 * unready until the replacement scope satisfies the barrier.
 */
export function nextWebWorkspaceRevealedScopeKey({
  revealedScopeKey,
  currentScopeKey,
  readinessSatisfied,
}: WebWorkspaceRevealTransition): string | null {
  if (!currentScopeKey) return null;
  if (revealedScopeKey === currentScopeKey) return revealedScopeKey;
  return readinessSatisfied ? currentScopeKey : null;
}

export function publishWebWorkspaceReadiness(
  scopeKey: string,
  ready: boolean,
  generation = currentWebStartupCoverGeneration(),
): void {
  if (typeof window === "undefined") return;
  if (ready) currentWorkspaceReadiness = { scopeKey, generation };
  else if (
    currentWorkspaceReadiness?.scopeKey === scopeKey
    && currentWorkspaceReadiness.generation === generation
  ) {
    currentWorkspaceReadiness = null;
  }
  window.dispatchEvent(new CustomEvent<WebWorkspaceReadyDetail>(
    WEB_WORKSPACE_READY_EVENT,
    { detail: { scopeKey, ready, generation } },
  ));
}

export function webStartupCoverReason(): WebStartupCoverReason {
  if (typeof document === "undefined") return null;
  const reason = document.getElementById(WEB_STARTUP_COVER_ID)?.dataset.reason;
  return reason === "initial" || reason === "resume" || reason === "scope-change"
    ? reason
    : null;
}

export function currentWebStartupCoverGeneration(): number {
  if (typeof document === "undefined") return 0;
  const raw = document.getElementById(WEB_STARTUP_COVER_ID)?.dataset.generation;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function startupCoverGenerationCanRelease(
  expectedGeneration: number | undefined,
  currentGeneration: number,
): boolean {
  return expectedGeneration === undefined || expectedGeneration === currentGeneration;
}

export function startupVerificationCanCommit(
  requestGeneration: number,
  currentGeneration: number,
  privacySurfaceActive: boolean,
): boolean {
  return requestGeneration === currentGeneration && privacySurfaceActive;
}

/** Re-arm the one document-owned web loader before a protected scope changes. */
export function armWebStartupCover(
  reason: Exclude<WebStartupCoverReason, "initial" | null>,
): number {
  if (typeof document === "undefined") return 0;
  const cover = document.getElementById(WEB_STARTUP_COVER_ID);
  const root = document.getElementById(WEB_STARTUP_ROOT_ID);
  if (!cover || !root) return currentWebStartupCoverGeneration();

  const generation = currentWebStartupCoverGeneration() + 1;
  cover.dataset.generation = String(generation);
  cover.dataset.state = "visible";
  cover.dataset.reason = reason;
  cover.removeAttribute("aria-hidden");
  root.setAttribute("inert", "");
  root.setAttribute("aria-hidden", "true");
  document.documentElement.removeAttribute("data-flowledger-ready");
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<WebStartupCoverArmedDetail>(
      WEB_STARTUP_COVER_ARMED_EVENT,
      { detail: { generation, reason } },
    ));
  }
  return generation;
}

export function shouldReleaseWebStartupCover({
  visible,
  readyToReveal,
  terminalErrorReady,
  protectedRoute,
  workspaceRoute,
  currentScopeKey,
  verifiedScopeKey,
  workspaceReadyScopeKey,
  coverGeneration,
  workspaceReadyGeneration,
}: WebStartupReleaseState): boolean {
  if (!visible || (!readyToReveal && !terminalErrorReady)) return false;
  if (!protectedRoute) return true;
  // A private route remains mounted briefly after sign-out. Do not reveal it
  // through either the normal or terminal-error path without a current user;
  // /login takes the public path only after that route actually commits.
  if (!currentScopeKey) return false;
  if (terminalErrorReady) return true;
  if (verifiedScopeKey !== currentScopeKey) return false;
  if (!workspaceRoute) return true;
  return Boolean(
    workspaceReadyScopeKey === currentScopeKey
    && workspaceReadyGeneration === coverGeneration,
  );
}

/**
 * Reveal the already-mounted application beneath the static web boot cover.
 * The cover itself is never removed so pagehide can synchronously re-arm it
 * before a PWA task snapshot or bfcache restore.
 */
export function releaseWebStartupCover(expectedGeneration?: number): boolean {
  if (typeof document === "undefined") return false;
  const cover = document.getElementById(WEB_STARTUP_COVER_ID);
  const root = document.getElementById(WEB_STARTUP_ROOT_ID);
  if (!cover || !root) return false;
  if (!startupCoverGenerationCanRelease(
    expectedGeneration,
    currentWebStartupCoverGeneration(),
  )) return false;

  root.removeAttribute("inert");
  root.removeAttribute("aria-hidden");
  cover.setAttribute("aria-hidden", "true");
  cover.dataset.state = "hidden";
  delete cover.dataset.reason;
  document.documentElement.dataset.flowledgerReady = "true";
  return true;
}
