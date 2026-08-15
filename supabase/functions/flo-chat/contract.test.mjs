import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  aggregateCoverage,
  boundedLimit,
  deterministicAnswerFromTools,
  deterministicFloRoute,
  floCapabilityGuidance,
  money,
  sanitizeContext,
  validateGroundedAnswer,
  verifiedFallbackFromTools,
  verifiedFallbackForTool,
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

test("unsupported canonical calculations return immediate truthful app guidance", () => {
  assert.equal(floCapabilityGuidance("Why is my Flow Score 54?")?.source.route, "/(tabs)/how-flowledger-works");
  assert.match(floCapabilityGuidance("Can I send extra money to debt safely?")?.answer ?? "", /Debt Payoff Planner/);
  assert.equal(floCapabilityGuidance("Can I afford a purchase next week?")?.source.route, "/plan-simulator");
  assert.equal(floCapabilityGuidance("Which bills are due next?") , null);
});

test("simple account questions use deterministic read routes without model synthesis", () => {
  const forecastRoute = deterministicFloRoute("What should I know about my forecast?");
  assert.equal(forecastRoute?.intent, "forecast_overview");
  assert.deepEqual(forecastRoute?.requests.map(request => request.name), ["getAccountOverview", "getBillsAndDebt", "getIncomeSchedule"]);
  assert.equal(deterministicFloRoute("Why is my Forecast lower on 2026-08-20?"), null);
  assert.equal(deterministicFloRoute("What are my checking balances?")?.intent, "account_overview");
  assert.equal(deterministicFloRoute("How much debt do I owe?")?.intent, "debt_overview");
  assert.equal(deterministicFloRoute("What bills do I have?")?.intent, "bill_overview");
  assert.equal(deterministicFloRoute("Show my debt plan history")?.intent, "debt_plan_history");
  assert.equal(deterministicFloRoute("Show my next paychecks")?.intent, "income_overview");
  assert.equal(deterministicFloRoute("Show recent Activity")?.intent, "activity_overview");
  assert.equal(deterministicFloRoute("How much did I spend this month?")?.intent, "activity_overview");
  const budgetRoute = deterministicFloRoute("Show my current goals", "2026-08-15");
  assert.equal(budgetRoute?.intent, "budget_goal_overview");
  assert.deepEqual(budgetRoute?.requests[0]?.input, { year: 2026, month: 7, includeClosed: false });
  assert.equal(deterministicFloRoute("Is my bank connection healthy?")?.intent, "connection_health");
  assert.equal(deterministicFloRoute("Can I afford $100 next week?"), null);
});

test("simple bill overview lists configured bill facts without computing a forecast total", () => {
  const source = { id: "getBillsAndDebt:bill-a", type: "bill", label: "Rent", recordId: "bill-a", asOf: "2026-08-15T12:00:00.000Z", freshness: "current", route: "/(tabs)/bills" };
  const billPayload = {
    status: "ok",
    dataAsOf: source.asOf,
    coverage: { complete: true, returned: 1, limit: 200 },
    evidence: [source],
    records: [{ id: "bill-a", name: "Rent", amount: 1250, frequency: "monthly", is_debt: false }],
  };
  const result = deterministicAnswerFromTools("bill_overview", ["getBillsAndDebt"], [billPayload]);
  assert.ok(result);
  assert.match(result.answer.answer, /Rent: \$1,250\.00 monthly/);
  assert.doesNotMatch(result.answer.answer, /total/i);
  assert.deepEqual(validateGroundedAnswer(result.answer, result.sources, [billPayload]), { valid: true });
});

test("saved debt-plan history uses the verified plan rows without model synthesis", () => {
  const source = { id: "getDebtPlanHistory:plan-a", type: "debt", label: "Debt payment plans", recordId: "plan-a", asOf: "2026-08-15T12:00:00.000Z", freshness: "current", route: "/(tabs)/bills" };
  const planPayload = {
    status: "ok",
    dataAsOf: source.asOf,
    coverage: { complete: true, returned: 1, limit: 100 },
    evidence: [source],
    records: [{ id: "plan-a", amount: 75, payment_date: "2026-08-20" }],
  };
  const result = deterministicAnswerFromTools("debt_plan_history", ["getDebtPlanHistory"], [planPayload]);
  assert.ok(result);
  assert.match(result.answer.answer, /\$75\.00 for 2026-08-20/);
  assert.deepEqual(validateGroundedAnswer(result.answer, result.sources, [planPayload]), { valid: true });
});

test("forecast fast path summarizes only validated server-side forecast inputs", () => {
  const accountSource = { id: "getAccountOverview:summary", type: "account", label: "Canonical account totals", recordId: "summary", asOf: "2026-08-15T12:00:00.000Z", freshness: "current", route: "/(tabs)/more" };
  const billSource = { id: "getBillsAndDebt:summary", type: "bill", label: "Configured debt totals", recordId: "summary", asOf: "2026-08-15T12:00:00.000Z", freshness: "current", route: "/(tabs)/bills" };
  const incomeSource = { id: "getIncomeSchedule:income-a", type: "income", label: "Payday", recordId: "income-a", asOf: "2026-08-15T12:00:00.000Z", freshness: "current", route: "/(tabs)/bills" };
  const payloads = [
    { status: "ok", dataAsOf: accountSource.asOf, coverage: { complete: true, returned: 1, limit: 1 }, evidence: [accountSource], records: [{ id: "summary", checkingBalance: 2500 }], summary: { id: "summary", checkingBalance: 2500 } },
    { status: "ok", dataAsOf: billSource.asOf, coverage: { complete: true, returned: 1, limit: 1 }, evidence: [billSource], records: [{ id: "summary", billRecordCount: 8, activeDebtCount: 3 }], summary: { id: "summary", billRecordCount: 8, activeDebtCount: 3 } },
    { status: "ok", dataAsOf: incomeSource.asOf, coverage: { complete: true, returned: 1, limit: 1 }, evidence: [incomeSource], records: [{ id: "income-a", name: "Payday", amount: 1200, next_payment_date: "2026-08-21" }] },
  ];
  const names = ["getAccountOverview", "getBillsAndDebt", "getIncomeSchedule"];
  const result = deterministicAnswerFromTools("forecast_overview", names, payloads);
  assert.ok(result);
  assert.match(result.answer.answer, /records feeding your Forecast/);
  assert.match(result.answer.answer, /\$2,500\.00/);
  assert.match(result.answer.answer, /Payday \$1,200\.00 on 2026-08-21/);
  assert.deepEqual(validateGroundedAnswer(result.answer, result.sources, payloads), { valid: true });
  assert.equal(result.partial, false);
});

test("forecast fast path still answers from successful tools when one source is unavailable", () => {
  const accountSource = { id: "getAccountOverview:summary", type: "account", label: "Canonical account totals", recordId: "summary", asOf: "2026-08-15T12:00:00.000Z", freshness: "current", route: "/(tabs)/more" };
  const payloads = [
    { status: "ok", dataAsOf: accountSource.asOf, coverage: { complete: true, returned: 1, limit: 1 }, evidence: [accountSource], records: [{ id: "summary", checkingBalance: 2500 }], summary: { id: "summary", checkingBalance: 2500 } },
    { status: "unavailable", dataAsOf: null, coverage: { complete: false, returned: 0, limit: 100, reason: "query_failed" }, evidence: [], records: [] },
    { status: "unavailable", dataAsOf: null, coverage: { complete: false, returned: 0, limit: 100, reason: "query_failed" }, evidence: [], records: [] },
  ];
  const result = deterministicAnswerFromTools("forecast_overview", ["getAccountOverview", "getBillsAndDebt", "getIncomeSchedule"], payloads);
  assert.ok(result);
  assert.match(result.answer.answer, /\$2,500\.00/);
  assert.match(result.answer.caveat ?? "", /unavailable/);
  assert.equal(result.partial, true);
  assert.deepEqual(validateGroundedAnswer(result.answer, result.sources, payloads), { valid: true });
});

test("Activity fast path reports only bounded verified cash records", () => {
  const transactionSource = { id: "searchTransactions:tx-a", type: "transaction", label: "Groceries", recordId: "tx-a", asOf: null, freshness: "unknown", route: "/(tabs)/transactions", startDate: "2026-08-01", endDate: "2026-08-15" };
  const summarySource = { ...transactionSource, id: "searchTransactions:summary", label: "Transaction totals", recordId: "summary" };
  const activityPayload = {
    status: "partial",
    dataAsOf: null,
    coverage: { complete: false, returned: 1, limit: 20, startDate: "2026-08-01", endDate: "2026-08-15", reason: "transaction_source_freshness_unknown" },
    evidence: [transactionSource, summarySource],
    records: [{ id: "tx-a", merchant_name: "Groceries", amount: -42.5, date: "2026-08-14" }, { id: "summary", outflows: 42.5, transactionCount: 1 }],
    summary: { id: "summary", outflows: 42.5, transactionCount: 1 },
  };
  const result = deterministicAnswerFromTools("activity_overview", ["searchTransactions"], [activityPayload]);
  assert.ok(result);
  assert.match(result.answer.answer, /1 cash transaction and \$42\.50 in outflows/);
  assert.match(result.answer.answer, /Groceries: -?\$42\.50 on 2026-08-14/);
  assert.equal(result.partial, true);
  assert.deepEqual(validateGroundedAnswer(result.answer, result.sources, [activityPayload]), { valid: true });
});

test("budget, goal, and connection fast paths stay grounded to exact server records", () => {
  const budgetSource = { id: "getBudgetsAndGoals:budget:b1", type: "budget", label: "Dining", recordId: "budget:b1", asOf: "2026-08-15T12:00:00.000Z", freshness: "current", route: "/(tabs)/bills" };
  const goalSource = { id: "getBudgetsAndGoals:goal:g1", type: "budget", label: "Emergency", recordId: "goal:g1", asOf: null, freshness: "unknown", route: "/(tabs)/bills" };
  const planPayload = {
    status: "ok", dataAsOf: budgetSource.asOf, coverage: { complete: true, returned: 2, limit: 200 }, evidence: [budgetSource, goalSource],
    records: [{ id: "budget:b1", record_kind: "budget", category: "Dining", amount: 300 }, { id: "goal:g1", record_kind: "goal", name: "Emergency", current_amount: 500, target_amount: 1000 }],
  };
  const plan = deterministicAnswerFromTools("budget_goal_overview", ["getBudgetsAndGoals"], [planPayload]);
  assert.ok(plan);
  assert.match(plan.answer.answer, /Dining: \$300\.00/);
  assert.match(plan.answer.answer, /Emergency: \$500\.00 toward \$1,000\.00/);
  assert.deepEqual(validateGroundedAnswer(plan.answer, plan.sources, [planPayload]), { valid: true });

  const connectionSource = { id: "getConnectionHealth:connection:c1", type: "connection", label: "Example Bank", recordId: "connection:c1", asOf: "2026-08-15T12:00:00.000Z", freshness: "current", route: "/(tabs)/more" };
  const connectionPayload = { status: "ok", dataAsOf: connectionSource.asOf, coverage: { complete: true, returned: 1, limit: 150 }, evidence: [connectionSource], records: [{ id: "connection:c1", record_kind: "connection", institution_name: "Example Bank", status: "healthy" }] };
  const connection = deterministicAnswerFromTools("connection_health", ["getConnectionHealth"], [connectionPayload]);
  assert.ok(connection);
  assert.match(connection.answer.answer, /Example Bank: healthy/);
  assert.deepEqual(validateGroundedAnswer(connection.answer, connection.sources, [connectionPayload]), { valid: true });
});

test("a completed account tool provides a verified recovery answer", () => {
  const result = verifiedFallbackForTool("Can I send extra money to debt safely?", "getBillsAndDebt", {
    ...payload,
    evidence: [{ ...evidence[0], type: "debt", route: "/(tabs)/bills" }],
  });
  assert.match(result.answer, /Debt Payoff Planner/);
  assert.equal(result.partial, true);
  assert.deepEqual(result.coverage.reasons, ["assistant_synthesis_unavailable"]);
  assert.equal(result.sources.some(source => source.route === "/snowball-plan"), true);
});

test("multi-tool recovery preserves every verified source without synthesizing new facts", () => {
  const secondSource = { id: "bill:b", type: "bill", label: "Rent", recordId: "b", asOf: "2026-08-13T12:00:00.000Z", freshness: "current" };
  const result = verifiedFallbackFromTools(
    "What affects my plan?",
    ["getAccountOverview", "getBillsAndDebt"],
    [payload, { ...payload, evidence: [secondSource], records: [{ id: "b", name: "Rent", amount: 100 }] }],
  );
  assert.ok(result);
  assert.equal(result.sources.some(source => source.id === "account:a"), true);
  assert.equal(result.sources.some(source => source.id === "bill:b"), true);
  assert.equal(result.coverage.tools, 2);
  assert.equal(result.partial, true);
  assert.match(result.answer, /I found 1 active account: Checking: \$42\.81/);
  assert.match(result.answer, /I checked your bills and debt records/);
});

test("account recovery returns verified balances without waiting for model prose", () => {
  const result = verifiedFallbackForTool("What are my current account balances?", "getAccountOverview", {
    ...payload,
    dataAsOf: "2026-08-13T12:00:00.000Z",
    evidence: [{ ...evidence[0], type: "account", recordId: "checking", route: "/(tabs)/more" }],
    records: [
      { id: "checking", name: "Everyday checking", account_type: "checking", current_balance: 1250.5 },
      { id: "summary", record_kind: "canonical_account_summary", checkingBalance: 1250.5, savingsBalance: 400, liabilities: 0 },
    ],
    summary: { id: "summary", checkingBalance: 1250.5, savingsBalance: 400, liabilities: 0 },
  });
  assert.match(result.answer, /Everyday checking: \$1,250\.50/);
  assert.match(result.answer, /checking: \$1,250\.50, savings: \$400\.00, liabilities: \$0\.00/);
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
  const terminalMigration = await readFile(new URL("../../migrations/20260813204306_finalize_flo_responses_atomically.sql", import.meta.url), "utf8");
  const toolsSource = await readFile(new URL("./tools.ts", import.meta.url), "utf8");
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
  assert.match(source, /const answerTimeoutMs = 18_000/);
  assert.match(source, /const hardAnswerDeadlineMs = 20_000/);
  assert.match(source, /timeout: \{ totalMs: answerTimeoutMs, stepMs: 12_000, toolMs: 5_000 \}/);
  assert.match(source, /const result = await withinHardDeadline\(agent\.generate/);
  assert.doesNotMatch(source, /postToolSynthesisDeadlineMs|synthesisAbort|verified_tool_ready/);
  assert.match(source, /deterministicFloRoute\(message, now\.slice\(0, 10\)\)/);
  assert.match(source, /executeFloReadTools\(toolRuntime, directRoute\.requests\)/);
  assert.match(source, /const bufferedEvents: Uint8Array\[\] = \[\]/);
  assert.ok(source.indexOf("await withinHardDeadline(agent.generate") < source.indexOf("const output = new ReadableStream", source.indexOf("await withinHardDeadline(agent.generate")));
  assert.doesNotMatch(source, /EdgeRuntime\.waitUntil|abortProvider|deliverVerifiedFallback|verified_tool_fallback/);
  assert.match(source, /maxRetries: 0/);
  assert.match(source, /toolRuntime\.toolNames\.length >= 3/);
  assert.match(source, /await finalizeFloResponse\(server!/);
  assert.match(source, /request_in_progress/);
  assert.match(source, /reconcile_stale_flo_responses/);
  assert.match(source, /request_id: requestId, processing_started_at: now/);
  assert.match(source, /verified-fallback/);
  assert.match(source, /verifiedFallbackFromTools\(message, toolRuntime\.toolResultNames, toolRuntime\.toolResults\)/);
  assert.match(terminalMigration, /error_code = 'response_interrupted'/);
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
  assert.match(toolsSource, /toolCache: Map<string, FloToolEnvelope>/);
  assert.match(toolsSource, /toolResultNames: string\[\]/);
  assert.match(toolsSource, /Use only for how-to or where-is navigation questions\. Never use it for questions about what is in the user's account, Forecast/);
  assert.match(toolsSource, /const cached = runtime\.toolCache\.get\(cacheKey\)/);
  assert.match(terminalMigration, /create or replace function public\.finalize_flo_response/);
  assert.match(terminalMigration, /and status = 'streaming'/);
  assert.match(terminalMigration, /insert into public\.flo_usage/);
  assert.match(terminalMigration, /insert into public\.flo_audit_events/);
  assert.match(terminalMigration, /where event_type in \('answer', 'failure'\)/);
  assert.match(terminalMigration, /if p_ephemeral then[\s\S]*delete from public\.flo_conversations/);
  assert.match(terminalMigration, /create or replace function public\.reconcile_stale_flo_responses/);
  assert.match(terminalMigration, /error_code = 'response_interrupted'/);
  assert.match(terminalMigration, /for update of message skip locked/);
  assert.match(terminalMigration, /revoke all on function public\.finalize_flo_response[\s\S]*from public, anon, authenticated/);
});

