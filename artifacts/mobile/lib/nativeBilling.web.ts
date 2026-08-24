import type { BillingProductId } from "@/lib/billing";

export interface WebBillingProduct { identifier: BillingProductId; priceString: string }

export async function activateBillingIdentity(_userId: string): Promise<void> {}
export function deactivateBillingIdentity(): void {}
export async function resetBillingIdentityAfterDeletion(): Promise<void> {}
export async function loadBillingProduct(_productId: BillingProductId): Promise<WebBillingProduct> { throw new Error("Subscriptions are available in the iOS and Android apps."); }
export async function purchaseBillingProduct(_product: WebBillingProduct, _attributes: { intentId: string; householdId: string; expectedUserId: string }): Promise<void> { throw new Error("Subscriptions are available in the iOS and Android apps."); }
export async function restoreBillingPurchases(_attributes: { intentId: string; householdId: string; expectedUserId: string }): Promise<void> { throw new Error("Subscriptions are available in the iOS and Android apps."); }
export async function openBillingManagement(_expectedUserId: string): Promise<void> { throw new Error("Manage this subscription in the iOS or Android app."); }
export async function openStoreSubscriptionSettings(): Promise<void> { throw new Error("Manage this subscription in the iOS or Android app."); }
export function isBillingCancellation(_error: unknown): boolean { return false; }
