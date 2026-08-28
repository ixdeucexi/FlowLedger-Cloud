import assert from "node:assert/strict";
import test from "node:test";

import {
  releaseWebStartupCover,
  scheduleWebStartupBackgroundWork,
  WEB_STARTUP_COVER_RELEASED_EVENT,
  nextWebWorkspaceRevealedScopeKey,
  nextWebWorkspaceRevealToken,
  shouldReleaseWebStartupCover,
  startupCoverGenerationCanRelease,
  startupVerificationCanCommit,
  webStartupRouteIsProtected,
  webWorkspaceRevealTokenIsReady,
  workspaceScopeTransitionNeedsCover,
} from "./webStartupCover";

function fakeElement(attributes: Record<string, string> = {}) {
  const stored = new Map(Object.entries(attributes));
  return {
    dataset: {} as Record<string, string>,
    hidden: false,
    getAttribute: (name: string) => stored.get(name) ?? null,
    hasAttribute: (name: string) => stored.has(name),
    removeAttribute: (name: string) => { stored.delete(name); },
    setAttribute: (name: string, value: string) => { stored.set(name, value); },
  };
}

const exactWorkspace = {
  visible: true,
  readyToReveal: true,
  terminalErrorReady: false,
  protectedRoute: true,
  workspaceRoute: true,
  currentScopeKey: "user-a:household-a",
  verifiedScopeKey: "user-a:household-a",
  workspaceReadyScopeKey: "user-a:household-a",
  coverGeneration: 4,
  workspaceReadyGeneration: 4,
};

test("the web cover releases only for the exact ready workspace scope", () => {
  assert.equal(shouldReleaseWebStartupCover(exactWorkspace), true);
  assert.equal(shouldReleaseWebStartupCover({
    ...exactWorkspace,
    workspaceReadyScopeKey: "user-a:household-b",
  }), false);
  assert.equal(shouldReleaseWebStartupCover({
    ...exactWorkspace,
    verifiedScopeKey: null,
  }), false);
  assert.equal(shouldReleaseWebStartupCover({
    ...exactWorkspace,
    visible: false,
  }), false);
  assert.equal(shouldReleaseWebStartupCover({
    ...exactWorkspace,
    coverGeneration: 5,
  }), false);
});

test("public and mounted terminal routes can reveal without a workspace token", () => {
  assert.equal(shouldReleaseWebStartupCover({
    ...exactWorkspace,
    protectedRoute: false,
    workspaceRoute: false,
    currentScopeKey: null,
    verifiedScopeKey: null,
    workspaceReadyScopeKey: null,
  }), true);
  assert.equal(shouldReleaseWebStartupCover({
    ...exactWorkspace,
    readyToReveal: false,
    terminalErrorReady: true,
    workspaceReadyScopeKey: null,
  }), true);
  assert.equal(shouldReleaseWebStartupCover({
    ...exactWorkspace,
    readyToReveal: false,
    terminalErrorReady: false,
  }), false);
});

test("sign-out cannot reveal an old private route before login commits", () => {
  for (const segment of [
    "(tabs)",
    "plan-simulator",
    "planned-debt-payment",
    "setup",
    "snowball-plan",
    "user-guide",
  ]) {
    assert.equal(webStartupRouteIsProtected(segment), true, segment);
  }
  for (const segment of [undefined, "index", "login", "auth", "support", "delete-account"]) {
    assert.equal(webStartupRouteIsProtected(segment), false, segment);
  }

  const signedOutPrivateRoute = {
    ...exactWorkspace,
    currentScopeKey: null,
    verifiedScopeKey: null,
    workspaceReadyScopeKey: null,
    workspaceReadyGeneration: null,
  };
  // The old tabs route and an old pushed private route both remain covered.
  assert.equal(shouldReleaseWebStartupCover(signedOutPrivateRoute), false);
  assert.equal(shouldReleaseWebStartupCover({
    ...signedOutPrivateRoute,
    workspaceRoute: false,
  }), false);
  assert.equal(shouldReleaseWebStartupCover({
    ...signedOutPrivateRoute,
    terminalErrorReady: true,
  }), false);

  // Login/support can reveal only once the public route itself has committed.
  assert.equal(shouldReleaseWebStartupCover({
    ...signedOutPrivateRoute,
    protectedRoute: false,
    workspaceRoute: false,
  }), true);
});

test("same-scope workspace readiness is monotonic after reveal", () => {
  assert.equal(nextWebWorkspaceRevealedScopeKey({
    revealedScopeKey: "user-a:household-a",
    currentScopeKey: "user-a:household-a",
    readinessSatisfied: false,
  }), "user-a:household-a");
  assert.equal(nextWebWorkspaceRevealedScopeKey({
    revealedScopeKey: "user-a:household-a",
    currentScopeKey: "user-a:household-b",
    readinessSatisfied: false,
  }), null);
  assert.equal(nextWebWorkspaceRevealedScopeKey({
    revealedScopeKey: "user-a:household-a",
    currentScopeKey: "user-a:household-b",
    readinessSatisfied: true,
  }), "user-a:household-b");
  assert.equal(nextWebWorkspaceRevealedScopeKey({
    revealedScopeKey: "user-a:household-a",
    currentScopeKey: null,
    readinessSatisfied: true,
  }), null);
});

test("a resume arm invalidates stale release and verification generations", () => {
  assert.equal(startupCoverGenerationCanRelease(7, 8), false);
  assert.equal(startupCoverGenerationCanRelease(8, 8), true);
  assert.equal(startupVerificationCanCommit(7, 8, true), false);
  assert.equal(startupVerificationCanCommit(8, 8, false), false);
  assert.equal(startupVerificationCanCommit(8, 8, true), true);
});

test("the document cover detaches before the root becomes interactive", () => {
  const priorDocument = (globalThis as any).document;
  const priorWindow = (globalThis as any).window;
  const priorCustomEvent = (globalThis as any).CustomEvent;
  const cover = fakeElement();
  cover.dataset = { generation: "4", reason: "initial", state: "visible" };
  const root = fakeElement({ inert: "", "aria-hidden": "true" });
  const documentElement = { dataset: {} as Record<string, string> };
  const frames: Array<() => void> = [];
  const events: Array<{ type: string; detail: unknown }> = [];

  try {
    (globalThis as any).CustomEvent = class {
      constructor(public type: string, public init: { detail: unknown }) {}
      get detail() { return this.init.detail; }
    };
    (globalThis as any).document = {
      visibilityState: "visible",
      documentElement,
      getElementById: (id: string) => id === "flowledger-web-startup-cover"
        ? cover
        : id === "root" ? root : null,
    };
    (globalThis as any).window = {
      dispatchEvent: (event: { type: string; detail: unknown }) => {
        events.push(event);
      },
      requestAnimationFrame: (work: () => void) => {
        frames.push(work);
        return frames.length;
      },
    };

    assert.equal(releaseWebStartupCover(4), true);
    assert.equal(releaseWebStartupCover(4), true);
    assert.equal(frames.length, 1, "duplicate release requests share one paint frame");
    assert.equal(cover.hidden, false, "the blocking cover stays up until the paint frame");
    assert.equal(root.hasAttribute("inert"), true);
    assert.equal(events.length, 0);

    frames.shift()?.();
    assert.equal(cover.hidden, true, "the compositor layer is detached");
    assert.equal(cover.dataset.state, "hidden");
    assert.equal(root.hasAttribute("inert"), false, "unlock follows detachment");
    assert.equal(root.hasAttribute("aria-hidden"), false);
    assert.equal(documentElement.dataset.flowledgerReady, "true");
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, WEB_STARTUP_COVER_RELEASED_EVENT);
    assert.deepEqual(events[0]?.detail, { generation: 4 });
  } finally {
    (globalThis as any).document = priorDocument;
    (globalThis as any).window = priorWindow;
    (globalThis as any).CustomEvent = priorCustomEvent;
  }
});

test("background work begins only after a released frame and retargets on re-arm", async () => {
  const priorDocument = (globalThis as any).document;
  const priorWindow = (globalThis as any).window;
  const priorCustomEvent = (globalThis as any).CustomEvent;
  const cover = fakeElement();
  cover.dataset = { generation: "12", reason: "initial", state: "visible" };
  const root = fakeElement({ inert: "", "aria-hidden": "true" });
  const frames: Array<() => void> = [];
  const idleWork: Array<() => void> = [];
  const listeners = new Map<string, Set<(event: any) => void>>();
  let workCalls = 0;

  try {
    (globalThis as any).CustomEvent = class {
      constructor(public type: string, public init: { detail: unknown }) {}
      get detail() { return this.init.detail; }
    };
    (globalThis as any).document = {
      visibilityState: "visible",
      documentElement: { dataset: {} },
      getElementById: (id: string) => id === "flowledger-web-startup-cover"
        ? cover
        : id === "root" ? root : null,
    };
    (globalThis as any).window = {
      addEventListener: (type: string, listener: (event: any) => void) => {
        const group = listeners.get(type) ?? new Set();
        group.add(listener);
        listeners.set(type, group);
      },
      removeEventListener: (type: string, listener: (event: any) => void) => {
        listeners.get(type)?.delete(listener);
      },
      dispatchEvent: (event: { type: string }) => {
        listeners.get(event.type)?.forEach(listener => listener(event));
      },
      requestAnimationFrame: (work: () => void) => {
        frames.push(work);
        return frames.length;
      },
      cancelAnimationFrame: () => undefined,
      requestIdleCallback: (work: () => void) => {
        idleWork.push(work);
        return idleWork.length;
      },
      cancelIdleCallback: () => undefined,
    };

    const cancel = scheduleWebStartupBackgroundWork(() => { workCalls += 1; }, 0, 12);
    assert.equal(frames.length, 0, "an armed cover keeps background work unscheduled");
    assert.equal(releaseWebStartupCover(12), true);
    frames.shift()?.();
    assert.equal(workCalls, 0, "the synchronous release event never runs app work");
    assert.equal(frames.length, 1, "work is separated from release by another frame");
    frames.shift()?.();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(workCalls, 0, "the post-paint task waits for browser idle time");
    assert.equal(idleWork.length, 1);
    idleWork.shift()?.();
    assert.equal(workCalls, 1);
    cancel();

    scheduleWebStartupBackgroundWork(() => { workCalls += 1; }, 0, 12);
    assert.equal(frames.length, 1);
    cover.hidden = false;
    cover.dataset = { generation: "13", reason: "resume", state: "visible" };
    root.setAttribute("inert", "");
    root.setAttribute("aria-hidden", "true");
    frames.shift()?.();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(workCalls, 1, "work cannot run while a newer generation is armed");

    assert.equal(releaseWebStartupCover(13), true);
    frames.shift()?.();
    assert.equal(workCalls, 1, "the newer release event only schedules later work");
    frames.shift()?.();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(idleWork.length, 1);
    idleWork.shift()?.();
    assert.equal(workCalls, 2, "valid work resumes once the exact newer generation releases");

    cover.hidden = true;
    cover.dataset = { generation: "13", state: "hidden" };
    root.removeAttribute("inert");
    root.removeAttribute("aria-hidden");
    const cancelBeforeFrame = scheduleWebStartupBackgroundWork(
      () => { workCalls += 1; },
      0,
      13,
    );
    assert.equal(frames.length, 1, "already-released work still yields a frame");
    cancelBeforeFrame();
    frames.shift()?.();
    await new Promise(resolve => setTimeout(resolve, 10));
    idleWork.splice(0).forEach(work => work());
    assert.equal(workCalls, 2, "cancellation prevents queued frames and idle work");
  } finally {
    (globalThis as any).document = priorDocument;
    (globalThis as any).window = priorWindow;
    (globalThis as any).CustomEvent = priorCustomEvent;
  }
});

test("a newer cover generation cancels a queued release frame", () => {
  const priorDocument = (globalThis as any).document;
  const priorWindow = (globalThis as any).window;
  const cover = fakeElement();
  cover.dataset = { generation: "8", reason: "resume", state: "visible" };
  const root = fakeElement({ inert: "", "aria-hidden": "true" });
  const frames: Array<() => void> = [];

  try {
    (globalThis as any).document = {
      visibilityState: "visible",
      documentElement: { dataset: {} },
      getElementById: (id: string) => id === "flowledger-web-startup-cover"
        ? cover
        : id === "root" ? root : null,
    };
    (globalThis as any).window = {
      dispatchEvent: () => undefined,
      requestAnimationFrame: (work: () => void) => {
        frames.push(work);
        return frames.length;
      },
    };

    assert.equal(releaseWebStartupCover(8), true);
    cover.dataset.generation = "9";
    frames.shift()?.();
    assert.equal(cover.hidden, false);
    assert.equal(cover.dataset.state, "visible");
    assert.equal(root.hasAttribute("inert"), true);
  } finally {
    (globalThis as any).document = priorDocument;
    (globalThis as any).window = priorWindow;
  }
});

test("the WebKit fallback yields pending input before background work", () => {
  const priorDocument = (globalThis as any).document;
  const priorWindow = (globalThis as any).window;
  const priorNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const priorSetTimeout = globalThis.setTimeout;
  const priorClearTimeout = globalThis.clearTimeout;
  const cover = fakeElement();
  cover.hidden = true;
  cover.dataset = { generation: "21", state: "hidden" };
  const root = fakeElement();
  const frames: Array<() => void> = [];
  const timers: Array<() => void> = [];
  let inputChecks = 0;
  let workCalls = 0;

  try {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        scheduling: {
          isInputPending: () => {
            inputChecks += 1;
            return inputChecks === 1;
          },
        },
      },
    });
    (globalThis as any).document = {
      visibilityState: "visible",
      documentElement: { dataset: { flowledgerReady: "true" } },
      getElementById: (id: string) => id === "flowledger-web-startup-cover"
        ? cover
        : id === "root" ? root : null,
    };
    (globalThis as any).window = {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      requestAnimationFrame: (work: () => void) => {
        frames.push(work);
        return frames.length;
      },
      cancelAnimationFrame: () => undefined,
    };
    globalThis.setTimeout = ((work: (...args: unknown[]) => void, _delay?: number, ...args: unknown[]) => {
      timers.push(() => work(...args));
      return timers.length as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;

    scheduleWebStartupBackgroundWork(() => { workCalls += 1; }, 0, 21);
    assert.equal(frames.length, 1);
    frames.shift()?.();
    assert.equal(timers.length, 1, "the post-paint delay is queued as a separate task");
    timers.shift()?.();
    assert.equal(timers.length, 1, "the no-idle-callback fallback yields one more task");
    timers.shift()?.();
    assert.equal(workCalls, 0);
    assert.equal(frames.length, 1, "pending input earns another animation frame");
    frames.shift()?.();
    assert.equal(timers.length, 1);
    timers.shift()?.();
    assert.equal(workCalls, 1);
    assert.equal(inputChecks, 2);
  } finally {
    (globalThis as any).document = priorDocument;
    (globalThis as any).window = priorWindow;
    if (priorNavigator) Object.defineProperty(globalThis, "navigator", priorNavigator);
    else delete (globalThis as any).navigator;
    globalThis.setTimeout = priorSetTimeout;
    globalThis.clearTimeout = priorClearTimeout;
  }
});

test("workspace reveal is exact to cover generation and destination content", () => {
  const prior = {
    scopeKey: "user-a:household-a",
    generation: 7,
    contentKey: "dashboard:snapshot-day-one",
  };
  assert.equal(nextWebWorkspaceRevealToken({
    revealed: prior,
    currentScopeKey: prior.scopeKey,
    currentGeneration: 8,
    currentContentKey: prior.contentKey,
    readinessSatisfied: false,
  }), null, "a resume generation cannot reuse the old reveal token");
  assert.equal(nextWebWorkspaceRevealToken({
    revealed: prior,
    currentScopeKey: prior.scopeKey,
    currentGeneration: 7,
    currentContentKey: "dashboard:snapshot-day-two",
    readinessSatisfied: false,
  }), prior, "same-generation background changes never block an interactive app");
  assert.deepEqual(nextWebWorkspaceRevealToken({
    revealed: prior,
    currentScopeKey: prior.scopeKey,
    currentGeneration: 8,
    currentContentKey: "dashboard:snapshot-day-two",
    readinessSatisfied: true,
  }), {
    scopeKey: prior.scopeKey,
    generation: 8,
    contentKey: "dashboard:snapshot-day-two",
  });
});

test("post-reveal tab readiness never rearms the boot cover", () => {
  assert.equal(workspaceScopeTransitionNeedsCover({
    previousScopeKey: "user-a:household-a",
    currentScopeKey: "user-a:household-a",
    workspaceRoute: true,
    coverAlreadyArmed: false,
  }), false, "Forecast to a pending Dashboard shell is the same scope");
  assert.equal(workspaceScopeTransitionNeedsCover({
    previousScopeKey: "user-a:household-a",
    currentScopeKey: "user-a:household-b",
    workspaceRoute: true,
    coverAlreadyArmed: false,
  }), true, "an actual household replacement remains fail-closed");
  assert.equal(workspaceScopeTransitionNeedsCover({
    previousScopeKey: "user-a:household-a",
    currentScopeKey: "user-a:household-b",
    workspaceRoute: true,
    coverAlreadyArmed: true,
  }), false, "an already-visible cover is not armed twice");
});

test("an armed cover requires the current content but a released app stays interactive", () => {
  const token = {
    scopeKey: "user-a:household-a",
    generation: 9,
    contentKey: "dashboard:revision-one",
  };
  const changedContent = {
    revealed: token,
    currentScopeKey: token.scopeKey,
    currentGeneration: token.generation,
    currentContentKey: "dashboard:revision-two",
  };
  assert.equal(webWorkspaceRevealTokenIsReady({
    ...changedContent,
    coverArmed: true,
  }), false);
  assert.equal(webWorkspaceRevealTokenIsReady({
    ...changedContent,
    coverArmed: false,
  }), true);
});

test("an armed generation replaces a stale destination token once the new content is ready", () => {
  const first = {
    scopeKey: "user-a:household-a",
    generation: 9,
    contentKey: "dashboard:revision-one",
  };
  const pending = nextWebWorkspaceRevealToken({
    revealed: first,
    currentScopeKey: first.scopeKey,
    currentGeneration: first.generation,
    currentContentKey: "dashboard:revision-two",
    readinessSatisfied: false,
    coverArmed: true,
  });
  assert.equal(pending, null, "armed content changes invalidate the stale token");

  const ready = nextWebWorkspaceRevealToken({
    revealed: pending,
    currentScopeKey: first.scopeKey,
    currentGeneration: first.generation,
    currentContentKey: "dashboard:revision-two",
    readinessSatisfied: true,
    coverArmed: true,
  });
  assert.deepEqual(ready, {
    scopeKey: first.scopeKey,
    generation: first.generation,
    contentKey: "dashboard:revision-two",
  });

  assert.equal(nextWebWorkspaceRevealToken({
    revealed: ready,
    currentScopeKey: first.scopeKey,
    currentGeneration: first.generation,
    currentContentKey: "route:(tabs)/bills",
    readinessSatisfied: false,
    coverArmed: false,
  }), ready, "released same-generation navigation remains monotonic");
});
