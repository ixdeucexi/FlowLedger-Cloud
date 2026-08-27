import assert from "node:assert/strict";
import test from "node:test";

import { coalesceAuthCompletion } from "./authCompletion";

test("duplicate native callback deliveries share one session operation", async () => {
  let completions = 0;
  let resolveSession!: (value: { userId: string }) => void;
  const operation = () => {
    completions += 1;
    return new Promise<{ userId: string }>(resolve => {
      resolveSession = resolve;
    });
  };

  const first = coalesceAuthCompletion("callback:duplicate-success", operation);
  const second = coalesceAuthCompletion("callback:duplicate-success", operation);
  assert.equal(completions, 1);

  resolveSession({ userId: "user-1" });
  assert.deepEqual(await first, { userId: "user-1" });
  assert.deepEqual(await second, { userId: "user-1" });
  assert.equal(completions, 1);
});

test("a failed callback operation can be retried", async () => {
  let attempts = 0;
  await assert.rejects(
    coalesceAuthCompletion("callback:retry-after-failure", async () => {
      attempts += 1;
      throw new Error("temporary failure");
    }),
    /temporary failure/,
  );

  const session = await coalesceAuthCompletion(
    "callback:retry-after-failure",
    async () => {
      attempts += 1;
      return { userId: "user-2" };
    },
  );
  assert.deepEqual(session, { userId: "user-2" });
  assert.equal(attempts, 2);
});

test("successful callback replay entries stay bounded", async () => {
  for (let index = 0; index < 12; index += 1) {
    assert.equal(
      await coalesceAuthCompletion(`callback:bounded-${index}`, async () => index),
      index,
    );
  }

  let replayed = 0;
  assert.equal(
    await coalesceAuthCompletion("callback:bounded-0", async () => {
      replayed += 1;
      return 99;
    }),
    99,
  );
  assert.equal(replayed, 1);
});
