import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { buildBillPaymentHistory, loadBillPaymentHistoryRows, paymentHistoryRowInScope, type PaymentHistoryRow as Row, type PaymentHistoryScope } from "./billPaymentHistory";
import { createNestedOverlayHistory } from "./nestedOverlayHistory";

const householdId = "11111111-1111-1111-1111-111111111111", otherHousehold = "22222222-2222-2222-2222-222222222222", userId = "33333333-3333-3333-3333-333333333333";
const scope: PaymentHistoryScope = { householdId, userId, isPersonal: true, role: "owner" };
const transaction = (extra: Row = {}): Row => ({ id: "t1", household_id: householdId, user_id: userId, linked_bill_id: "bill-a", date: "2026-09-10", matched_occurrence_date: "2026-09-15", amount: -40, source: "manual", ...extra });
const override = (extra: Row = {}): Row => ({ id: "o1", household_id: householdId, user_id: userId, bill_id: "bill-a", month: 8, year: 2026, paid_amount: 40, paid_date: "2026-09-10", ...extra });
const allocation = (extra: Row = {}): Row => ({ type: "bill", targetId: "bill-a", occurrenceDate: "2026-09-15", amount: 40, settlement: "partial", ...extra });
const history = (transactions: Row[], overrides: Row[] = []) => buildBillPaymentHistory({ billId: "bill-a", today: "2026-09-27", transactions, overrides, scope });

test("shows actual bill and debt-linked payments newest first without name guessing", () => {
  const result = history([transaction(), transaction({ id: "t2", linked_bill_id: null, debt_applied_bill_id: "bill-a", date: "2026-09-20", amount: -25 }), transaction({ id: "unlinked", linked_bill_id: null, name: "bill-a" })]);
  assert.deepEqual(result.entries.map(row => [row.date, row.amount]), [["2026-09-20", 25], ["2026-09-10", 40]]);
  assert.equal(result.paymentCount, 2); assert.equal(result.recordedPaidTotal, 65);
  assert.equal(result.entries[0].status, "Recorded payment");
});

test("split allocations use only this bill's slices and retain partial/extra status", () => {
  const row = transaction({ amount: -100, review_status: "matched", review_allocations: [allocation({ amount: 25 }), allocation({ targetId: "bill-b", amount: 65 }), allocation({ type: "extra_principal", amount: 10, settlement: "extra_principal" })] });
  const result = history([row]);
  assert.equal(result.recordedPaidTotal, 35); assert.equal(result.entries[0].status, "Partial payment");
  assert.equal(history([{ ...row, review_allocations: [allocation({ type: "extra_principal", amount: 100, settlement: "extra_principal" })] }]).entries[0].status, "Includes extra principal");
});

test("unbalanced, malformed or unreviewed allocation evidence cannot make up a total", () => {
  for (const patch of [{ review_allocations: [allocation({ amount: 39 })], review_status: "matched" }, { review_allocations: [allocation()], review_status: "legacy_reviewed" }, { review_allocations: [allocation(), null], review_status: "matched" }, { review_allocations: { amount: 40 }, review_status: "matched" }]) {
    const result = history([transaction(patch)]);
    assert.equal(result.entries.length, 0); assert.equal(result.recordedPaidTotal, null); assert.ok(result.notices.length);
  }
});

test("excludes pending, removed, deleted, future, positive, transfer and scheduled rows", () => {
  const patches: Row[] = [{ pending: true }, { removed_at: "2026-09-11" }, { deleted_at: "2026-09-11" }, { date: "2026-09-28" }, { amount: 40 }, { review_status: "transfer" }, { review_resolution: "transfer" }, { transfer_group_id: "transfer-1" }, { source: "snowball_plan" }, { source: "plaid", review_status: "needs_review" }];
  assert.equal(history(patches.map((patch, index) => transaction({ id: `t${index}`, ...patch }))).entries.length, 0);
});

test("missing or invalid actual dates and amounts are flagged rather than fabricated", () => {
  for (const patch of [{ date: null }, { date: "2026-02-30" }, { amount: "NaN" }, { amount: Infinity }, { amount: null }]) {
    const result = history([transaction(patch)]);
    assert.equal(result.paymentCount, 0); assert.equal(result.recordedPaidTotal, null); assert.match(result.notices.join(" "), /invalid amount or missing payment date/);
  }
});

test("same provider payment is counted once; three conflicting copies cannot resurrect it", () => {
  const row = transaction({ source: "plaid", review_status: "matched", plaid_transaction_id: "provider-1" });
  assert.equal(history([row, { ...row, id: "t2" }]).recordedPaidTotal, 40);
  const conflict = history([row, { ...row, id: "t2", amount: -50 }, { ...row, id: "t3" }]);
  assert.equal(conflict.paymentCount, 0); assert.equal(conflict.recordedPaidTotal, null); assert.match(conflict.notices.join(" "), /conflicting/);
  assert.equal(history([row, { ...row, id: "t2", plaid_transaction_id: "provider-2" }]).paymentCount, 2);
});

test("posted replacement inherits exact bill identity and actual amount/date, not removed manual amount", () => {
  const manual = transaction({ id: "manual", amount: -100, removed_at: "2026-09-20", match_reason: "replaced_by_posted_transaction" });
  const posted = transaction({ id: "posted", linked_bill_id: null, amount: -60, date: "2026-09-20", source: "plaid", plaid_transaction_id: "bank", linked_plan_id: "manual", linked_plan_type: "transaction", review_status: "matched", review_resolution: "manual", match_reason: "confirmed_manual_match", review_allocations: [{ type: "planned_expense", source: "transaction", targetId: "manual", amount: 60, settlement: "partial" }] });
  const result = history([manual, posted]);
  assert.equal(result.paymentCount, 1); assert.equal(result.recordedPaidTotal, 60); assert.equal(result.entries[0].date, "2026-09-20"); assert.equal(result.entries[0].status, "Partial payment");
  const split = history([{ ...manual, review_allocations: [allocation({ amount: 50 }), allocation({ amount: 50, targetId: "bill-b" })] }, posted]);
  assert.equal(split.paymentCount, 0); assert.equal(split.recordedPaidTotal, null); assert.match(split.notices.join(" "), /allocation reviewed/);
});

test("monthly fallback is clearly aggregate; moved payment date does not duplicate its original cycle", () => {
  const result = history([transaction({ date: "2026-09-02", matched_occurrence_date: "2026-08-29" })], [override({ id: "aug", month: 7, paid_date: "2026-09-02" }), override({ id: "july", month: 6, paid_amount: 30, paid_date: "2026-07-29" })]);
  assert.equal(result.paymentCount, 1); assert.equal(result.monthlyRecordCount, 1); assert.equal(result.recordedPaidTotal, 70);
  assert.equal(result.entries[1].kind, "monthly_record"); assert.match(result.entries[1].status, /not an individual payment/);
});

test("monthly total exceeding known regular coverage is not added or silently ignored", () => {
  const result = history([transaction({ amount: -25 })], [override({ paid_amount: 100 })]);
  assert.equal(result.paymentCount, 1); assert.equal(result.monthlyRecordCount, 0); assert.equal(result.recordedPaidTotal, null); assert.match(result.notices.join(" "), /higher than its detailed/);
  assert.equal(history([transaction()], [override()]).recordedPaidTotal, 40);
  const extra = history([transaction({ review_status: "matched", review_allocations: [allocation({ type: "extra_principal", settlement: "extra_principal" })] })], [override()]);
  assert.equal(extra.recordedPaidTotal, null, "extra principal does not cover regular cycle total");
});

test("unknown cycle retains useful monthly records but never sums potential overlap", () => {
  const result = history([transaction({ matched_occurrence_date: null })], [override()]);
  assert.equal(result.paymentCount, 1); assert.equal(result.monthlyRecordCount, 1); assert.equal(result.recordedPaidTotal, null); assert.match(result.entries.find(row => row.kind === "monthly_record")!.status, /may overlap/);
});

test("undated monthly records remain undated and invalid monthly amounts never display NaN", () => {
  const result = history([], [override({ paid_date: null })]);
  assert.equal(result.entries[0].date, null); assert.equal(result.entries[0].cycle, "2026-09"); assert.equal(result.recordedPaidTotal, null);
  assert.equal(history([], [override({ paid_amount: "NaN" })]).entries.length, 0);
  assert.equal(history([], [override({ month: 9, paid_date: null })]).entries.length, 0);
});

test("hidden payment cannot return as fallback but does not hide unrelated monthly cycles", () => {
  const result = history([transaction({ removed_at: "2026-09-11", matched_occurrence_date: null })], [override(), override({ id: "aug", month: 7, paid_date: "2026-08-10" })]);
  assert.equal(result.entries.length, 1); assert.equal(result.entries[0].cycle, "2026-08");
});

test("household and legacy ownership isolation applies to selector and helper", () => {
  const legacy = transaction({ id: "legacy", household_id: null });
  const result = history([legacy, transaction({ id: "foreign", household_id: otherHousehold }), transaction({ id: "foreign-personal", household_id: null, user_id: "other" })]);
  assert.equal(result.paymentCount, 1);
  assert.equal(paymentHistoryRowInScope(legacy, { ...scope, role: "viewer" }), false);
  assert.equal(paymentHistoryRowInScope(legacy, { ...scope, isPersonal: false }), false);
});

type Call = { table: string; ops: [string, unknown, unknown?][] };
function fakeClient(tables: Record<string, Row[]>, options: { error?: string; onRead?: () => void; leak?: Row } = {}) {
  const calls: Call[] = [];
  return { calls, from(table: string) {
    const call: Call = { table, ops: [] }; calls.push(call);
    const predicates: ((row: Row) => boolean)[] = []; let limit = 500;
    const query = {
      select(value: string) { call.ops.push(["select", value]); return query; },
      eq(key: string, value: unknown) { call.ops.push(["eq", key, value]); predicates.push(row => row[key] === value); return query; },
      contains(key: string, value: string) { call.ops.push(["contains", key, value]); const needles: Row[] = JSON.parse(value); predicates.push(row => Array.isArray(row[key]) && needles.every(needle => (row[key] as Row[]).some(item => Object.entries(needle).every(([k, v]) => item[k] === v)))); return query; },
      or(value: string) { call.ops.push(["or", value]); predicates.push(row => paymentHistoryRowInScope(row, scope)); return query; },
      order(key: string, value: unknown) { call.ops.push(["order", key, value]); return query; },
      limit(value: number) { call.ops.push(["limit", value]); limit = value; return query; },
      gt(key: string, value: string) { call.ops.push(["gt", key, value]); predicates.push(row => String(row[key]) > value); return query; },
      in(key: string, value: string[]) { call.ops.push(["in", key, value]); predicates.push(row => value.includes(String(row[key]))); return query; },
      abortSignal(value: AbortSignal) { call.ops.push(["abortSignal", value]); return query; },
      then(resolve: (value: { data: Row[] | null; error: unknown }) => unknown) { options.onRead?.(); return Promise.resolve(resolve({ data: options.leak ? [options.leak] : (tables[table] ?? []).filter(row => predicates.every(fn => fn(row))).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, limit), error: options.error ? { message: options.error } : null })); },
    }; return query;
  } };
}

test("loader pages each scoped exact branch, unions overlapping IDs and never queries raw bank/plans", async () => {
  const rows = Array.from({ length: 5 }, (_, index) => transaction({ id: `t${index}`, debt_applied_bill_id: "bill-a", review_status: "matched", review_allocations: [allocation()] }));
  const client = fakeClient({ transactions: [...rows, transaction({ id: "other", household_id: otherHousehold }), transaction({ id: "wrong-bill", linked_bill_id: "bill-b" })], monthly_overrides: [override(), override({ id: "o2", month: 7 }), override({ id: "o3", month: 6 })] });
  const loaded = await loadBillPaymentHistoryRows(client, { billId: "bill-a", scope, pageSize: 2 });
  assert.equal(loaded.transactions.length, 5); assert.equal(loaded.overrides.length, 3); assert.ok(client.calls.some(call => call.ops.some(op => op[0] === "gt")));
  assert.ok(client.calls.every(call => ["transactions", "monthly_overrides"].includes(call.table) && call.ops.some(op => op[0] === "or") && call.ops.some(op => op[0] === "order" && op[1] === "id")));
  assert.ok(client.calls.some(call => call.ops.some(op => op[0] === "contains" && String(op[2]).includes('"type":"extra_principal"'))));
});

test("installed Supabase client sends valid JSONB containment with escaped bill IDs and unchanged scope", async () => {
  const billId = 'bill,"quoted"\\path&other=wrong';
  for (const membership of [scope, { ...scope, role: "viewer" as const }]) {
    const requests: URL[] = [];
    const client = createClient("https://payment-history.test", "test-public-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async (input, init) => {
        assert.equal(init?.method, "GET");
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        requests.push(url);
        // This is the real installed SDK's wire format, not fakeClient's
        // semantic contains implementation. No network request is made.
        const predicate = url.searchParams.get("review_allocations");
        if (predicate) {
          assert.ok(predicate.startsWith("cs.["), predicate);
          const value = JSON.parse(predicate.slice(3));
          assert.equal(value.length, 1); assert.equal(value[0].targetId, billId);
          assert.ok(["bill", "extra_principal"].includes(value[0].type));
        }
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      } },
    });
    const result = await loadBillPaymentHistoryRows(client, { billId, scope: membership });
    assert.deepEqual(result, { transactions: [], overrides: [] }); assert.equal(requests.length, 5);
    const predicates = requests.map(url => url.searchParams.get("review_allocations")).filter((value): value is string => value !== null);
    assert.deepEqual(predicates.sort(), ["bill", "extra_principal"].map(type => `cs.${JSON.stringify([{ type, targetId: billId }])}`).sort());
    for (const url of requests) {
      assert.equal(url.searchParams.get("order"), "id.asc"); assert.equal(url.searchParams.get("limit"), "500");
      assert.equal(url.searchParams.get("other"), null, "bill ID text must not become a separate filter");
      if (membership.role === "owner") {
        assert.equal(url.searchParams.get("or"), `(household_id.eq.${householdId},and(household_id.is.null,user_id.eq.${userId}))`);
      } else {
        assert.equal(url.searchParams.get("or"), null); assert.equal(url.searchParams.get("household_id"), `eq.${householdId}`);
      }
    }
    assert.ok(requests.some(url => url.searchParams.get("linked_bill_id") === `eq.${billId}`));
    assert.ok(requests.some(url => url.searchParams.get("debt_applied_bill_id") === `eq.${billId}`));
  }
});

test("loader retrieves exact removed-manual replacement without guessing merchant names", async () => {
  const manual = transaction({ id: "manual", removed_at: "2026-09-20", match_reason: "replaced_by_posted_transaction" });
  const replacement = transaction({ id: "posted", linked_bill_id: null, linked_plan_id: "manual", linked_plan_type: "transaction", review_resolution: "manual" });
  const client = fakeClient({ transactions: [manual, replacement, { ...replacement, id: "foreign", household_id: otherHousehold }] });
  const result = await loadBillPaymentHistoryRows(client, { billId: "bill-a", scope });
  assert.deepEqual(result.transactions.map(row => row.id), ["manual", "posted"]);
  assert.ok(client.calls.some(call => call.ops.some(op => op[0] === "in" && op[1] === "linked_plan_id")));
});

test("only personal owners can load legacy records; arbitrary text bill IDs remain exact filters", async () => {
  const billId = 'bill-a,(linked_bill_id.neq.x)';
  const client = fakeClient({ transactions: [transaction({ linked_bill_id: billId }), transaction({ id: "legacy", linked_bill_id: billId, household_id: null })] });
  const result = await loadBillPaymentHistoryRows(client, { billId, scope: { ...scope, role: "viewer" } });
  assert.equal(result.transactions.length, 1); assert.ok(client.calls.every(call => !call.ops.some(op => op[0] === "or")));
  assert.ok(client.calls.some(call => call.ops.some(op => op[0] === "eq" && op[1] === "linked_bill_id" && op[2] === billId)));
});

test("loader errors, foreign results and cancellation are failures, never empty successful history", async () => {
  await assert.rejects(loadBillPaymentHistoryRows(fakeClient({}, { error: "server details" }), { billId: "bill-a", scope }), /could not be loaded/);
  await assert.rejects(loadBillPaymentHistoryRows(fakeClient({}, { leak: transaction({ household_id: otherHousehold }) }), { billId: "bill-a", scope }), /could not be verified/);
  const aborted = new AbortController(); aborted.abort();
  const client = fakeClient({}); await assert.rejects(loadBillPaymentHistoryRows(client, { billId: "bill-a", scope, signal: aborted.signal }), /cancelled/); assert.equal(client.calls.length, 0);
  const inFlight = new AbortController();
  await assert.rejects(loadBillPaymentHistoryRows(fakeClient({}, { onRead: () => inFlight.abort() }), { billId: "bill-a", scope, signal: inFlight.signal }), /cancelled/);
});

test("history is on-demand within the original editor modal; Back does not save/reset the draft", () => {
  const root = path.resolve(__dirname, "..");
  const editor = readFileSync(path.join(root, "components/AddBillModal.tsx"), "utf8");
  const panel = readFileSync(path.join(root, "components/BillPaymentHistoryPanel.tsx"), "utf8");
  assert.equal((editor.match(/<Modal\s/g) ?? []).length, 1); assert.doesNotMatch(panel, /<Modal\s/);
  assert.match(editor, /historyVisible && editBill \? <BillPaymentHistoryPanel/); assert.match(editor, /onPress=\{\(\) => setHistoryVisible\(false\)\}/);
  assert.match(editor, /Keyboard\.dismiss\(\)/); assert.match(panel, /scopeKey !== openedScope/); assert.match(panel, /state\.key === scopeKey/);
  assert.match(panel, /activeHousehold\?\.isPersonal/); assert.match(panel, /current = false; controller\.abort\(\)/); assert.match(panel, /flexShrink: 1, minHeight: 0/);
  assert.doesNotMatch(panel, /\.(insert|update|delete|upsert|rpc)\(/);
});

function fakeHistory(deferred = false) {
  const stack: Record<string, unknown>[] = [{ route: "previous" }, { route: "bills" }];
  let index = 1; const listeners = new Set<() => void>(); const queue: (() => void)[] = [];
  const host = {
    history: {
      get state() { return stack[index]; },
      pushState(value: Record<string, unknown>) { stack.splice(index + 1); stack.push(value); index++; },
      back() { const pop = () => { if (index > 0) { index--; [...listeners].forEach(listener => listener()); } }; if (deferred) queue.push(pop); else pop(); },
    }, location: { href: "https://example.test/bills" },
    addEventListener(_type: "popstate", listener: () => void) { listeners.add(listener); },
    removeEventListener(_type: "popstate", listener: () => void) { listeners.delete(listener); },
  };
  return { host, listeners, position: () => index, flush: () => { while (queue.length) queue.shift()!(); } };
}

test("browser Back returns history to unchanged draft, then closes editor without leaving bills", () => {
  const browser = fakeHistory(); let nested = false, closed = false; const draft = { amount: "123.45" };
  const controller = createNestedOverlayHistory(browser.host, () => { if (nested) { nested = false; controller.setNested(false); } else { closed = true; controller.dispose(); } });
  nested = true; controller.setNested(true); assert.equal(browser.listeners.size, 1);
  browser.host.history.back(); assert.equal(nested, false); assert.equal(closed, false); assert.equal(draft.amount, "123.45"); assert.equal(browser.position(), 2);
  browser.host.history.back(); assert.equal(closed, true); assert.deepEqual(browser.host.history.state, { route: "bills" }); assert.equal(browser.position(), 1);
});

test("UI Back consumes only history entry and does not swallow the next browser Back", () => {
  const browser = fakeHistory(); let dismissals = 0;
  const controller = createNestedOverlayHistory(browser.host, () => { dismissals++; controller.dispose(); });
  controller.setNested(true); controller.setNested(false);
  assert.equal(browser.position(), 2); assert.equal(dismissals, 0);
  browser.host.history.back(); assert.equal(dismissals, 1); assert.equal(browser.position(), 1);
});

test("closing nested editor cleans only its owned nested entry and removes its listener", () => {
  const browser = fakeHistory(); let dismissals = 0;
  const controller = createNestedOverlayHistory(browser.host, () => { dismissals++; });
  controller.setNested(true); controller.dispose();
  assert.equal(browser.position(), 2); assert.equal(browser.host.history.state.route, "bills"); assert.equal(dismissals, 0); assert.equal(browser.listeners.size, 0);
});

test("asynchronous UI Back followed by reopening history does not dismiss or duplicate the editor", () => {
  const browser = fakeHistory(true); let dismissals = 0;
  const controller = createNestedOverlayHistory(browser.host, () => { dismissals++; controller.setNested(false); });
  controller.setNested(true); controller.setNested(false); controller.setNested(true);
  browser.flush(); assert.equal(dismissals, 0); assert.equal(browser.position(), 3); assert.equal(browser.listeners.size, 1);
  browser.host.history.back(); browser.flush(); assert.equal(dismissals, 1); assert.equal(browser.position(), 2);
  controller.dispose();
});

test("closing and immediately reopening an editor waits for the old owned traversal", () => {
  for (const uiBackAlreadyPending of [false, true]) {
    const browser = fakeHistory(true); let dismissals = 0;
    const first = createNestedOverlayHistory(browser.host, () => { throw new Error("Closed editor received Back"); });
    first.setNested(true); if (uiBackAlreadyPending) first.setNested(false); first.dispose();
    const second = createNestedOverlayHistory(browser.host, () => { dismissals++; second.setNested(false); });
    second.setNested(true);
    assert.equal(browser.position(), 3, "no new entry before the old asynchronous traversal finishes");
    assert.equal(browser.listeners.size, 1, "only the owned traversal listener while waiting");
    browser.flush(); assert.equal(dismissals, 0); assert.equal(browser.position(), 4); assert.equal(browser.listeners.size, 1);
    browser.host.history.back(); browser.flush(); assert.equal(dismissals, 1); assert.equal(browser.position(), 3);
    second.dispose(); assert.equal(browser.listeners.size, 0);
  }
});

test("an editor closed while awaiting an old traversal never mounts its history listener", () => {
  const browser = fakeHistory(true);
  const first = createNestedOverlayHistory(browser.host, () => {}); first.setNested(true); first.dispose();
  const second = createNestedOverlayHistory(browser.host, () => { throw new Error("Disposed queued editor received Back"); });
  second.setNested(true); second.dispose(); browser.flush();
  assert.equal(browser.position(), 2); assert.equal(browser.listeners.size, 0);
});
