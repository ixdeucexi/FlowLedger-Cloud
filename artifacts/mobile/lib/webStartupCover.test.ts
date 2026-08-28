import assert from "node:assert/strict";
import test from "node:test";

import { shouldReleaseWebStartupCover } from "./webStartupCover";

const exactWorkspace = {
  visible: true,
  readyToReveal: true,
  terminalErrorReady: false,
  workspaceRoute: true,
  currentScopeKey: "user-a:household-a",
  verifiedScopeKey: "user-a:household-a",
  workspaceReadyScopeKey: "user-a:household-a",
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
});

test("public and mounted terminal routes can reveal without a workspace token", () => {
  assert.equal(shouldReleaseWebStartupCover({
    ...exactWorkspace,
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
