import { revealedPrivacyBindings } from "./privacyTestHarness";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind } from "typescript";
import { parseMoneyInput, parseDecimalInput } from "./moneyFormInput";

function handler(file: string, start: string, end: string, bindings: Record<string, unknown>) {
  bindings = revealedPrivacyBindings(bindings);
  const source = readFileSync(file, "utf8");
  const body = source.slice(source.indexOf(`  const ${start} =`), source.indexOf(`  const ${end} =`, source.indexOf(`  const ${start} =`)));
  return new Function(...Object.keys(bindings), `${transpileModule(body, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText}; return ${start};`)(...Object.values(bindings));
}

test("invalid pasted amounts cannot invoke transaction, income, bucket, or bill persistence", async () => {
  for (const [file, field, extras] of [
    ["AddTransactionModal", "amount", { savingRef: { current: false } }],
    ["IncomeModal", "amount", {}],
    ["GoalModal", "target", { savingRef: { current: false }, pendingGoal: null, current: "0", goalMode: "savings" }],
    ["GoalModal", "current", { savingRef: { current: false }, pendingGoal: null, target: "100", goalMode: "savings" }],
    ["AddBillModal", "amount", { balance: "0", interestRate: "0", isDebt: true }],
  ] as const) {
    for (const raw of ["25oops", "1,20.50", "Infinity", "5.123"]) {
      let saves = 0, alerts = 0;
      const save = handler(`components/${file}.tsx`, "handleSave", file === "IncomeModal" ? "handleAddUpdate" : "handleDelete", {
        saving: false, name: "Example", ...extras, [field]: raw, parseMoneyInput, parseDecimalInput,
        showFormError: () => alerts++, Alert: { alert: () => alerts++ }, onSave: () => saves++, saveStandardTransaction: () => saves++,
      });
      await save();
      assert.equal(saves, 0, `${file}:${field}:${raw}`);
      assert.equal(alerts, 1);
    }
  }
});

test("valid grouped transaction amount persists exactly rather than its numeric prefix", async () => {
  const saved: any[] = [];
  const save = handler("components/AddTransactionModal.tsx", "handleSave", "handleDelete", {
    saving: false, savingRef: { current: false }, bucketPurchase: false, amount: "1,200.50", parseMoneyInput, isTransfer: false, isExpense: true,
    category: "Other", note: "Purchase", date: "2027-01-05", accountId: undefined, linkedBillId: undefined, editTx: null,
    Haptics: { impactAsync: () => {}, ImpactFeedbackStyle: { Medium: "medium" } }, creationContext: undefined,
    previewSafetyStop: () => null, saveStandardTransaction: (tx: unknown) => saved.push(tx),
  });
  await save();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].amount, -1200.5);
});

test("OAuth deletion verification recovers from storage, provider and session throws and rejects a different identity", async () => {
  for (const failure of ["storage", "provider", "session", "mismatch", "success"]) {
    const state = { busy: false, token: "old" as string | null, error: null as string | null, removed: [] as string[], signouts: 0 };
    const verify = handler("app/delete-account.tsx", "reauthenticateOauth", "deleteAccount", {
      oauthProvider: "google", reauthInFlightRef: { current: false }, deletionSubjectId: "original", oauthReauthKey: "pending:original",
      setBusy: (v: boolean) => { state.busy = v; }, setError: (v: string | null) => { state.error = v; }, setOauthAccessToken: (v: string | null) => { state.token = v; },
      AsyncStorage: { setItem: async () => { if (failure === "storage") throw new Error("storage failed"); }, removeItem: async (key: string) => { state.removed.push(key); } },
      signInWithGoogle: async () => { if (failure === "provider") throw new Error("provider failed"); return null; }, signInWithApple: async () => null,
      supabase: { auth: { getSession: async () => { if (failure === "session") throw new Error("session failed"); return { data: { session: { access_token: "verified", user: { id: failure === "mismatch" ? "other" : "original" } } } }; }, signOut: async () => { state.signouts++; } } },
    });
    await verify();
    assert.equal(state.busy, false);
    assert.equal(state.token, failure === "success" ? "verified" : null);
    assert.equal(state.error === null, failure === "success");
    assert.deepEqual(state.removed, failure === "success" ? [] : ["pending:original"]);
    assert.equal(state.signouts, failure === "mismatch" ? 1 : 0);
  }
});

test("Calendar override validation preserves draft on invalid input or failed save and blank still clears", async () => {
  for (const [raw, fail] of [["25oops", false], ["1,200.50", true], ["", false]] as const) {
    let draft: Record<string, string> = { key: raw }, calls = 0, errors = 0, value: unknown = "not called";
    const persist = async (...args: unknown[]) => { calls++; value = args.at(-1); if (fail) throw new Error("offline"); };
    const save = handler("app/(tabs)/monthly.tsx", "handleAmtBlur", "saveDueDayChange", {
      useCallback: (fn: unknown) => fn, editingAmounts: draft, parseMoneyInput, month: 0, selectedYear: 2027,
      setCustomAmount: persist, setBillOccurrenceAmount: persist,
      setEditingAmounts: (fn: (previous: Record<string, string>) => Record<string, string>) => { draft = fn(draft); }, showFormError: () => errors++,
    });
    await save({ id: "bill", amount: 100 }, "key");
    if (!raw) { assert.equal(calls, 1); assert.equal(value, undefined); assert.deepEqual(draft, {}); }
    else { assert.equal(calls, fail ? 1 : 0); assert.equal(draft.key, raw); assert.equal(errors, 1); }
  }
});

test("safety settings reject malformed floors or noninteger/out-of-range horizon before writing", () => {
  for (const [floor, horizon] of [["25oops", "6"], ["100", "6oops"], ["100", "2.5"], ["100", "25"], ["100", "0"]]) {
    let writes = 0, errors = 0;
    const save = handler("app/(tabs)/more.tsx", "saveSafetySettings", "handleSubmitFeedback", {
      safetyFloorText: floor, forecastHorizonText: horizon, parseMoneyInput, showFormError: () => errors++,
      updateSettings: () => writes++, setSafetyFloorText: () => {}, setForecastHorizonText: () => {},
    });
    save(); assert.equal(writes, 0); assert.equal(errors, 1);
  }
});

test("validation messages use a visible web alert instead of RN Web's no-op Alert", () => {
  const source = readFileSync("lib/formInputAlert.ts", "utf8");
  for (const platform of ["web", "android"]) {
    const messages: string[] = []; const native: string[] = []; const exported: any = {};
    const js = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
    new Function("exports", "require", "window", js)(exported, () => ({ Platform: { OS: platform }, Alert: { alert: (title: string) => native.push(title) } }), { alert: (message: string) => messages.push(message) });
    exported.showFormError("Check amount", "Invalid input");
    assert.equal(messages.length, platform === "web" ? 1 : 0); assert.equal(native.length, platform === "web" ? 0 : 1);
  }
});

test("desktop Calendar preserves explicit requested dates and month navigation defaults", () => {
  const source = readFileSync("app/(tabs)/monthly.tsx", "utf8");
  const start = source.indexOf("    setSelectedDate(current => {", source.indexOf("const desktopSelectionMonthRef"));
  const end = source.indexOf("    });", start);
  const body = source.slice(start + "    setSelectedDate(current => {".length, end);
  const select = new Function("current", "monthPrefix", "requestedDate", "isCurrentMonth", "todayIso", "selectedYear", "month", "isoDateForMonthDay", body);
  assert.equal(select("2026-12-20", "2026-12-", "2026-12-20", false, "2026-10-21", 2026, 11, () => "2026-12-01"), "2026-12-20");
  assert.equal(select("2026-12-20", "2026-10-", "2026-12-20", true, "2026-10-21", 2026, 9, () => "2026-10-01"), "2026-12-20");
  assert.equal(select(null, "2026-12-", "2026-10-20", false, "2026-10-21", 2026, 11, () => "2026-12-01"), "2026-12-01");
  assert.equal(select(null, "2026-10-", undefined, true, "2026-10-21", 2026, 9, () => "2026-10-01"), "2026-10-21");
  const cold = source.slice(source.indexOf("if (!requestedDate && isColdCalendarStart)"), source.indexOf("} else if (!requestedDate && saved"));
  assert.match(cold, /setMonth\(householdCurrentMonth\)/);
  assert.match(cold, /setSelectedYear\(householdCurrentYear\)/);
  assert.doesNotMatch(cold, /new Date/);
});
