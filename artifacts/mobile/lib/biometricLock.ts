export const BIOMETRIC_LOCK_TIMEOUT_MS = 2 * 60 * 1000;

export interface StoredBiometricLock {
  version: 1;
  enabled: true;
  userId: string;
  passkeyId: string;
}

export function biometricLockStorageKey(userId: string): string {
  return `flowledger_biometric_lock:v1:${userId}`;
}

export function parseStoredBiometricLock(value: string | null, userId: string): StoredBiometricLock | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredBiometricLock>;
    if (
      parsed.version !== 1
      || parsed.enabled !== true
      || parsed.userId !== userId
      || typeof parsed.passkeyId !== "string"
      || parsed.passkeyId.length === 0
    ) {
      return null;
    }
    return parsed as StoredBiometricLock;
  } catch {
    return null;
  }
}

export function shouldLockAfterBackground(
  backgroundedAt: number | null,
  now: number,
  timeoutMs = BIOMETRIC_LOCK_TIMEOUT_MS,
): boolean {
  if (backgroundedAt === null || !Number.isFinite(backgroundedAt) || !Number.isFinite(now)) return false;
  return now - backgroundedAt >= Math.max(0, timeoutMs);
}

export function friendlyBiometricError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  if (normalized.includes("notallowed") || normalized.includes("cancel") || normalized.includes("timed out")) {
    return "Fingerprint unlock was cancelled. Try again when you're ready.";
  }
  if (normalized.includes("passkey_disabled")) {
    return "Fingerprint unlock is not available right now.";
  }
  if (normalized.includes("credential_exists") || normalized.includes("already registered")) {
    return "This device already has a FlowLedger passkey. Remove it from your account and try again.";
  }
  if (normalized.includes("credential_not_found")) {
    return "This device's FlowLedger passkey is no longer available. Sign in and set it up again.";
  }
  return "FlowLedger couldn't use your device unlock. Please try again.";
}
