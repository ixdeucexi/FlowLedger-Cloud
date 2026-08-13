import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  aggregateCoverage,
  boundedLimit,
  money,
  sanitizeContext,
  validateGroundedAnswer,
} from "./contract.ts";

const evidence = [{ id: "account:a", type: "account", label: "Checking", recordId: "a", asOf: "2026-08-12T00:00:00.000Z", freshness: "current" }];
const payload = {
  status: "ok",
  dataAsOf: "2026-08-12T00:00:00.000Z",
  coverage: { complete: true, returned: 1, limit: 50 },
  evidence,
  records: [{ id: "a", name: "Checking", current_balance: 42.81, balance_as_of: "2026-08-12" }],
};

test("invalid money stays unknown instead of becoming zero", () => {
  assert.equal(money(undefined), null);
  assert.equal(money("not-a-number"), null);
  assert.equal(money("42.819"), 42.82);
});
test("grounded answer accepts exact structured account claims", () => {
  const answer = {
    answer: "Checking has $42.81 as of 2026-08-12.",
    claims: [
      { kind: "entity", label: "Account", field: "name", value: "Checking", evidenceIds: ["account:a"] },
      { kind: "amount", label: "Balance", field: "current_balance", value: "$42.81", evidenceIds: ["account:a"] },
      { kind: "date", label: "As of", field: "balance_as_of", value: "2026-08-12", evidenceIds: ["account:a"] },
    ],
    caveat: null,
    evidenceIds: ["account:a"],
    followups: [],
  };
  assert.deepEqual(validateGroundedAnswer(answer, evidence, [payload]), { valid: true });
});

test("grounding rejects unsupported and unstructured financial claims", () => {
  const unsupported = {
    answer: "Checking has $99.00.",
    claims: [{ kind: "amount", label: "Balance", field: "current_balance", value: "$99.00", evidenceIds: ["account:a"] }],
    caveat: null, evidenceIds: ["account:a"], followups: [],
  };
  assert.equal(validateGroundedAnswer(unsupported, evidence, [payload]).code, "unsupported_amount");

  const unstructured = {
    answer: "Checking has $42.81 and 2 pending items.",
    claims: [{ kind: "amount", label: "Balance", field: "current_balance", value: "$42.81", evidenceIds: ["account:a"] }],
    caveat: null, evidenceIds: ["account:a"], followups: [],
  };
  assert.equal(validateGroundedAnswer(unstructured, evidence, [payload]).code, "unstructured_numeric_claim");
});

test("grounding rejects cross-record evidence misattribution", () => {
  const mixedEvidence = [
    ...evidence,
    { id: "account:b", type: "account", label: "Savings", recordId: "b", asOf: "2026-08-12T00:00:00.000Z", freshness: "current" },
  ];
  const mixedPayload = { ...payload, evidence: mixedEvidence, records: [
    { id: "a", name: "Checking", current_balance: 42.81 },
    { id: "b", name: "Savings", current_balance: 99 },
  ] };
  const answer = {
    answer: "Checking has $99.",
    claims: [
      { kind: "entity", label: "Account", field: "name", value: "Checking", evidenceIds: ["account:a"] },
      { kind: "amount", label: "Balance", field: "current_balance", value: "$99", evidenceIds: ["account:a"] },
    ],
    caveat: null, evidenceIds: ["account:a"], followups: [],
  };
  assert.equal(validateGroundedAnswer(answer, mixedEvidence, [mixedPayload]).code, "unsupported_amount");
});

test("aggregate evidence is scoped to its exact tool source even when summary record ids repeat", () => {
  const accountSource = { id: "getAccountOverview:summary", type: "account", label: "Account total", recordId: "summary", asOf: "2026-08-12T00:00:00.000Z", freshness: "current" };
  const transactionSource = { id: "searchTransactions:summary", type: "transaction", label: "Transaction total", recordId: "summary", asOf: "2026-08-12T00:00:00.000Z", freshness: "current" };
  const payloads = [
    { ...payload, evidence: [accountSource], records: [{ id: "summary", liquidAssets: 42.81 }], summary: { id: "summary", liquidAssets: 42.81 } },
    { ...payload, evidence: [transactionSource], records: [{ id: "summary", outflows: 99 }], summary: { id: "summary", outflows: 99 } },
  ];
  const answer = { answer: "Liquid assets are $99.", claims: [{ kind: "amount", label: "Liquid assets", field: "liquidAssets", value: "$99", evidenceIds: [accountSource.id] }], caveat: null, evidenceIds: [accountSource.id], followups: [] };
  assert.equal(validateGroundedAnswer(answer, [accountSource, transactionSource], payloads).code, "unsupported_amount");
});

test("zero-result deterministic aggregate is grounded as zero", () => {
  const source = { id: "searchTransactions:summary", type: "transaction", label: "Transaction totals", recordId: "summary", asOf: "2026-08-12T00:00:00.000Z", freshness: "current" };
  const empty = { ...payload, evidence: [source], records: [{ id: "summary", outflows: 0, transactionCount: 0 }], summary: { id: "summary", outflows: 0, transactionCount: 0 } };
  const answer = { answer: "Outflows are $0.", claims: [{ kind: "amount", label: "Outflows", field: "outflows", value: "$0", evidenceIds: [source.id] }], caveat: null, evidenceIds: [source.id], followups: [] };
  assert.deepEqual(validateGroundedAnswer(answer, [source], [empty]), { valid: true });
});

test("object keys and false flags cannot support entity or status claims", () => {
  const source = { id: "bill:a", type: "bill", label: "A", recordId: "a", asOf: "2026-08-12T00:00:00.000Z", freshness: "current" };
  const bills = { ...payload, evidence: [source], records: [{ id: "a", name: "Rent", is_debt: false, paid_amount: 0, status: "unpaid" }] };
  const paid = { answer: "Payment status: paid.", claims: [{ kind: "status", label: "Payment status", field: "status", value: "paid", evidenceIds: [source.id] }], caveat: null, evidenceIds: [source.id], followups: [] };
  const debt = { answer: "Type: debt.", claims: [{ kind: "entity", label: "Type", field: "is_debt", value: "debt", evidenceIds: [source.id] }], caveat: null, evidenceIds: [source.id], followups: [] };
  assert.equal(validateGroundedAnswer(paid, [source], [bills]).code, "unsupported_claim");
  assert.equal(validateGroundedAnswer(debt, [source], [bills]).code, "unsupported_claim");
});

test("numeric claims are bound to the asserted field rather than any number in a record", () => {
  const source = { id: "debt:a", type: "debt", label: "Debt", recordId: "a", asOf: "2026-08-12T00:00:00.000Z", freshness: "current" };
  const debts = { ...payload, evidence: [source], records: [{ id: "a", amount: 100, balance: 500, due_day: 12 }] };
  const wrongBalance = { answer: "Balance: $100.", claims: [{ kind: "amount", label: "Balance", field: "balance", value: "$100", evidenceIds: [source.id] }], caveat: null, evidenceIds: [source.id], followups: [] };
  const wrongCount = { answer: "Debt count: 12.", claims: [{ kind: "count", label: "Debt count", field: "debt_count", value: "12", evidenceIds: [source.id] }], caveat: null, evidenceIds: [source.id], followups: [] };
  assert.equal(validateGroundedAnswer(wrongBalance, [source], [debts]).code, "unsupported_amount");
  assert.equal(validateGroundedAnswer(wrongCount, [source], [debts]).code, "unsupported_amount");
});

test("coverage and client context remain bounded", () => {
  assert.equal(boundedLimit(999), 200);
  assert.deepEqual(sanitizeContext({ route: "/(tabs)/bills", label: " A debt ", ignored: "secret" }), { route: "/(tabs)/bills", label: "A debt" });
  assert.equal(aggregateCoverage([{ ...payload, status: "partial", coverage: { ...payload.coverage, complete: false } }]).partial, true);
});

test("missing source timestamps stay unknown instead of becoming request time", () => {
  const result = aggregateCoverage([{ ...payload, dataAsOf: null, evidence: [{ ...evidence[0], asOf: null, freshness: "unknown" }] }]);
  assert.equal(result.dataAsOf, null);
});

test("empty query evidence keeps a null timestamp", async () => {
  const source = await readFile(new URL("./tools.ts", import.meta.url), "utf8");
  assert.match(source, /id: `\$\{name\}:query`[\s\S]{0,100}asOf: null/);
});

test("every account tool uses exact active-household filters and never legacy null scope", async () => {
  const source = await readFile(new URL("./tools.ts", import.meta.url), "utf8");
  assert.match(source, /\.eq\("household_id", runtime\.householdId\)/);
  assert.doesNotMatch(source, /household_id\.is\.null|scopedFilter|\.or\(`household_id/);
  assert.match(source, /from\("plaid_items"\)[\s\S]*?\.eq\("household_id", runtime\.householdId\)/);
  assert.match(source, /from\("plaid_accounts"\)[\s\S]*?\.eq\("household_id", runtime\.householdId\)/);
  assert.match(source, /select\("id,date,amount[^"]*plaid_account_id/);
  assert.match(source, /row\.pending !== true && \(row\.source === "plaid" \|\| row\.review_status !== "transfer"\)/);
  assert.doesNotMatch(source, /record\.date \?\? record\.created_at/);
  assert.doesNotMatch(source, /from\("bills"\)[\s\S]{0,500}select\([^\n]*updated_at/);
  assert.match(source, /\(tabs\)\/transactions/);
  assert.doesNotMatch(source, /route: "\/(activity|bills|forecast|settings)"/);
});

test("followups cannot carry ungrounded financial figures or judgments", () => {
  const answer = { answer: "Balance: $42.81.", claims: [{ kind: "amount", label: "Balance", field: "current_balance", value: "$42.81", evidenceIds: ["account:a"] }], caveat: null, evidenceIds: ["account:a"], followups: ["Can I afford $100?"] };
  assert.equal(validateGroundedAnswer(answer, evidence, [payload]).code, "unsafe_followup");
});

test("v3 endpoint enforces privacy, legacy rejection, and server-owned persistence", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../../migrations/20260812152444_flo_v3_account_intelligence.sql", import.meta.url), "utf8");
  const guardMigration = await readFile(new URL("../../migrations/20260812171000_fix_flo_server_owned_write_guards.sql", import.meta.url), "utf8");
  assert.match(source, /body\.version !== 3/);
  assert.match(source, /store: false/);
  assert.match(source, /crypto\.subtle\.sign\("HMAC"/);
  assert.match(source, /renderValidatedClaims\(answer\)/);
  assert.match(source, /safeClaimLabel\(claim\.field\)/);
  assert.doesNotMatch(source, /`\$\{claim\.label\}: \$\{claim\.value\}/);
  assert.match(source, /FLO_DAILY_REQUEST_LIMIT/);
  assert.match(source, /withApprovedCors\(await handleV3/);
  assert.match(source, /FLO_ALLOWED_ORIGINS/);
  assert.match(source, /"Access-Control-Allow-Methods":\s*"POST, OPTIONS"/);
  assert.match(source, /FLO_SAFETY_IDENTIFIER_SECRET/);
  assert.match(source, /requestedConversationId != null/);
  assert.match(source, /is_ephemeral", true/);
  assert.match(source, /ephemeral_cleanup_failed/);
  assert.match(source, /\.eq\("is_ephemeral", true\)/);
  assert.match(source, /if \(!ephemeral\) return/);
  assert.match(source, /if \(historyEnabled && \(!conversation \|\| conversation\.is_ephemeral/);
  assert.ok(source.indexOf("await enforceRateLimit") < source.indexOf('title: "Ephemeral Flo chat"'));
  assert.ok(source.indexOf("existingRowsError") < source.indexOf('title: "Ephemeral Flo chat"'));
  assert.match(source, /failAfterConversation\(jsonError\("message_persistence_failed"/);
  assert.match(source, /publicFailureCode\(error\)/);
  assert.match(source, /const answerTimeoutMs = 22_000/);
  assert.match(source, /timeout: \{ totalMs: answerTimeoutMs \}/);
  assert.match(source, /EdgeRuntime\.waitUntil\(task\)/);
  assert.match(source, /setInterval\(\(\) => emitProgress\(currentStatus\), 8_000\)/);
  assert.match(source, /code === "answer_timeout"/);
  assert.doesNotMatch(source, /error\.message\.slice\(0, 80\)/);
  assert.match(source, /filter\(\(row: any\) => row\.role === "user"\)/);
  assert.doesNotMatch(source, /LEGACY DETERMINISTIC SNAPSHOT|body\.snapshot|legacyResponse/);
  assert.match(migration, /revoke insert on table public\.flo_usage from authenticated/i);
  assert.match(guardMigration, /current_user in \('authenticated', 'anon'\)/i);
  assert.doesNotMatch(guardMigration, /auth\.role\(\)/i);
  assert.match(guardMigration, /revoke all on function public\.guard_flo_ephemeral_conversations\(\)/i);
  assert.match(migration, /revoke all on table public\.flo_audit_events from public, anon, authenticated/i);
  assert.match(migration, /revoke all on table public\.flo_memory from authenticated/i);
  assert.match(migration, /confirm_flo_recurring_bill_proposal/);
  assert.match(migration, /active_household_id = v_proposal\.household_id/);
  assert.match(migration, /tier = 'pro'/);
  assert.match(migration, /is_ephemeral boolean not null default false/);
  assert.match(migration, /ephemeral_conversations_are_server_owned/);
  assert.match(migration, /old\.is_ephemeral or new\.is_ephemeral or old\.is_ephemeral is distinct from new\.is_ephemeral/);
  assert.doesNotMatch(migration, /\(v_proposal\.payload ->> 'billId'\)::uuid/);
});

