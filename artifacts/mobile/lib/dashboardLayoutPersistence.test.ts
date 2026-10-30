import assert from "node:assert/strict";
import test from "node:test";
import {
  DashboardLayoutController,
  DashboardPersistenceCancelled,
  dispatchDashboardLayoutSave,
  type DashboardLayoutState,
} from "./dashboardLayoutPersistence";
import {
  DEFAULT_DASHBOARD_LAYOUT,
  applyDashboardLayoutPreset,
  normalizeDashboardLayout,
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
