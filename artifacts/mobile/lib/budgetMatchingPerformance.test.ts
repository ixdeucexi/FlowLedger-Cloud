import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Execute the real memo callbacks so financial/controller work cannot hide in
// a presentation that never renders the ordinary Activity feed.
const source = readFileSync("components/ActivityScreen.tsx", "utf8");
const parsed = ts.createSourceFile("ActivityScreen.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map<string, string>();
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(parsed) === "useMemo") {
    callbacks.set(node.name.text, node.initializer.arguments[0].getText(parsed));
  }
  ts.forEachChild(node, visit);
}
visit(parsed);
function execute(name: string, context: Record<string, unknown>) {
  const callback = callbacks.get(name);
  assert.ok(callback, `Missing ${name} callback`);
  const js = ts.transpileModule(`const evaluate = ${callback}; exports.run = evaluate;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const output: { run?: () => unknown } = {};
  new Function("exports", ...Object.keys(context), js)(output, ...Object.values(context));
  return output.run!();
}

test("embedded matching never walks the ordinary ledger or builds unused feed and forecast summaries", () => {
  const forbidden = () => { throw new Error("Ordinary Activity calculation ran inside matching"); };
  const context = { matchingOnly: true, selectDepositoryTransactions: forbidden, getIncomeOccurrencesInMonth: forbidden, getRemainingDebtPlanForMonth: forbidden, buildReviewQueue: forbidden, unmatchedPendingTransactions: forbidden, pendingManualReplacementIds: forbidden, activityRunningBalancesFromDatedAnchor: forbidden, summarizeActivitySnapshot: forbidden };
  for (const name of ["activityTransactions", "allActivity", "unmatchedPendingActivity"]) {
    assert.deepEqual(execute(name, context), []);
  }
  assert.equal((execute("runningBalanceById", context) as Map<string, number>).size, 0);
  assert.equal(execute("activityReviewCount", context), 0);
  assert.deepEqual(execute("monthSummaryBasis", context), { title: "", income: 0, out: 0, net: 0, weeks: [] });
  assert.deepEqual(execute("activitySummary", context), { title: "", income: 0, out: 0, net: 0, transactions: 0, latestWeeksOnly: false, weeks: [] });
});

test("ordinary Activity still reads its ledger, builds income occurrences, and requests planned summaries", () => {
  const row = { id: "manual-entry" };
  let ledgerCalls = 0;
  assert.deepEqual(execute("activityTransactions", { matchingOnly: false, transactions: [row], transactionAccountIdentities: [], selectDepositoryTransactions: (rows: unknown[]) => { ledgerCalls += 1; return { included: rows }; } }), [row]);
  assert.equal(ledgerCalls, 1);
  let incomeCalls = 0;
  assert.deepEqual(execute("allActivity", {
    matchingOnly: false, localDay: "2026-11-16", activityTransactions: [], pendingBankTransactions: [], pendingPlanMatches: [], overrides: [], bills: [], incomes: [], extraPayments: [], forecastAccounts: [],
    matchedOccurrenceAllocations: () => new Map(), matchedIncomeOccurrenceAllocations: () => new Map(), activePendingPlanMatches: () => [],
    isConfirmedBillMatch: () => false,
    getIncomeOccurrencesInMonth: () => { incomeCalls += 1; return []; },
  }), []);
  assert.equal(incomeCalls, 25);
  assert.throws(() => execute("monthSummaryBasis", { matchingOnly: false, monthFilter: "2026-11", getRemainingDebtPlanForMonth: () => { throw new Error("Ordinary debt plan requested"); } }), /Ordinary debt plan requested/);
  assert.equal(execute("activityReviewCount", { matchingOnly: false, transactions: [], localDay: "2026-11-16", buildReviewQueue: () => [row] }), 1);
});
