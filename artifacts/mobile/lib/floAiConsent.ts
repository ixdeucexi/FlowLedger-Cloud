export const FLO_AI_CONSENT_VERSION = "2026-08-15";

export function floAiConsentStorageKey(userId: string) {
  return `flowledger_flo_ai_consent:v1:${userId}`;
}

export function parseFloAiConsent(value: string | null, userId: string): boolean {
  if (!value) return false;
  try {
    const parsed = JSON.parse(value) as { version?: string; userId?: string; acceptedAt?: string };
    return parsed.version === FLO_AI_CONSENT_VERSION
      && parsed.userId === userId
      && typeof parsed.acceptedAt === "string"
      && Number.isFinite(new Date(parsed.acceptedAt).getTime());
  } catch {
    return false;
  }
}

export function createFloAiConsent(userId: string, acceptedAt = new Date().toISOString()) {
  return JSON.stringify({ version: FLO_AI_CONSENT_VERSION, userId, acceptedAt });
}
