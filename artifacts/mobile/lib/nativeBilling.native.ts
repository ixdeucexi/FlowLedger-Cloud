import Purchases, { PURCHASES_ERROR_CODE, type PurchasesStoreProduct } from "react-native-purchases";
import { Linking, Platform } from "react-native";

import type { BillingProductId } from "@/lib/billing";
import { billingIdentityAction, requireSupabaseBillingUserId } from "@/lib/billingIdentityPolicy";

let configured = false;
let enabledUserId: string | null = null;
let desiredUserId: string | null = null;
let identityGeneration = 0;
let identityQueue: Promise<void> = Promise.resolve();

function publicSdkKey(): string {
  const key = Platform.OS === "ios"
    ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY
    : Platform.OS === "android" ? process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY : null;
  const normalized = key?.trim();
  // RevenueCat intentionally terminates release builds configured with a Test
  // Store key. Test Store belongs only in Metro/debug builds; a standalone
  // Preview must stay usable while real App Store/Google Play keys are pending.
  if (!normalized || (!__DEV__ && normalized.startsWith("test_"))) {
    throw new Error("Store subscriptions are not configured in this build.");
  }
  return normalized;
}

function requireEnabledUser(): string {
  if (!enabledUserId) throw new Error("Sign in before managing a subscription.");
  return enabledUserId;
}

export async function activateBillingIdentity(userId: string): Promise<void> {
  const verifiedUserId = requireSupabaseBillingUserId(userId);
  if (Platform.OS !== "ios" && Platform.OS !== "android") return;
  desiredUserId = verifiedUserId;
  const generation = ++identityGeneration;
  const activation = identityQueue.catch(() => undefined).then(async () => {
    if (generation !== identityGeneration || desiredUserId !== verifiedUserId) return;
    const currentId = configured ? await Purchases.getAppUserID() : null;
    if (generation !== identityGeneration || desiredUserId !== verifiedUserId) return;
    const action = billingIdentityAction(configured, currentId, verifiedUserId);
    if (action === "configure") {
      Purchases.configure({ apiKey: publicSdkKey(), appUserID: verifiedUserId });
      configured = true;
      await Purchases.setAllowSharingStoreAccount(false);
    } else if (action === "login") {
      await Purchases.logIn(verifiedUserId);
    }
    const verifiedId = await Purchases.getAppUserID();
    if (generation !== identityGeneration || desiredUserId !== verifiedUserId) return;
    if (verifiedId !== verifiedUserId) throw new Error("The store purchaser identity does not match the signed-in account.");
    enabledUserId = verifiedUserId;
  });
  identityQueue = activation;
  await activation;
}

export function deactivateBillingIdentity(): void {
  // Deliberately do not call Purchases.logOut(): it creates an anonymous ID.
  identityGeneration += 1;
  desiredUserId = null;
  enabledUserId = null;
}

export async function resetBillingIdentityAfterDeletion(): Promise<void> {
  deactivateBillingIdentity();
  if (!configured) return;
  // RevenueCat logOut() creates an anonymous App User ID. Keep the configured
  // SDK dormant instead; the next authenticated account is attached directly
  // with logIn(the Supabase UUID), and server checks reject every anonymous ID.
  Purchases.invalidateCustomerInfoCache();
}

async function requireCurrentIdentity(expectedUserId: string): Promise<string> {
  const expected = requireSupabaseBillingUserId(expectedUserId);
  if (requireEnabledUser() !== expected || desiredUserId !== expected) {
    throw new Error("The store purchaser identity changed. Sign in again before continuing.");
  }
  const liveUserId = await Purchases.getAppUserID();
  if (liveUserId !== expected || enabledUserId !== expected || desiredUserId !== expected) {
    throw new Error("The store purchaser identity does not match the signed-in account.");
  }
  return expected;
}

export async function loadBillingProduct(productId: BillingProductId): Promise<PurchasesStoreProduct> {
  requireEnabledUser();
  const products = await Purchases.getProducts([productId]);
  const product = products.find(candidate => candidate.identifier === productId);
  if (!product) throw new Error("That subscription is not available from this store yet.");
  return product;
}

export async function purchaseBillingProduct(product: PurchasesStoreProduct, attributes: { intentId: string; householdId: string; expectedUserId: string }): Promise<void> {
  await requireCurrentIdentity(attributes.expectedUserId);
  await Purchases.setAttributes({
    flowledger_intent_id: attributes.intentId,
    flowledger_household_id: attributes.householdId,
  });
  await requireCurrentIdentity(attributes.expectedUserId);
  await Purchases.purchaseStoreProduct(product);
}

export async function restoreBillingPurchases(attributes: { intentId: string; householdId: string; expectedUserId: string }): Promise<void> {
  await requireCurrentIdentity(attributes.expectedUserId);
  await Purchases.setAttributes({
    flowledger_intent_id: attributes.intentId,
    flowledger_household_id: attributes.householdId,
  });
  await requireCurrentIdentity(attributes.expectedUserId);
  await Purchases.restorePurchases();
}

export async function openBillingManagement(expectedUserId: string): Promise<void> {
  await requireCurrentIdentity(expectedUserId);
  await Purchases.showManageSubscriptions();
}

export async function openStoreSubscriptionSettings(): Promise<void> {
  const url = Platform.OS === "ios"
    ? "https://apps.apple.com/account/subscriptions"
    : "https://play.google.com/store/account/subscriptions";
  await Linking.openURL(url);
}

export function isBillingCancellation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { userCancelled?: unknown; code?: unknown };
  return candidate.userCancelled === true || candidate.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR;
}
