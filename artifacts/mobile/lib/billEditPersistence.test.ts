import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ModuleKind, transpileModule } from "typescript";

import {
  billEditablePatch,
  billEditableDbPatch,
  billEditableValuesEqual,
  changedBillEditableFields,
  normalizedBillEditableFields,
  type BillEditableField,
} from "./billEditPersistence";
import { activeVersionedPatch, assertFinancialMutationScope, enqueueMutationByKey, enqueueMutationByKeys, monthlyOverridePatchDbPayload, runRecoverableFinancialMutation } from "./financialMutationRecovery";
import { addDebtPaymentPause, isDebtPaymentPauseDate, normalizeDebtPaymentPauses, resumeDebtPaymentPause, type DebtPaymentPause } from "./debtPaymentPause";
import { normalizeBillRow, normalizeMonthlyOverrideRow } from "./financialProjectionInput";
import type { Bill } from "./financialProjectionTypes";
import { parseBudgetPlanCache } from "./budgetPlanCache";

type EditableBill = Record<BillEditableField, unknown>;

function bill(overrides: Partial<EditableBill> = {}): EditableBill {
  return {
    name: "Card",
    amount: 50,
    category: "Debt",
    priority: 1,
    is_debt: true,
    balance: 900,
    interest_rate: 12,
    due_day: 15,
    day_of_week: 0,
    next_payment_date: undefined,
    start_date: "2026-01-01",
    end_date: undefined,
    is_recurring: true,
    frequency: "monthly",
    smart_priority: "must",
    include_in_snowball: true,
    debt_payment_pauses: [],
    ...overrides,
  };
}

test("an editor reports only fields changed from its open-time baseline", () => {
  const baseline = bill();
  const submitted = bill({ name: "Travel Card", due_day: 20 });
  assert.deepEqual(changedBillEditableFields(baseline, submitted), ["name", "due_day"]);
  assert.deepEqual(billEditablePatch(submitted, ["name", "due_day"]), {
    name: "Travel Card",
    due_day: 20,
  });
});

const pause = (patch: Partial<DebtPaymentPause> = {}): DebtPaymentPause => ({
  id: "pause-history", start_date: "2026-01-01", resume_date: "2026-02-01", redirect_payment: false, ...patch,
});

test("pause history uses normalized JSON equality and an empty legacy CAS baseline", () => {
  const history = [pause()];
  const baseline = bill({ debt_payment_pauses: history });
  const cloned = bill({ debt_payment_pauses: [{ redirect_payment: false, resume_date: "2026-02-01", start_date: "2026-01-01", id: "pause-history" }] });
  assert.deepEqual(changedBillEditableFields(baseline, cloned), []);
  assert.deepEqual(changedBillEditableFields(bill({ debt_payment_pauses: undefined }), bill()), []);
  assert.deepEqual(billEditableDbPatch({ debt_payment_pauses: undefined }, ["debt_payment_pauses"]), { debt_payment_pauses: [] });
  assert.deepEqual(billEditablePatch(cloned, ["name"]), { name: "Card" });
  assert.deepEqual(changedBillEditableFields(baseline, bill({ debt_payment_pauses: [pause({ redirect_payment: true })] })), ["debt_payment_pauses"]);
  assert.throws(() => billEditableDbPatch({ debt_payment_pauses: "broken" }, ["debt_payment_pauses"]), /intervals/);
});

test("an unrelated editor save never includes a stale debt balance", () => {
  const openTime = bill({ balance: 900 });
  const submitted = bill({ name: "Renamed Card", balance: 900 });
  const liveAfterPayment = bill({ balance: 825 });
  const fields = changedBillEditableFields(openTime, submitted);
  const merged = { ...liveAfterPayment, ...billEditablePatch(submitted, fields) };
  assert.deepEqual(fields, ["name"]);
  assert.equal(merged.balance, 825);
  assert.equal(merged.name, "Renamed Card");
  assert.deepEqual(billEditableDbPatch(openTime, fields), { name: "Card" });
  assert.deepEqual(billEditableDbPatch(submitted, fields), { name: "Renamed Card" });
});

test("a deliberate balance edit carries its open-time value for conflict detection", () => {
  const openTime = bill({ balance: 900 });
  const submitted = bill({ balance: 850 });
  const fields = changedBillEditableFields(openTime, submitted);
  assert.deepEqual(fields, ["balance"]);
  assert.deepEqual(billEditableDbPatch(openTime, fields), { balance: 900 });
  assert.deepEqual(billEditableDbPatch(submitted, fields), { balance: 850 });
});

test("persistence contracts update only owned columns across Review Center races", () => {
  const context = readFileSync("context/BudgetContext.tsx", "utf8");
  const overrideStart = context.indexOf("const persistMonthlyOverrideWriteIntent");
  const overrideEnd = context.indexOf("// ─── Bills", overrideStart);
  const overrideWrite = context.slice(overrideStart, overrideEnd);
  assert.match(overrideWrite, /monthlyOverridePatchDbPayload\(effectivePatch\)/);
  assert.match(overrideWrite, /\.update\(dbPatch\)/);
  assert.doesNotMatch(overrideWrite, /monthlyOverrideDbPayload\(updated\)/);

  const billStart = context.indexOf("const updateBill");
  const billEnd = context.indexOf("const stopFutureBill", billStart);
  const billWrite = context.slice(billStart, billEnd);
  assert.match(billWrite, /billEditablePatch\(bill, editableFields\)/);
  assert.match(billWrite, /billEditableDbPatch\(reviewedBill, activeEditableFields\)/);
  assert.match(billWrite, /update_bill_with_override_intents/);
  assert.match(billWrite, /p_expected: expectedBillPatch/);
  assert.match(billWrite, /p_patch: persistedBillPatch/);
  assert.match(billWrite, /p_overrides: activeOverrideIntents/);
  assert.match(billWrite, /expected: monthlyOverridePatchDbPayload/);
  assert.match(billWrite, /enqueueMutationByKeys/);
  const realPersist = billWrite.slice(billWrite.indexOf("const persist:"));
  assert.doesNotMatch(realPersist, /Promise\.all\(overrideIntents\.map\(persistMonthlyOverrideWriteIntent\)\)/);
  assert.doesNotMatch(billWrite, /\.update\(\{[\s\S]*\.\.\.reviewedBill/);
});

test("database contract rejects duplicate monthly override occurrences", () => {
  const migration = readFileSync("../../supabase/migrations/20260825094545_unique_monthly_override_occurrences.sql", "utf8");
  assert.match(migration, /having count\(\*\) > 1/i);
  assert.match(migration, /alter column household_id set not null/i);
  assert.match(migration, /create unique index[\s\S]+household_id, bill_id, month, year/i);
  assert.match(migration, /function public\.update_bill_with_override_intents/i);
  assert.match(migration, /from public\.bills[\s\S]+for update/i);
  assert.match(migration, /update public\.bills set[\s\S]+insert into public\.monthly_overrides/i);
  assert.match(migration, /on conflict \(household_id, bill_id, month, year\) do nothing/i);
  assert.match(migration, /v_override_expected[\s\S]+for update[\s\S]+is distinct from/i);
  assert.match(migration, /foreign key \(household_id\)[\s\S]+on delete cascade/i);
  assert.match(migration, /perform public\.recalculate_debt_minimum_boosts/i);
});

test("manual debt finalization persists an immutable required amount snapshot", () => {
  assert.deepEqual(monthlyOverridePatchDbPayload({
    actual_amount: 1000,
    paid_amount: 1000,
    paid_date: "2026-08-04",
    required_debt_amount: 1500,
  }), {
    actual_amount: 1000,
    paid_amount: 1000,
    paid_date: "2026-08-04",
    required_debt_amount: 1500,
  });

  const context = readFileSync("context/BudgetContext.tsx", "utf8");
  const finalizationStart = context.indexOf("const finalizeBillPayment");
  const finalizationEnd = context.indexOf("// ─── Transactions", finalizationStart);
  const finalization = context.slice(finalizationStart, finalizationEnd);
  assert.ok(finalizationStart >= 0 && finalizationEnd > finalizationStart);
  assert.match(finalization, /const requiredDebtAmount = bill\.is_debt[\s\S]+getDebtMonthSettlements/);
  assert.match(finalization, /await upsertOverride\([\s\S]+required_debt_amount: requiredDebtAmount/);

  const migration = readFileSync("../../supabase/migrations/20260827040341_debt_required_amount_snapshot.sql", "utf8");
  assert.match(migration, /add column if not exists required_debt_amount numeric/i);
  assert.match(migration, /check \(required_debt_amount is null or required_debt_amount >= 0\)/i);
});

/** Execute the actual context callbacks and tracked/queued save path with a CAS database. */
function pausePersistenceHarness(initialPauses: DebtPaymentPause[] | undefined = undefined) {
  const initial = { ...bill(), id: "card", created_at: "2026-01-01T00:00:00Z", debt_payment_pauses: initialPauses } as Bill;
  const scope = { householdId: "home-a", budgetId: "budget-a", role: "owner" };
  const state = {
    bills: [initial], stored: structuredClone(initial), today: "2026-11-03", canEdit: true, online: true,
    error: null as string | null, errors: [] as string[], gate: null as Promise<void> | null,
    writes: [] as Array<{ name: string; args: Record<string, any> }>,
    retry: null as null | (() => Promise<void>), clears: 0,
  };
  const householdScopeRef = { current: { ...scope } };
  const userScopeIdRef = { current: "user-a" };
  const financialDataUserIdRef = { current: "user-a" };
  const financialScopeGenerationRef = { current: 1 };
  const settingsRef = { current: { debtPayoffEnabled: true } };
  const startupCoreReadyScopeKeyRef = { current: "user-a:home-a" as string | null };
  const bindings: Record<string, unknown> = {
    useCallback: (callback: unknown) => callback,
    user: { id: "user-a" }, userScopeIdRef, financialDataUserIdRef, financialScopeGenerationRef,
    householdScopeRef, settingsRef, startupCoreReadyScopeKeyRef, householdTimeZone: "Pacific/Honolulu", demoMode: false,
    saveLifecycleGenerationRef: { current: 1 },
    assertCanEditHousehold: () => {
      if (!state.canEdit) throw new Error("View-only household access cannot change debt payments.");
      if (!state.online) throw new Error("You are offline. Reconnect to save this change.");
    },
    safeLocalDateInTimeZone: (_date: Date, zone: string) => { assert.equal(zone, "Pacific/Honolulu"); return state.today; },
    genId: (() => { let id = 0; return () => `save-${++id}`; })(),
    billEditablePatch, billEditableDbPatch, billEditableValuesEqual, normalizedBillEditableFields,
    addDebtPaymentPause, isDebtPaymentPauseDate, normalizeDebtPaymentPauses, resumeDebtPaymentPause,
    activeVersionedPatch, enqueueMutationByKey, enqueueMutationByKeys, monthlyOverridePatchDbPayload,
    assertFinancialMutationScope, runRecoverableFinancialMutation, normalizeBillRow, normalizeMonthlyOverrideRow,
    overridesRef: { current: [] }, billOverrideRetryIdsRef: { current: new Map() },
    billEditFieldTokensRef: { current: new Map() }, billWriteQueuesRef: { current: new Map() },
    monthlyOverrideFieldTokensRef: { current: new Map() }, monthlyOverrideStableIdsRef: { current: new Map() },
    monthlyOverrideWriteQueuesRef: { current: new Map() }, debtPaymentPauseInFlightRef: { current: new Set() },
    createMonthlyOverrideWriteIntent: () => { throw new Error("A pause must not change monthly overrides."); },
    persistMonthlyOverrideWriteIntent: async () => undefined,
    pastActiveMonthsForBill: () => [], reorderDebtPriorities: (rows: Bill[]) => rows,
    setBills: (next: (rows: Bill[]) => Bill[]) => { state.bills = next(state.bills); },
    setOverrides: () => { throw new Error("A pause must not change monthly overrides."); },
    clearScopedFinancialData: () => { state.clears++; state.bills = []; },
    markSaveStarted: () => 1, markSaveCompleted: () => undefined,
    markSaveFailed: (error: Error, retry: () => Promise<void>) => { state.errors.push(error.message); state.retry = retry; },
    supabase: { rpc: async (name: string, args: Record<string, any>) => {
      state.writes.push({ name, args });
      if (state.gate) await state.gate;
      if (state.error) return { data: null, error: { message: state.error } };
      for (const [field, expected] of Object.entries(args.p_expected)) {
        if (!billEditableValuesEqual(field as BillEditableField, state.stored[field as keyof Bill], expected)) {
          return { data: null, error: { message: "This bill changed. Refresh and try again." } };
        }
      }
      state.stored = { ...state.stored, ...args.p_patch };
      return { data: { bill: structuredClone(state.stored), overrides: [], debt_minimums: [] }, error: null };
    } },
  };
  const context = readFileSync("context/BudgetContext.tsx", "utf8");
  const trackedStart = context.indexOf("  const runTrackedFinancialMutation =");
  const tracked = context.slice(trackedStart, context.indexOf("  const retryLastSave =", trackedStart));
  const start = context.indexOf("  const updateBill =");
  const actions = context.slice(start, context.indexOf("  const stopFutureBill =", start));
  const js = transpileModule(`${tracked}\n${actions}`, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const render = () => {
    const values = { ...bindings, bills: state.bills, activeHousehold: { ...householdScopeRef.current } };
    return new Function(...Object.keys(values), `${js}; return {pauseDebtPayments,resumeDebtPayments,updateBill};`)(...Object.values(values)) as {
      pauseDebtPayments: (id: string, input: { startDate: string; resumeDate: string; redirectPayment: boolean }) => Promise<void>;
      resumeDebtPayments: (id: string, pauseId: string) => Promise<void>;
    };
  };
  return { state, render, householdScopeRef, userScopeIdRef, financialDataUserIdRef, financialScopeGenerationRef, settingsRef, startupCoreReadyScopeKeyRef,
    billWriteQueuesRef: bindings.billWriteQueuesRef as { current: Map<string, Promise<unknown>> } };
}

const newPause = { startDate: "2026-11-03", resumeDate: "2027-01-03", redirectPayment: true };
const tick = () => new Promise(resolve => setImmediate(resolve));

test("actual pause save sends only pause history with an exact CAS baseline and survives reload", async () => {
  for (const previous of [undefined, [pause()]]) {
    const harness = pausePersistenceHarness(previous);
    const original = structuredClone(harness.state.bills[0]);
    await harness.render().pauseDebtPayments("card", newPause);
    const { args, name } = harness.state.writes[0];
    assert.equal(name, "update_bill_with_override_intents");
    assert.deepEqual(args.p_expected, { debt_payment_pauses: previous ?? [] });
    assert.deepEqual(Object.keys(args.p_patch), ["debt_payment_pauses"]);
    assert.deepEqual(args.p_overrides, []);
    const saved = normalizeBillRow(JSON.parse(JSON.stringify(harness.state.stored)));
    assert.deepEqual(saved.debt_payment_pauses, [...(previous ?? []), { id: "save-1", start_date: newPause.startDate, resume_date: newPause.resumeDate, redirect_payment: true }]);
    for (const field of ["amount", "balance", "priority", "end_date", "include_in_snowball", "is_recurring", "frequency"] as const) assert.equal(saved[field], original[field]);
    assert.deepEqual(harness.state.errors, []);
  }
});

test("the actual household cache and bill normalization retain full pause history", async () => {
  const harness = pausePersistenceHarness([pause()]);
  await harness.render().pauseDebtPayments("card", newPause);
  const household = { householdId: "home-a", budgetId: "budget-a", name: "Home", isPersonal: true, role: "owner" };
  const arrays = Object.fromEntries(["overrides", "billDateMoves", "transactions", "deletedTransactions", "pendingBankTransactions", "pendingPlanMatches", "incomes", "goals", "extraPayments", "categories", "accounts", "connectedBankAccounts", "dailyCheckingCloses", "transactionAccountIdentities", "decisions"].map(key => [key, []]));
  const cached = parseBudgetPlanCache(JSON.stringify({
    version: 1, userId: "user-a", household, households: [household],
    savedAt: "2026-11-03T00:00:00Z", dataUpdatedAt: "2026-11-03T00:00:00Z",
    data: { ...arrays, bills: [harness.state.stored], householdTimeZone: "Pacific/Honolulu", settings: {} },
  }), "user-a", "home-a");
  assert.ok(cached);
  assert.deepEqual(normalizeBillRow(cached.data.bills[0]).debt_payment_pauses, harness.state.stored.debt_payment_pauses);
});

test("actual failed save rolls back cloned pause JSON, preserves other edits, and retries the same ID", async () => {
  const harness = pausePersistenceHarness([pause()]);
  let release!: () => void;
  harness.state.gate = new Promise<void>(resolve => { release = resolve; });
  harness.state.error = "Connection lost";
  const saving = harness.render().pauseDebtPayments("card", newPause);
  await tick();
  const submitted = structuredClone(harness.state.bills[0].debt_payment_pauses);
  harness.state.bills = [{ ...harness.state.bills[0], name: "Renamed while saving", debt_payment_pauses: structuredClone(submitted) }];
  release();
  await assert.rejects(saving, /Connection lost/);
  assert.deepEqual(harness.state.bills[0].debt_payment_pauses, [pause()]);
  assert.equal(harness.state.bills[0].name, "Renamed while saving");
  assert.match(harness.state.errors[0], /Connection lost/);
  harness.state.error = null;
  await harness.state.retry!();
  assert.deepEqual(harness.state.bills[0].debt_payment_pauses, submitted);
  assert.deepEqual(harness.state.writes[1].args, harness.state.writes[0].args);
});

test("actual pause saves reject double submissions and conflicting saved history", async () => {
  const harness = pausePersistenceHarness();
  let release!: () => void;
  harness.state.gate = new Promise<void>(resolve => { release = resolve; });
  const actions = harness.render();
  const saving = actions.pauseDebtPayments("card", newPause);
  await tick();
  await assert.rejects(actions.pauseDebtPayments("card", newPause), /already saving/);
  assert.equal(harness.state.writes.length, 1);
  harness.state.stored.debt_payment_pauses = [pause()];
  release();
  await assert.rejects(saving, /changed/);
  assert.equal(harness.state.bills[0].debt_payment_pauses, undefined);
  assert.deepEqual(harness.state.stored.debt_payment_pauses, [pause()]);
});

test("actual pause actions reject invalid, read-only and wrong-scope changes before any write", async () => {
  for (const reason of ["past", "date", "range", "redirect", "readonly", "household", "budget", "user", "missing", "loading", "foreign-row"]) {
    const harness = pausePersistenceHarness();
    if (reason === "foreign-row") (harness.state.bills[0] as Bill & { household_id: string }).household_id = "home-b";
    const actions = harness.render();
    const input = { ...newPause };
    if (reason === "past") input.startDate = "2026-11-02";
    if (reason === "date") input.startDate = "2026-11-31";
    if (reason === "range") input.resumeDate = input.startDate;
    if (reason === "redirect") harness.settingsRef.current.debtPayoffEnabled = false;
    if (reason === "readonly") harness.state.canEdit = false;
    if (reason === "household") harness.householdScopeRef.current.householdId = "home-b";
    if (reason === "budget") harness.householdScopeRef.current.budgetId = "budget-b";
    if (reason === "user") harness.userScopeIdRef.current = "user-b";
    if (reason === "loading") harness.startupCoreReadyScopeKeyRef.current = null;
    await assert.rejects(actions.pauseDebtPayments(reason === "missing" ? "foreign-debt" : "card", input));
    assert.equal(harness.state.writes.length, 0, reason);
    assert.equal(harness.state.bills[0].debt_payment_pauses, undefined, reason);
  }
});

test("a household switch while the bill save is queued prevents the old write and retry", async () => {
  const harness = pausePersistenceHarness();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  harness.billWriteQueuesRef.current.set("card", blocked);
  const saving = harness.render().pauseDebtPayments("card", newPause);
  harness.householdScopeRef.current.householdId = "home-b";
  harness.financialScopeGenerationRef.current++;
  release();
  await assert.rejects(saving, /household changed/);
  assert.equal(harness.state.writes.length, 0);
  assert.ok(harness.state.clears > 0);
  await assert.rejects(harness.state.retry!(), /previous household/);
  assert.equal(harness.state.writes.length, 0);
});

test("a queued pause rolls back if edit access or connectivity is lost before dispatch", async () => {
  for (const reason of ["readonly", "offline"]) {
    for (const previous of [undefined, [pause()]]) {
      const harness = pausePersistenceHarness(previous);
      let release!: () => void;
      harness.billWriteQueuesRef.current.set("card", new Promise<void>(resolve => { release = resolve; }));
      const saving = harness.render().pauseDebtPayments("card", newPause);
      assert.equal(harness.state.bills[0].debt_payment_pauses?.length, (previous?.length ?? 0) + 1);
      assert.equal(harness.state.writes.length, 0);
      harness.state.bills = [{ ...harness.state.bills[0], name: "Renamed while queued", debt_payment_pauses: structuredClone(harness.state.bills[0].debt_payment_pauses) }];
      if (reason === "readonly") harness.state.canEdit = false;
      else harness.state.online = false;
      release();
      await assert.rejects(saving, reason === "readonly" ? /View-only/ : /offline/);
      assert.equal(harness.state.writes.length, 0);
      assert.deepEqual(harness.state.bills[0].debt_payment_pauses, previous);
      assert.deepEqual(harness.state.stored.debt_payment_pauses, previous);
      assert.equal(harness.state.bills[0].name, "Renamed while queued");
      assert.equal(harness.state.clears, 0);
      assert.equal(harness.state.errors.length, 1);
      assert.match(harness.state.errors[0], reason === "readonly" ? /View-only/ : /offline/);
    }
  }
});

test("actual resume preserves ended history, truncates active pauses and cancels unelapsed pauses", async () => {
  for (const start of ["2026-11-01", "2026-11-03", "2026-11-10"]) {
    const active = pause({ id: "current", start_date: start, resume_date: "2027-01-03", redirect_payment: true });
    const harness = pausePersistenceHarness([pause(), active]);
    await harness.render().resumeDebtPayments("card", "current");
    assert.deepEqual(harness.state.stored.debt_payment_pauses, start < harness.state.today
      ? [pause(), { ...active, resume_date: harness.state.today }] : [pause()]);
    assert.deepEqual(harness.state.writes[0].args.p_expected, { debt_payment_pauses: [pause(), active] });
    assert.deepEqual(Object.keys(harness.state.writes[0].args.p_patch), ["debt_payment_pauses"]);
  }
  const ended = pausePersistenceHarness([pause()]);
  await ended.render().resumeDebtPayments("card", "pause-history");
  assert.equal(ended.state.writes.length, 0);
  assert.deepEqual(ended.state.bills[0].debt_payment_pauses, [pause()]);
});
