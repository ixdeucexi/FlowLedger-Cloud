export const BIOMETRIC_LOCK_TIMEOUT_MS = 2 * 60 * 1000;

export interface StoredBiometricLock {
  version: 2;
  enabled: boolean;
  userId: string;
  credentialId: string;
}

export function biometricLockStorageKey(userId: string): string {
  return `flowledger_biometric_lock:v2:${userId}`;
}

export function parseStoredBiometricLock(value: string | null, userId: string): StoredBiometricLock | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredBiometricLock>;
    if (
      parsed.version !== 2
      || typeof parsed.enabled !== "boolean"
      || parsed.userId !== userId
      || typeof parsed.credentialId !== "string"
      || parsed.credentialId.length === 0
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

export function credentialIdToBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function credentialIdFromBase64Url(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = globalThis.atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0)).buffer as ArrayBuffer;
}

export function assertionHasUserVerification(response: AuthenticatorAssertionResponse): boolean {
  const authenticatorData = new Uint8Array(response.authenticatorData);
  return authenticatorData.length > 32 && (authenticatorData[32] & 0x04) === 0x04;
}

export function friendlyBiometricError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  if (normalized.includes("notallowed") || normalized.includes("cancel") || normalized.includes("timed out")) {
    return "Device unlock was cancelled. Try again when you're ready.";
  }
  if (normalized.includes("securityerror") || normalized.includes("relying party")) {
    return "This app address cannot use your device lock. Refresh FlowLedger and try again.";
  }
  if (normalized.includes("credential_not_found") || normalized.includes("not found")) {
    return "This device lock is no longer available. Turn the setting off, then set it up again.";
  }
  return "FlowLedger couldn't use your device unlock. Please try again.";
}
