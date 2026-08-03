import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BIOMETRIC_LOCK_TIMEOUT_MS,
  biometricLockStorageKey,
  friendlyBiometricError,
  parseStoredBiometricLock,
  shouldLockAfterBackground,
} from "./biometricLock";

describe("biometric app lock", () => {
  it("keeps device settings isolated by user", () => {
    assert.equal(biometricLockStorageKey("user-a"), "flowledger_biometric_lock:v1:user-a");
    assert.notEqual(biometricLockStorageKey("user-a"), biometricLockStorageKey("user-b"));
  });

  it("accepts only the current user's complete saved enrollment", () => {
    const saved = JSON.stringify({ version: 1, enabled: true, userId: "user-a", passkeyId: "passkey-1" });
    assert.deepEqual(parseStoredBiometricLock(saved, "user-a"), {
      version: 1,
      enabled: true,
      userId: "user-a",
      passkeyId: "passkey-1",
    });
    assert.equal(parseStoredBiometricLock(saved, "user-b"), null);
    assert.equal(parseStoredBiometricLock("not-json", "user-a"), null);
  });

  it("locks only after two full minutes away", () => {
    assert.equal(shouldLockAfterBackground(1_000, 1_000 + BIOMETRIC_LOCK_TIMEOUT_MS - 1), false);
    assert.equal(shouldLockAfterBackground(1_000, 1_000 + BIOMETRIC_LOCK_TIMEOUT_MS), true);
  });

  it("keeps biometric errors friendly", () => {
    assert.match(friendlyBiometricError(new Error("NotAllowedError: cancelled")), /cancelled/i);
    assert.doesNotMatch(friendlyBiometricError(new Error("secret internal stack")), /secret|stack/i);
  });
});
