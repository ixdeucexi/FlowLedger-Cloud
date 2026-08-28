import assert from "node:assert/strict";
import test from "node:test";

import {
  nextWebWorkspaceRevealedScopeKey,
  nextWebWorkspaceRevealToken,
  shouldReleaseWebStartupCover,
  startupCoverGenerationCanRelease,
  startupVerificationCanCommit,
  webStartupRouteIsProtected,
  webWorkspaceRevealTokenIsReady,
  workspaceScopeTransitionNeedsCover,
} from "./webStartupCover";

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
