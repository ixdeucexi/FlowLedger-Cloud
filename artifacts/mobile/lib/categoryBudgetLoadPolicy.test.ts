import assert from "node:assert/strict";
import test from "node:test";

import {
  createExactCategoryBudgetMemoryCache,
  parseCategoryBudgetCache,
  resolveGuardedRemoteValue,
} from "./categoryBudgetLoadPolicy";

test("category cache presence distinguishes missing, corrupt, and explicit empty plans", () => {
  assert.equal(parseCategoryBudgetCache(null), null);
  assert.equal(parseCategoryBudgetCache("not-json"), null);
  assert.equal(parseCategoryBudgetCache("[]"), null);
  assert.equal(parseCategoryBudgetCache('{"Housing":"900"}'), null);
  assert.deepEqual(parseCategoryBudgetCache("{}"), {});
  assert.deepEqual(parseCategoryBudgetCache('{"Housing":900}'), { Housing: 900 });
});

test("an authoritative native category result survives leave and re-entry, including exact empty", async () => {
  const cache = createExactCategoryBudgetMemoryCache();
  let revision = 0;
  const key = "budget-one:2026-08";
  await resolveGuardedRemoteValue({
    revisionAtStart: revision,
    currentRevision: () => revision,
    readCurrent: () => cache.read(key) ?? {},
    loadRemote: async () => ({ Housing: 900 }),
    commitRemote: value => {
      cache.write(key, value);
      revision += 1;
    },
  });
  assert.equal(cache.has(key), true);
  assert.deepEqual(cache.read(key), { Housing: 900 });

  const emptyKey = "budget-one:2026-09";
  cache.write(emptyKey, {});
  assert.equal(cache.has(emptyKey), true);
  assert.deepEqual(cache.read(emptyKey), {});
  assert.equal(cache.has("budget-one:2026-10"), false);
});

test("an older category fetch cannot overwrite a newer local save", async () => {
  let resolveRemote!: (value: Record<string, number>) => void;
  const remote = new Promise<Record<string, number>>(resolve => {
    resolveRemote = resolve;
  });
  let revision = 4;
  let current: Record<string, number> = { Housing: 900 };
  let remoteCommits = 0;
  const pending = resolveGuardedRemoteValue({
    revisionAtStart: revision,
    currentRevision: () => revision,
    readCurrent: () => current,
    loadRemote: () => remote,
    commitRemote: value => {
      remoteCommits += 1;
      current = value;
      revision += 1;
    },
  });

  current = { Housing: 1_050 };
  revision += 1;
  resolveRemote({ Housing: 875 });

  assert.deepEqual(await pending, { Housing: 1_050 });
  assert.deepEqual(current, { Housing: 1_050 });
  assert.equal(remoteCommits, 0);
});

test("an unchanged category revision accepts the authoritative result", async () => {
  let revision = 2;
  let current: Record<string, number> = { Food: 300 };
  const result = await resolveGuardedRemoteValue({
    revisionAtStart: revision,
    currentRevision: () => revision,
    readCurrent: () => current,
    loadRemote: async () => ({ Food: 325 }),
    commitRemote: value => {
      current = value;
      revision += 1;
    },
  });
  assert.deepEqual(result, { Food: 325 });
  assert.deepEqual(current, { Food: 325 });
});
