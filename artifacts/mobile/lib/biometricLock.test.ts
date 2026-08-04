import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BIOMETRIC_LOCK_TIMEOUT_MS,
  BIOMETRIC_UNLOCK_REUSE_MS,
  assertionHasUserVerification,
  biometricRpIdForHostname,
  biometricLockStorageKey,
  credentialIdFromBase64Url,
  credentialIdToBase64Url,
  friendlyBiometricError,
  parseRecentBiometricUnlock,
  parseStoredBiometricLock,
  recentBiometricUnlockStorageKey,
  shouldLockAfterBackground,
} from "./biometricLock";

describe("biometric app lock", () => {
  it("keeps device settings isolated by user", () => {
    assert.equal(biometricLockStorageKey("user-a"), "flowledger_biometric_lock:v2:user-a");
    assert.notEqual(biometricLockStorageKey("user-a"), biometricLockStorageKey("user-b"));
  });

  it("binds production biometrics to the canonical FlowLedger domain", () => {
    assert.equal(biometricRpIdForHostname("flowledger-algo.com"), "flowledger-algo.com");
    assert.equal(biometricRpIdForHostname("www.flowledger-algo.com"), "flowledger-algo.com");
    assert.equal(biometricRpIdForHostname("LOGIN.FLOWLEDGER-ALGO.COM."), "flowledger-algo.com");
    assert.equal(biometricRpIdForHostname("flow-ledger-cloud.vercel.app"), undefined);
    assert.equal(biometricRpIdForHostname("localhost"), undefined);
    assert.equal(biometricRpIdForHostname("notflowledger-algo.com"), undefined);
  });

  it("reuses only a fresh unlock for the same user and credential", () => {
    const completedAt = 10_000;
    const saved = JSON.stringify({
      version: 1,
      userId: "user-a",
      credentialId: "credential-1",
      completedAt,
    });
    assert.equal(recentBiometricUnlockStorageKey("user-a"), "flowledger_biometric_unlock:v1:user-a");
    assert.ok(parseRecentBiometricUnlock(saved, "user-a", "credential-1", completedAt + 1));
    assert.equal(parseRecentBiometricUnlock(saved, "user-b", "credential-1", completedAt + 1), null);
    assert.equal(parseRecentBiometricUnlock(saved, "user-a", "credential-2", completedAt + 1), null);
    assert.equal(
      parseRecentBiometricUnlock(saved, "user-a", "credential-1", completedAt + BIOMETRIC_UNLOCK_REUSE_MS),
      null,
    );
  });

  it("accepts only the current user's complete saved enrollment", () => {
    const saved = JSON.stringify({ version: 2, enabled: true, userId: "user-a", credentialId: "credential-1" });
    assert.deepEqual(parseStoredBiometricLock(saved, "user-a"), {
      version: 2,
      enabled: true,
      userId: "user-a",
      credentialId: "credential-1",
    });
    assert.equal(parseStoredBiometricLock(saved, "user-b"), null);
    assert.equal(parseStoredBiometricLock("not-json", "user-a"), null);
  });

  it("round-trips WebAuthn credential IDs", () => {
    const original = Uint8Array.from([0, 1, 2, 253, 254, 255]);
    const encoded = credentialIdToBase64Url(original.buffer);
    assert.equal(encoded, "AAEC_f7_");
    assert.deepEqual(Array.from(new Uint8Array(credentialIdFromBase64Url(encoded))), Array.from(original));
  });

  it("requires the authenticator's user-verification flag", () => {
    const verified = new Uint8Array(37);
    verified[32] = 0x05;
    const unverified = new Uint8Array(37);
    unverified[32] = 0x01;
    assert.equal(assertionHasUserVerification({ authenticatorData: verified.buffer } as AuthenticatorAssertionResponse), true);
    assert.equal(assertionHasUserVerification({ authenticatorData: unverified.buffer } as AuthenticatorAssertionResponse), false);
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
