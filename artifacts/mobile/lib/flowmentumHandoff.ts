export const FLOWMENTUM_URL = "https://flowmentum-algo.com";
export const FLOWMENTUM_PROTECTED_DAYS = 90;

export interface FlowmentumEligibilityInput {
  protectedDays: number;
  stage: string;
  status: "safe" | "watch" | "risk";
  riskDays: number;
  forecastConfidence: "high" | "medium" | "low";
}

export function isFlowmentumHandoffEligible(input: FlowmentumEligibilityInput): boolean {
  return input.protectedDays >= FLOWMENTUM_PROTECTED_DAYS
    && input.stage === "standing"
    && input.status === "safe"
    && input.riskDays === 0
    && input.forecastConfidence === "high";
}

export function flowmentumSeenStorageKey(userId: string, householdId: string): string {
  return `flowledger-flowmentum-seen-v1-${userId}-${householdId}`;
}

export function flowmentumPreviewStorageKey(userId: string, householdId: string): string {
  return `flowledger-flowmentum-preview-v1-${userId}-${householdId}`;
}
