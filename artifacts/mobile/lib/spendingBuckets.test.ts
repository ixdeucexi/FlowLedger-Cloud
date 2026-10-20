import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  bucketEffectiveRouteDate,
  isEligibleSpendingBucketMatch,
  isOpenSpendingBucket,
  spendingBucketMatch,
  spendingBucketSummary,
  validateCreateSpendingBucketMatch,
} from "./spendingBuckets";

test("an open spending bucket protects only its unmatched balance", () => {
  assert.deepEqual(
    spendingBucketSummary({ target_amount: 450, current_amount: 101.08 }),
    {
      planned: 450,
      spent: 101.08,
      remaining: 348.92,
      released: 0,
      closed: false,
    },
  );
  assert.equal(
    isOpenSpendingBucket({ target_amount: 450, current_amount: 101.08 }),
    true,
  );
});

test("closing releases unused money without rewriting planned or spent amounts", () => {
  const bucket = {
    target_amount: 450,
    current_amount: 101.08,
    closed_at: "2026-07-20T12:00:00.000Z",
  };
  assert.deepEqual(spendingBucketSummary(bucket), {
    planned: 450,
    spent: 101.08,
    remaining: 0,
    released: 348.92,
    closed: true,
  });
  assert.equal(isOpenSpendingBucket(bucket), false);
});

test("closing an over-budget bucket never creates negative released money", () => {
  assert.deepEqual(
    spendingBucketSummary({
      target_amount: 100,
      current_amount: 125,
      closed_at: "2026-07-20",
    }),
    {
      planned: 100,
      spent: 125,
      remaining: 0,
      released: 0,
      closed: true,
    },
  );
});

test("bucket matching keeps partial, exact, and overage money separate", () => {
  assert.deepEqual(spendingBucketMatch(84.02, 139.32), {
    settlement: "partial",
    applied: 84.02,
    extra: 0,
  });
  assert.deepEqual(spendingBucketMatch(139.32, 139.32), {
    settlement: "exact",
    applied: 139.32,
    extra: 0,
  });
  assert.deepEqual(spendingBucketMatch(150, 139.32), {
    settlement: "split",
    applied: 139.32,
    extra: 10.68,
  });
});

test("matching eligibility includes open buckets across months and excludes every unavailable bucket", () => {
  const open = {
    goal_type: "planned_expense" as const,
    target_amount: 200,
    current_amount: 40,
  };
  assert.equal(isEligibleSpendingBucketMatch(open), true);
  assert.equal(
    isEligibleSpendingBucketMatch({ ...open, goal_type: "savings" }),
    false,
  );
  assert.equal(
    isEligibleSpendingBucketMatch({ ...open, closed_at: "2026-08-20" }),
    false,
  );
  assert.equal(
    isEligibleSpendingBucketMatch({ ...open, archived_at: "2026-08-20" }),
    false,
  );
  assert.equal(
    isEligibleSpendingBucketMatch({ ...open, current_amount: 200 }),
    false,
  );
});

test("bucket remainder routing waits until both today and the bucket date are available", () => {
  assert.equal(
    bucketEffectiveRouteDate("2026-08-20", "2026-08-12"),
    "2026-08-20",
  );
  assert.equal(
    bucketEffectiveRouteDate("2026-08-20", "2026-09-03"),
    "2026-09-03",
  );
  assert.throws(
    () => bucketEffectiveRouteDate("2026-02-30", "2026-09-03"),
    /current date/,
  );
});

test("create-and-match supports an exact post-purchase bucket", () => {
  assert.deepEqual(
    validateCreateSpendingBucketMatch({
      name: "  Tia Kohl's school clothes  ",
      targetAmount: 84.02,
      targetDate: "2026-08-12",
      transactionAmount: -84.02,
    }),
    {
      name: "Tia Kohl's school clothes",
      targetAmount: 84.02,
      targetDate: "2026-08-12",
      transactionAmount: 84.02,
      settlement: "exact",
    },
  );
});

test("create-and-match leaves future purchase money in a larger bucket", () => {
  assert.equal(
    validateCreateSpendingBucketMatch({
      name: "School clothes",
      targetAmount: 200,
      targetDate: "2026-08-12",
      transactionAmount: 84.02,
    }).settlement,
    "partial",
  );
});

test("create-and-match rejects a bucket smaller than the posted transaction", () => {
  assert.throws(
    () =>
      validateCreateSpendingBucketMatch({
        name: "School clothes",
        targetAmount: 80,
        targetDate: "2026-08-12",
        transactionAmount: 84.02,
      }),
    /at least \$84\.02/,
  );
});

test("create-and-match rejects blank names and impossible dates", () => {
  assert.throws(
    () =>
      validateCreateSpendingBucketMatch({
        name: " ",
        targetAmount: 84.02,
        targetDate: "2026-08-12",
        transactionAmount: 84.02,
      }),
    /Enter a name/,
  );
  assert.throws(
    () =>
      validateCreateSpendingBucketMatch({
        name: "School clothes",
        targetAmount: 84.02,
        targetDate: "2026-02-30",
        transactionAmount: 84.02,
      }),
    /valid target date/,
  );
});

test("create-and-match RPC keeps creation and reconciliation behind the locked private boundary", () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      "../../supabase/migrations/20260820072703_create_spending_bucket_and_reconcile.sql",
    ),
    "utf8",
  ).toLowerCase();
  assert.match(
    sql,
    /create or replace function private\.create_spending_bucket_for_transaction/,
  );
  assert.match(sql, /security definer/);
  assert.match(sql, /for update/);
  assert.match(sql, /review_status is distinct from 'needs_review'/);
  assert.match(sql, /deleted_at is null/);
  assert.match(sql, /public\.is_household_editor/);
  assert.match(sql, /hp\.tier = 'pro'/);
  assert.match(sql, /v_target < v_actual/);
  assert.match(sql, /'nan', 'infinity', '-infinity'/);
  assert.match(sql, /v_tx\.user_id, v_tx\.household_id, v_tx\.budget_id/);
  assert.match(sql, /private\.reconcile_transaction/);
  assert.match(sql, /v_tx\.review_status = 'matched'/);
  assert.match(sql, /v_tx\.linked_plan_id/);
  assert.match(
    sql,
    /from public\.transaction_reconciliations[\s\S]+for update/,
  );
  assert.match(sql, /btrim\(v_goal\.name\) = v_name/);
  assert.match(
    sql,
    /round\(\(allocation ->> 'amount'\)::numeric, 2\) = v_actual/,
  );
  assert.match(sql, /'goal_id', v_goal\.id/);
  assert.match(sql, /'retry', true/);
  assert.match(sql, /security invoker/);
  assert.match(
    sql,
    /grant execute on function public\.create_spending_bucket_for_transaction[\s\S]+to authenticated, service_role/,
  );
});

test("bucket remainder RPC closes and routes atomically and requires unroute before reopen", () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      "../../supabase/migrations/20260820072711_route_spending_bucket_remainder.sql",
    ),
    "utf8",
  ).toLowerCase();
  assert.match(
    sql,
    /create or replace function private\.close_spending_bucket_and_route_remainder/,
  );
  assert.match(
    sql,
    /create or replace function private\.reopen_spending_bucket_and_unroute_remainder/,
  );
  assert.match(
    sql,
    /select \* into v_goal from public\.goals where id = p_bucket_id for update/,
  );
  assert.match(sql, /public\.is_household_editor/);
  assert.match(sql, /hp\.tier = 'pro'/);
  assert.match(sql, /p_expected_spent/);
  assert.match(sql, /p_expected_remainder/);
  assert.match(sql, /'type', 'bucket_remainder'/);
  assert.match(sql, /'availabledate', v_effective_date::text/);
  assert.match(sql, /public\.apply_debt_snowball_payment/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /extra_payments_household_budget_month_year_idx/);
  assert.match(
    sql,
    /create or replace function private\.snowball_payment_has_reconciled_amount/,
  );
  assert.match(sql, /reconciliation\.target_id = p_payment_id/);
  assert.match(sql, /allocation ->> 'type' = 'extra_principal'/);
  assert.match(
    sql,
    /private\.snowball_payment_has_reconciled_amount\(v_payment\.id, v_payment\.payment_date\)/,
  );
  assert.match(
    sql,
    /create or replace function private\.validate_bucket_snowball_allocations/,
  );
  assert.match(sql, /jsonb_array_length\(p_allocations\) = 0/);
  assert.match(sql, /jsonb_typeof\(allocation -> 'payment'\) <> 'number'/);
  assert.match(
    sql,
    /group by allocation ->> 'billid'[\s\S]+having count\(\*\) > 1/,
  );
  assert.match(
    sql,
    /bill\.is_debt[\s\S]+bill\.include_in_snowball is not false[\s\S]+bill\.balance > 0\.009/,
  );
  assert.match(sql, /bill\.household_id is not distinct from p_household_id/);
  assert.match(
    sql,
    /perform private\.validate_bucket_snowball_allocations\([\s\S]+p_allocations, v_plan_amount/,
  );
  assert.match(
    sql,
    /perform private\.validate_bucket_snowball_allocations\([\s\S]+p_allocations, v_next_amount/,
  );
  assert.match(sql, /'payment', to_jsonb\(v_payment\)/);
  assert.match(sql, /create trigger guard_bucket_remainder_payment/);
  assert.match(sql, /flowledger\.bucket_route_id/);
  assert.match(sql, /flowledger\.bucket_unroute_id/);
  assert.match(
    sql,
    /reopen the routed spending bucket before removing this snowball payment/,
  );
  assert.match(
    sql,
    /new\.payment_date < \(v_source ->> 'availabledate'\)::date/,
  );
  assert.match(
    sql,
    /before update of name, target_amount, target_date, goal_type, user_id, household_id/,
  );
  assert.ok(
    sql.lastIndexOf("set closed_at = now()") <
      sql.indexOf("v_saved_payment_id := public.apply_debt_snowball_payment"),
    "the guarded close must occur before its new route exists; any later failure still rolls the transaction back",
  );
  assert.match(
    sql,
    /delete from public\.extra_payments where id = v_payment\.id/,
  );
  assert.match(sql, /guard_routed_bucket_progress/);
  assert.match(sql, /security invoker/);
  assert.match(
    sql,
    /grant execute on function public\.close_spending_bucket_and_route_remainder[\s\S]+to authenticated, service_role/,
  );
});

test("Review Center matches a partial bucket purchase before offering explicit close choices", () => {
  const source = readFileSync(
    resolve(process.cwd(), "components/ReviewCenter.tsx"),
    "utf8",
  );
  assert.match(
    source,
    /const completed = await resolveTarget\(choice\.target, "partial"\)/,
  );
  assert.match(source, /openBucketCloseChoices\(settledGoal, true\)/);
  assert.match(source, /onClose=\{\(\) => setBucketClosePrompt\(null\)\}/);
  assert.match(source, /bucketCloseInFlightRef\.current/);
  assert.match(source, /reviewInFlightRef\.current/);
  assert.match(
    source,
    /const completeReview[\s\S]+finally \{\s*reviewInFlightRef\.current = false/,
  );
  assert.match(
    source,
    /onKeep=\{\(\) => bucketClosePrompt \? void closeBucketKeepAvailable/,
  );
  assert.doesNotMatch(
    source,
    /variance\.target\.type === "goal" \? void resolveTarget\(variance\.target, "full"\)/,
  );
  assert.match(source, /const routed = routedBucketIds\.has\(goal\.id\)/);
  assert.match(
    source,
    /\{!routed \? \(\s*<Pressable[\s\S]+accessibilityLabel=\{`Edit/,
  );
  assert.match(source, /\{goal\.closed_at && !routed \? \(/);

  const modalSource = readFileSync(
    resolve(process.cwd(), "components/BillSurplusModal.tsx"),
    "utf8",
  );
  assert.match(modalSource, /Continue · keep/);
  assert.match(modalSource, /I can't safely move this to Snowball/);
  assert.match(modalSource, /itemType === "bucket" \? `Close bucket/);
});

test("generic review retries lock the posted transaction and return the prior identical decision", () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      "../../supabase/migrations/20260820072814_harden_review_retries.sql",
    ),
    "utf8",
  ).toLowerCase();
  assert.match(sql, /rename to reconcile_transaction_unlocked_v1/);
  assert.match(sql, /from public\.transactions[\s\S]+for update/);
  assert.match(sql, /review_status is distinct from 'needs_review'/);
  assert.match(sql, /v_existing\.target_id is not distinct from p_target_id/);
  assert.match(sql, /'retry', true/);
  assert.match(
    sql,
    /perform 1 from public\.goals where id = p_target_id for update/,
  );
  assert.match(sql, /return private\.reconcile_transaction_unlocked_v1/);
  assert.match(
    sql,
    /revoke all on function private\.reconcile_transaction_unlocked_v1[\s\S]+authenticated/,
  );
});

test("all Snowball editors preserve routed bucket funding and its availability date", () => {
  const contextSource = readFileSync(
    resolve(process.cwd(), "context/BudgetContext.tsx"),
    "utf8",
  );
  assert.match(
    contextSource,
    /sources \?\? \(existing\s*\? resizeSnowballFundingSources\(existing\.sources, preview\.selectedExtra\)/,
  );
  assert.match(
    contextSource,
    /latestBucketRemainderAvailableDate\(resizedSources\)/,
  );
  assert.match(
    contextSource,
    /Reopen the routed spending bucket before removing this Snowball payment/,
  );

  const plannerSource = readFileSync(
    resolve(process.cwd(), "app/snowball-plan.tsx"),
    "utf8",
  );
  assert.match(plannerSource, /paymentDateMinimum = bucketAvailableDate/);
  assert.match(
    plannerSource,
    /resizeSnowballFundingSources\(existingPayment\.sources, preview\.selectedExtra\)/,
  );
  assert.match(plannerSource, /minDate=\{paymentDateMinimum\}/);

  const activitySource = readFileSync(
    resolve(process.cwd(), "app/(tabs)/transactions.tsx"),
    "utf8",
  );
  assert.match(
    activitySource,
    /latestBucketRemainderAvailableDate\(editExtraPayment\.sources\)/,
  );
  assert.match(activitySource, /Reopen bucket first/);
});

test("context fallbacks honor server ids for recovered bucket creation and concurrent Snowball merges", () => {
  const contextSource = readFileSync(
    resolve(process.cwd(), "context/BudgetContext.tsx"),
    "utf8",
  );
  assert.match(
    contextSource,
    /const serverGoalId = typeof rpcPayload\?\.goal_id/,
  );
  assert.match(contextSource, /linked_plan_id: serverGoalId/);
  assert.match(contextSource, /goalId: serverGoalId/);
  assert.match(
    contextSource,
    /const serverPaymentId = typeof rpcPayload\?\.payment_id/,
  );
  assert.match(
    contextSource,
    /normalizeExtraPaymentRow\(\{ \.\.\.rpcPayload\.payment, id: serverPaymentId \}\)/,
  );
  assert.match(contextSource, /paymentId: serverPaymentId/);
});

import { requestedBucketCloseGoal } from "./spendingBuckets";
test("close bucket navigation resolves only a current editable loaded open bucket", () => {
  const goal = { id: "trip", goal_type: "planned_expense" as const, target_amount: 500, current_amount: 125 };
  const input = { bucketId: "trip", requestedScope: "owner:home", currentScope: "owner:home", ready: true, canEdit: true, goals: [goal] };
  assert.equal(requestedBucketCloseGoal(input), goal);
  assert.equal(requestedBucketCloseGoal({ ...input, ready: false }), null);
  assert.equal(requestedBucketCloseGoal({ ...input, canEdit: false }), null);
  assert.equal(requestedBucketCloseGoal({ ...input, currentScope: "owner:other" }), null);
  assert.equal(requestedBucketCloseGoal({ ...input, goals: [] }), null);
  assert.equal(requestedBucketCloseGoal({ ...input, goals: [{ ...goal, closed_at: "2028-01-01" }] }), null);
  assert.equal(requestedBucketCloseGoal({ ...input, goals: [{ ...goal, archived_at: "2028-01-01" }] }), null);
  assert.equal(requestedBucketCloseGoal({ ...input, goals: [{ ...goal, goal_type: "savings" as const }] }), null);
});

import { transpileModule, ModuleKind } from "typescript";
test("editor Close bucket navigates once to reviewed choices without saving a financial change", () => {
  const source = readFileSync("components/GoalModal.tsx", "utf8");
  const body = source.slice(source.indexOf("  const openCloseBucket ="), source.indexOf("  const [name,"));
  const routes: any[] = [];
  let closed = 0;
  const bindings = {
    canCloseBucket: true, savingRef: { current: false }, closeNavigationRef: { current: false },
    currentBucket: { id: "trip" }, user: { id: "owner" }, activeHousehold: { householdId: "home" },
    onClose: () => { closed++; }, router: { push: (route: unknown) => routes.push(route) },
  };
  const js = transpileModule(body, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const open = new Function(...Object.keys(bindings), `${js}; return openCloseBucket;`)(...Object.values(bindings));
  open(); open();
  assert.equal(closed, 1); assert.equal(routes.length, 1);
  assert.equal(routes[0].params.closeBucketId, "trip");
  assert.equal(routes[0].params.closeBucketScope, "owner:home");
  assert.equal(routes[0].params.section, "review");
  assert.doesNotMatch(body, /updateGoal|onSave|closeSpendingBucket/);
});

test("close deep link reuses explicit keep/Snowball coordinator with scope, retry and stale-balance guards", () => {
  const source = readFileSync("components/ReviewCenter.tsx", "utf8");
  assert.match(source, /handledCloseRequestRef.current === request/);
  assert.match(source, /requestedBucketCloseGoal\(/);
  assert.match(source, /openBucketCloseChoicesRef.current\(goal\)/);
  assert.match(source, /mountedBucketScopeRef.current !== bucketScope/);
  assert.match(source, /return \(\) => \{ mountedBucketScopeRef.current = null; \}/);
  assert.match(source, /expectedSpent: summary.spent/);
  assert.match(source, /expectedRemainder: bucketSnowballOffer.remainder/);
  assert.match(source, /onConfirm: \(\) => void closeBucketKeepAvailable/);
  assert.match(source, /finally \{\s*bucketCloseInFlightRef.current = false;\s*setSaving\(false\)/);
});

test("consumed Close bucket navigation cannot replay after cancel, section remount or refresh", () => {
  const source = readFileSync("app/(tabs)/more.tsx", "utf8");
  const body = source.slice(source.indexOf("  const consumeBucketCloseRequest ="), source.indexOf("  const requestedReviewTransactionId ="));
  const initial = { bucketId: "trip", scope: "owner:home", request: "first" };
  const pending = { current: initial as typeof initial | null };
  const route: Record<string, string | undefined> = { section: "review", reviewFilter: "expense", closeBucketId: "trip", closeBucketScope: "owner:home", closeBucketAt: "first" };
  let writes = 0;
  const bindings = {
    useCallback: (fn: unknown) => fn,
    bucketCloseNavigationRef: pending,
    router: { setParams: (params: Record<string, string | undefined>) => { writes++; Object.assign(route, params); } },
  };
  const js = transpileModule(body, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const consume = new Function(...Object.keys(bindings), `${js}; return consumeBucketCloseRequest;`)(...Object.values(bindings));
  consume("trip", "owner:home", "first");
  consume("trip", "owner:home", "first");
  assert.equal(writes, 1);
  assert.equal(route.section, "review"); assert.equal(route.reviewFilter, "expense");
  // Cancel leaves the bucket open; a fresh Review Center or browser load has no request to run.
  const url = new URL("https://example.test/more");
  Object.entries(route).forEach(([key, value]) => { if (value !== undefined) url.searchParams.set(key, value); });
  const refreshed = new URL(url.toString()).searchParams;
  route.section = "overview"; route.section = "review";
  assert.equal(route.closeBucketAt, undefined);
  assert.equal(refreshed.get("closeBucketId"), null);
  assert.equal(refreshed.get("closeBucketScope"), null);
  assert.equal(refreshed.get("closeBucketAt"), null);
  const newer = { bucketId: "trip", scope: "owner:home", request: "second" };
  pending.current = newer;
  consume("trip", "owner:home", "first");
  assert.equal(pending.current, newer); assert.equal(writes, 1);
  consume("trip", "other:home", "second");
  assert.equal(writes, 1);
  consume("trip", "owner:home", "second");
  assert.equal(writes, 2);
  const review = readFileSync("components/ReviewCenter.tsx", "utf8");
  assert.match(review, /handledCloseRequestRef.current = request;\s*openBucketCloseChoicesRef.current\(goal\);\s*onCloseBucketRequestHandled\?\.\(goal.id, scope, closeBucketRequest\)/);
  assert.match(source, /onCloseBucketRequestHandled=\{consumeBucketCloseRequest\}/);
});
