export type FloPlanTier = "free" | "pro" | null | undefined;

export function isFloProEnforcementEnabled(value: string | null | undefined): boolean {
  return value?.trim().toLowerCase() !== "false";
}

export function canUseFloAccountChat(
  enforcementEnabled: boolean,
  actualTier: FloPlanTier,
  verifiedPreviewTier: FloPlanTier,
): boolean {
  return !enforcementEnabled || (verifiedPreviewTier ?? actualTier) === "pro";
}
