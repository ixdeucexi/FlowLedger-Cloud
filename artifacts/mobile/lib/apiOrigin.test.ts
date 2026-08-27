import assert from "node:assert/strict";
import test from "node:test";

import {
  FLOWLEDGER_PRODUCTION_ORIGIN,
  isReleaseApiOriginSafe,
  joinApiUrl,
  resolveNativeApiOrigin,
} from "./apiOrigin";

test("API paths resolve against an explicit origin", () => {
  assert.equal(joinApiUrl(FLOWLEDGER_PRODUCTION_ORIGIN, "/api/plaid/sync"), `${FLOWLEDGER_PRODUCTION_ORIGIN}/api/plaid/sync`);
  assert.equal(joinApiUrl(FLOWLEDGER_PRODUCTION_ORIGIN, "api/feedback"), `${FLOWLEDGER_PRODUCTION_ORIGIN}/api/feedback`);
});

test("native API configuration fails closed instead of defaulting to production", () => {
  assert.equal(resolveNativeApiOrigin(undefined, undefined), null);
  assert.equal(
    resolveNativeApiOrigin("https://sandbox.example.com", undefined),
    "https://sandbox.example.com",
  );
  assert.equal(
    resolveNativeApiOrigin(undefined, "https://preview.example.com/"),
    "https://preview.example.com",
  );
});

test("release API origins reject development and insecure hosts", () => {
  assert.equal(isReleaseApiOriginSafe("https://flowledger-algo.com"), true);
  assert.equal(isReleaseApiOriginSafe("http://localhost:3000"), false);
  assert.equal(isReleaseApiOriginSafe("https://example.replit.dev"), false);
});
