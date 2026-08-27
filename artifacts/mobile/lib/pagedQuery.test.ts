import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  appendUniqueRowsById,
  dateIdKeysetFilter,
  loadAllDateIdKeysetRows,
  loadAllPagedRows,
} from "./pagedQuery";

test("loads more than the PostgREST 1000-row response cap without truncation", async () => {
  const source = Array.from({ length: 2_307 }, (_, index) => ({ id: String(index), index }));
  const ranges: Array<[number, number]> = [];
  const result = await loadAllPagedRows(async (from, to) => {
    ranges.push([from, to]);
    return { data: source.slice(from, to + 1), error: null };
  });

  assert.equal(result.error, null);
  assert.equal(result.data?.length, 2_307);
  assert.deepEqual(ranges, [
    [0, 499],
    [500, 999],
    [1_000, 1_499],
    [1_500, 1_999],
    [2_000, 2_499],
  ]);
});

test("stops at the first failed page instead of returning a partial ledger", async () => {
  const result = await loadAllPagedRows(async (from) => (
    from === 500
      ? { data: null, error: { message: "network" } }
      : { data: Array.from({ length: 500 }, (_, index) => ({ id: String(index) })), error: null }
  ));
  assert.deepEqual(result, { data: null, error: { message: "network" } });
});

test("date/id keyset loading cannot skip older rows after a concurrent head insert", async () => {
  const original = Array.from({ length: 2_307 }, (_, index) => ({
    date: "2026-08-27",
    id: `row-${String(2_307 - index).padStart(6, "0")}`,
  }));
  let live = [...original];
  let pageCalls = 0;
  const result = await loadAllDateIdKeysetRows(async (cursor, limit) => {
    pageCalls += 1;
    if (pageCalls === 2) {
      live = [{ date: "2026-08-28", id: "new-head" }, ...live];
    }
    const rows = cursor
      ? live.filter(row => row.date < cursor.date || (row.date === cursor.date && row.id < cursor.id))
      : live;
    return { data: rows.slice(0, limit), error: null };
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.data, original);
  assert.equal(pageCalls, 5);
});

test("accepts database-collated mixed-case ids without re-sorting them in JavaScript", async () => {
  // PostgreSQL's production ICU en-US collation orders the uppercase-token row
  // before this lowercase-token row. JavaScript code-point `<` says the
  // opposite, even though PostgREST's ORDER BY and id.lt cursor agree.
  const databaseOrdered = [
    { date: "2026-08-19", id: "plaid:test:Z" },
    { date: "2026-08-19", id: "plaid:test:r" },
    { date: "2026-08-18", id: "plaid:test:next-day" },
  ];
  const result = await loadAllDateIdKeysetRows(async (cursor, limit) => {
    const start = cursor
      ? databaseOrdered.findIndex(row => row.date === cursor.date && row.id === cursor.id) + 1
      : 0;
    return { data: databaseOrdered.slice(start, start + limit), error: null };
  }, 1);

  assert.equal(result.error, null);
  assert.deepEqual(result.data, databaseOrdered);
});

test("keyset loading still fails closed on forward dates and repeated rows", async () => {
  let forwardPage = 0;
  const forward = await loadAllDateIdKeysetRows(async () => ({
    data: [forwardPage++ === 0
      ? { date: "2026-08-19", id: "first" }
      : { date: "2026-08-20", id: "unexpected-newer-date" }],
    error: null,
  }), 1);
  assert.match(forward.error?.message ?? "", /order changed/);

  let repeatedPage = 0;
  const repeated = await loadAllDateIdKeysetRows(async () => ({
    data: [repeatedPage++ === 0
      ? { date: "2026-08-19", id: "same-row" }
      : { date: "2026-08-19", id: "same-row" }],
    error: null,
  }), 1);
  assert.match(repeated.error?.message ?? "", /order changed/);
});

test("date/id keyset filters quote ids and invalid cursors fail closed", () => {
  assert.equal(
    dateIdKeysetFilter({ date: "2026-08-27", id: 'row."quoted"' }),
    'date.lt.2026-08-27,and(date.eq.2026-08-27,id.lt."row.\\"quoted\\"")',
  );
  assert.throws(
    () => dateIdKeysetFilter({ date: "2026-02-31", id: "row" }),
    /valid transaction cursor/,
  );
});

test("activity pagination appends and replaces duplicate rows by stable id", () => {
  assert.deepEqual(
    appendUniqueRowsById(
      [{ id: "a", value: 1 }, { id: "b", value: 2 }],
      [{ id: "b", value: 20 }, { id: "c", value: 3 }],
    ),
    [{ id: "a", value: 1 }, { id: "b", value: 20 }, { id: "c", value: 3 }],
  );
});

test("every growing transaction refresh uses the complete paged loader", () => {
  const context = readFileSync("context/BudgetContext.tsx", "utf8");
  assert.match(context, /const loadAllTransactions = useCallback/);
  assert.ok((context.match(/loadAllTransactions\(/g) ?? []).length >= 5);
  assert.match(context, /loadAllDateIdKeysetRows/);
  assert.match(context, /dateIdKeysetFilter\(cursor\)/);
  assert.match(context, /\.order\("date", \{ ascending: false \}\)[\s\S]*?\.order\("id", \{ ascending: false \}\)/);
  assert.doesNotMatch(context.slice(
    context.indexOf("const loadAllTransactions"),
    context.indexOf("const loadDailyCheckingCloses"),
  ), /\.range\(/);
  assert.doesNotMatch(context, /applyHouseholdSelect\(supabase\.from\("transactions"\)\.select\("\*"\), uid\)/);
});

test("startup renders core data before secondary debt maintenance and records only successful freshness", () => {
  const context = readFileSync("context/BudgetContext.tsx", "utf8");
  const loadStart = context.indexOf("// ── Load from Supabase");
  const loadEnd = context.indexOf("const loadBankData", loadStart);
  const source = context.slice(loadStart, loadEnd);
  assert.ok(source.indexOf("setDataUpdatedAt") < source.indexOf("sync_due_debt_transactions"));
  assert.match(source, /const secondaryCategoryRequest = Promise\.resolve/);
  assert.ok(source.indexOf("secondaryCategoryRequest.then") > source.indexOf("loadSucceeded = true"));
  assert.match(source, /Promise\.all\(\[[\s\S]*?Promise\.all\(\[[\s\S]*?loadBillDateMoves/);
  assert.match(source, /if \(loadSucceeded\) \{[\s\S]*?lastPlanRefreshAtRef\.current = Date\.now\(\)/);
});

test("native reconnect forces a background plan reload after an offline transition", () => {
  const context = readFileSync("context/BudgetContext.tsx", "utf8");
  assert.match(context, /subscribeNetworkStatus\(status =>/);
  assert.match(context, /status === false[\s\S]*?wasOffline = true/);
  assert.match(context, /status === true && wasOffline[\s\S]*?refreshPlanAfterReconnect/);
});
