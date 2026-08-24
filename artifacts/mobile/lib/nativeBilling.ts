import type { BillingProductId } from "@/lib/billing";

export interface BillingStoreProduct { identifier: BillingProductId; priceString: string }

export async function activateBillingIdentity(_userId: string): Promise<void> {}
export function deactivateBillingIdentity(): void {}
export async function resetBillingIdentityAfterDeletion(): Promise<void> {}
export async function loadBillingProduct(_productId: BillingProductId): Promise<BillingStoreProduct> { throw new Error("Subscriptions require a native store build."); }
export async function purchaseBillingProduct(_product: BillingStoreProduct, _attributes: { intentId: string; householdId: string; expectedUserId: string }): Promise<void> { throw new Error("Subscriptions require a native store build."); }
export async function restoreBillingPurchases(_attributes: { intentId: string; householdId: string; expectedUserId: string }): Promise<void> { throw new Error("Subscriptions require a native store build."); }
export async function openBillingManagement(_expectedUserId: string): Promise<void> { throw new Error("Subscriptions require a native store build."); }
export async function openStoreSubscriptionSettings(): Promise<void> { throw new Error("Subscriptions require a native store build."); }
export function isBillingCancellation(_error: unknown): boolean { return false; }
