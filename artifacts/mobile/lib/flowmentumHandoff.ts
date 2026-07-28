import { STABILITY_POLICY } from "./stability";

export const FLOWMENTUM_URL = "https://flowmentum-algo.com";
export const FLOWMENTUM_PROTECTED_DAYS = STABILITY_POLICY.freedomGoalDays;

export interface FlowmentumEligibilityInput {
  protectedDays: number;
  stage: string;
  status: "safe" | "watch" | "risk";
  riskDays: number;
  forecastConfidence: "high" | "medium" | "low";
}

export interface FlowmentumVisibilityInput {
  eligible: boolean;
  seen: boolean;
  adminPreview?: boolean;
}

export function isFlowmentumHandoffEligible(input: FlowmentumEligibilityInput): boolean {
  return input.protectedDays >= FLOWMENTUM_PROTECTED_DAYS
    && input.stage === "standing"
    && input.status === "safe"
    && input.riskDays === 0
    && input.forecastConfidence === "high";
}

export function shouldShowFlowmentumHandoff(input: FlowmentumVisibilityInput): boolean {
  if (input.adminPreview) return true;
  return input.eligible && !input.seen;
}

export function flowmentumSeenStorageKey(userId: string, householdId: string): string {
  return `flowledger-flowmentum-seen-v2-${userId}-${householdId}`;
}

export function flowmentumPreviewStorageKey(userId: string, householdId: string): string {
  return `flowledger-flowmentum-preview-v2-${userId}-${householdId}`;
}
