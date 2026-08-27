import assert from "node:assert/strict";
import test from "node:test";

import { selectAuthStorageBackend } from "./secureAuthStoragePolicy";

test("web auth storage remains browser storage", () => {
  assert.equal(selectAuthStorageBackend("web", false), "web");
});

test("native auth never falls back to plain storage", () => {
  assert.equal(selectAuthStorageBackend("ios", true), "secure");
  assert.equal(selectAuthStorageBackend("android", true), "secure");
  assert.equal(selectAuthStorageBackend("ios", false), "unavailable");
  assert.equal(selectAuthStorageBackend("android", false), "unavailable");
});
