import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  dailySnapshotMatches,
  selectTodayWithFlo,
  type FloDailyFacts,
} from "./todayWithFlo";
import {
  createTodayWithFloStore,
  scopedTodayWithFloStore,
  clearTodayWithFloStoresForUser,
  type TodayWithFloSaved,
} from "./todayWithFloPreferences";
import { overlayActivity } from "./overlayActivity";
const facts: FloDailyFacts = {
  today: "2026-09-11",
  decisions: [],
  reviewCount: 0,
  upcoming: [],
  goals: [],
};

test("empty and rounded all-clear facts never invent a useful or safe-cash takeaway", () => {
  assert.equal(selectTodayWithFlo(facts, []), null);
  assert.equal(
    selectTodayWithFlo(
      { ...facts, decisions: [{ id: "all-clear", tone: "safe" }] },
      [],
    ),
    null,
  );
});
test("risk can repeat while ordinary useful topics rotate", () => {
  const populated = {
    ...facts,
    safetyFloor: 200,
    goals: [{ name: "Trip", current_amount: 12.34, target_amount: 500 }],
  };
  assert.equal(selectTodayWithFlo(populated, [])?.topic, "goal-earmark");
  assert.equal(
    selectTodayWithFlo(populated, [
      { day: "2026-09-10", topic: "goal-earmark" },
    ])?.topic,
    "cushion-review",
  );
  assert.equal(
    selectTodayWithFlo(
      {
        ...populated,
        decisions: [{ id: "breathing-room-opportunity", tone: "risk" }],
      },
      [{ day: "2026-09-10", topic: "forecast-risk" }],
    )?.topic,
    "forecast-risk",
  );
});
test("due-soon pending bills beat coaching, preserve cents and warn against double payment", () => {
  const tip = selectTodayWithFlo(
    {
      ...facts,
      safetyFloor: 200,
      upcoming: [
        {
          name: "Rent",
          amount: 900.37,
          day: 12,
          month: 8,
          year: 2026,
          pending: true,
        },
      ],
    },
    [{ day: "2026-09-10", topic: "pending-payment" }],
  );
  assert.equal(tip?.topic, "pending-payment");
  assert.match(
    tip!.details.join(" "),
    /\$900\.37.*2026-09-12.*before paying again/,
  );
  assert.equal(tip?.urgent, true);
});
test("catalog has ten distinct fact-backed topics, each with at most two details", () => {
  const samples: FloDailyFacts[] = [
    {
      ...facts,
      decisions: [{ id: "breathing-room-opportunity", tone: "risk" }],
    },
    { ...facts, reviewCount: 2 },
    ...[true, false].map((pending) => ({
      ...facts,
      upcoming: [
        { name: "Bill", amount: 1.23, day: 20, month: 8, year: 2026, pending },
      ],
    })),
    {
      ...facts,
      goals: [{ name: "Goal", current_amount: 1.23, target_amount: 5 }],
    },
    {
      ...facts,
      goals: [{ name: "Goal", current_amount: 5, target_amount: 5 }],
    },
    { ...facts, payday: { date: "2026-09-25", income: 1500.22 } },
    {
      ...facts,
      categories: [
        { category: "Food", spent: 4.56, budgeted: 20, status: "available" },
      ],
    },
    { ...facts, safetyFloor: 200 },
    { ...facts, decisions: [{ id: "snowball-target", tone: "info" }] },
  ];
  const tips = samples.map((f) => selectTodayWithFlo(f, [])!);
  assert.equal(new Set(tips.map((t) => t.topic)).size, 10);
  assert.ok(
    tips.every((t) => t.details.length <= 2 && t.route.startsWith("/")),
  );
  assert.match(
    tips.find((t) => t.topic === "payday")!.details.join(" "),
    /Expected income is not money received/,
  );
  assert.match(
    tips.find((t) => t.topic === "goal-earmark")!.details.join(" "),
    /not a separate available-cash/,
  );
});
test("snapshot identity and household date must all match", () => {
  const identity = { userId: "u", householdId: "h", budgetId: "b" };
  assert.equal(
    dailySnapshotMatches(identity, identity, facts.today, facts.today),
    true,
  );
  for (const key of ["userId", "householdId", "budgetId"] as const)
    assert.equal(
      dailySnapshotMatches(
        { ...identity, [key]: "other" },
        identity,
        facts.today,
        facts.today,
      ),
      false,
    );
  assert.equal(
    dailySnapshotMatches(identity, identity, "2026-09-10", facts.today),
    false,
  );
});
test("once per household day survives reopen and budget switching, next day eligible", async () => {
  let disk: TodayWithFloSaved = {};
  const create = () =>
    createTodayWithFloStore(
      async () => disk,
      async (v) => {
        disk = { ...disk, ...v };
      },
    );
  const store = create();
  await store.hydrate();
  assert.equal(store.canPresent("b1", facts.today), true);
  assert.equal(
    await store.claimPresentation("b1", facts.today, "review"),
    true,
  );
  assert.equal(store.canPresent("b2", facts.today), false);
  const reopened = create();
  await reopened.hydrate();
  assert.equal(reopened.canPresent("b1", facts.today), false);
  assert.equal(reopened.canPresent("b1", "2026-09-12"), true);
  assert.deepEqual(disk.history, {
    b1: [{ day: facts.today, topic: "review" }],
  });
});
test("failed reads/corrupt settings fail closed; legitimate empty prefs default ON", async () => {
  for (const invalid of [
    { enabled: "false" },
    { history: [] },
    { history: { b: [null] } },
    null,
  ]) {
    const store = createTodayWithFloStore(
      async () => invalid as unknown as TodayWithFloSaved,
      async () => {},
    );
    await store.hydrate();
    assert.equal(store.getSnapshot().ready, false);
    assert.equal(store.canPresent("b", facts.today), false);
  }
  const store = createTodayWithFloStore(
    async () => {
      throw new Error("disk");
    },
    async () => {},
  );
  await store.hydrate();
  assert.equal(store.canPresent("b", facts.today), false);
});
test("storage failure never authorizes presentation and does not flip saved toggle", async () => {
  const store = createTodayWithFloStore(
    async () => ({}),
    async () => {
      throw new Error("disk");
    },
  );
  await store.hydrate();
  assert.equal(
    await store.claimPresentation("b", facts.today, "review"),
    false,
  );
  assert.equal(store.canPresent("b", facts.today), false);
  assert.equal(await store.setEnabled(false), false);
  assert.equal(store.getSnapshot().enabled, true);
});
test("rapid toggles serialize by rejecting while saving; disposal invalidates pending completion", async () => {
  let resolve!: () => void;
  const store = createTodayWithFloStore(
    async () => ({}),
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  await store.hydrate();
  const first = store.setEnabled(false);
  assert.equal(await store.setEnabled(true), false);
  resolve();
  assert.equal(await first, true);
  assert.equal(store.getSnapshot().enabled, false);
  const next = store.setEnabled(true);
  store.dispose();
  resolve();
  assert.equal(await next, false);
  assert.equal(store.canPresent("b", facts.today), false);
});
test("shared household store isolates other users and clears on signout", async () => {
  const a = scopedTodayWithFloStore(
    "u",
    "h",
    async () => ({}),
    async () => {},
  );
  const again = scopedTodayWithFloStore(
    "u",
    "h",
    async () => ({}),
    async () => {},
  );
  const other = scopedTodayWithFloStore(
    "v",
    "h",
    async () => ({}),
    async () => {},
  );
  assert.equal(a, again);
  assert.notEqual(a, other);
  await a.hydrate();
  clearTodayWithFloStoresForUser("u");
  assert.equal(a.canPresent("b", facts.today), false);
  assert.notEqual(
    scopedTodayWithFloStore(
      "u",
      "h",
      async () => ({}),
      async () => {},
    ),
    a,
  );
});
test("overlapping modals hold the collision gate until all close", () => {
  const first = overlayActivity.register(),
    second = overlayActivity.register();
  assert.equal(overlayActivity.getSnapshot(), true);
  first();
  assert.equal(overlayActivity.getSnapshot(), true);
  second();
  assert.equal(overlayActivity.getSnapshot(), false);
});
test("a delayed refresh cannot re-enable a successfully saved off preference", async () => {
  let resolve!: (saved: TodayWithFloSaved) => void;
  let reads = 0;
  const store = createTodayWithFloStore(
    () =>
      ++reads === 1
        ? Promise.resolve({})
        : new Promise((r) => {
            resolve = r;
          }),
    async () => {},
  );
  await store.hydrate();
  const refresh = store.hydrate(true);
  assert.equal(await store.setEnabled(false), true);
  resolve({ enabled: true });
  await refresh;
  assert.equal(store.getSnapshot().enabled, false);
  assert.equal(store.canPresent("b", facts.today), false);
});
test("a superseded failed refresh cannot invalidate the newer saved setting", async () => {
  let reject!: (error: Error) => void;
  let reads = 0;
  const store = createTodayWithFloStore(
    () =>
      ++reads === 1
        ? Promise.resolve({})
        : new Promise((_resolve, fail) => {
            reject = fail;
          }),
    async () => {},
  );
  await store.hydrate();
  const refresh = store.hydrate(true);
  await store.setEnabled(false);
  reject(new Error("old read"));
  await refresh;
  assert.equal(store.getSnapshot().ready, true);
  assert.equal(store.getSnapshot().error, null);
  assert.equal(store.getSnapshot().enabled, false);
});
test("native workspace interactions cancel pending daily opportunities", () => {
  let cancelled = false;
  const off = overlayActivity.subscribeInteractions(() => {
    cancelled = true;
  });
  overlayActivity.interact();
  assert.equal(cancelled, true);
  off();
  const root = readFileSync("app/_layout.tsx", "utf8");
  assert.match(root, /onTouchStart=\{overlayActivity.interact\}/);
  const source = readFileSync("components/TodayWithFlo.tsx", "utf8");
  assert.equal((source.match(/editing\(\) \|\|/g) ?? []).length, 2);
  assert.match(source, /subscribeInteractions\(cancel\)/);
  const prefs = readFileSync("lib/interfacePreferences.ts", "utf8");
  assert.match(
    prefs,
    /if \(throwOnError\) throw new Error\("Invalid interface preferences"\)/,
  );
});
test("integration remains post-reveal, bounded, scoped and free of financial requests", () => {
  const source = readFileSync("components/TodayWithFlo.tsx", "utf8");
  assert.match(source, /useDashboardFinancialSnapshot\(\)/);
  assert.doesNotMatch(
    source,
    /getDailyBalances|getCashFlow|fetch\(|supabase|OpenAI|buildDashboard/,
  );
  assert.match(source, /started > 8000/);
  assert.match(source, /2300/);
  assert.match(source, /navigator\.locks\.request/);
  assert.ok(
    source.indexOf("await preference.store.claimPresentation") <
      source.indexOf("setPresentation({ tip"),
  );
  assert.match(source, /dailySnapshotMatches/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /onRequestClose=\{close\}/);
  assert.match(source, /Escape/);
  const root = readFileSync("app/_layout.tsx", "utf8");
  assert.match(
    root,
    /<TodayWithFlo ready=\{readyToReveal && !effectivePrivacyShielded && !privacyRefreshError && !biometricLocked && !budgetLoading && !budgetLoadError && !!session\}/,
  );
});
