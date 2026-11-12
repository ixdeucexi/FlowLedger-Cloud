import assert from "node:assert/strict";
import test from "node:test";
import {
  DashboardLayoutController,
  DashboardPersistenceCancelled,
  dispatchDashboardLayoutSave,
  initialDashboardLayoutState,
  type DashboardLayoutState,
} from "./dashboardLayoutPersistence";
import {
  DEFAULT_DASHBOARD_LAYOUT,
  applyDashboardLayoutPreset,
  normalizeDashboardLayout,
  moveDashboardWidget,
  setDashboardAccountsCollapsed,
  setDashboardWidgetVisible,
  toggleDashboardFavoriteAction,
  type DashboardLayoutPreference,
} from "./dashboardCustomization";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("remote layout dispatch rejects an SDK account different from the captured owner", async () => {
  let writes = 0;
  await assert.rejects(dispatchDashboardLayoutSave({
    userId: "user-a",
    canWrite: () => true,
    getSession: async () => ({ data: { session: { user: { id: "user-b" }, access_token: "fixture-user-b" } }, error: null }),
    write: async () => { writes += 1; },
  }), DashboardPersistenceCancelled);
  assert.equal(writes, 0);
});

test("scope changes while SDK session resolves cancel dispatch before the RPC", async () => {
  const session = deferred<{ data: { session: { user: { id: string }; access_token: string } }; error: null }>();
  let current = true;
  let writes = 0;
  const saving = dispatchDashboardLayoutSave({
    userId: "user-a",
    canWrite: () => current,
    getSession: () => session.promise,
    write: async () => { writes += 1; },
  });
  current = false;
  session.resolve({ data: { session: { user: { id: "user-a" }, access_token: "fixture-user-a" } }, error: null });
  await assert.rejects(saving, DashboardPersistenceCancelled);
  assert.equal(writes, 0);
});

test("valid layout dispatch binds the checked session rather than later SDK auth state", async () => {
  const session = { user: { id: "user-a" }, access_token: "fixture-user-a" };
  let sent = "";
  await dispatchDashboardLayoutSave({
    userId: "user-a",
    canWrite: () => true,
    getSession: async () => ({ data: { session }, error: null }),
    write: async (token) => { session.access_token = "fixture-new-account"; sent = token; },
  });
  assert.equal(sent, "fixture-user-a");
});

test("a disposed controller waiting for auth neither sends an RPC nor publishes another scope's error", async () => {
  const session = deferred<{ data: { session: { user: { id: string }; access_token: string } }; error: null }>();
  let current = true;
  let writes = 0;
  const published: DashboardLayoutState[] = [];
  const controller = new DashboardLayoutController({
    isCurrent: () => current,
    remoteEnabled: true,
    readLocal: async () => ({}),
    readRemote: async () => undefined,
    writeLocal: async (_layout, _pending, canWrite) => {
      if (!canWrite()) throw new DashboardPersistenceCancelled();
    },
    writeRemote: (_layout, canWrite) => dispatchDashboardLayoutSave({
      userId: "user-a", canWrite, getSession: () => session.promise,
      write: async () => { writes += 1; },
    }),
    onChange: value => { published.push(value); },
  });
  controller.update(applyDashboardLayoutPreset("simple"));
  await tick();
  current = false;
  controller.dispose();
  const before = published.length;
  session.resolve({ data: { session: { user: { id: "user-a" }, access_token: "fixture-user-a" } }, error: null });
  await controller.settled();
  assert.equal(writes, 0);
  assert.equal(published.length, before);
  assert.ok(published.every(value => value.saveError === null));
});
function harness(options: { remoteEnabled?: boolean } = {}) {
  const state = {
    current: true,
    local: {
      layout: normalizeDashboardLayout(DEFAULT_DASHBOARD_LAYOUT) as unknown,
      pendingSync: false,
    },
    remote: undefined as unknown,
    localReadError: false,
    remoteReadError: false,
    localWriteError: false,
    remoteWriteError: false,
    localRead: null as
      | null
      | (() => Promise<{ layout?: unknown; pendingSync?: boolean }>),
    remoteRead: null as null | (() => Promise<unknown>),
    remoteGate: null as null | Promise<void>,
    localGate: null as null | Promise<void>,
    states: [] as DashboardLayoutState[],
    writes: [] as { layout: DashboardLayoutPreference; pendingSync: boolean }[],
    remoteWrites: [] as DashboardLayoutPreference[],
    remoteReads: 0,
  };
  const controller = new DashboardLayoutController({
    isCurrent: () => state.current,
    remoteEnabled: options.remoteEnabled ?? true,
    readLocal: async () => {
      if (state.localRead) return state.localRead();
      if (state.localReadError) throw new Error("local read denied");
      return state.local;
    },
    readRemote: async () => {
      state.remoteReads += 1;
      if (state.remoteRead) return state.remoteRead();
      if (state.remoteReadError) throw new Error("offline");
      return state.remote;
    },
    writeLocal: async (layout, pendingSync, canWrite) => {
      if (state.localGate) await state.localGate;
      if (!canWrite()) throw new DashboardPersistenceCancelled();
      if (state.localWriteError) throw new Error("quota");
      const copy = normalizeDashboardLayout(layout);
      state.local = { layout: copy, pendingSync };
      state.writes.push({ layout: copy, pendingSync });
    },
    writeRemote: async (layout) => {
      state.remoteWrites.push(normalizeDashboardLayout(layout));
      if (state.remoteGate) await state.remoteGate;
      if (state.remoteWriteError) throw new Error("offline");
      state.remote = normalizeDashboardLayout(layout);
    },
    onChange: (next) => state.states.push(next),
  });
  return { controller, state };
}

test("late hydration cannot replace a new user edit, even after its save finishes", async () => {
  const h = harness(),
    local = deferred<{ layout?: unknown }>(),
    remote = deferred<unknown>();
  h.state.localRead = () => local.promise;
  h.state.remoteRead = () => remote.promise;
  const loading = h.controller.load();
  const next = applyDashboardLayoutPreset("debt_focus");
  h.controller.update(next);
  await h.controller.settled();
  local.resolve({ layout: DEFAULT_DASHBOARD_LAYOUT });
  remote.resolve(DEFAULT_DASHBOARD_LAYOUT);
  await loading;
  assert.deepEqual(h.controller.getSnapshot().layout, next);
  assert.equal(h.controller.getSnapshot().loading, false);
  assert.deepEqual(h.state.local.layout, next);
});

test("local unsynced layout wins a stale remote record after reload and retries sync", async () => {
  const h = harness(),
    next = applyDashboardLayoutPreset("planning_ahead");
  h.state.local = { layout: next, pendingSync: true };
  h.state.remote = DEFAULT_DASHBOARD_LAYOUT;
  await h.controller.load();
  await h.controller.settled();
  assert.deepEqual(h.controller.getSnapshot().layout, next);
  assert.deepEqual(h.state.remoteWrites, [next]);
  assert.equal(h.state.local.pendingSync, false);
});

test("new local edit is persisted while an older remote request is still waiting", async () => {
  const h = harness(),
    gate = deferred<void>();
  h.state.remoteGate = gate.promise;
  const first = applyDashboardLayoutPreset("simple"),
    latest = applyDashboardLayoutPreset("debt_focus");
  h.controller.update(first);
  await tick();
  assert.equal(h.state.remoteWrites.length, 1);
  h.controller.update(latest);
  await tick();
  assert.deepEqual(h.state.local.layout, latest);
  assert.equal(h.state.local.pendingSync, true);
  gate.resolve();
  await h.controller.settled();
  assert.deepEqual(h.state.remoteWrites, [first, latest]);
  assert.deepEqual(h.state.local.layout, latest);
  assert.equal(h.state.local.pendingSync, false);
});

test("account or household invalidation cancels queued remote saves and old UI updates", async () => {
  const h = harness(),
    gate = deferred<void>();
  h.state.remoteGate = gate.promise;
  h.controller.update(applyDashboardLayoutPreset("simple"));
  await tick();
  h.controller.update(applyDashboardLayoutPreset("debt_focus"));
  await tick();
  h.state.current = false;
  h.controller.dispose();
  const publishedBefore = h.state.states.length;
  gate.resolve();
  await h.controller.settled();
  assert.equal(
    h.state.remoteWrites.length,
    1,
    "only already-authorized in-flight request ran",
  );
  assert.equal(h.state.states.length, publishedBefore);
  assert.equal(
    h.state.local.pendingSync,
    true,
    "late old request cannot mark the newer local edit synced",
  );
});

test("remote save failure keeps local layout pending and retry saves latest choices", async () => {
  const h = harness(),
    next = applyDashboardLayoutPreset("planning_ahead");
  h.state.remoteWriteError = true;
  h.controller.update(next);
  await h.controller.settled();
  assert.match(h.controller.getSnapshot().saveError!, /Saved on this device/);
  assert.equal(h.state.local.pendingSync, true);
  assert.deepEqual(h.state.local.layout, next);
  h.state.remoteWriteError = false;
  h.controller.retrySave();
  await h.controller.settled();
  assert.equal(h.controller.getSnapshot().saveError, null);
  assert.equal(h.controller.getSnapshot().saving, false);
  assert.equal(h.state.local.pendingSync, false);
  assert.deepEqual(h.state.remote, next);
});

test("retry loading cannot discard dirty on-screen choices after a failed save", async () => {
  const h = harness(),
    next = applyDashboardLayoutPreset("debt_focus");
  h.state.remoteWriteError = true;
  h.controller.update(next);
  await h.controller.settled();
  h.state.remote = applyDashboardLayoutPreset("simple");
  await h.controller.retryLoad();
  assert.deepEqual(h.controller.getSnapshot().layout, next);
  assert.deepEqual(h.state.local.layout, next);
  assert.equal(h.state.local.pendingSync, true);
});

test("local quota failure is visible immediately while an earlier remote save is pending", async () => {
  const h = harness(),
    gate = deferred<void>();
  h.state.remoteGate = gate.promise;
  h.controller.update(applyDashboardLayoutPreset("simple"));
  await tick();
  h.state.localWriteError = true;
  const next = applyDashboardLayoutPreset("planning_ahead");
  h.controller.update(next);
  await tick();
  assert.match(
    h.controller.getSnapshot().saveError!,
    /Couldn’t save Dashboard on this device/,
  );
  assert.equal(h.controller.getSnapshot().saving, false);
  assert.deepEqual(h.controller.getSnapshot().layout, next);
  gate.resolve();
  await h.controller.settled();
  assert.equal(
    h.state.remoteWrites.length,
    1,
    "unsaved local draft is not sent remotely",
  );
  h.state.localWriteError = false;
  h.controller.retrySave();
  await h.controller.settled();
  assert.equal(h.controller.getSnapshot().saveError, null);
  assert.deepEqual(h.state.remote, next);
});

test("failed hydration is recoverable and never writes over unreadable local preferences", async () => {
  const h = harness();
  h.state.localReadError = true;
  h.state.remoteReadError = true;
  await h.controller.load();
  assert.ok(h.controller.getSnapshot().loadError);
  assert.equal(h.controller.getSnapshot().loading, false);
  assert.equal(h.state.writes.length, 0);
  const next = applyDashboardLayoutPreset("simple");
  h.state.localReadError = false;
  h.state.remoteReadError = false;
  h.state.remote = next;
  await h.controller.retryLoad();
  assert.equal(h.controller.getSnapshot().loadError, null);
  assert.deepEqual(h.controller.getSnapshot().layout, next);
});

test("stale local completion is guarded inside the queued device write", async () => {
  const h = harness(),
    gate = deferred<void>();
  h.state.localGate = gate.promise;
  h.controller.update(applyDashboardLayoutPreset("simple"));
  h.state.current = false;
  h.controller.dispose();
  gate.resolve();
  await h.controller.settled();
  assert.equal(h.state.writes.length, 0);
  assert.equal(h.state.remoteWrites.length, 0);
});

test("demo layouts save on device without any remote access", async () => {
  const h = harness({ remoteEnabled: false });
  await h.controller.load();
  h.controller.update(applyDashboardLayoutPreset("simple"));
  await h.controller.settled();
  assert.equal(h.state.remoteReads, 0);
  assert.equal(h.state.remoteWrites.length, 0);
  assert.equal(h.state.local.pendingSync, false);
  assert.equal(h.controller.getSnapshot().saving, false);
});

const savedPrivateLayout = () => normalizeDashboardLayout({
  ...DEFAULT_DASHBOARD_LAYOUT,
  hidden: ["setup", "zero_based_budget", "accounts", "breathing_room"],
  accountsCollapsed: true,
});

test("old local and cloud expanded defaults fold once and the next explicit expansion persists", async () => {
  for (const source of ["local", "cloud"] as const) {
    const legacy = {
      order: ["buckets", "accounts", "overview", "snapshot"],
      hidden: ["today_decisions"],
      favoriteActions: ["add-goal", "open-review"],
      accountsCollapsed: false,
    };
    const h = harness();
    h.state.local = { layout: source === "local" ? legacy : undefined, pendingSync: false };
    h.state.remote = source === "cloud" ? legacy : undefined;
    await h.controller.load();
    await h.controller.settled();
    const folded = h.controller.getSnapshot().layout;
    assert.equal(folded.accountsCollapsed, true, source);
    assert.equal(folded.accountsCollapseVersion, 1);
    assert.deepEqual(folded.hidden, legacy.hidden);
    assert.deepEqual(folded.favoriteActions, legacy.favoriteActions);
    assert.deepEqual(folded.order.filter(id => legacy.order.includes(id)), legacy.order);
    h.controller.update(current => setDashboardAccountsCollapsed(current, false));
    await h.controller.settled();
    const expanded = h.controller.getSnapshot().layout;
    assert.equal(expanded.accountsCollapsed, false);
    assert.equal(expanded.accountsCollapseVersion, 1);
    assert.deepEqual(h.state.remoteWrites, [expanded]);
    assert.deepEqual(h.state.local.layout, expanded);
    const reloaded = harness();
    reloaded.state.local = structuredClone(h.state.local);
    reloaded.state.remote = structuredClone(h.state.remote);
    await reloaded.controller.load();
    await reloaded.controller.settled();
    assert.deepEqual(reloaded.controller.getSnapshot().layout, expanded);
    assert.equal(reloaded.state.remoteWrites.length, 0);
    h.controller.dispose(); reloaded.controller.dispose();
  }
});

test("unknown saved preferences stay unready until the household read confirms absence", async () => {
  const h = harness(), remote = deferred<unknown>();
  h.state.local.layout = undefined;
  h.state.remoteRead = () => remote.promise;
  assert.equal(initialDashboardLayoutState(false).ready, false);
  assert.equal(h.controller.getSnapshot().ready, false);
  const loading = h.controller.load();
  await tick();
  assert.equal(h.controller.getSnapshot().loading, true);
  assert.equal(h.controller.getSnapshot().ready, false);
  assert.equal(h.state.writes.length, 0, "unread preferences cannot be replaced by default cache data");
  assert.equal(h.state.remoteWrites.length, 0);
  remote.resolve(undefined);
  await loading;
  assert.equal(h.controller.getSnapshot().loading, false);
  assert.equal(h.controller.getSnapshot().ready, true);
  assert.deepEqual(h.controller.getSnapshot().layout, DEFAULT_DASHBOARD_LAYOUT);
  assert.equal(h.state.remoteWrites.length, 0, "confirmed absence does not create remote preferences");
});

test("failed unknown preferences stay unready without autosaving defaults and retry can restore hidden cards", async () => {
  for (const localFailure of [false, true]) {
    const h = harness(), saved = savedPrivateLayout();
    h.state.local.layout = undefined;
    h.state.localReadError = localFailure;
    h.state.remoteReadError = true;
    await h.controller.load();
    assert.equal(h.controller.getSnapshot().ready, false);
    assert.equal(h.controller.getSnapshot().loading, false);
    assert.ok(h.controller.getSnapshot().loadError);
    assert.equal(h.state.writes.length, 0);
    assert.equal(h.state.remoteWrites.length, 0);
    h.state.localReadError = false;
    h.state.remoteReadError = false;
    h.state.remote = saved;
    await h.controller.retryLoad();
    assert.equal(h.controller.getSnapshot().ready, true);
    assert.equal(h.controller.getSnapshot().loadError, null);
    assert.deepEqual(h.controller.getSnapshot().layout, saved);
    assert.deepEqual(h.state.local.layout, saved);
  }
});

test("a saved scoped device layout is usable while cloud preferences are still pending", async () => {
  const h = harness(), saved = savedPrivateLayout(), remote = deferred<unknown>();
  h.state.local = { layout: saved, pendingSync: false };
  h.state.remoteRead = () => remote.promise;
  const loading = h.controller.load();
  await tick();
  assert.equal(h.controller.getSnapshot().ready, true);
  assert.equal(h.controller.getSnapshot().loading, true);
  assert.deepEqual(h.controller.getSnapshot().layout, saved);
  assert.equal(h.state.remoteWrites.length, 0);
  remote.resolve(saved);
  await loading;
  assert.equal(h.controller.getSnapshot().ready, true);
  assert.deepEqual(h.controller.getSnapshot().layout, saved);
});

test("saved hidden cards and folded accounts survive an offline reload", async () => {
  const h = harness(), saved = savedPrivateLayout();
  h.state.local = { layout: saved, pendingSync: false };
  h.state.remoteReadError = true;
  await h.controller.load();
  assert.equal(h.controller.getSnapshot().ready, true);
  assert.ok(h.controller.getSnapshot().loadError);
  assert.deepEqual(h.controller.getSnapshot().layout, saved);
  assert.deepEqual(h.state.local.layout, saved);
  assert.equal(h.state.remoteWrites.length, 0);
});

test("unsynced hidden cards and folded accounts beat stale cloud preferences after reload", async () => {
  const h = harness(), saved = savedPrivateLayout();
  h.state.local = { layout: saved, pendingSync: true };
  h.state.remote = DEFAULT_DASHBOARD_LAYOUT;
  h.state.remoteWriteError = true;
  await h.controller.load();
  await h.controller.settled();
  assert.equal(h.controller.getSnapshot().ready, true);
  assert.deepEqual(h.controller.getSnapshot().layout, saved);
  assert.deepEqual(h.state.remoteWrites, [saved]);
  assert.equal(h.state.local.pendingSync, true);
  assert.deepEqual(h.state.local.layout, saved);
  h.state.remoteWriteError = false;
  h.controller.retrySave();
  await h.controller.settled();
  assert.equal(h.state.local.pendingSync, false);
  assert.deepEqual(h.state.remote, saved);
});

test("rapid functional layout edits preserve collapse, visibility, order and favorites across an old cloud acknowledgment", async () => {
  const h = harness(), firstAck = deferred<void>(), latestAck = deferred<void>();
  await h.controller.load();
  h.state.remoteGate = firstAck.promise;
  h.controller.update(current => setDashboardWidgetVisible(current, "setup", false));
  await tick();
  assert.equal(h.state.remoteWrites.length, 1);
  const first = h.state.remoteWrites[0];
  h.controller.update(current => setDashboardAccountsCollapsed(current, true));
  h.controller.update(current => setDashboardWidgetVisible(current, "accounts", false));
  h.controller.update(current => moveDashboardWidget(current, "accounts", "down"));
  h.controller.update(current => toggleDashboardFavoriteAction(current, "add-income"));
  const latest = h.controller.getSnapshot().layout;
  assert.equal(latest.accountsCollapsed, true);
  assert.ok(latest.hidden.includes("setup"));
  assert.ok(latest.hidden.includes("accounts"));
  assert.equal(latest.order.indexOf("accounts"), DEFAULT_DASHBOARD_LAYOUT.order.indexOf("accounts") + 1);
  assert.deepEqual(latest.favoriteActions, [...DEFAULT_DASHBOARD_LAYOUT.favoriteActions, "add-income"]);
  await tick();
  assert.deepEqual(h.state.local.layout, latest);
  assert.equal(h.state.local.pendingSync, true);
  h.state.remoteGate = latestAck.promise;
  firstAck.resolve();
  await tick();
  assert.deepEqual(h.state.remoteWrites, [first, latest]);
  assert.equal(h.state.local.pendingSync, true, "an old acknowledgment cannot mark newer choices synced");
  assert.deepEqual(h.state.local.layout, latest);
  assert.deepEqual(h.controller.getSnapshot().layout, latest);
  latestAck.resolve();
  await h.controller.settled();
  assert.equal(h.state.local.pendingSync, false);
  assert.deepEqual(h.state.remote, latest);
});

test("a disposed old scope cannot publish preferences or acknowledge a new A-B-A visit", async () => {
  const oldVisit = harness(), remote = deferred<unknown>(), saved = savedPrivateLayout();
  oldVisit.state.local.layout = undefined;
  oldVisit.state.remoteRead = () => remote.promise;
  const loading = oldVisit.controller.load();
  await tick();
  oldVisit.state.current = false;
  oldVisit.controller.dispose();
  const lastPublished = oldVisit.state.states.length;
  const newVisit = harness();
  newVisit.state.local = { layout: saved, pendingSync: false };
  newVisit.state.remote = saved;
  await newVisit.controller.load();
  oldVisit.state.current = true;
  remote.resolve(DEFAULT_DASHBOARD_LAYOUT);
  await loading;
  oldVisit.controller.update(DEFAULT_DASHBOARD_LAYOUT);
  await oldVisit.controller.settled();
  assert.equal(oldVisit.state.states.length, lastPublished);
  assert.equal(oldVisit.state.writes.length, 0);
  assert.equal(oldVisit.state.remoteWrites.length, 0);
  assert.deepEqual(newVisit.controller.getSnapshot().layout, saved);
  assert.equal(newVisit.controller.getSnapshot().ready, true);
});
