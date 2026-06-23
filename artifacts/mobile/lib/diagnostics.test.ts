import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sanitizeDiagnostic } from "./diagnosticPolicy";

describe("diagnostic privacy allowlist", () => {
  it("accepts codes and rejects messages that could contain financial data", () => {
    const base = { eventType: "save_failure" as const, operation: "amount_save" as const, platform: "web" as const };
    assert.equal(sanitizeDiagnostic({ ...base, errorCode: "update_monthly_bill" }).errorCode, "update_monthly_bill");
    assert.equal(sanitizeDiagnostic({ ...base, errorCode: "Balance $1,234 for Power Bill" }).errorCode, undefined);
    assert.equal(sanitizeDiagnostic({ ...base, errorCode: "john@example.com" }).errorCode, undefined);
    assert.equal(sanitizeDiagnostic({ ...base, errorCode: "a".repeat(65) }).errorCode, undefined);
  });
});
