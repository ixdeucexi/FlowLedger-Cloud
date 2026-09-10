import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createFloLauncherPreferenceStore,
  scopedFloLauncherPreferenceStore,
  clearFloLauncherPreferenceStoresForUser,
} from "./floLauncherVisibility";

test("default on, persisted off, observable shared setting and persisted Undo", async () => {
  let saved: { floLauncherEnabled?: boolean } = {};
  const make = () =>
    createFloLauncherPreferenceStore(
      async () => saved,
      async (value) => {
        saved = { floLauncherEnabled: value };
      },
    );
  const store = make();
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications++;
  });
  assert.equal(store.getSnapshot().ready, false);
  await store.hydrate();
  assert.equal(store.getSnapshot().enabled, true);
  assert.equal(await store.setEnabled(false), true);
  assert.equal(store.getSnapshot().enabled, false);
  const reopened = make();
  await reopened.hydrate();
  assert.equal(reopened.getSnapshot().enabled, false);
  assert.equal(await store.setEnabled(true), true);
  assert.equal(saved.floLauncherEnabled, true);
  assert.ok(notifications >= 5);
  unsubscribe();
});

test("registry shares exact scope only and logout invalidates only that user's memory", async () => {
  const read = async () => ({});
  const write = async () => {};
  const a = scopedFloLauncherPreferenceStore("user-a", "home-a", read, write);
  const same = scopedFloLauncherPreferenceStore(
    "user-a",
    "home-a",
    read,
    write,
  );
  const otherHome = scopedFloLauncherPreferenceStore(
    "user-a",
    "home-b",
    read,
    write,
  );
  const otherUser = scopedFloLauncherPreferenceStore(
    "user-b",
    "home-a",
    read,
    write,
  );
  assert.equal(a, same);
  assert.notEqual(a, otherHome);
  assert.notEqual(a, otherUser);
  await Promise.all([a.hydrate(), otherHome.hydrate(), otherUser.hydrate()]);
  await a.setEnabled(false);
  assert.equal(same.getSnapshot().enabled, false);
  assert.equal(otherHome.getSnapshot().enabled, true);
  assert.equal(otherUser.getSnapshot().enabled, true);
  clearFloLauncherPreferenceStoresForUser("user-a");
  assert.notEqual(
    scopedFloLauncherPreferenceStore("user-a", "home-a", read, write),
    a,
  );
  assert.notEqual(
    scopedFloLauncherPreferenceStore("user-a", "home-b", read, write),
    otherHome,
  );
  assert.equal(
    scopedFloLauncherPreferenceStore("user-b", "home-a", read, write),
    otherUser,
  );
});

test("hydration deduplicates, blocks early writes and separates household completion", async () => {
  let resolve!: (value: { floLauncherEnabled: boolean }) => void;
  let reads = 0;
  const a = createFloLauncherPreferenceStore(
    () => {
      reads++;
      return new Promise((done) => {
        resolve = done;
      });
    },
    async () => {},
  );
  const b = createFloLauncherPreferenceStore(
    async () => ({}),
    async () => {},
  );
  const load = a.hydrate();
  assert.equal(a.hydrate(), load);
  assert.equal(await a.setEnabled(false), false);
  await b.hydrate();
  resolve({ floLauncherEnabled: false });
  await load;
  assert.equal(reads, 1);
  assert.equal(a.getSnapshot().enabled, false);
  assert.equal(b.getSnapshot().enabled, true);
});

test("save failure keeps confirmed state and concurrent writes cannot race", async () => {
  let reject!: (error: Error) => void;
  const store = createFloLauncherPreferenceStore(
    async () => ({}),
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await store.hydrate();
  const saving = store.setEnabled(false);
  assert.equal(store.getSnapshot().saving, true);
  assert.equal(store.getSnapshot().enabled, true);
  assert.equal(await store.setEnabled(true), false);
  reject(new Error("storage failure"));
  assert.equal(await saving, false);
  assert.equal(store.getSnapshot().enabled, true);
  assert.match(store.getSnapshot().error!, /previous setting is unchanged/);
});

test("failed hydration stays unready and can retry without falsely showing saved-off launcher", async () => {
  let fail = true;
  const store = createFloLauncherPreferenceStore(
    async () => {
      if (fail) throw new Error("read failure");
      return { floLauncherEnabled: false };
    },
    async () => {},
  );
  await store.hydrate();
  assert.equal(store.getSnapshot().ready, false);
  assert.ok(store.getSnapshot().error);
  fail = false;
  await store.hydrate();
  assert.equal(store.getSnapshot().ready, true);
  assert.equal(store.getSnapshot().enabled, false);
});

test("fixed launcher hold suppresses navigation and every preference surface uses one shared control", () => {
  const read = (path: string) =>
    readFileSync(join(process.cwd(), path), "utf8");
  const launcher = read("components/FloLauncher.tsx");
  assert.doesNotMatch(
    launcher,
    /PanResponder|floLauncherPosition|name="x"|dragHandle/,
  );
  assert.match(launcher, /delayLongPress=\{650\}/);
  assert.match(launcher, /UNDO_DURATION_MS = 5000/);
  assert.match(launcher, /held.current = true/);
  assert.match(launcher, /if \(held.current\) return/);
  assert.match(launcher, /scope !== currentScope.current/);
  for (const path of [
    "components/DashboardCustomizer.tsx",
    "components/desktop/DesktopSettingsPage.tsx",
    "app/(tabs)/more.tsx",
  ])
    assert.match(read(path), /<FloLauncherSetting \/>/);
  assert.match(
    read("lib/floLauncherVisibility.ts"),
    /JSON.stringify\(\[userId, householdId\]\)/,
  );
  assert.doesNotMatch(
    read("hooks/useDashboardLayoutPreferences.ts"),
    /floLauncherEnabled/,
  );
});
