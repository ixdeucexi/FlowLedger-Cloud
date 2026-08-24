import { Platform } from "react-native";

import { getInstallationId } from "@/lib/deviceInstallation";
import { supabase } from "@/lib/supabase";

export const BILLING_PRODUCTS = {
  ios: { monthly: "flowledger_pro_monthly", annual: "flowledger_pro_annual" },
  android: { monthly: "flowledger_pro:monthly-autorenewing", annual: "flowledger_pro:annual-autorenewing" },
} as const;

export type BillingCadence = "monthly" | "annual";
export type BillingProductId = typeof BILLING_PRODUCTS.ios[BillingCadence] | typeof BILLING_PRODUCTS.android[BillingCadence];
export function billingProductId(cadence: BillingCadence): BillingProductId {
  return BILLING_PRODUCTS[nativePlatform()][cadence];
}
export type BillingLifecycleStatus = "active" | "grace" | "cancelled" | "expired" | "refunded" | "revoked";

export interface BillingEntitlementStatus {
  product_id: string;
  store: "app_store" | "play_store" | "promotional" | "unknown_store";
  environment: "sandbox" | "production";
  status: BillingLifecycleStatus;
  expires_at: string | null;
  grace_ends_at: string | null;
  will_renew: boolean | null;
  updated_at: string;
}

export interface BillingStatusResponse {
  ok: true;
  householdId: string;
  householdName: string;
  plan: { tier: "free" | "pro"; source: "default" | "billing" | "admin" | "grandfathered" };
  entitlement: BillingEntitlementStatus | null;
}

export interface BillingIntentResponse {
  ok: true;
  intentId: string;
  expiresAt: string;
  householdId: string;
  householdName: string;
  appUserId: string;
  productId: string;
}

export interface BillingRestoreIntentResponse {
  ok: true;
  householdId: string;
  householdName: string;
  appUserId: string;
  intents: Array<{ id: string; product_id: string; expires_at: string }>;
}

export interface BillingRestoreReconciliationResponse {
  ok: true;
  verified: boolean;
  result: "restored" | "expired" | "no_active_purchase";
}

interface BillingErrorBody { error?: string; message?: string }

function billingEnvironment(): "sandbox" | "production" {
  return process.env.EXPO_PUBLIC_BILLING_ENVIRONMENT === "production" ? "production" : "sandbox";
}

function nativePlatform(): "ios" | "android" {
  if (Platform.OS !== "ios" && Platform.OS !== "android") throw new Error("Subscriptions are available in the iOS and Android apps.");
  return Platform.OS;
}

function billingError(error: unknown, data: unknown): Error {
  const body = data && typeof data === "object" ? data as BillingErrorBody : null;
  return new Error(body?.message || body?.error || (error instanceof Error ? error.message : "Billing service is unavailable."));
}

async function invokeBilling<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("billing-dispatcher", { body });
  if (error || !data || typeof data !== "object" || "error" in data) throw billingError(error, data);
  return data as T;
}

export async function createBillingIntent(input: {
  householdId: string;
  householdName: string;
  productId: BillingProductId;
}): Promise<BillingIntentResponse> {
  return invokeBilling<BillingIntentResponse>({
    action: "intent",
    householdId: input.householdId,
    confirmedHouseholdName: input.householdName,
    productId: input.productId,
    platform: nativePlatform(),
    environment: billingEnvironment(),
    installationId: await getInstallationId(),
  });
}

export async function markBillingIntentPurchasing(householdId: string, intentId: string): Promise<void> {
  await invokeBilling({ action: "mark_purchasing", householdId, intentId });
}

export async function cancelBillingIntents(householdId: string, intentIds: string[]): Promise<void> {
  if (!intentIds.length) return;
  await invokeBilling({ action: "cancel_intent", householdId, intentIds });
}

export async function createBillingRestoreIntent(input: {
  householdId: string;
  householdName: string;
}): Promise<BillingRestoreIntentResponse> {
  return invokeBilling<BillingRestoreIntentResponse>({
    action: "restore_intent",
    householdId: input.householdId,
    confirmedHouseholdName: input.householdName,
    platform: nativePlatform(),
    environment: billingEnvironment(),
    installationId: await getInstallationId(),
  });
}

export async function reconcileBillingRestore(
  householdId: string,
  intentIds: string[],
): Promise<BillingRestoreReconciliationResponse> {
  return invokeBilling<BillingRestoreReconciliationResponse>({
    action: "restore_reconcile",
    householdId,
    intentIds,
  });
}

export async function readBillingStatus(householdId: string): Promise<BillingStatusResponse> {
  return invokeBilling<BillingStatusResponse>({ action: "status", householdId });
}

export function billingStatusMessage(entitlement: BillingEntitlementStatus | null): string | null {
  if (!entitlement) return null;
  const expiry = entitlement.expires_at ? new Date(entitlement.expires_at).toLocaleDateString() : null;
  if (entitlement.status === "grace") return `Payment needs attention${entitlement.grace_ends_at ? ` before ${new Date(entitlement.grace_ends_at).toLocaleDateString()}` : ""}. Pro remains available during the store grace period.`;
  if (entitlement.status === "cancelled") return expiry ? `Cancelled. Pro remains available through ${expiry}.` : "Cancelled. Check the store for the access end date.";
  if (["expired", "refunded", "revoked"].includes(entitlement.status)) return "This store subscription is no longer active.";
  if (entitlement.status === "active" && entitlement.will_renew === false) return expiry ? `Pro remains available through ${expiry} and will not renew.` : "Pro is active and will not renew.";
  return null;
}

export async function waitForServerBillingStatus(householdId: string, attempts = 6): Promise<BillingStatusResponse> {
  let latest = await readBillingStatus(householdId);
  for (let attempt = 1; attempt < attempts && latest.plan.tier !== "pro"; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    latest = await readBillingStatus(householdId);
  }
  return latest;
}
