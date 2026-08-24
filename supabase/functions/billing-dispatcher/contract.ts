export const REVENUECAT_ENTITLEMENT_ID = "pro";
export const REVENUECAT_PRODUCTS = ["flowledger_pro_monthly", "flowledger_pro_annual"] as const;
export const REVENUECAT_STORE_PRODUCTS = {
  app_store: { flowledger_pro_monthly: "flowledger_pro_monthly", flowledger_pro_annual: "flowledger_pro_annual" },
  play_store: {
    "flowledger_pro:monthly-autorenewing": "flowledger_pro_monthly",
    "flowledger_pro:annual-autorenewing": "flowledger_pro_annual",
  },
} as const;
export const BILLING_EDIT_ROLES = new Set(["owner"]);
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BillingProductId = typeof REVENUECAT_PRODUCTS[number];
export type NormalizedBillingStatus = "active" | "grace" | "cancelled" | "expired" | "refunded" | "revoked";

export interface RevenueCatEvent {
  id?: unknown;
  type?: unknown;
  app_user_id?: unknown;
  original_app_user_id?: unknown;
  aliases?: unknown;
  product_id?: unknown;
  entitlement_id?: unknown;
  entitlement_ids?: unknown;
  store?: unknown;
  environment?: unknown;
  transaction_id?: unknown;
  original_transaction_id?: unknown;
  event_timestamp_ms?: unknown;
  purchased_at_ms?: unknown;
  expiration_at_ms?: unknown;
  grace_period_expiration_at_ms?: unknown;
  cancel_reason?: unknown;
  expiration_reason?: unknown;
  transferred_from?: unknown;
  transferred_to?: unknown;
}

export interface NormalizedRevenueCatEvent {
  providerEventId: string;
  eventType: string;
  appUserId: string;
  productId: BillingProductId;
  store: "app_store" | "play_store" | "promotional" | "unknown_store";
  environment: "sandbox" | "production";
  status: NormalizedBillingStatus;
  transactionId: string | null;
  originalTransactionId: string;
  eventAt: string;
  purchasedAt: string | null;
  expiresAt: string | null;
  graceEndsAt: string | null;
  willRenew: boolean | null;
}
export interface NormalizedRevenueCatTransfer {
  providerEventId: string;
  eventType: "TRANSFER";
  transferredFrom: string[];
  environment: "sandbox" | "production";
  eventAt: string;
}

export interface NormalizedRevenueCatRestore {
  productId: BillingProductId;
  storeProductId: string;
  store: "app_store" | "play_store";
  environment: "sandbox" | "production";
  status: "active" | "grace" | "cancelled";
  transactionId: string;
  eventAt: string;
  purchasedAt: string | null;
  expiresAt: string | null;
  graceEndsAt: string | null;
  willRenew: boolean;
}
export type RevenueCatRestoreResult =
  | { kind: "active"; value: NormalizedRevenueCatRestore }
  | { kind: "no_active"; eventAt: string }
  | { kind: "invalid"; reason: string };

export function isUuid(value: unknown): value is string {
  return UUID_PATTERN.test(String(value ?? ""));
}

export function isBillingProduct(value: unknown): value is BillingProductId {
  return REVENUECAT_PRODUCTS.includes(String(value ?? "") as BillingProductId);
}

export function canonicalBillingProduct(value: unknown, platformOrStore: unknown): BillingProductId | null {
  const platform = String(platformOrStore ?? "").toLowerCase();
  const store = platform === "ios" || platform === "app_store" ? "app_store"
    : platform === "android" || platform === "play_store" ? "play_store" : null;
  if (!store) return null;
  return (REVENUECAT_STORE_PRODUCTS[store] as Record<string, BillingProductId>)[String(value ?? "")] ?? null;
}

function isoFromMs(value: unknown): string | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const date = new Date(numeric);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizedStore(value: unknown): NormalizedRevenueCatEvent["store"] | null {
  const store = String(value ?? "").toUpperCase();
  if (store === "APP_STORE" || store === "MAC_APP_STORE") return "app_store";
  if (store === "PLAY_STORE") return "play_store";
  if (store === "PROMOTIONAL") return "promotional";
  if (store === "UNKNOWN_STORE") return "unknown_store";
  return null;
}

function isoFromDateString(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeRevenueCatSubscriberRestore(
  payload: unknown,
  expectedAppUserId: string,
  expectedPlatform: "ios" | "android",
  allowedProducts: readonly BillingProductId[],
  nowMs = Date.now(),
): RevenueCatRestoreResult {
  const invalid = (reason: string): RevenueCatRestoreResult => ({ kind: "invalid", reason });
  if (!isUuid(expectedAppUserId) || !payload || typeof payload !== "object") return invalid("payload");
  const requestDateMs = Number((payload as { request_date_ms?: unknown }).request_date_ms);
  const snapshotAt = isoFromMs(requestDateMs);
  if (!snapshotAt || requestDateMs > nowMs + 5 * 60 * 1000) return invalid("snapshot_time");
  const subscriber = (payload as { subscriber?: unknown }).subscriber;
  if (!subscriber || typeof subscriber !== "object") return invalid("subscriber");
  const record = subscriber as Record<string, unknown>;
  if (String(record.original_app_user_id ?? "") !== expectedAppUserId) return invalid("identity");

  const entitlements = record.entitlements;
  const subscriptions = record.subscriptions;
  if (!entitlements || typeof entitlements !== "object" || !subscriptions || typeof subscriptions !== "object") return invalid("schema");
  const pro = (entitlements as Record<string, unknown>)[REVENUECAT_ENTITLEMENT_ID];
  if (pro === undefined || pro === null) return { kind: "no_active", eventAt: snapshotAt };
  if (typeof pro !== "object") return invalid("entitlement");
  const storeProductId = String((pro as Record<string, unknown>).product_identifier ?? "").trim();
  const subscription = (subscriptions as Record<string, unknown>)[storeProductId];
  if (!subscription || typeof subscription !== "object") return invalid("subscription");
  const detail = subscription as Record<string, unknown>;
  const store = normalizedStore(detail.store);
  if (store !== (expectedPlatform === "ios" ? "app_store" : "play_store")) return invalid("store");
  const productId = canonicalBillingProduct(storeProductId, store);
  if (!productId || !allowedProducts.includes(productId)) return invalid("product");
  if (String(detail.ownership_type ?? "").toUpperCase() !== "PURCHASED") return invalid("ownership");
  if (detail.is_sandbox !== true && detail.is_sandbox !== false) return invalid("environment");
  const dateFields: Array<[Record<string, unknown>, string]> = [
    [detail, "refunded_at"], [detail, "expires_date"], [detail, "grace_period_expires_date"],
    [detail, "purchase_date"], [detail, "original_purchase_date"],
    [detail, "billing_issues_detected_at"], [detail, "unsubscribe_detected_at"],
    [pro as Record<string, unknown>, "expires_date"], [pro as Record<string, unknown>, "grace_period_expires_date"],
  ];
  if (dateFields.some(([source, key]) => source[key] !== undefined && source[key] !== null
    && source[key] !== "" && !isoFromDateString(source[key]))) return invalid("date");
  if (isoFromDateString(detail.refunded_at)) return { kind: "no_active", eventAt: snapshotAt };

  const expiresAt = isoFromDateString(detail.expires_date)
    ?? isoFromDateString((pro as Record<string, unknown>).expires_date);
  const graceEndsAt = isoFromDateString(detail.grace_period_expires_date)
    ?? isoFromDateString((pro as Record<string, unknown>).grace_period_expires_date);
  const activeUntil = Math.max(
    expiresAt ? new Date(expiresAt).getTime() : 0,
    graceEndsAt ? new Date(graceEndsAt).getTime() : 0,
  );
  if (!activeUntil || activeUntil <= nowMs) return { kind: "no_active", eventAt: snapshotAt };
  const transactionId = String(detail.store_transaction_id ?? "").trim();
  if (!transactionId || transactionId.length > 180) return invalid("transaction");
  const environment = detail.is_sandbox === true ? "sandbox" : detail.is_sandbox === false ? "production" : null;
  if (!environment) return invalid("environment");
  const purchasedAt = isoFromDateString(detail.purchase_date)
    ?? isoFromDateString(detail.original_purchase_date);
  const billingIssue = Boolean(isoFromDateString(detail.billing_issues_detected_at));
  const inGrace = Boolean(graceEndsAt && new Date(graceEndsAt).getTime() > nowMs);
  const cancelled = Boolean(isoFromDateString(detail.unsubscribe_detected_at));
  const status = billingIssue && inGrace ? "grace" : cancelled ? "cancelled" : "active";
  const eventAt = snapshotAt;
  return { kind: "active", value: {
    productId,
    storeProductId,
    store,
    environment,
    status,
    transactionId,
    eventAt,
    purchasedAt,
    expiresAt,
    graceEndsAt,
    willRenew: status !== "cancelled",
  } };
}

function normalizedStatus(event: RevenueCatEvent): { status: NormalizedBillingStatus; willRenew: boolean | null } | null {
  const type = String(event.type ?? "").toUpperCase();
  if (["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE", "SUBSCRIPTION_EXTENDED", "TEMPORARY_ENTITLEMENT_GRANT"].includes(type)) {
    return { status: "active", willRenew: true };
  }
  if (type === "BILLING_ISSUE") return { status: "grace", willRenew: true };
  if (type === "CANCELLATION") {
    const reason = String(event.cancel_reason ?? "").toUpperCase();
    if (reason === "CUSTOMER_SUPPORT") return { status: "refunded", willRenew: false };
    if (reason === "BILLING_ERROR") return { status: "grace", willRenew: true };
    return { status: "cancelled", willRenew: false };
  }
  if (type === "EXPIRATION") return { status: "expired", willRenew: false };
  if (type === "REFUND") return { status: "refunded", willRenew: false };
  if (type === "REFUND_REVERSED") return { status: "active", willRenew: true };
  return null;
}

export function normalizeRevenueCatTransfer(event: RevenueCatEvent): NormalizedRevenueCatTransfer | null {
  if (String(event.type ?? "").toUpperCase() !== "TRANSFER") return null;
  const providerEventId = String(event.id ?? "").trim();
  const eventAt = isoFromMs(event.event_timestamp_ms);
  const environment = String(event.environment ?? "").toUpperCase() === "PRODUCTION"
    ? "production" : String(event.environment ?? "").toUpperCase() === "SANDBOX" ? "sandbox" : null;
  const from = Array.isArray(event.transferred_from) ? [...new Set(event.transferred_from.map(String).filter(isUuid))] : [];
  const to = Array.isArray(event.transferred_to) ? event.transferred_to.map(String).filter(Boolean) : [];
  if (!providerEventId || !eventAt || !from.length || !to.length || !environment) return null;
  return { providerEventId, eventType: "TRANSFER", transferredFrom: from, environment, eventAt };
}

export function normalizeRevenueCatEvent(event: RevenueCatEvent): NormalizedRevenueCatEvent | null {
  const eventType = String(event.type ?? "").toUpperCase();
  const providerEventId = String(event.id ?? "").trim();
  const appUserId = String(event.app_user_id ?? "").trim();
  const originalTransactionId = String(event.original_transaction_id ?? "").trim();
  const store = normalizedStore(event.store);
  const productId = canonicalBillingProduct(event.product_id, store);
  const environment = String(event.environment ?? "").toUpperCase() === "PRODUCTION"
    ? "production"
    : String(event.environment ?? "").toUpperCase() === "SANDBOX" ? "sandbox" : null;
  const lifecycle = normalizedStatus(event);
  const entitlementIds = Array.isArray(event.entitlement_ids) ? event.entitlement_ids.map(String) : [];
  const entitlementMatches = event.entitlement_id === REVENUECAT_ENTITLEMENT_ID || entitlementIds.includes(REVENUECAT_ENTITLEMENT_ID);
  const aliases = Array.isArray(event.aliases) ? event.aliases.map(String) : [];
  const originalAppUserId = String(event.original_app_user_id ?? "").trim();

  if (!providerEventId || !lifecycle || !isUuid(appUserId) || !productId
    || !originalTransactionId || !store || !environment || !entitlementMatches) return null;

  // FlowLedger never creates RevenueCat anonymous identities. A UUID must be
  // both the current and original identity; aliases or transfers are rejected
  // so restore cannot move a receipt to another Supabase account.
  if ((originalAppUserId && originalAppUserId !== appUserId)
    || aliases.some(alias => isUuid(alias) && alias !== appUserId)
    || eventType === "TRANSFER") return null;

  const eventAt = isoFromMs(event.event_timestamp_ms);
  if (!eventAt) return null;
  return {
    providerEventId,
    eventType,
    appUserId,
    productId,
    store,
    environment,
    status: lifecycle.status,
    transactionId: String(event.transaction_id ?? "").trim() || null,
    originalTransactionId,
    eventAt,
    purchasedAt: isoFromMs(event.purchased_at_ms),
    expiresAt: isoFromMs(event.expiration_at_ms),
    graceEndsAt: isoFromMs(event.grace_period_expiration_at_ms),
    willRenew: lifecycle.willRenew,
  };
}

export function parseSignatureHeader(value: string): { timestamp: string; signature: string } | null {
  const parts = Object.fromEntries(value.split(",").map(part => {
    const index = part.indexOf("=");
    return index > 0 ? [part.slice(0, index).trim(), part.slice(index + 1).trim()] : ["", ""];
  }));
  return /^\d{10}$/.test(parts.t ?? "") && /^[0-9a-f]{64}$/i.test(parts.v1 ?? "")
    ? { timestamp: parts.t, signature: parts.v1.toLowerCase() }
    : null;
}

export function routeForBillingAction(action: unknown): "intent" | "restore_intent" | "restore_reconcile" | "mark_purchasing" | "cancel_intent" | "status" | null {
  return action === "intent" || action === "restore_intent" || action === "restore_reconcile"
    || action === "mark_purchasing" || action === "cancel_intent" || action === "status" ? action : null;
}
