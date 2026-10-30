import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import * as model from "./bucketAppearance";
import { BucketAppearanceStore } from "./bucketAppearanceStore";

const scope = {
  userId: "user-one",
  householdId: "household-one",
  budgetId: "budget-one",
};
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const photoA = "photo-aaaa1111-bbbb2222.png",
  photoB = "photo-cccc3333-dddd4444.png";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function tick() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
function source(file: string, dependencies: Record<string, unknown>): any {
  const js = transpileModule(
    readFileSync(path.join(__dirname, "..", file), "utf8"),
    {
      compilerOptions: {
        module: ModuleKind.CommonJS,
        target: ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const exports: Record<string, unknown> = {};
  new Function("exports", "require", js)(exports, (name: string) => {
    if (name in dependencies) return dependencies[name];
    throw Error("Unexpected dependency " + name);
  });
  return exports;
}
test("bucket appearance is closed, bounded, scoped and separate from financial fields", () => {
  const value = model.normalizeBucketAppearance({
    version: 1,
    looks: JSON.parse(
      '{"holiday":{"icon":"gift","cover":"ocean","photoId":"photo-aaaa1111-bbbb2222.png","celebrateCompletion":true,"target_amount":9},"__proto__":{"icon":"sun"}}',
    ),
    seen: ["a", "a", 5],
  });
  assert.deepEqual(value.looks.holiday, {
    icon: "gift",
    cover: "ocean",
    photoId: photoA,
    celebrateCompletion: true,
  });
  assert.equal(Object.hasOwn(value.looks, "__proto__"), false);
  assert.deepEqual(value.seen, ["a"]);
  assert.deepEqual(
    model.normalizeBucketLook({
      icon: "script",
      cover: "javascript:",
      photoId: "https://foreign/photo.jpg",
      celebrateCompletion: "yes",
    }),
    model.DEFAULT_BUCKET_LOOK,
  );
  const keys = [
    scope,
    { ...scope, userId: "user-two" },
    { ...scope, householdId: "household-two" },
    { ...scope, budgetId: "budget-two" },
  ].map(model.bucketAppearanceKey);
  assert.equal(new Set(keys).size, 4);
  assert.throws(() =>
    model.bucketAppearanceKey({ ...scope, budgetId: "../../other" }),
  );
  const original = Object.freeze({
    version: 1 as const,
    looks: Object.freeze({}),
    seen: [],
  });
  assert.equal(
    model.withBucketLook(original, "holiday", { icon: "sun" }).looks.holiday
      .icon,
    "sun",
  );
  assert.deepEqual(original.looks, {});
  assert.throws(() =>
    model.withBucketLook(original, "__proto__", { icon: "sun" }),
  );
  assert.throws(() => model.parseBucketAppearance("x".repeat(180001)));
});
test("photo validation accepts real image signatures and rejects SVG, empty, oversized and URI identifiers", () => {
  assert.equal(model.validateBucketPhoto(png, 120), "png");
  assert.equal(
    model.validateBucketPhoto(new Uint8Array([255, 216, 255, 1]), 120),
    "jpg",
  );
  assert.equal(
    model.validateBucketPhoto(
      new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]),
      120,
    ),
    "webp",
  );
  assert.throws(() =>
    model.validateBucketPhoto(new TextEncoder().encode("<svg>"), 100),
  );
  assert.throws(() => model.validateBucketPhoto(png, 0));
  assert.throws(() =>
    model.validateBucketPhoto(png, model.MAX_BUCKET_PHOTO_BYTES + 1),
  );
  assert.equal(model.validBucketPhotoId("../../photo.png"), false);
  assert.equal(model.validBucketPhotoId("blob:foreign"), false);
});
test("appearance storage preserves the previous look on failure and queues independent changes", async () => {
  let raw: string | null = null,
    fail = false;
  const gate = deferred<void>();
  let writes = 0;
  const store = new BucketAppearanceStore({
    read: async () => raw,
    write: async (next) => {
      writes++;
      if (writes === 1) await gate.promise;
      if (fail) throw Error("Storage full");
      raw = next;
    },
  });
  await store.load();
  const one = store.update("holiday", { icon: "gift" }),
    two = store.update("car", { cover: "ocean" });
  await tick();
  assert.deepEqual(store.getSnapshot().data.looks, {});
  gate.resolve();
  await Promise.all([one, two]);
  assert.equal(store.getSnapshot().data.looks.holiday.icon, "gift");
  assert.equal(store.getSnapshot().data.looks.car.cover, "ocean");
  const before = JSON.stringify(store.getSnapshot().data);
  fail = true;
  await assert.rejects(
    store.update("holiday", { icon: "sun" }),
    /Storage full/,
  );
  assert.equal(JSON.stringify(store.getSnapshot().data), before);
  assert.match(store.getSnapshot().saveError!, /Storage full/);
  fail = false;
  await store.update("holiday", { icon: "sun" });
  assert.equal(store.getSnapshot().saveError, null);
  const reloaded = new BucketAppearanceStore({
    read: async () => raw,
    write: async () => {},
  });
  await reloaded.load();
  assert.deepEqual(reloaded.getSnapshot().data, store.getSnapshot().data);
});
test("failed hydration does not overwrite saved metadata and retry restores it", async () => {
  let unavailable = true,
    writes = 0;
  const retryGate = deferred<void>();
  const store = new BucketAppearanceStore({
    read: () => {
      if (unavailable) throw Error("denied");
      return retryGate.promise.then(() =>
        JSON.stringify({
          version: 1,
          looks: { holiday: { icon: "gift", cover: "sunset" } },
          seen: [],
        }),
      );
    },
    write: async () => {
      writes++;
    },
  });
  await store.load();
  assert.ok(store.getSnapshot().loadError);
  await assert.rejects(store.update("holiday", { icon: "sun" }), /Load/);
  assert.equal(writes, 0);
  unavailable = false;
  const retry = store.load(true);
  await tick();
  assert.equal(store.getSnapshot().ready, false);
  await assert.rejects(store.update("holiday", { icon: "sun" }), /Load/);
  retryGate.resolve();
  await retry;
  assert.equal(store.getSnapshot().loadError, null);
  assert.equal(store.getSnapshot().data.looks.holiday.cover, "sunset");
  assert.equal(writes, 0);
});
test("stale asynchronous edits do not write and disposal waits for in-flight writes before purge", async () => {
  let writes = 0,
    current = true;
  const gate = deferred<void>();
  const store = new BucketAppearanceStore({
    read: async () => null,
    write: async () => {
      writes++;
    },
  });
  await store.load();
  const operation = store.change(
    async (data) => {
      await gate.promise;
      return {
        data: model.withBucketLook(data, "holiday", { icon: "gift" }),
        value: true,
      };
    },
    () => current,
  );
  await tick();
  current = false;
  gate.resolve();
  await assert.rejects(operation, /household changed/);
  assert.equal(writes, 0);
  const writeGate = deferred<void>();
  let finished = false;
  const delayed = new BucketAppearanceStore({
    read: async () => null,
    write: async () => {
      await writeGate.promise;
      finished = true;
    },
  });
  await delayed.load();
  const pending = delayed.update("holiday", { icon: "sun" });
  await tick();
  let disposed = false;
  const purge = delayed.dispose().then(() => {
    assert.equal(finished, true);
    disposed = true;
  });
  await tick();
  assert.equal(disposed, false);
  writeGate.resolve();
  await pending;
  await purge;
  assert.deepEqual(delayed.getSnapshot().data.looks, {});
});
test("milestones only celebrate real transitions, never spent budgets or initial hydration", () => {
  const bucket = {
    id: "trip",
    name: "Trip",
    goal_type: "planned_expense",
    target_amount: 500,
    current_amount: 500,
  };
  const savings = {
    ...bucket,
    id: "rainy",
    name: "Rainy day",
    goal_type: "savings",
    current_amount: 499,
  };
  const data = model.normalizeBucketAppearance({
    version: 1,
    looks: {
      trip: { celebrateCompletion: true },
      rainy: { celebrateCompletion: true },
    },
    seen: [],
  });
  assert.equal(model.eligibleBucketMilestone(bucket), null);
  assert.deepEqual(
    model.newBucketMilestones(
      null,
      [{ ...savings, current_amount: 500 }],
      data,
    ),
    [],
  );
  const goalEvent = model.newBucketMilestones(
    [savings],
    [{ ...savings, current_amount: 500 }],
    data,
  );
  assert.equal(goalEvent.length, 1);
  assert.equal(goalEvent[0].label, "Goal funded");
  const bucketEvent = model.newBucketMilestones(
    [bucket],
    [{ ...bucket, closed_at: "2026-10-30T12:00:00Z" }],
    data,
  );
  assert.equal(bucketEvent[0].label, "Bucket complete");
  assert.deepEqual(
    model.newBucketMilestones(
      [savings],
      [{ ...savings, current_amount: 500 }],
      { ...data, seen: [goalEvent[0].key] },
    ),
    [],
  );
  assert.deepEqual(
    model.newBucketMilestones(
      [savings],
      [{ ...savings, current_amount: 500 }],
      model.EMPTY_BUCKET_APPEARANCE,
    ),
    [],
  );
  assert.equal(
    model.eligibleBucketMilestone({ ...savings, current_amount: Infinity }),
    null,
  );
});
test("milestone observation waits for confirmed saves, suppresses hydration and clears failed/scope baselines", () => {
  const below = {
      id: "rainy",
      name: "Rainy",
      goal_type: "savings",
      target_amount: 100,
      current_amount: 50,
    },
    funded = { ...below, current_amount: 100 };
  const data = model.normalizeBucketAppearance({
    version: 1,
    looks: { rainy: { celebrateCompletion: true } },
    seen: [],
  });
  const idle = { ready: true, saving: false, failed: false, confirmed: false };
  const initial = model.observeBucketMilestones(
    null,
    "one",
    [below],
    data,
    idle,
  );
  assert.deepEqual(initial.events, []);
  const pending = model.observeBucketMilestones(
    initial.previous,
    "one",
    [funded],
    data,
    { ...idle, saving: true },
  );
  assert.deepEqual(pending.events, []);
  assert.equal(pending.previous, initial.previous);
  const saved = model.observeBucketMilestones(
    pending.previous,
    "one",
    [funded],
    data,
    { ...idle, confirmed: true },
  );
  assert.equal(saved.events[0].label, "Goal funded");
  const hydrated = model.observeBucketMilestones(
    initial.previous,
    "one",
    [funded],
    data,
    idle,
  );
  assert.deepEqual(hydrated.events, []);
  assert.equal(
    model.observeBucketMilestones(initial.previous, "one", [funded], data, {
      ...idle,
      failed: true,
    }).previous,
    null,
  );
  assert.deepEqual(
    model.observeBucketMilestones(
      initial.previous,
      "other-scope",
      [funded],
      data,
      { ...idle, confirmed: true },
    ).events,
    [],
  );
});

function runtimeFixture() {
  const data = new Map<string, string>(),
    deleted: string[] = [];
  let fail = false,
    created = photoB;
  const createGate = deferred<void>();
  let gated = false;
  const api = source("lib/bucketAppearanceRuntime.ts", {
    "@react-native-async-storage/async-storage": {
      getItem: async (k: string) => data.get(k) ?? null,
      setItem: async (k: string, v: string) => {
        if (fail) throw Error("quota");
        data.set(k, v);
      },
      getAllKeys: async () => [...data.keys()],
      multiRemove: async (keys: string[]) =>
        keys.forEach((k) => data.delete(k)),
    },
    "./bucketAppearance": model,
    "./bucketAppearanceStore": { BucketAppearanceStore },
    "./bucketPhotoStorage": {
      persistBucketPhoto: async () => {
        if (gated) await createGate.promise;
        return created;
      },
      deleteBucketPhoto: async (_s: unknown, id: string) => deleted.push(id),
      clearBucketPhotosForUser: async () => {},
    },
  });
  return {
    api,
    data,
    deleted,
    setFail: (v: boolean) => {
      fail = v;
    },
    gate: () => {
      gated = true;
    },
    createGate,
  };
}
test("photo replacement commits metadata before removing old asset; failure preserves old and removes orphan", async () => {
  const f = runtimeFixture(),
    key = model.bucketAppearanceKey(scope);
  f.data.set(
    key,
    JSON.stringify({
      version: 1,
      looks: { trip: { icon: "sun", cover: "none", photoId: photoA } },
      seen: [],
    }),
  );
  await f.api.getBucketAppearanceStore(scope).load();
  f.setFail(true);
  await assert.rejects(
    f.api.saveBucketPhoto(scope, "trip", {}, () => true),
    /quota/,
  );
  assert.equal(JSON.parse(f.data.get(key)!).looks.trip.photoId, photoA);
  assert.deepEqual(f.deleted, [photoB]);
  f.setFail(false);
  await f.api.saveBucketPhoto(scope, "trip", {}, () => true);
  assert.equal(JSON.parse(f.data.get(key)!).looks.trip.photoId, photoB);
  assert.deepEqual(f.deleted, [photoB, photoA]);
  await f.api.saveBucketLook(scope, "trip", { photoId: undefined }, () => true);
  assert.equal(JSON.parse(f.data.get(key)!).looks.trip.photoId, undefined);
  assert.equal(f.deleted.at(-1), photoB);
});
test("scope switches during photo creation remove the new orphan without changing metadata", async () => {
  const f = runtimeFixture(),
    key = model.bucketAppearanceKey(scope);
  await f.api.getBucketAppearanceStore(scope).load();
  let current = true;
  f.gate();
  const save = f.api.saveBucketPhoto(scope, "trip", {}, () => current);
  await tick();
  current = false;
  f.createGate.resolve();
  await assert.rejects(save, /household changed/);
  assert.equal(f.data.has(key), false);
  assert.deepEqual(f.deleted, [photoB]);
});
test("account deletion clears only the selected user's stores and photos", async () => {
  const f = runtimeFixture(),
    other = { ...scope, userId: "other-user" };
  await f.api.getBucketAppearanceStore(scope).load();
  await f.api.getBucketAppearanceStore(other).load();
  await f.api.saveBucketLook(scope, "trip", { icon: "sun" }, () => true);
  await f.api.saveBucketLook(other, "trip", { icon: "gift" }, () => true);
  await f.api.clearBucketAppearanceForUser(scope.userId);
  assert.equal(f.data.has(model.bucketAppearanceKey(scope)), false);
  assert.equal(f.data.has(model.bucketAppearanceKey(other)), true);
});

function photoStorageFixture(platform: "web" | "android") {
  const files = new Map<string, Uint8Array>([
      ["file:///cache/DocumentPicker/chosen.png", png],
    ]),
    directories = new Set<string>(),
    records = new Map<string, any>();
  const state = {
    failCopy: false,
    quota: false,
    badImage: false,
    picks: 0,
    canceled: false,
    closed: 0,
  };
  const uri = (parts: any[]) =>
    parts
      .map((part) => (typeof part === "string" ? part : part.uri))
      .map((part, i) =>
        i ? part.replace(/^\/+/, "") : part.replace(/\/+$/, ""),
      )
      .join("/");
  class File {
    uri: string;
    constructor(...parts: any[]) {
      this.uri = uri(parts);
    }
    get size() {
      return files.get(this.uri)?.length ?? 0;
    }
    get exists() {
      return files.has(this.uri);
    }
    async bytes() {
      return files.get(this.uri)!;
    }
    copy(target: File) {
      files.set(target.uri, files.get(this.uri)!);
      if (state.failCopy) throw Error("disk full");
    }
    delete() {
      files.delete(this.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: any[]) {
      this.uri = uri(parts);
    }
    get exists() {
      return (
        directories.has(this.uri) ||
        [...files.keys()].some((key) => key.startsWith(this.uri + "/"))
      );
    }
    create() {
      directories.add(this.uri);
    }
    delete() {
      for (const key of files.keys())
        if (key.startsWith(this.uri + "/")) files.delete(key);
      directories.delete(this.uri);
    }
  }
  const db = {
    close: () => {
      state.closed++;
    },
    transaction: () => {
      const tx: any = { failed: false };
      setTimeout(() => {
        if (!tx.failed) tx.oncomplete?.();
      }, 0);
      const request = (value: any) => {
        const r: any = {};
        queueMicrotask(() => {
          r.result = value;
          r.onsuccess?.();
        });
        return r;
      };
      tx.objectStore = () => ({
        put: (value: any) => {
          if (state.quota) throw Error("quota");
          records.set(value.id, value);
        },
        get: (key: string) => request(records.get(key)),
        delete: (key: string) => records.delete(key),
        index: () => ({
          openCursor: (userId: string) => {
            const r: any = {},
              rows = [...records.values()].filter((x) => x.userId === userId);
            let i = 0;
            const next = () =>
              queueMicrotask(() => {
                const record = rows[i++];
                r.result = record
                  ? { delete: () => records.delete(record.id), continue: next }
                  : null;
                r.onsuccess?.();
              });
            next();
            return r;
          },
        }),
      });
      return tx;
    },
  };
  const indexedDBMock = {
    open: () => {
      const r: any = {};
      queueMicrotask(() => {
        r.result = db;
        r.onsuccess?.();
      });
      return r;
    },
  };
  const globals = {
    indexedDB: Object.getOwnPropertyDescriptor(globalThis, "indexedDB"),
    IDBKeyRange: Object.getOwnPropertyDescriptor(globalThis, "IDBKeyRange"),
  };
  Object.defineProperty(globalThis, "indexedDB", {
    value: indexedDBMock,
    configurable: true,
  });
  Object.defineProperty(globalThis, "IDBKeyRange", {
    value: { only: (value: string) => value },
    configurable: true,
  });
  const restore = () => {
    for (const [key, value] of Object.entries(globals)) {
      if (value) Object.defineProperty(globalThis, key, value);
      else delete (globalThis as any)[key];
    }
  };
  const api = source("lib/bucketPhotoStorage.ts", {
    "react-native": {
      Platform: { OS: platform },
      Image: {
        getSize: (
          _uri: string,
          success: (w: number, h: number) => void,
          failure: () => void,
        ) => (state.badImage ? failure() : success(100, 100)),
      },
    },
    "expo-document-picker": {
      getDocumentAsync: async () => {
        state.picks++;
        return state.canceled
          ? { canceled: true, assets: null }
          : {
              canceled: false,
              assets: [
                {
                  uri: "file:///cache/DocumentPicker/chosen.png",
                  name: "photo.png",
                },
              ],
            };
      },
    },
    "./bucketAppearance": model,
    "expo-file-system": {
      File,
      Directory,
      Paths: {
        document: { uri: "file:///documents/" },
        cache: { uri: "file:///cache/" },
      },
    },
  });
  return { api, state, files, records, restore };
}
test("native photos copy to persistent scoped documents, reload, cleanup failures and remove picker copies", async () => {
  const f = photoStorageFixture("android");
  try {
    const asset = {
      uri: "file:///cache/DocumentPicker/chosen.png",
      name: "chosen.png",
    };
    const id = await f.api.persistBucketPhoto(scope, asset);
    const loaded = await f.api.loadBucketPhoto(scope, id);
    assert.match(
      loaded.uri,
      /^file:\/\/\/documents\/bucket-photos\/user-one\/household-one\/budget-one\/photo-/,
    );
    assert.ok(f.files.has(loaded.uri));
    loaded.release();
    await assert.rejects(
      f.api.loadBucketPhoto({ ...scope, budgetId: "another" }, id),
      /no longer/,
    );
    f.state.failCopy = true;
    const before = f.files.size;
    await assert.rejects(f.api.persistBucketPhoto(scope, asset), /disk full/);
    assert.equal(f.files.size, before, "partial new copies are removed");
    f.state.failCopy = false;
    await f.api.releasePickedBucketPhoto(asset);
    assert.equal(f.files.has(asset.uri), false);
    assert.ok(f.files.has(loaded.uri));
    await f.api.clearBucketPhotosForUser(scope.userId);
    assert.equal(f.files.has(loaded.uri), false);
  } finally {
    f.restore();
  }
});
test("web photos persist blobs by exact scope, survive reload URLs and retain others on removal", async () => {
  const f = photoStorageFixture("web");
  const blob = new Blob([png], { type: "image/png" }),
    picked = URL.createObjectURL(blob);
  try {
    const asset = { uri: picked, name: "chosen.png", file: blob };
    const id = await f.api.persistBucketPhoto(scope, asset);
    const second = await f.api.persistBucketPhoto(
      { ...scope, userId: "other-user" },
      asset,
    );
    assert.equal(f.records.size, 2);
    const loaded = await f.api.loadBucketPhoto(scope, id);
    assert.match(loaded.uri, /^blob:/);
    loaded.release();
    const reloaded = await f.api.loadBucketPhoto(scope, id);
    assert.notEqual(loaded.uri, reloaded.uri);
    reloaded.release();
    await assert.rejects(
      f.api.loadBucketPhoto({ ...scope, householdId: "another" }, id),
      /no longer/,
    );
    f.state.quota = true;
    await assert.rejects(f.api.persistBucketPhoto(scope, asset), /quota/);
    assert.equal(f.records.size, 2);
    f.state.quota = false;
    await f.api.clearBucketPhotosForUser(scope.userId);
    assert.equal(f.records.size, 1);
    const other = await f.api.loadBucketPhoto(
      { ...scope, userId: "other-user" },
      second,
    );
    other.release();
    await f.api.releasePickedBucketPhoto(asset);
  } finally {
    URL.revokeObjectURL(picked);
    f.restore();
  }
});
test("picker cancellation and undecodable images leave photo storage untouched", async () => {
  const f = photoStorageFixture("android");
  try {
    f.state.canceled = true;
    assert.equal(await f.api.chooseBucketPhoto(), null);
    assert.equal(f.state.picks, 1);
    f.state.badImage = true;
    await assert.rejects(
      f.api.persistBucketPhoto(scope, {
        uri: "file:///cache/DocumentPicker/chosen.png",
      }),
      /couldn’t be opened/,
    );
    assert.equal(
      [...f.files.keys()].filter((x) => x.includes("documents")).length,
      0,
    );
  } finally {
    f.restore();
  }
});
