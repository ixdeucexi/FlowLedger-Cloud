import assert from "node:assert/strict";
import test from "node:test";

import { accountDeletionStorageKeyShouldBeRemoved } from "./accountDeletionPolicy";

test("account deletion clears FlowLedger, Supabase auth, and user-scoped device keys", () => {
  assert.equal(accountDeletionStorageKeyShouldBeRemoved("flowledger_theme", "user-a"), true);
  assert.equal(accountDeletionStorageKeyShouldBeRemoved("sb-project-auth-token", "user-a"), true);
  assert.equal(accountDeletionStorageKeyShouldBeRemoved("draft:user-a:2026", "user-a"), true);
  assert.equal(accountDeletionStorageKeyShouldBeRemoved("unrelated-origin-setting", "user-a"), false);
});
