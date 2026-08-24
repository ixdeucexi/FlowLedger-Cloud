import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { accountDeletionStorageKeyShouldBeRemoved } from "./accountDeletionPolicy";

test("account deletion clears FlowLedger, Supabase auth, and user-scoped device keys", () => {
  assert.equal(accountDeletionStorageKeyShouldBeRemoved("flowledger_theme", "user-a"), true);
  assert.equal(accountDeletionStorageKeyShouldBeRemoved("sb-project-auth-token", "user-a"), true);
  assert.equal(accountDeletionStorageKeyShouldBeRemoved("draft:user-a:2026", "user-a"), true);
  assert.equal(accountDeletionStorageKeyShouldBeRemoved("unrelated-origin-setting", "user-a"), false);
});

test("native exports are temporary and deletion purges any interrupted cache export", () => {
  const deletion = readFileSync("lib/accountDeletion.ts", "utf8");
  const more = readFileSync("app/(tabs)/more.tsx", "utf8");
  assert.match(deletion, /readDirectoryAsync\(FileSystem\.cacheDirectory\)/);
  assert.match(deletion, /\^flowledger-backup-\.\*\\\.csv\$/i);
  assert.match(deletion, /purgeFlowLedgerCacheExports\(\)/);
  assert.match(more, /finally \{[\s\S]*?FileSystem\.deleteAsync\(fileUri, \{ idempotent: true \}\)/);
});

test("deletion reauthentication stays bound to the original account and warns about store billing", () => {
  const source = readFileSync("app/delete-account.tsx", "utf8");
  assert.match(source, /freshSession\.user\.id !== deletionSubjectId/);
  assert.match(source, /data\.session\.user\.id !== deletionSubjectId/);
  assert.match(source, /user\.id !== deletionSubjectId \|\| session\.user\.id !== deletionSubjectId/);
  assert.match(source, /OAUTH_REAUTH_STARTED_KEY\}:\$\{deletionSubjectId\}/);
  assert.match(source, /does not cancel an App Store or Google Play subscription/);
  assert.match(source, /Manage store subscription/);
  assert.match(source, /if \(!deletionSubjectId && user\?\.id\) setDeletionSubjectId\(user\.id\)/);
  assert.match(source, /partial\.code === "AUTH_DELETION_PENDING"/);
  assert.match(source, /purgeLocalPushNotifications\(\)/);
  assert.match(source, /resetBillingIdentityAfterDeletion\(\)/);
  assert.match(source, /Shared household plan data remains/);
  assert.doesNotMatch(source, /params:\s*\{[^}]*receipt/);
});
