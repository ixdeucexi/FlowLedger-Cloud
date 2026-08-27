import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  activeVersionedPatch,
  assertFinancialMutationScope,
  classifyTransactionRestoreState,
  enqueueMutationByKey,
  enqueueMutationByKeys,
  financialMutationScopeMatches,
  isAlreadyReviewedError,
  monthlyOverridePatchDbPayload,
  reconciledTransactionMatchesIntent,
  rollbackVersionedPatch,
  runRecoverableFinancialMutation,
  runSingleFlight,
  type FinancialMutationRetry,
} from "./financialMutationRecovery";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("financial retry scope is bound to one user, household, and lifecycle", () => {
  const original = { userId: "user-a", householdId: "home-a", generation: 4 };
  assert.equal(financialMutationScopeMatches(original, { ...original }), true);
  for (const changed of [
    { ...original, userId: "user-b" },
    { ...original, householdId: "home-b" },
    { ...original, generation: 5 },
  ]) {
    assert.equal(financialMutationScopeMatches(original, changed), false);
    assert.throws(
      () => assertFinancialMutationScope(original, changed),
      /previous household/i,
    );
  }
});

test("retry single-flight coalesces taps and opens again after settlement", async () => {
  const holder: { current: Promise<number> | null } = { current: null };
  let resolveAttempt: ((value: number) => void) | undefined;
  let attempts = 0;
  const operation = () => {
    attempts += 1;
    return new Promise<number>((resolve) => {
      resolveAttempt = resolve;
    });
  };

  const first = runSingleFlight(holder, operation);
  const second = runSingleFlight(holder, operation);
  assert.equal(first, second);
  assert.equal(attempts, 0, "the operation begins on the next microtask");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(attempts, 1);
  resolveAttempt?.(7);
  assert.deepEqual(await Promise.all([first, second]), [7, 7]);
  assert.equal(holder.current, null);

  const third = runSingleFlight(holder, async () => ++attempts);
  assert.equal(await third, 2);
});

test("same-row writes are serialized so a slower first save cannot land after a later edit", async () => {
  const queues = new Map<string, Promise<unknown>>();
  const firstGate = deferred<void>();
  const events: string[] = [];
  let row = { custom_amount: 100, custom_due_day: 5 };

  const first = enqueueMutationByKey(queues, "bill-1:2026-8", async () => {
    events.push("first:start");
    const next = { ...row, custom_amount: 120 };
    await firstGate.promise;
    row = next;
    events.push("first:saved");
  });
  const second = enqueueMutationByKey(queues, "bill-1:2026-8", async () => {
    events.push("second:start");
    row = { ...row, custom_amount: 135 };
    events.push("second:saved");
  });

  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, ["first:start"]);
  firstGate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(events, [
    "first:start",
    "first:saved",
    "second:start",
    "second:saved",
  ]);
  assert.equal(
    row.custom_amount,
    135,
    "the later user intent must be the final row",
  );
  assert.equal(queues.size, 0);
});

test("an atomic multi-occurrence edit holds every occurrence queue", async () => {
  const queues = new Map<string, Promise<unknown>>();
  const gate = deferred<void>();
  const events: string[] = [];
  const atomic = enqueueMutationByKeys(
    queues,
    ["b:2026-9", "b:2026-8"],
    async () => {
      events.push("atomic:start");
      await gate.promise;
      events.push("atomic:end");
    },
  );
  const later = enqueueMutationByKey(queues, "b:2026-9", async () => {
    events.push("later");
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, ["atomic:start"]);
  gate.resolve();
  await Promise.all([atomic, later]);
  assert.deepEqual(events, ["atomic:start", "atomic:end", "later"]);
});

test("failed override rollback restores only its fields and preserves a queued later edit", async () => {
  type Row = {
    custom_amount?: number;
    custom_due_day?: number;
    paid_amount: number;
  };
  const queues = new Map<string, Promise<unknown>>();
  const tokens = new Map<string, string>([["custom_amount", "amount-a"]]);
  const firstGate = deferred<void>();
  const original: Row = {
    custom_amount: 100,
    custom_due_day: 5,
    paid_amount: 0,
  };
  let row: Row = original;

  const first = enqueueMutationByKey(queues, "bill-1:2026-8", async () => {
    const patch = activeVersionedPatch(
      { custom_amount: 120 },
      "amount-a",
      tokens,
    );
    const optimistic = { ...row, ...patch };
    row = optimistic;
    await firstGate.promise;
    row = rollbackVersionedPatch(
      row,
      original,
      optimistic,
      Object.keys(patch),
      "amount-a",
      tokens,
    );
    throw new Error("first request failed");
  });

  tokens.set("custom_due_day", "due-b");
  const second = enqueueMutationByKey(queues, "bill-1:2026-8", async () => {
    const patch = activeVersionedPatch({ custom_due_day: 18 }, "due-b", tokens);
    row = { ...row, ...patch };
  });

  firstGate.resolve();
  await assert.rejects(first, /first request failed/);
  await second;
  assert.deepEqual(row, {
    custom_amount: 100,
    custom_due_day: 18,
    paid_amount: 0,
  });
});

test("a superseded same-field retry becomes a no-op and cannot roll back the newer value", () => {
  type Row = { custom_amount?: number; paid_amount: number };
  const tokens = new Map<string, string>([["custom_amount", "edit-b"]]);
  const stalePatch = activeVersionedPatch(
    { custom_amount: 120 },
    "edit-a",
    tokens,
  );
  assert.deepEqual(stalePatch, {});

  const previous: Row = { custom_amount: 100, paid_amount: 0 };
  const optimistic: Row = { custom_amount: 120, paid_amount: 0 };
  const newer: Row = { custom_amount: 140, paid_amount: 0 };
  assert.deepEqual(
    rollbackVersionedPatch(
      newer,
      previous,
      optimistic,
      ["custom_amount"],
      "edit-a",
      tokens,
    ),
    newer,
  );
});

test("disjoint bill edits remain active while only the same field supersedes", () => {
  const tokens = new Map<string, string>([
    ["name", "edit-a"],
    ["due_day", "edit-b"],
  ]);
  assert.deepEqual(
    activeVersionedPatch({ name: "Renamed", due_day: 10 }, "edit-a", tokens),
    { name: "Renamed" },
  );
  assert.deepEqual(activeVersionedPatch({ due_day: 20 }, "edit-b", tokens), {
    due_day: 20,
  });
  tokens.set("name", "edit-c");
  assert.deepEqual(
    activeVersionedPatch({ name: "Renamed" }, "edit-a", tokens),
    {},
  );
});

test("a sparse override edit preserves a concurrent Review Center payment", () => {
  const paymentCommittedByRpc = {
    custom_due_day: 5,
    paid_amount: 57,
    actual_amount: 57,
    paid_date: "2026-08-22",
  };
  const dueDatePatch = monthlyOverridePatchDbPayload({ custom_due_day: 20 });
  assert.deepEqual(dueDatePatch, { custom_due_day: 20 });

  const afterBothCommits = { ...paymentCommittedByRpc, ...dueDatePatch };
  assert.deepEqual(afterBothCommits, {
    custom_due_day: 20,
    paid_amount: 57,
    actual_amount: 57,
    paid_date: "2026-08-22",
  });
  assert.deepEqual(
    monthlyOverridePatchDbPayload({ custom_amount: undefined }),
    { custom_amount: null },
    "an explicit clear is persisted without adding unrelated paid fields",
  );
});

test("transaction restore recovery recognizes a committed lost response", () => {
  const ids = ["left", "right"];
  assert.equal(
    classifyTransactionRestoreState(
      [
        { id: "left", deleted_at: "2026-08-25T12:00:00Z" },
        { id: "right", deleted_at: "2026-08-25T12:00:00Z" },
      ],
      ids,
    ),
    "needs_restore",
  );
  assert.equal(
    classifyTransactionRestoreState(
      [
        { id: "left", deleted_at: null },
        { id: "right", deleted_at: null },
      ],
      ids,
    ),
    "already_restored",
  );
  assert.equal(
    classifyTransactionRestoreState(
      [
        { id: "left", deleted_at: null },
        { id: "right", deleted_at: "2026-08-25T12:00:00Z" },
      ],
      ids,
    ),
    "conflict",
  );
  assert.equal(
    classifyTransactionRestoreState([{ id: "left", deleted_at: null }], ids),
    "conflict",
  );
});

test("a failed financial write stays failed and exposes the exact retry closure", async () => {
  const states: string[] = [];
  let visibleRetry: FinancialMutationRetry | undefined;
  let attempts = 0;
  const operation = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("request interrupted");
    return "saved";
  };
  const run = () =>
    runRecoverableFinancialMutation(operation, run, {
      onStarted: () => states.push("saving"),
      onCompleted: () => states.push("saved"),
      onFailed: (_error, retry) => {
        states.push("failed");
        visibleRetry = retry;
      },
    });

  await assert.rejects(run(), /interrupted/);
  assert.deepEqual(states, ["saving", "failed"]);
  assert.ok(visibleRetry);
  await visibleRetry();
  assert.equal(attempts, 2);
  assert.deepEqual(states, ["saving", "failed", "saving", "saved"]);
});

test("successful financial writes never expose a stale retry", async () => {
  let failed = false;
  const value = await runRecoverableFinancialMutation(
    async () => 42,
    async () => undefined,
    {
      onStarted: () => undefined,
      onCompleted: () => undefined,
      onFailed: () => {
        failed = true;
      },
    },
  );
  assert.equal(value, 42);
  assert.equal(failed, false);
});

test("an interrupted identical Review Center decision can be recovered", () => {
  const transaction = {
    id: "tx-1",
    review_status: "matched",
    review_resolution: "snowball",
    linked_plan_id: "payment-1",
    matched_occurrence_date: "2026-08-25",
    review_allocations: [
      {
        type: "extra_principal",
        targetId: "debt-1",
        amount: 25,
        plannedAmount: 25,
        occurrenceDate: "2026-08-25",
        settlement: "exact",
      },
    ],
  };
  const intent = {
    transactionId: "tx-1",
    resolution: "snowball" as const,
    targetId: "debt-1",
    occurrenceDate: "2026-08-25",
    plannedAmount: 25,
    settlement: "exact",
  };
  assert.equal(reconciledTransactionMatchesIntent(transaction, intent), true);
  assert.equal(
    reconciledTransactionMatchesIntent(transaction, {
      ...intent,
      targetId: "debt-2",
    }),
    false,
  );
  assert.equal(
    reconciledTransactionMatchesIntent(transaction, {
      ...intent,
      plannedAmount: 24.99,
    }),
    false,
  );
});

test("recovery distinguishes identical bill/category reviews from conflicts", () => {
  const splitBill = {
    id: "tx-bill",
    review_status: "matched",
    review_resolution: "bill",
    linked_bill_id: "bill-1",
    matched_occurrence_date: "2026-08-20",
    review_allocations: [
      {
        type: "bill",
        targetId: "bill-1",
        occurrenceDate: "2026-08-20",
        settlement: "split",
      },
      { type: "category", category: "Dining" },
    ],
  };
  const splitIntent = {
    transactionId: "tx-bill",
    resolution: "bill" as const,
    targetId: "bill-1",
    occurrenceDate: "2026-08-20",
    settlement: "split",
    extraCategory: "Dining",
  };
  assert.equal(
    reconciledTransactionMatchesIntent(splitBill, splitIntent),
    true,
  );
  assert.equal(
    reconciledTransactionMatchesIntent(splitBill, {
      ...splitIntent,
      extraCategory: "Shopping",
    }),
    false,
  );

  assert.equal(
    reconciledTransactionMatchesIntent(
      {
        id: "tx-category",
        category: "Groceries",
        review_status: "categorized",
        review_resolution: "category",
        review_allocations: [{ type: "category", category: "Groceries" }],
      },
      {
        transactionId: "tx-category",
        resolution: "category",
        targetId: "Dining",
      },
    ),
    false,
  );
});

test("only explicit already-reviewed responses enter recovery verification", () => {
  assert.equal(
    isAlreadyReviewedError(
      new Error("This transaction has already been reviewed"),
    ),
    true,
  );
  assert.equal(
    isAlreadyReviewedError({
      message: "Review state changed. Refresh and try again",
    }),
    true,
  );
  assert.equal(isAlreadyReviewedError(new Error("connection reset")), false);
});

test("core create retries reuse client ids and publish the shared recovery lifecycle", () => {
  const context = readFileSync("context/BudgetContext.tsx", "utf8");
  const sections = [
    ["const addBill", "const updateBill"],
    ["const saveExtraPayment", "const getExtraPayment"],
    ["const addTransaction", "const updateTransaction"],
    ["const addIncome", "const updateIncome"],
    ["const addGoal", "const updateGoal"],
    ["const saveDecision", "const updateDecision"],
    ["const importBills", "// ─── Provider value"],
  ] as const;
  for (const [startToken, endToken] of sections) {
    const start = context.indexOf(startToken);
    const end = context.indexOf(endToken, start + startToken.length);
    assert.ok(
      start >= 0 && end > start,
      `missing source section ${startToken}`,
    );
    const source = context.slice(start, end);
    assert.match(source, /runTrackedFinancialMutation/);
    assert.match(source, /upsert\(/);
    assert.match(source, /onConflict: "id"/);
  }

  const accountStart = context.indexOf("const addAccount");
  const accountEnd = context.indexOf("const updateAccount", accountStart);
  assert.ok(
    accountStart >= 0 && accountEnd > accountStart,
    "missing source section const addAccount",
  );
  const accountSource = context.slice(accountStart, accountEnd);
  assert.match(accountSource, /runTrackedFinancialMutation/);
  assert.match(accountSource, /add_manual_account_with_anchor/);
  assert.match(accountSource, /const openingBalanceId = genId\(\)/);
  assert.match(accountSource, /p_balance_id: openingBalanceId/);
  assert.doesNotMatch(accountSource, /\.from\("accounts"\)\s*\.upsert/);
});

test("RPC-backed money retries keep stable identifiers and verify committed reviews", () => {
  const context = readFileSync("context/BudgetContext.tsx", "utf8");
  const snowballStart = context.indexOf("const applyDebtSnowballPayment");
  const snowballEnd = context.indexOf(
    "const removeDebtSnowballPayment",
    snowballStart,
  );
  const snowball = context.slice(snowballStart, snowballEnd);
  assert.match(snowball, /const paymentId = existing\?\.id \?\? genId\(\)/);
  assert.match(snowball, /p_payment_id: paymentId/);
  assert.match(snowball, /runTrackedFinancialMutation/);

  const reviewStart = context.indexOf("const reconcileTransaction");
  const reviewEnd = context.indexOf(
    "const createSpendingBucketForTransaction",
    reviewStart,
  );
  const review = context.slice(reviewStart, reviewEnd);
  assert.match(review, /isAlreadyReviewedError\(result\.error\)/);
  assert.match(
    review,
    /reconciledTransactionMatchesIntent\(savedTransaction, input\)/,
  );

  const routeStart = context.indexOf(
    "const closeSpendingBucketAndRouteRemainder",
  );
  const routeEnd = context.indexOf("const reopenSpendingBucket", routeStart);
  const route = context.slice(routeStart, routeEnd);
  assert.match(
    route,
    /const paymentId = input\.existingPaymentId \?\? genId\(\)/,
  );
  assert.match(route, /p_payment_id: paymentId/);
  assert.match(route, /runTrackedFinancialMutation/);
});

test("transaction archive retries never perform a non-atomic client debt restore", () => {
  const context = readFileSync("context/BudgetContext.tsx", "utf8");
  const transferStart = context.indexOf("const deleteTransfer");
  const transactionStart = context.indexOf(
    "const deleteTransaction",
    transferStart,
  );
  const restoreStart = context.indexOf(
    "const restoreDeletedTransaction",
    transactionStart,
  );
  assert.ok(
    transferStart >= 0 &&
      transactionStart > transferStart &&
      restoreStart > transactionStart,
  );

  for (const source of [
    context.slice(transferStart, transactionStart),
    context.slice(transactionStart, restoreStart),
  ]) {
    assert.match(source, /runTrackedFinancialMutation/);
    assert.match(source, /debt_applied_bill_id/);
    assert.doesNotMatch(source, /restoreDebtApplicationsForTransactions/);
    assert.doesNotMatch(source, /debt_applied_amount: 0/);
  }

  const transfer = context.slice(transferStart, transactionStart);
  assert.match(
    transfer,
    /idsToDelete\.some\(transactionId => !archivedIds\.has\(transactionId\)\)/,
  );

  const deletion = context.slice(transactionStart, restoreStart);
  assert.match(deletion, /undo_manual_transaction_reconciliation/);
  assert.match(deletion, /current\.debt_applied_bill_id/);
  assert.match(deletion, /select\("\*"\)[\s\S]+\.single\(\)/);

  const restoreEnd = context.indexOf(
    "const getTransactionsForMonth",
    restoreStart,
  );
  const restore = context.slice(restoreStart, restoreEnd);
  assert.match(restore, /runTrackedFinancialMutation/);
  assert.match(
    restore,
    /idsToRestore\.some\(transactionId => !restoredIds\.has\(transactionId\)\)/,
  );
  assert.match(restore, /syncDebtTransactionsAndRefresh/);
});

test("overlapping saves cannot hide an actionable failure or carry it across households", () => {
  const context = readFileSync("context/BudgetContext.tsx", "utf8");
  const lifecycleStart = context.indexOf("const markSaveStarted");
  const lifecycleEnd = context.indexOf("const retryBudgetLoad", lifecycleStart);
  const lifecycle = context.slice(lifecycleStart, lifecycleEnd);
  assert.match(
    lifecycle,
    /activeSaveOperationsRef\.current\.add\(operationId\)/,
  );
  assert.match(lifecycle, /failedSaveOperationsRef\.current\.set\(failureId/);
  assert.match(
    lifecycle,
    /const nextFailure = failedSaveOperationsRef\.current\.entries\(\)\.next\(\)\.value/,
  );
  assert.match(lifecycle, /failedSaveOperationRef\.current !== null/);
  assert.match(
    lifecycle,
    /if \(saveStatusTimerRef\.current\) clearTimeout\(saveStatusTimerRef\.current\)/,
  );
  assert.match(lifecycle, /retrySaveRef\.current = null/);

  const resetStart = context.indexOf("const resetSaveLifecycle");
  const resetEnd = context.indexOf("const activeHousehold", resetStart);
  const reset = context.slice(resetStart, resetEnd);
  assert.match(reset, /saveLifecycleGenerationRef\.current \+= 1/);
  assert.match(reset, /retrySavePromiseRef\.current = null/);

  const trackedStart = context.indexOf("const runTrackedFinancialMutation");
  const trackedEnd = context.indexOf("const retryLastSave", trackedStart);
  const tracked = context.slice(trackedStart, trackedEnd);
  assert.match(
    tracked,
    /assertFinancialMutationScope\(operationScope, currentScope\(\)\)/,
  );
  assert.match(tracked, /const guardedRetry/);

  const retryStart = context.indexOf("const retryLastSave");
  const retryEnd = context.indexOf("const clearSaveError", retryStart);
  assert.match(
    context.slice(retryStart, retryEnd),
    /runSingleFlight\(retrySavePromiseRef/,
  );

  const switchStart = context.indexOf("const switchHousehold");
  const switchEnd = context.indexOf("const createHousehold", switchStart);
  const householdSwitch = context.slice(switchStart, switchEnd);
  assert.match(householdSwitch, /activeSaveOperationsRef\.current\.size > 0/);
  assert.match(householdSwitch, /replaceActiveHouseholdScope\(next\)/);
});

test("scope-changing household paths invalidate retries before exposing another plan", () => {
  const context = readFileSync("context/BudgetContext.tsx", "utf8");
  for (const [startToken, endToken] of [
    ["const acceptHouseholdInvite", "const updateHouseholdMemberRole"],
    ["const leaveActiveHousehold", "// ── Load from Supabase"],
  ] as const) {
    const start = context.indexOf(startToken);
    const end = context.indexOf(endToken, start);
    assert.ok(start >= 0 && end > start, `missing ${startToken}`);
    const source = context.slice(start, end);
    assert.match(
      source,
      /resetSaveLifecycle\(\)/,
      `${startToken} must invalidate retries`,
    );
    assert.match(
      source,
      /replaceActiveHouseholdScope\(null\)/,
      `${startToken} must revoke the active scope`,
    );
  }
  const privacyStart = context.indexOf("const refreshHouseholdsForPrivacy");
  const privacyEnd = context.indexOf("const refreshHouseholdActivity", privacyStart);
  const privacyRefresh = context.slice(privacyStart, privacyEnd);
  assert.match(privacyRefresh, /resetSaveLifecycle\(\)/);
  assert.match(privacyRefresh, /clearScopedFinancialData\(\)/);
  assert.match(privacyRefresh, /resolveHouseholds\(userId\)/);
  assert.match(privacyRefresh, /waitForScopeCoreLoad\(next\.householdId\)/);
  assert.ok(
    privacyRefresh.indexOf("clearScopedFinancialData()")
      < privacyRefresh.indexOf("resolveHouseholds(userId)"),
    "revoked data must clear before selecting its replacement",
  );
});

test("lost-response destructive retries are idempotent and debt direct edits fail closed", () => {
  const context = readFileSync("context/BudgetContext.tsx", "utf8");
  for (const [startToken, endToken] of [
    ["const stopFutureBill", "const deleteBill"],
    ["const deleteExtraPayment", "const applyDebtSnowballPayment"],
    ["const deleteIncome", "const getMonthlyIncome"],
    ["const deleteGoal", "const checkGoalAffordability"],
    ["const deleteDecision", "const forecastConfidence"],
  ] as const) {
    const start = context.indexOf(startToken);
    const end = context.indexOf(endToken, start);
    assert.match(
      context.slice(start, end),
      /deleteRowIdempotently\(/,
      `${startToken} must accept an already-deleted retry`,
    );
  }
  const deleteHelperStart = context.indexOf("const deleteRowIdempotently");
  const deleteHelperEnd = context.indexOf(
    "const recalculateAndRefreshDebtMinimums",
    deleteHelperStart,
  );
  const deleteHelper = context.slice(deleteHelperStart, deleteHelperEnd);
  assert.match(deleteHelper, /\.delete\(\)[\s\S]+\.maybeSingle\(\)/);
  assert.match(deleteHelper, /loadHouseholdMemberships/);
  assert.match(deleteHelper, /if \(remaining\.data\) throw/);

  const paidStart = context.indexOf("const setPaidAmount");
  const paidEnd = context.indexOf("const setCustomAmount", paidStart);
  const paid = context.slice(paidStart, paidEnd);
  assert.match(paid, /bill\?\.is_debt[\s\S]+No change was applied/);
  assert.doesNotMatch(paid, /runTrackedFinancialMutation/);
  assert.doesNotMatch(paid, /supabase\.from\("bills"\)\.update/);

  const incomeStart = context.indexOf("const updateIncome");
  const incomeEnd = context.indexOf("const deleteIncome", incomeStart);
  assert.match(
    context.slice(incomeStart, incomeEnd),
    /income === reviewedItem/,
  );

  const monthly = readFileSync("app/(tabs)/monthly.tsx", "utf8");
  const quickStart = monthly.indexOf("const handleQuickPaid");
  const quickEnd = monthly.indexOf(
    "const showTransactionDebtNotice",
    quickStart,
  );
  const quick = monthly.slice(quickStart, quickEnd);
  assert.ok(
    quick.indexOf("bill?.is_debt") <
      quick.indexOf("removeDebtSurplusTransaction"),
    "debt quick-pay must exit before removing a surplus transaction",
  );
  assert.match(quick, /explainDebtPaymentRoute\(\);[\s\S]+return;/);

  const blurStart = monthly.indexOf("const handlePaidBlur");
  const blurEnd = monthly.indexOf(
    "const finalizeBillAtActualForMonth",
    blurStart,
  );
  const blur = monthly.slice(blurStart, blurEnd);
  assert.ok(
    blur.indexOf("bill?.is_debt") < blur.indexOf("setPaidAmount"),
    "debt paid-input must exit before any direct write",
  );
  assert.doesNotMatch(blur, /deleteTransaction\(/);
  assert.match(monthly, /bill\.is_debt \? "Record payment"/);
  assert.match(monthly, /bill\.is_debt \? \([\s\S]+Use Activity/);
});

test("monthly payment and account retries keep stable write identities", () => {
  const context = readFileSync("context/BudgetContext.tsx", "utf8");
  const coordinatorStart = context.indexOf(
    "const createMonthlyOverrideWriteIntent",
  );
  const coordinatorEnd = context.indexOf("// ─── Bills", coordinatorStart);
  const coordinator = context.slice(coordinatorStart, coordinatorEnd);
  assert.match(coordinator, /monthlyOverrideStableIdsRef\.current\.get\(key\)/);
  assert.match(
    coordinator,
    /enqueueMutationByKey\(monthlyOverrideWriteQueuesRef\.current, intent\.key/,
  );
  assert.match(
    coordinator,
    /activeVersionedPatch\(intent\.patch, intent\.token/,
  );
  assert.match(coordinator, /rollbackVersionedPatch\(/);

  const billStart = context.indexOf("const updateBill");
  const billEnd = context.indexOf("const stopFutureBill", billStart);
  const billUpdate = context.slice(billStart, billEnd);
  assert.match(billUpdate, /billOverrideRetryIdsRef\.current\.get\(bill\.id\)/);
  assert.match(billUpdate, /retryOverrideIds\?\.set\(key, stableId\)/);
  assert.match(billUpdate, /createMonthlyOverrideWriteIntent/);
  assert.match(billUpdate, /persistMonthlyOverrideWriteIntent/);
  assert.match(
    billUpdate,
    /enqueueMutationByKey\(billWriteQueuesRef\.current, bill\.id/,
  );
  assert.match(billUpdate, /billEditFieldTokensRef\.current\.get\(bill\.id\)/);
  assert.match(billUpdate, /activeEditableFields = editableFields\.filter/);
  assert.doesNotMatch(billUpdate, /billEditTokensRef/);
  assert.doesNotMatch(billUpdate, /overridesRef\.current = previousOverrides/);

  const overrideStart = context.indexOf("const upsertOverride");
  const paidEnd = context.indexOf("const setCustomAmount", overrideStart);
  const paidWrite = context.slice(overrideStart, paidEnd);
  assert.match(paidWrite, /createMonthlyOverrideWriteIntent/);
  assert.match(paidWrite, /persistMonthlyOverrideWriteIntent/);
  assert.match(paidWrite, /runTrackedFinancialMutation/);
  assert.match(paidWrite, /No change was applied/);
  assert.doesNotMatch(
    paidWrite.slice(paidWrite.indexOf("const setPaidAmount")),
    /runTrackedFinancialMutation/,
  );

  const accountStart = context.indexOf("const saveManualAccountChange");
  const accountEnd = context.indexOf(
    "const updateConnectedBankAccountDisplayName",
    accountStart,
  );
  const accountUpdate = context.slice(accountStart, accountEnd);
  assert.match(
    accountUpdate,
    /accountEditTokensRef\.current\.set\(intendedAccount\.id, editToken\)/,
  );
  assert.match(
    accountUpdate,
    /accountEditTokensRef\.current\.get\(intendedAccount\.id\) !== editToken/,
  );
  assert.match(accountUpdate, /const mutationId = genId\(\)/);
  assert.match(accountUpdate, /const balanceHistoryId = genId\(\)/);
  assert.match(accountUpdate, /updateManualAccountWithAnchorAtomically\(\{/);
  assert.match(accountUpdate, /mutationId,[\s\S]+balanceId: balanceHistoryId/);
  assert.doesNotMatch(accountUpdate, /from\("accounts"\)\.update/);
  assert.doesNotMatch(accountUpdate, /from\("account_balances"\)\.upsert/);

  const atomicAccountContract = readFileSync(
    "lib/atomicFinancialMutations.ts",
    "utf8",
  );
  assert.match(
    atomicAccountContract,
    /"checking" \| "savings" \| "cash" \| "credit_card"/,
  );
  assert.match(
    atomicAccountContract,
    /existing row must remain renameable\/reconcilable[\s\S]+archivable/,
  );
});

test("core updates verify an affected row before they can be shown as saved", () => {
  const context = readFileSync("context/BudgetContext.tsx", "utf8");
  const sections = [
    ["const updateBill", "const stopFutureBill"],
    ["const updateIncome", "const deleteIncome"],
    ["const updateGoal", "const refreshBucketRoutingData"],
    ["const updateAccount", "const updateConnectedBankAccountDisplayName"],
    ["const reconcileAccount", "const archiveAccount"],
    ["const updateDecision", "const deleteDecision"],
  ] as const;
  for (const [startToken, endToken] of sections) {
    const start = context.indexOf(startToken);
    const end = context.indexOf(endToken, start + startToken.length);
    assert.ok(
      start >= 0 && end > start,
      `missing source section ${startToken}`,
    );
    const source = context.slice(start, end);
    if (startToken === "const updateBill") {
      assert.match(source, /update_bill_with_override_intents/);
      assert.match(source, /savedResult\.error \|\| !savedResult\.data/);
    } else if (startToken === "const updateAccount" || startToken === "const reconcileAccount") {
      assert.match(source, /saveManualAccountChange\(/);
      const helperStart = context.indexOf("const saveManualAccountChange");
      const helperEnd = context.indexOf("const updateAccount", helperStart);
      const helper = context.slice(helperStart, helperEnd);
      assert.match(helper, /updateManualAccountWithAnchorAtomically\(\{/);
      assert.match(helper, /normalizeAccountRow\(result\.account\)/);
    } else {
      assert.match(
        source,
        /\.select\("id"\)\.single\(\)/,
        `${startToken} must fail closed when RLS updates zero rows`,
      );
    }
  }
});

test("database RPC contracts make identical snowball and Review Center retries idempotent", () => {
  const snowballSql = readFileSync(
    "../../supabase/migrations/20260724153744_reschedule_snowball_plan_across_months.sql",
    "utf8",
  );
  assert.match(snowballSql, /where id = p_payment_id[\s\S]+for update/i);
  assert.match(
    snowballSql,
    /if v_existing_id is null[\s\S]+insert into public\.extra_payments/i,
  );
  assert.match(
    snowballSql,
    /else[\s\S]+update public\.extra_payments[\s\S]+where id = v_existing_id/i,
  );

  const reviewSql = readFileSync(
    "../../supabase/migrations/20260820072814_harden_review_retries.sql",
    "utf8",
  );
  assert.match(reviewSql, /for update/i);
  assert.match(reviewSql, /'retry', true/i);
  assert.match(reviewSql, /v_existing\.resolution = p_resolution/i);

  const bucketSql = readFileSync(
    "../../supabase/migrations/20260820072703_create_spending_bucket_and_reconcile.sql",
    "utf8",
  );
  assert.match(
    bucketSql,
    /The RPC may have committed even if the client lost its response/i,
  );
  assert.match(bucketSql, /'retry', true/i);
});

test("Plaid card attachment retries reuse the connected account debt id", () => {
  const attachApi = readFileSync(
    "../../api/_utils/plaidAttachCreditCard.js",
    "utf8",
  );
  assert.match(attachApi, /findConnectedCardDebt/);
  assert.match(attachApi, /id: `plaid-debt:\$\{refreshedAccount\.id\}`/);
  assert.match(attachApi, /onConflict: "id"/);
});
