const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../../artifacts/mobile/components/PlaidLinkButton.tsx"), "utf8");

test("native Plaid status failure is degraded and retryable rather than an authoritative empty state", () => {
  assert.match(source, /"loading" \| "ready" \| "error"/);
  assert.match(source, /setStatusState\("error"\)/);
  assert.match(source, /Could not load bank connections/);
  assert.match(source, />Retry</);
  assert.match(source, /statusState === "ready" \? <View style=\{styles\.actions\}>/);
  assert.match(source, /statusState !== "ready"/);
});
