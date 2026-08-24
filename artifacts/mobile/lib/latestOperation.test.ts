import assert from "node:assert/strict";
import test from "node:test";

import { SerializedLatestOperation } from "./latestOperation";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("a slow household A registration cannot finish after household B", async () => {
  const gate = new SerializedLatestOperation();
  const releaseA = deferred();
  const writes: string[] = [];
  const a = gate.schedule(async isCurrent => {
    await releaseA.promise;
    if (isCurrent()) writes.push("A");
  });
  const b = gate.schedule(async isCurrent => { if (isCurrent()) writes.push("B"); });
  releaseA.resolve();
  await Promise.all([a, b]);
  assert.deepEqual(writes, ["B"]);
});

test("signout invalidates registration and cleanup runs after an in-flight request", async () => {
  const gate = new SerializedLatestOperation();
  const release = deferred();
  const started = deferred();
  const lifecycle: string[] = [];
  const registration = gate.schedule(async isCurrent => {
    lifecycle.push("post-started");
    started.resolve();
    await release.promise;
    if (isCurrent()) lifecycle.push("post-current");
  });
  await started.promise;
  const cleanup = gate.invalidateAndWait(async () => { lifecycle.push("delete"); });
  release.resolve();
  await Promise.all([registration, cleanup]);
  assert.deepEqual(lifecycle, ["post-started", "delete"]);
});
