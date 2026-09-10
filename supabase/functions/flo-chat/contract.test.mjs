import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { currentFloMonth, recordedSnowballTarget } from "./snowballTarget.ts";

import {
  aggregateCoverage,
  allowsSavedPlanRead,
  classifyFloFailure,
  claimEvidenceIds,
  boundedLimit,
  configuredDebtSummary,
  deterministicAnswerFromTools,
  deterministicFloRoute,
  floCapabilityGuidance,
  money,
  oldestSourceAsOf,
  sourceAsOf,
  requiresConfiguredDebtRead,
  sanitizeContext,
  safeOptionalFollowups,
  safeFloFailureReason,
  validateGroundedAnswer,
  verifiedFallbackFromTools,
  verifiedFallbackForTool,
  verifiedEmptyAnswerFromTools,
  selectToolVerifiedAnswer,
} from "./contract.ts";

const evidence = [{ id: "account:a", type: "account", label: "Checking", recordId: "a", asOf: "2026-08-12T00:00:00.000Z", freshness: "current" }];
const payload = {
  status: "ok",
  dataAsOf: "2026-08-12T00:00:00.000Z",
  coverage: { complete: true, returned: 1, limit: 50 },
  evidence,
  records: [{ id: "a", name: "Checking", current_balance: 42.81, balance_as_of: "2026-08-12" }],
};

test("snowball target routes advertised current requests but preserves historical and compound questions", () => {
  for (const question of ["Show me my debt snowball target.", "What is my snowball target?", "Which debt is my snowball target?"]) {
    const route = deterministicFloRoute(question);
    assert.equal(route?.intent, "debt_snowball_target");
    assert.deepEqual(route.requests, [{ name: "getCurrentSnowballTarget", input: {} }]);
  }
  for (const question of ["What was my snowball target last month?", "What is my snowball target and how much extra can I safely pay?", "Show my saved snowball target history"]) assert.notEqual(deterministicFloRoute(question)?.intent, "debt_snowball_target");
});

test("named debt balance and minimum question returns configured facts without fabricating lender minimums", () => {
  const route = deterministicFloRoute("What is my CORE Test Card balance and minimum payment?");
  assert.equal(route?.intent, "named_debt_payment");
  assert.deepEqual(route.requests[0].input, { debtOnly: true, includeClosed: true, query: "core test card" });
  assert.notEqual(deterministicFloRoute("What is my CORE Test Card balance and minimum payment last month?")?.intent, "named_debt_payment");
  const row = { id: "a", name: "CORE Test Card", is_debt: true, balance: 1000, amount: 35 };
  const checked = { ...payload, records: [row], summary: { query: "core test card", queryComplete: true }, evidence: [{ ...evidence[0], id: "getBillsAndDebt:a", type: "debt" }] };
  const result = deterministicAnswerFromTools("named_debt_payment", ["getBillsAndDebt"], [checked]);
  assert.match(result.answer.answer, /Recorded balance: \$1,000.00/);
  assert.match(result.answer.answer, /Configured payment: \$35.00/);
  assert.match(result.answer.answer, /not a verified lender-required minimum/);
  assert.deepEqual(result.answer.claims.map(claim => claim.field), ["name", "balance", "amount"]);
  assert.deepEqual(validateGroundedAnswer(result.answer, result.sources, [checked]), { valid: true });
  for (const invalid of [
    { ...checked, records: [{ ...row, name: "CORE Test Card Two" }] },
    { ...checked, records: [row, { ...row, id: "b" }] },
    { ...checked, summary: { ...checked.summary, queryComplete: false } },
    { ...checked, summary: { ...checked.summary, query: null } },
  ]) {
    const unresolved = deterministicAnswerFromTools("named_debt_payment", ["getBillsAndDebt"], [invalid]);
    assert.match(unresolved.answer.answer, /could not identify one exact debt record/);
    assert.doesNotMatch(unresolved.answer.answer, /\$1,000/);
  }
  const unknownPayment = { ...checked, records: [{ ...row, amount: null }] };
  assert.match(deterministicAnswerFromTools("named_debt_payment", ["getBillsAndDebt"], [unknownPayment]).answer.answer, /Configured payment: unavailable/);
});

const debtRow = (id, balance, extra = {}) => ({ id, name: `Debt ${id}`, is_debt: true, balance, interest_rate: 18, include_in_snowball: true, frequency: "monthly", due_day: 15, ...extra });
const targetMonth = { year: 2026, month: 8 };
test("target selection uses canonical order across ten debts, APR ties and record ID ties", () => {
  const ten = Array.from({ length: 10 }, (_, index) => debtRow(String(index), 1000 - index * 50));
  assert.equal(recordedSnowballTarget(ten, targetMonth, true, []).targetId, "9");
  assert.equal(recordedSnowballTarget([debtRow("b", 50), debtRow("a", 50)], targetMonth, true, []).targetId, "a");
  assert.equal(recordedSnowballTarget([debtRow("a", 50, { interest_rate: 18.001 }), debtRow("b", 50, { interest_rate: 18.002 })], targetMonth, true, []).targetId, "b");
  assert.equal(recordedSnowballTarget([debtRow("a", 20), debtRow("b", 50, { interest_rate: null })], targetMonth, true, []).targetId, "a");
  assert.equal(recordedSnowballTarget([debtRow("a", 20), debtRow("b", 20, { interest_rate: null })], targetMonth, true, []).reason, "missing_tiebreak_apr");
});

test("snowball eligibility excludes stopped, future, excluded and paid-off debt without treating missing balances as zero", () => {
  const rows = [debtRow("stopped", 1, { end_date: "2026-08-31" }), debtRow("future", 1, { start_date: "2026-10-01" }), debtRow("excluded", 1, { include_in_snowball: false }), debtRow("paid", 0), debtRow("active", 50)];
  assert.equal(recordedSnowballTarget(rows, targetMonth, true, []).targetId, "active");
  assert.equal(recordedSnowballTarget([...rows, debtRow("unknown", null)], targetMonth, true, []).reason, "missing_balance");
  assert.equal(recordedSnowballTarget(rows, targetMonth, false, []).reason, "incomplete_records");
  assert.equal(recordedSnowballTarget([], targetMonth, true, []).state, "no_debts");
  assert.equal(recordedSnowballTarget([rows[2]], targetMonth, true, []).state, "all_excluded");
  assert.equal(recordedSnowballTarget([rows[0]], targetMonth, true, []).state, "none_current");
  assert.equal(recordedSnowballTarget([rows[3]], targetMonth, true, []).state, "paid_off");
});

test("month selection respects local timezone at UTC month boundary and rejects unknown zones", () => {
  assert.deepEqual(currentFloMonth("2026-10-01T01:00:00Z", "America/Chicago"), { year: 2026, month: 8, date: "2026-09-30" });
  assert.deepEqual(currentFloMonth("2026-10-01T01:00:00Z", "Asia/Tokyo"), { year: 2026, month: 9, date: "2026-10-01" });
  assert.equal(currentFloMonth("2026-10-01T01:00:00Z", "fake-zone"), null);
  assert.equal(currentFloMonth("2026-10-01T01:00:00Z", undefined), null);
  assert.equal(recordedSnowballTarget([], null, true, []).reason, "month_unknown");
});

test("canonical moved occurrences include inactive debts without blocking ordinary active overrides", () => {
  const rows = [debtRow("stopped", 20, { end_date: "2026-08-31" }), debtRow("active", 50)];
  const movedIn = [{ bill_id: "stopped", from_date: "2026-08-15", to_date: "2026-09-15", updated_at: "2026-09-01T00:00:00Z" }];
  assert.equal(recordedSnowballTarget(rows, targetMonth, true, movedIn).targetId, "stopped");
  assert.equal(recordedSnowballTarget(rows, targetMonth, true, [{ bill_id: "active", custom_due_day: 18 }]).targetId, "active");
  assert.equal(recordedSnowballTarget(rows, targetMonth, true, [{ bill_id: "stopped", custom_due_day: 18 }]).state, "unavailable");
  assert.equal(recordedSnowballTarget([rows[1]], targetMonth, true, [{ bill_id: "active", from_date: "2026-09-15", to_date: "2026-10-15" }]).targetId, "active");
});

test("target answer names the exact verified debt and never substitutes saved-plan history", () => {
  const row = debtRow("a", 250);
  const summary = { id: "summary", state: "target", targetId: "a" };
  const checked = { ...payload, records: [row, summary], summary, evidence: [ { ...evidence[0], id: "getCurrentSnowballTarget:a" }, { ...evidence[0], id: "getCurrentSnowballTarget:summary", recordId: "summary" } ] };
  const answer = deterministicAnswerFromTools("debt_snowball_target", ["getCurrentSnowballTarget"], [checked]);
  assert.match(answer.answer.answer, /target is Debt a, with \$250.00 remaining/);
  assert.match(answer.answer.answer, /recorded-balance/);
  assert.deepEqual(validateGroundedAnswer(answer.answer, answer.sources, [checked]), { valid: true });
});

test("actual snowball tool scopes every query and feeds complete canonical selection into the grounded answer", async () => {
  const source = await readFile(new URL("./tools.ts", import.meta.url), "utf8");
  const withoutImports = source.replace(/^import[\s\S]*?from "[^"]+";\r?\n/gm, "").replace(/\bexport /g, "");
  const schema = new Proxy(function () { return schema; }, { get: () => schema });
  const create = new Function("z", "tool", "FLO_V3_MAX_ROWS", "currentFloMonth", "recordedSnowballTarget", "sourceAsOf", "oldestSourceAsOf", "freshness", `${stripTypeScriptTypes(withoutImports)}; return createFloTools;`)(schema, definition => definition, 200, currentFloMonth, recordedSnowballTarget, sourceAsOf, oldestSourceAsOf, () => "unknown");
  const records = Array.from({ length: 10 }, (_, index) => debtRow(String(index), 1000 - index * 50));
  const results = { bills: { data: records, count: 10, error: null }, bill_date_moves: { data: [], count: 0, error: null }, monthly_overrides: { data: [], count: 0, error: null } };
  const filters = [];
  const client = { from(table) {
    const query = new Proxy({}, { get(_target, key) {
      if (key === "then") return (resolve, reject) => Promise.resolve(results[table]).then(resolve, reject);
      return (...args) => { if (key === "eq") filters.push([table, ...args]); return query; };
    } });
    return query;
  } };
  const runtime = () => ({ client, householdId: "qa-only", userId: "qa-owner", now: "2026-10-01T01:00:00Z", timezone: "America/Chicago", toolResults: [], toolResultNames: [], toolNames: [], toolCache: new Map() });
  const checked = await create(runtime()).getCurrentSnowballTarget.execute({});
  assert.equal(checked.summary.targetId, "9");
  assert.equal(checked.coverage.startDate, "2026-09-30");
  for (const table of Object.keys(results)) assert.ok(filters.some(filter => filter[0] === table && filter[1] === "household_id" && filter[2] === "qa-only"));
  const answer = deterministicAnswerFromTools("debt_snowball_target", ["getCurrentSnowballTarget"], [checked]);
  assert.deepEqual(validateGroundedAnswer(answer.answer, answer.sources, [checked]), { valid: true });
  results.bills.count = 11;
  const partial = await create(runtime()).getCurrentSnowballTarget.execute({});
  assert.equal(partial.summary.state, "unavailable");
  assert.equal(partial.coverage.complete, false);
});

test("income how-to is immediate static guidance with the existing Income settings route", async () => {
  const help = floCapabilityGuidance("How do I add income?");
  assert.match(help.answer, /Open Settings, choose Plan settings, then Income/);
  assert.match(help.answer, /Add Income Source/);
  assert.equal(help.source.route, "/(tabs)/more?section=money");
  assert.equal(floCapabilityGuidance("How do I add income and how much did I get last month?"), null);
  const more = await readFile(new URL("../../../artifacts/mobile/app/(tabs)/more.tsx", import.meta.url), "utf8");
  const safeRoutes = await readFile(new URL("../../../artifacts/mobile/lib/floExperience.ts", import.meta.url), "utf8");
  assert.match(more, /activeSettingsSection === "money"/);
  assert.match(more, /Add Income Source/);
  assert.match(safeRoutes, /"\/\(tabs\)\/more"/);
});

test("today's briefing requests current account, bill, income and settings records only", () => {
  for (const question of ["What should I know about my plan today?", "What should I know about my money today?", "Review my current plan", "Show my plan today", "How is my plan looking today?"]) {
    const route = deterministicFloRoute(question, "2026-09-10");
    assert.equal(route?.intent, "current_plan_briefing", question);
    assert.deepEqual(route.requests.map(item => item.name), ["getAccountOverview", "getBillsAndDebt", "getIncomeSchedule", "getHouseholdAndSettings"]);
  }
  for (const question of ["Review my current plan and my saved simulations", "What should I know about my plan today for groceries?", "Show my current plan for last month"]) assert.equal(deterministicFloRoute(question), null);
});

test("current-plan briefing stays grounded with debt, negative checking and a chosen cushion", () => {
  const make = (name, records, summary) => ({ ...payload, records, summary, evidence: records.map(record => ({ ...evidence[0], id: `${name}:${record.id}`, recordId: record.id })) });
  const accountSummary = { id: "summary", checkingBalance: -50 };
  const billSummary = { id: "summary", billRecordCount: 2, debtBalance: 1000, configuredMinimums: 35 };
  const names = ["getAccountOverview", "getBillsAndDebt", "getIncomeSchedule", "getHouseholdAndSettings"];
  const results = [make(names[0], [accountSummary], accountSummary), make(names[1], [billSummary], billSummary), make(names[2], [{ id: "income", name: "Paycheck", amount: 1500 }]), make(names[3], [{ id: "settings", safety_floor: 200 }])];
  const result = deterministicAnswerFromTools("current_plan_briefing", names, results);
  assert.match(result.answer.answer, /Checking: -\$50.00/);
  assert.match(result.answer.answer, /Recorded debt balance: \$1,000.00/);
  assert.match(result.answer.answer, /chosen cushion: \$200.00/);
  assert.match(result.answer.answer, /open Forecast/);
  assert.match(result.answer.answer, /not lender-verified required minimums or a safe-to-spend calculation/);
  assert.doesNotMatch(result.answer.answer, /next payday is|safe to spend is|saved plan amount/i);
  assert.deepEqual(validateGroundedAnswer(result.answer, result.sources, results), { valid: true });
});

test("bundled launcher prompts use precise current overview aliases", () => {
  for (const [question, intent] of [
    ["What should I know about my bills and debts?", "bills_debt_overview"],
    ["What should I know about my recent activity?", "activity_overview"],
    ["What should I know about my category plan?", "budget_goal_overview"],
    ["What should I know about my account?", "account_overview"],
    ["What should I know about my debt payoff plan?", "debt_overview"],
  ]) {
    assert.equal(deterministicFloRoute(question)?.intent, intent);
    assert.equal(deterministicFloRoute(`${question} Only last month.`), null);
  }
});

test("saved plan tools require explicit historical or hypothetical intent", async () => {
  for (const question of ["Show my saved plans", "Review my simulations", "What if I spend more?", "What were my previous decisions?"]) assert.equal(allowsSavedPlanRead(question), true);
  for (const question of ["What should I know about my plan today?", "How is my money looking?", "Show my plan", "Review current plan, not saved simulations"]) assert.equal(allowsSavedPlanRead(question), false);
  const source = await readFile(new URL("./tools.ts", import.meta.url), "utf8");
  const withoutImports = source.replace(/^import[\s\S]*?from "[^"]+";\r?\n/gm, "").replace(/\bexport /g, "");
  const schema = new Proxy(function () { return schema; }, { get: () => schema });
  const create = new Function("z", "tool", "FLO_V3_MAX_ROWS", `${stripTypeScriptTypes(withoutImports)}; return createFloTools;`)(schema, definition => definition, 200);
  assert.equal("getDecisionsAndSimulations" in create({ allowSavedPlans: false }), false);
  assert.equal("getDecisionsAndSimulations" in create({ allowSavedPlans: true }), true);
  assert.match(source, /Saved simulation/);
  assert.match(source, /NOT the current live plan/);
});

test("unsafe optional followups are dropped independently without weakening claim checks", () => {
  const followups = safeOptionalFollowups(["Review my bills", "Can I afford $100?", "Is my plan safe?", "Review my bills", null, ""]);
  assert.deepEqual(followups, ["Review my bills"]);
  const answer = { answer: "Current balance: $42.81.", claims: [{ kind: "amount", label: "Balance", field: "current_balance", value: "$42.81", evidenceIds: ["account:a"] }], caveat: null, evidenceIds: ["account:a"], followups };
  assert.deepEqual(validateGroundedAnswer(answer, evidence, [payload]), { valid: true });
  assert.equal(validateGroundedAnswer({ ...answer, claims: [{ ...answer.claims[0], value: "$99" }] }, evidence, [payload]).code, "unsupported_amount");
});

test("proven empty results get exact server-owned scoped text, not unchecked model prose", () => {
  const empty = { ...payload, records: [], coverage: { complete: true, returned: 0, limit: 20, startDate: "2026-08-01", endDate: "2026-08-31" } };
  const answer = verifiedEmptyAnswerFromTools(["getIncomeSchedule"], [empty]);
  assert.ok(answer);
  assert.match(answer.answer, /No matching income schedules/);
  assert.match(answer.answer, /outside that check/);
  assert.deepEqual(validateGroundedAnswer(answer, evidence, [empty]), { valid: true });
  assert.equal(verifiedEmptyAnswerFromTools(["getIncomeSchedule"], [{ ...empty, status: "unavailable" }]), null);
  assert.equal(verifiedEmptyAnswerFromTools(["getIncomeSchedule"], [{ ...empty, coverage: { ...empty.coverage, complete: false } }]), null);
  assert.equal(verifiedEmptyAnswerFromTools(["getAccountOverview"], [payload]), null);
  const summary = { id: "summary", transactionCount: 0, complete: true };
  const noTransactions = { ...empty, status: "partial", summary, records: [summary], coverage: { ...empty.coverage, complete: false } };
  assert.ok(verifiedEmptyAnswerFromTools(["searchTransactions"], [noTransactions]));
  assert.equal(verifiedEmptyAnswerFromTools(["searchTransactions"], [{ ...noTransactions, summary: { ...summary, complete: false } }]), null);
});

test("failure telemetry classifies only safe enums without copying provider details", () => {
  assert.equal(classifyFloFailure({ name: "AI_NoOutputGeneratedError", message: "sensitive provider body" }), "structured_output");
  assert.equal(classifyFloFailure({ name: "AI_APICallError", statusCode: 429, responseBody: "secret" }), "provider_rate_limit");
  assert.equal(classifyFloFailure({ name: "AI_APICallError", statusCode: 401 }), "provider_auth");
  assert.equal(classifyFloFailure(new Error("unsupported_amount")), "claim_validation");
  assert.equal(classifyFloFailure(new Error("tool_required")), "tool_coverage");
  assert.equal(classifyFloFailure(new Error("answer_timeout")), "timeout");
  assert.equal(classifyFloFailure(new Error("terminal_persistence_failed")), "persistence");
  assert.equal(classifyFloFailure(new Error("sk-secret user question provider response")), "unknown");
  assert.equal(classifyFloFailure(new Error("evidence_record_missing")), "claim_validation");
  assert.equal(safeFloFailureReason(new Error("unverified_evidence")), "unverified_evidence");
  assert.equal(safeFloFailureReason(new Error("evidence_record_missing")), "evidence_record_missing");
  assert.equal(safeFloFailureReason(new Error("sk-secret user question provider response")), "unclassified");
});

test("published evidence follows exact rendered claims while every claim remains validated", () => {
  const answer = { answer: "Current balance: $42.81.", claims: [{ kind: "amount", label: "Balance", field: "current_balance", value: "$42.81", evidenceIds: ["account:a"] }], caveat: null, evidenceIds: ["getAccountOverview"], followups: [] };
  assert.equal(validateGroundedAnswer(answer, evidence, [payload]).code, "unverified_evidence");
  const normalized = { ...answer, evidenceIds: claimEvidenceIds(answer) };
  assert.deepEqual(normalized.evidenceIds, ["account:a"]);
  assert.deepEqual(validateGroundedAnswer(normalized, evidence, [payload]), { valid: true });
  const invented = { ...answer, claims: [{ ...answer.claims[0], evidenceIds: ["account:another-household"] }] };
  assert.equal(validateGroundedAnswer({ ...invented, evidenceIds: claimEvidenceIds(invented) }, evidence, [payload]).valid, false);
  const wrongField = { ...answer, claims: [{ ...answer.claims[0], field: "minimum_payment" }] };
  assert.equal(validateGroundedAnswer({ ...wrongField, evidenceIds: claimEvidenceIds(wrongField) }, evidence, [payload]).code, "unsupported_amount");
});

test("runtime handles proven-empty tools before model output and validates all nonempty claims", async () => {
  const empty = { ...payload, records: [], coverage: { complete: true, returned: 0, limit: 20 } };
  const result = { get output() { throw new Error("provider output getter must not run for proven empty tools"); } };
  const selected = selectToolVerifiedAnswer(() => result.output, ["getDecisionsAndSimulations"], [empty]);
  assert.equal(selected.provenEmpty, true);
  assert.match(selected.answer.answer, /No matching saved decisions or simulations/);
  assert.deepEqual(validateGroundedAnswer(selected.answer, evidence, [empty]), { valid: true });
  assert.throws(() => selectToolVerifiedAnswer(() => result.output, ["getAccountOverview"], [payload]));
  assert.throws(() => selectToolVerifiedAnswer(() => result.output, ["getDecisionsAndSimulations"], [{ ...empty, coverage: { ...empty.coverage, complete: false } }]));
  const model = { answer: "untrusted prose", claims: [], evidenceIds: ["account:a"], caveat: null, followups: [] };
  assert.equal(selectToolVerifiedAnswer(() => model, ["getAccountOverview"], [payload]).provenEmpty, false);
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const emptyAt = source.indexOf("const selected = selectToolVerifiedAnswer(() =>");
  const outputAt = source.indexOf("answerSchema.safeParse(result.output)");
  const validationAt = source.indexOf("validateGroundedAnswer(answer, allSources, toolRuntime.toolResults)");
  assert.ok(emptyAt > 0 && emptyAt < outputAt && outputAt < validationAt);
  assert.match(source, /if \(selected.provenEmpty\)/);
  assert.match(source, /evidenceIds: claimEvidenceIds\(answer\)/);
  assert.match(source, /failureClass, failureReason, semanticFailureCodes, failureStage, droppedFollowupCount/);
  assert.match(source, /const semanticFailureCodes = safeAnalysisFailureCodes\(error\)/);
  const contract = await readFile(new URL("./contract.ts", import.meta.url), "utf8");
  assert.doesNotMatch(contract, /full explanation needed more time/);
});

test("card balance, minimum and rate questions require the configured debt source", () => {
  for (const question of [
    "What is my CORE Test Card balance and minimum payment?",
    "What is the APR on CORE Test Card?",
    "What is my interest rate on my loan?",
    "How much do I owe on my credit card?",
    "What is my minimum monthly payment?",
    "Show my debt balances",
    "What is my APR?",
  ]) assert.equal(requiresConfiguredDebtRead(question), true, question);
  for (const question of [
    "Show my debit card purchases",
    "What is my debit card balance?",
    "What is my gift card balance?",
    "How much did I spend on my credit card?",
    "What is my checking balance?",
    "What is my savings interest rate?",
    "What is the minimum balance for savings?",
  ]) assert.equal(requiresConfiguredDebtRead(question), false, question);
});

test("account tool descriptions prevent cash accounts substituting for manual cards", async () => {
  const source = await readFile(new URL("./tools.ts", import.meta.url), "utf8");
  assert.match(source, /manually entered cards and loans live in getBillsAndDebt/);
  assert.match(source, /Never substitute a checking balance for a requested card balance/);
  assert.match(source, /REQUIRED for named-card\/debt balances, minimum payments, APR, or interest questions/);
  assert.match(source, /do not assert that a configured amount is a current lender-verified minimum/);
});

test("invalid money stays unknown instead of becoming zero", () => {
  assert.equal(money(undefined), null);
  assert.equal(money("not-a-number"), null);
  assert.equal(money("42.819"), 42.82);
  for (const value of [null, "", "  ", false, true, [], [0], {}, NaN, Infinity, "Infinity", "0x10", 1e308]) assert.equal(money(value), null);
  for (const value of [0, "0", " 0.00 "]) assert.equal(money(value), 0);
  assert.equal(money("-12.34"), -12.34);
});

test("missing balances cannot support a fabricated zero claim or overview", () => {
  for (const value of [null, "", false, []]) {
    const missing = { ...payload, records: [{ ...payload.records[0], current_balance: value }] };
    const answer = { answer: "Balance: $0.", claims: [{ kind: "amount", label: "Balance", field: "current_balance", value: "$0", evidenceIds: ["account:a"] }], caveat: null, evidenceIds: ["account:a"], followups: [] };
    assert.equal(validateGroundedAnswer(answer, evidence, [missing]).code, "unsupported_amount");
    const overview = deterministicAnswerFromTools("account_overview", ["getAccountOverview"], [missing]);
    assert.doesNotMatch(overview.answer.answer, /\$0/);
    assert.match(overview.answer.answer, /no current balance/);
  }
});

test("debt aggregates require every operand and complete row coverage", () => {
  const debt = { id: "a", is_debt: true, balance: 500, amount: 25 };
  const complete = configuredDebtSummary([debt, { ...debt, id: "b", balance: 125.55, amount: 0 }], true);
  assert.equal(complete.debtBalance, 625.55);
  assert.equal(complete.configuredMinimums, 25);
  assert.equal(complete.activeDebtCount, 2);
  for (const value of [null, undefined, "", false, "invalid"]) {
    const missingBalance = configuredDebtSummary([debt, { ...debt, balance: value }], true);
    assert.equal(missingBalance.debtBalance, null);
    assert.equal(missingBalance.activeDebtCount, null);
    assert.equal(missingBalance.configuredMinimums, 50);
    const missingMinimum = configuredDebtSummary([debt, { ...debt, amount: value }], true);
    assert.equal(missingMinimum.configuredMinimums, null);
    assert.equal(missingMinimum.debtBalance, 1000);
  }
  const empty = configuredDebtSummary([{ is_debt: false, amount: null }], true);
  assert.equal(empty.debtBalance, 0);
  assert.equal(empty.configuredMinimums, 0);
  assert.equal(empty.activeDebtCount, 0);
  const explicitZero = configuredDebtSummary([{ ...debt, balance: 0, amount: 0 }], true);
  assert.equal(explicitZero.debtBalance, 0);
  assert.equal(explicitZero.configuredMinimums, 0);
  for (const records of [[], [debt]]) {
    const truncated = configuredDebtSummary(records, false);
    assert.equal(truncated.debtBalance, null);
    assert.equal(truncated.configuredMinimums, null);
    assert.equal(truncated.activeDebtCount, null);
    assert.equal(truncated.billRecordCount, null);
  }
});

test("debt query retains unknown balances and marks unavailable totals partial", async () => {
  const source = await readFile(new URL("./tools.ts", import.meta.url), "utf8");
  assert.match(source, /query\.or\("is_debt.eq.false,balance.gt.0.009,balance.is.null"\)/);
  assert.match(source, /configuredDebtSummary\(result.records as Array<Record<string, unknown>>, result.coverage.complete\)/);
  assert.match(source, /result.summary.debtBalance === null \|\| result.summary.configuredMinimums === null/);
  assert.match(source, /reason: result.coverage.reason \?\? "debt_totals_unavailable"/);
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

test("date-only source precision survives evidence, envelopes, and aggregate coverage", async () => {
  assert.equal(sourceAsOf("2026-09-09"), "2026-09-09");
  assert.equal(sourceAsOf("2026-09-09T03:00:00-05:00"), "2026-09-09T08:00:00.000Z");
  for (const value of [null, "", "2026-02-30", "2026-09-09T12:00:00", "9/9/2026"]) assert.equal(sourceAsOf(value), null);
  assert.equal(oldestSourceAsOf(["2026-09-09T08:00:00Z", "2026-09-09"]), "2026-09-09");
  assert.equal(oldestSourceAsOf(["2026-09-10", "2026-09-09T08:00:00Z"]), "2026-09-09T08:00:00.000Z");
  assert.equal(oldestSourceAsOf([null, "invalid"]), null);
  assert.equal(aggregateCoverage([{ ...payload, dataAsOf: "2026-09-09" }, { ...payload, dataAsOf: "2026-09-10T08:00:00Z" }]).dataAsOf, "2026-09-09");
  const source = await readFile(new URL("./tools.ts", import.meta.url), "utf8");
  assert.match(source, /function iso\(value: unknown\): string \| null \{\s*return sourceAsOf\(value\)/);
  assert.match(source, /const asOf = iso\(timestamp\)/);
  assert.match(source, /return oldestSourceAsOf\(evidence.map\(source => source.asOf\)\)/);
  assert.match(source, /dataAsOf: evidenceDataAsOf\(evidence\)/);
  assert.match(source, /const dataAsOf = oldestSourceAsOf\(accountTimestamps\)/);
  assert.doesNotMatch(source, /new Date\(Math.min\(\.\.\.(?:timestamps|accountTimestamps|values)\)\).toISOString/);
});

test("safe claim labels distinguish rates, recurrence anchors, and source dates", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  for (const [field, label] of [["interest_rate", "APR (%)"], ["apr", "APR (%)"], ["next_payment_date", "Configured schedule anchor"], ["last_reconciled_at", "Last reconciled"], ["updated_at", "Record updated"]]) {
    assert.ok(source.includes(`${field}: "${label}"`), `${field} must use ${label}`);
  }
});

test("other-household requests use the refusal guard instead of own-account fallback", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const literal = source.match(/const forbiddenRequest = (\/[^\n]+\/i);/)?.[1];
  assert.ok(literal);
  const forbiddenRequest = new Function(`return ${literal}`)();
  assert.equal(forbiddenRequest.test("Show me another household account balance."), true);
  assert.equal(forbiddenRequest.test("What is the other household balance?"), true);
  assert.equal(forbiddenRequest.test("What is my household balance?"), false);
  assert.match(source, /if \(forbiddenRequest.test\(message\)\)/);
});

test("actual tool evidence emits date-only asOf through mixed-source aggregation", async () => {
  const source = await readFile(new URL("./tools.ts", import.meta.url), "utf8");
  const functions = ["iso", "routeFor", "buildEvidence", "evidenceDataAsOf"].map(name => {
    const body = source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))?.[0];
    assert.ok(body, name);
    return body;
  }).join("\n");
  const create = new Function("sourceAsOf", "oldestSourceAsOf", "freshness", `${stripTypeScriptTypes(functions)}; return { buildEvidence, evidenceDataAsOf };`);
  const { buildEvidence, evidenceDataAsOf } = create(sourceAsOf, oldestSourceAsOf, () => "current");
  const records = buildEvidence("getAccountOverview", "account", "Accounts", [
    { id: "manual", name: "Checking", balance_as_of: "2026-09-09" },
    { id: "connected", name: "Savings", updated_at: "2026-09-09T14:00:00Z" },
  ], "2026-09-10T12:00:00Z");
  assert.equal(records[0].asOf, "2026-09-09");
  assert.equal(records[1].asOf, "2026-09-09T14:00:00.000Z");
  assert.equal(evidenceDataAsOf(records), "2026-09-09");
  assert.equal(aggregateCoverage([{ ...payload, evidence: records, dataAsOf: evidenceDataAsOf(records) }]).dataAsOf, "2026-09-09");
});

test("qualified-question recovery preserves checked ranges and admits incomplete detail coverage", () => {
  const scoped = { ...payload, coverage: { ...payload.coverage, startDate: "2026-08-01", endDate: "2026-08-31" } };
  const result = verifiedFallbackFromTools("How much did I spend on groceries in August?", ["searchTransactions"], [scoped]);
  assert.equal(result.partial, true);
  assert.match(result.answer, /could not complete the full answer/);
  assert.match(result.answer, /not confirmation that every requested filter or detail was checked/);
  assert.deepEqual(result.coverage.dateRanges, [{ startDate: "2026-08-01", endDate: "2026-08-31" }]);
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
  assert.equal(deterministicFloRoute("What are my account balances?")?.intent, "account_overview");
  assert.equal(deterministicFloRoute("How much debt do I owe?")?.intent, "debt_overview");
  assert.equal(deterministicFloRoute("What bills do I have?")?.intent, "bill_overview");
  assert.equal(deterministicFloRoute("Show my debt plan history")?.intent, "debt_plan_history");
  assert.equal(deterministicFloRoute("Show my income schedule")?.intent, "income_overview");
  assert.equal(deterministicFloRoute("Show recent Activity")?.intent, "activity_overview");
  assert.equal(deterministicFloRoute("How much did I spend this month?"), null);
  const budgetRoute = deterministicFloRoute("Show my current goals", "2026-08-15");
  assert.equal(budgetRoute?.intent, "budget_goal_overview");
  assert.deepEqual(budgetRoute?.requests[0]?.input, { year: 2026, month: 7, includeClosed: false });
  assert.equal(deterministicFloRoute("Is my bank connection healthy?")?.intent, "connection_health");
  assert.equal(deterministicFloRoute("Can I afford $100 next week?"), null);
});

test("qualified and compound requests never lose their constraints to overview shortcuts", () => {
  for (const question of [
    "What are my checking balances?",
    "What is my checking balance and what is its as-of date?",
    "Show my accounts and income",
    "Show my account balances as of last month",
    "How much did I spend on groceries this month?",
    "Show recent transactions at Walmart",
    "Show recent pending transactions",
    "What bills have I paid?",
    "What bills are overdue?",
    "Show my bills from last month",
    "Show my next paychecks",
    "When is my next payday?",
    "Which bills are due next?",
    "What is coming up?",
    "Show my debt plan history for August 2026",
    "How much debt do I owe on Capital One?",
    "Show my current goals for a car",
    "Show my forecast and explain why the balance fell",
  ]) assert.equal(deterministicFloRoute(question, "2026-09-09"), null, question);
});

test("past income anchors are never presented as verified next paydays", () => {
  const source = { ...evidence[0], id: "getIncomeSchedule:i", recordId: "i", type: "income" };
  const income = { ...payload, evidence: [source], records: [{ id: "i", name: "Paycheck", amount: 1500, frequency: "biweekly", next_payment_date: "2020-01-03", excluded_dates: ["2020-01-17"] }] };
  const result = deterministicAnswerFromTools("income_overview", ["getIncomeSchedule"], [income]);
  assert.match(result.answer.answer, /configured income anchors/);
  assert.match(result.answer.answer, /not verified upcoming paydays/);
  assert.doesNotMatch(result.answer.answer, /next verified|next payment date/i);
  assert.deepEqual(validateGroundedAnswer(result.answer, result.sources, [income]), { valid: true });
});

test("evidence links open actual goal and budget destinations with mixed record kinds", async () => {
  const source = await readFile(new URL("./tools.ts", import.meta.url), "utf8");
  const routeBody = source.match(/function routeFor\(type: string, recordId\?: string\): string \| undefined \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(routeBody);
  const routeFor = new Function("type", "recordId", routeBody);
  assert.equal(routeFor("goal", "goal:a"), "/(tabs)/more?section=goals");
  assert.equal(routeFor("budget", "budget:a"), "/(tabs)/category-budget");
  assert.equal(routeFor("income", "income:a"), "/(tabs)/more?section=money");
  assert.equal(routeFor("debt", "summary"), "/(tabs)/bills");
  assert.equal(routeFor("debt", "a"), "/(tabs)/bills?debtId=a");
  assert.match(source, /all\.flatMap\(record => buildEvidence\("getBudgetsAndGoals", record\.record_kind/);
  assert.match(source, /next_payment_date is a configured recurrence anchor/);
});

test("qualified APR and all-debt recovery retain verified card rows", () => {
  const source = { ...evidence[0], id: "getBillsAndDebt:card", recordId: "card", type: "debt", label: "CORE Test Card" };
  const debts = { ...payload, evidence: [source], records: [{ id: "card", name: "CORE Test Card", is_debt: true, balance: 1000, amount: 25, interest_rate: 24 }] };
  for (const question of ["What is the APR on CORE Test Card?", "Tell me about CORE Test Card"]) {
    const result = verifiedFallbackFromTools(question, ["getBillsAndDebt"], [debts]);
    assert.match(result.answer, /CORE Test Card: \$1,000.00/);
    assert.doesNotMatch(result.answer, /no active bill record/);
    assert.equal(result.partial, true);
  }
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
  assert.match(result.answer.answer, /Configured schedule anchors \(not verified upcoming occurrences\)/);
  assert.doesNotMatch(result.answer.answer, /Next on the schedule/);
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

test("multi-tool recovery summarizes verified income and activity instead of generic failure copy", () => {
  const incomeSource = { id: "getIncomeSchedule:income-a", type: "income", label: "Payday", recordId: "income-a", asOf: "2026-08-23T12:00:00.000Z", freshness: "current", route: "/(tabs)/bills" };
  const activitySource = { id: "searchTransactions:tx-a", type: "transaction", label: "Groceries", recordId: "tx-a", asOf: null, freshness: "unknown", route: "/(tabs)/transactions" };
  const activitySummary = { ...activitySource, id: "searchTransactions:summary", label: "Transaction totals", recordId: "summary" };
  const result = verifiedFallbackFromTools(
    "Why does my spending feel high even though income is up?",
    ["getIncomeSchedule", "searchTransactions"],
    [
      {
        status: "ok", dataAsOf: incomeSource.asOf, coverage: { complete: true, returned: 1, limit: 100 }, evidence: [incomeSource],
        records: [{ id: "income-a", name: "Payday", amount: 1200, next_payment_date: "2026-08-28" }],
      },
      {
        status: "partial", dataAsOf: null, coverage: { complete: false, returned: 1, limit: 20, reason: "transaction_source_freshness_unknown" }, evidence: [activitySource, activitySummary],
        records: [{ id: "tx-a", merchant_name: "Groceries", amount: -42.5, date: "2026-08-22" }, { id: "summary", outflows: 42.5, transactionCount: 1 }],
        summary: { id: "summary", outflows: 42.5, transactionCount: 1 },
      },
    ],
  );
  assert.ok(result);
  assert.match(result.answer, /Payday: \$1,200\.00 on 2026-08-28/);
  assert.match(result.answer, /1 cash transaction and \$42\.50 in outflows/);
  assert.doesNotMatch(result.answer, /full explanation did not finish/i);
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
  assert.match(result.answer, /verified active account balances are Checking: \$42\.81/);
  assert.match(result.answer, /verified configured bills include Rent: \$100\.00/);
  assert.doesNotMatch(result.answer, /full explanation did not finish/i);
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
  assert.doesNotMatch(source, /from\("bills"\)\s*\.select\("[^"]*updated_at/);
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
  assert.match(source, /const answerTimeoutMs = 28_000/);
  assert.match(source, /const hardAnswerDeadlineMs = 30_000/);
  assert.match(source, /reasoningEffort: "low"/);
  assert.match(source, /timeout: \{ totalMs: answerTimeoutMs, stepMs: 15_000, toolMs: 5_000 \}/);
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

