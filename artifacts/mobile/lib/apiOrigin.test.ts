import assert from "node:assert/strict";
import test from "node:test";

import { FLOWLEDGER_PRODUCTION_ORIGIN, isReleaseApiOriginSafe, joinApiUrl } from "./apiOrigin";

test("native API paths resolve against the production origin", () => {
  assert.equal(joinApiUrl(FLOWLEDGER_PRODUCTION_ORIGIN, "/api/plaid/sync"), `${FLOWLEDGER_PRODUCTION_ORIGIN}/api/plaid/sync`);
  assert.equal(joinApiUrl(FLOWLEDGER_PRODUCTION_ORIGIN, "api/feedback"), `${FLOWLEDGER_PRODUCTION_ORIGIN}/api/feedback`);
});

test("release API origins reject development and insecure hosts", () => {
  assert.equal(isReleaseApiOriginSafe("https://flowledger-algo.com"), true);
  assert.equal(isReleaseApiOriginSafe("http://localhost:3000"), false);
  assert.equal(isReleaseApiOriginSafe("https://example.replit.dev"), false);
});
