export const WEB_STARTUP_COVER_ID = "flowledger-web-startup-cover";
export const WEB_STARTUP_ROOT_ID = "root";
export const WEB_WORKSPACE_READY_EVENT = "flowledger:workspace-ready";
export const WEB_STARTUP_COVER_ARMED_EVENT = "flowledger:startup-cover-armed";
export const WEB_STARTUP_COVER_RELEASED_EVENT = "flowledger:startup-cover-released";

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

export interface WebStartupCoverReleasedDetail {
  generation: number;
}

export interface WebWorkspaceRevealTransition {
  revealedScopeKey: string | null;
  currentScopeKey: string | null;
  readinessSatisfied: boolean;
}

export interface WebWorkspaceRevealToken {
  scopeKey: string;
  generation: number;
  contentKey: string;
}

export function nextWebWorkspaceRevealToken(input: {
  revealed: WebWorkspaceRevealToken | null;
  currentScopeKey: string | null;
  currentGeneration: number;
  currentContentKey: string;
  readinessSatisfied: boolean;
  coverArmed?: boolean;
}): WebWorkspaceRevealToken | null {
  if (!input.currentScopeKey) return null;
  const sameBarrier = input.revealed?.scopeKey === input.currentScopeKey
    && input.revealed.generation === input.currentGeneration;
  if (
    sameBarrier
    && (
      !input.coverArmed
      || input.revealed?.contentKey === input.currentContentKey
    )
  ) return input.revealed;
  return input.readinessSatisfied
    ? {
        scopeKey: input.currentScopeKey,
        generation: input.currentGeneration,
        contentKey: input.currentContentKey,
      }
    : null;
}

export function webWorkspaceRevealTokenIsReady(input: {
  revealed: WebWorkspaceRevealToken | null;
  currentScopeKey: string | null;
  currentGeneration: number;
  currentContentKey: string;
  coverArmed: boolean;
}): boolean {
  return Boolean(
    input.currentScopeKey
    && input.revealed?.scopeKey === input.currentScopeKey
    && input.revealed.generation === input.currentGeneration
    && (
      !input.coverArmed
      || input.revealed.contentKey === input.currentContentKey
    ),
  );
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

export function workspaceScopeTransitionNeedsCover(input: {
  previousScopeKey: string | null;
  currentScopeKey: string | null;
  workspaceRoute: boolean;
  coverAlreadyArmed: boolean;
}): boolean {
  return Boolean(
    input.workspaceRoute
    && !input.coverAlreadyArmed
    && input.previousScopeKey
    && input.currentScopeKey
    && input.previousScopeKey !== input.currentScopeKey,
  );
}

let currentWorkspaceReadiness: {
  scopeKey: string;
  generation: number;
} | null = null;

let pendingReleaseGeneration: number | null = null;

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

export function webStartupCoverIsReleased(
  expectedGeneration = currentWebStartupCoverGeneration(),
): boolean {
  if (typeof document === "undefined") return true;
  const cover = document.getElementById(WEB_STARTUP_COVER_ID);
  const root = document.getElementById(WEB_STARTUP_ROOT_ID);
  if (!cover || !root) return true;
  return Boolean(
    currentWebStartupCoverGeneration() === expectedGeneration
    && cover.hidden
    && cover.dataset.state === "hidden"
    && !cover.dataset.reason
    && !root.hasAttribute("inert")
    && !root.hasAttribute("aria-hidden"),
  );
}

/**
 * Queue nonessential web work only after the cover's hidden state has painted.
 * Release-event listeners never execute application work synchronously: the
 * next animation frame and then an idle turn separate it from the atomic
 * hide/unlock callback. A resume/scope re-arm sends the work back to the gate.
 */
export function scheduleWebStartupBackgroundWork(
  work: () => void,
  delayMs = 0,
  expectedGeneration = currentWebStartupCoverGeneration(),
): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    const timer = setTimeout(work, Math.max(0, delayMs));
    return () => clearTimeout(timer);
  }

  type IdleWindow = Window & {
    requestIdleCallback?: (
      callback: () => void,
      options?: { timeout?: number },
    ) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  const browserWindow = window as IdleWindow;
  let targetGeneration = expectedGeneration;
  let cancelled = false;
  let listening = false;
  let frameHandle: number | null = null;
  let timerHandle: ReturnType<typeof setTimeout> | null = null;
  let idleHandle: number | null = null;

  const removeReleaseListener = () => {
    if (!listening) return;
    listening = false;
    window.removeEventListener(WEB_STARTUP_COVER_RELEASED_EVENT, handleRelease);
  };
  const cancelScheduled = () => {
    if (frameHandle !== null) window.cancelAnimationFrame(frameHandle);
    if (timerHandle !== null) clearTimeout(timerHandle);
    if (idleHandle !== null) browserWindow.cancelIdleCallback?.(idleHandle);
    frameHandle = null;
    timerHandle = null;
    idleHandle = null;
  };
  const awaitRelease = () => {
    if (cancelled) return;
    const currentGeneration = currentWebStartupCoverGeneration();
    if (currentGeneration !== targetGeneration) targetGeneration = currentGeneration;
    if (!webStartupCoverIsReleased(targetGeneration)) {
      if (!listening) {
        listening = true;
        window.addEventListener(WEB_STARTUP_COVER_RELEASED_EVENT, handleRelease);
      }
      return;
    }
    removeReleaseListener();
    frameHandle = window.requestAnimationFrame(() => {
      frameHandle = null;
      timerHandle = setTimeout(() => {
        timerHandle = null;
        if (cancelled) return;
        if (!webStartupCoverIsReleased(targetGeneration)) {
          awaitRelease();
          return;
        }
        const run = () => {
          idleHandle = null;
          if (cancelled) return;
          if (!webStartupCoverIsReleased(targetGeneration)) {
            awaitRelease();
            return;
          }
          work();
        };
        if (typeof browserWindow.requestIdleCallback === "function") {
          idleHandle = browserWindow.requestIdleCallback(run, { timeout: 5_000 });
        } else {
          // WebKit does not consistently expose requestIdleCallback. Yield a
          // separate task and keep giving pending input priority when the
          // Scheduling API is available.
          const runFallback = () => {
            timerHandle = null;
            const scheduling = typeof navigator !== "undefined"
              ? (navigator as Navigator & {
                  scheduling?: { isInputPending?: () => boolean };
                }).scheduling
              : undefined;
            if (scheduling?.isInputPending?.()) {
              frameHandle = window.requestAnimationFrame(() => {
                frameHandle = null;
                timerHandle = setTimeout(runFallback, 0);
              });
              return;
            }
            run();
          };
          timerHandle = setTimeout(runFallback, 0);
        }
      }, Math.max(0, delayMs));
    });
  };
  const handleRelease = () => {
    removeReleaseListener();
    awaitRelease();
  };

  awaitRelease();
  return () => {
    cancelled = true;
    removeReleaseListener();
    cancelScheduled();
  };
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
  pendingReleaseGeneration = null;
  root.setAttribute("inert", "");
  root.setAttribute("aria-hidden", "true");
  cover.hidden = false;
  cover.dataset.generation = String(generation);
  cover.dataset.state = "visible";
  cover.dataset.reason = reason;
  cover.removeAttribute("aria-hidden");
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
  const generation = currentWebStartupCoverGeneration();
  if (!startupCoverGenerationCanRelease(expectedGeneration, generation)) return false;
  if (cover.hidden && cover.dataset.state === "hidden") return true;
  if (pendingReleaseGeneration === generation) return true;

  pendingReleaseGeneration = generation;
  const commitRelease = () => {
    if (pendingReleaseGeneration === generation) pendingReleaseGeneration = null;
    if (
      typeof document === "undefined"
      || document.visibilityState !== "visible"
      || !startupCoverGenerationCanRelease(
        generation,
        currentWebStartupCoverGeneration(),
      )
    ) return;
    const currentCover = document.getElementById(WEB_STARTUP_COVER_ID);
    const currentRoot = document.getElementById(WEB_STARTUP_ROOT_ID);
    if (!currentCover || !currentRoot) return;

    // Detach the opaque compositor layer before making the workspace
    // interactive. A CSS opacity transition can leave old loader pixels on
    // screen while pointer events already reach the app on a busy PWA frame.
    currentCover.setAttribute("aria-hidden", "true");
    currentCover.dataset.state = "hidden";
    currentCover.hidden = true;
    delete currentCover.dataset.reason;
    currentRoot.removeAttribute("inert");
    currentRoot.removeAttribute("aria-hidden");
    document.documentElement.dataset.flowledgerReady = "true";
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent<WebStartupCoverReleasedDetail>(
        WEB_STARTUP_COVER_RELEASED_EVENT,
        { detail: { generation } },
      ));
    }
  };

  // Keep the fully opaque, blocking cover through the readiness commit. The
  // next paint atomically contains the detached cover and interactive root.
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(commitRelease);
  } else {
    commitRelease();
  }
  return true;
}
