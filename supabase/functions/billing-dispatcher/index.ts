import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.108.0";

import {
  BILLING_EDIT_ROLES,
  canonicalBillingProduct,
  REVENUECAT_PRODUCTS,
  isUuid,
  normalizeRevenueCatEvent,
  normalizeRevenueCatSubscriberRestore,
  normalizeRevenueCatTransfer,
  parseSignatureHeader,
  routeForBillingAction,
} from "./contract.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-revenuecat-webhook-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...cors, "Content-Type": "application/json" };
const encoder = new TextEncoder();

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function requiredBillingEnvironment(): "sandbox" | "production" {
  const value = requiredEnv("REVENUECAT_ENVIRONMENT");
  if (value !== "sandbox" && value !== "production") throw new Error("invalid_revenuecat_environment");
  return value;
}

async function billingEnvironmentAllowed(db: ReturnType<typeof serviceClient>, environment: string, userIds: string[]) {
  const deployment = requiredBillingEnvironment();
  if (environment === deployment) return true;
  if (deployment !== "production" || environment !== "sandbox" || !userIds.length) return false;
  const uniqueIds = [...new Set(userIds)];
  const { data, error } = await db.from("billing_sandbox_testers").select("user_id").in("user_id", uniqueIds);
  if (error) throw error;
  return new Set((data ?? []).map(row => row.user_id)).size === uniqueIds.length;
}

function fixedTimeEqual(left: string, right: string) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function revenueCatSubscriber(appUserId: string) {
  const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`, {
    headers: {
      Authorization: `Bearer ${requiredEnv("REVENUECAT_SECRET_API_KEY")}`,
      Accept: "application/json",
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`revenuecat_subscriber_${response.status}`);
  const payload = await response.json();
  return payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
}

export async function verifyRevenueCatWebhook(rawBody: string, authorization: string, signatureHeader: string, nowMs = Date.now()) {
  const expectedAuthorization = requiredEnv("REVENUECAT_WEBHOOK_AUTHORIZATION");
  const secret = requiredEnv("REVENUECAT_WEBHOOK_SIGNING_SECRET");
  if (!fixedTimeEqual(authorization, expectedAuthorization)) return false;
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed || Math.abs(nowMs / 1000 - Number(parsed.timestamp)) > 300) return false;
  const computed = await hmacHex(secret, `${parsed.timestamp}.${rawBody}`);
  return fixedTimeEqual(computed, parsed.signature);
}

function bearerToken(request: Request) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization")?.trim() ?? "");
  return match?.[1]?.trim() ?? null;
}

function serviceClient() {
  return createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function authenticatedUser(request: Request, db: ReturnType<typeof serviceClient>) {
  const token = bearerToken(request);
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  return error ? null : data.user ?? null;
}

function cleanName(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
}

type ExistingBillingEntitlement = {
  product_id: string;
  store: string;
  environment: string;
  status: string;
  transaction_id: string | null;
  original_transaction_id: string;
  updated_at: string;
};

async function reconcileExistingBillingStatus(
  db: ReturnType<typeof serviceClient>,
  userId: string,
  householdId: string,
  entitlement: ExistingBillingEntitlement,
) {
  const updatedAt = new Date(entitlement.updated_at).getTime();
  if (Number.isFinite(updatedAt) && Date.now() - updatedAt < 10 * 60 * 1000) return "cached";
  const platform = entitlement.store === "app_store" ? "ios" : entitlement.store === "play_store" ? "android" : null;
  if (!platform || !await billingEnvironmentAllowed(db, entitlement.environment, [userId])) return "invalid";
  const subscriber = await revenueCatSubscriber(userId);
  if (!subscriber) return "unavailable";
  const restored = normalizeRevenueCatSubscriberRestore(subscriber, userId, platform, REVENUECAT_PRODUCTS);
  if (restored.kind === "invalid") return "invalid";
  const eventAt = restored.kind === "no_active" ? restored.eventAt : restored.value.eventAt;
  let input: Record<string, unknown>;
  if (restored.kind === "no_active") {
    input = {
      productId: entitlement.product_id,
      store: entitlement.store,
      environment: entitlement.environment,
      status: "expired",
      transactionId: entitlement.transaction_id,
      purchasedAt: null,
      expiresAt: eventAt,
      graceEndsAt: null,
      willRenew: false,
      fingerprint: `no-active:${eventAt.slice(0, 13)}`,
    };
  } else {
    const active = restored.value;
    if (active.store !== entitlement.store || active.environment !== entitlement.environment) return "invalid";
    input = {
      ...active,
      fingerprint: JSON.stringify({
        status: active.status, transactionId: active.transactionId, productId: active.productId,
        store: active.store, environment: active.environment, expiresAt: active.expiresAt,
        graceEndsAt: active.graceEndsAt, willRenew: active.willRenew, eventAt: active.eventAt,
      }),
    };
  }
  const eventHash = await sha256Hex(`status:${userId}:${householdId}:${entitlement.original_transaction_id}:${input.fingerprint}`);
  const { data, error } = await db.rpc("apply_revenuecat_billing_event", {
    p_provider_event_id: `status-reconcile:${eventHash}`,
    p_event_type: "STATUS_RECONCILIATION",
    p_app_user_id: userId,
    p_product_id: input.productId,
    p_store: input.store,
    p_environment: input.environment,
    p_status: input.status,
    p_transaction_id: input.transactionId,
    p_original_transaction_id: entitlement.original_transaction_id,
    p_event_at: eventAt,
    p_purchased_at: input.purchasedAt,
    p_expires_at: input.expiresAt,
    p_grace_ends_at: input.graceEndsAt,
    p_will_renew: input.willRenew,
    p_raw_event: { source: "revenuecat_api_v1", reconciliation: "bounded_status" },
  });
  if (error || (data as { result?: unknown } | null)?.result === "retryable") throw error ?? new Error("status_reconciliation_retryable");
  return restored.kind;
}

async function handleUserAction(request: Request, rawBody: string) {
  const db = serviceClient();
  const user = await authenticatedUser(request, db);
  if (!user || !isUuid(user.id)) return json({ error: "AUTH_REQUIRED", message: "Please sign in again." }, 401);

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody) as Record<string, unknown>; } catch { return json({ error: "INVALID_JSON" }, 400); }
  const action = routeForBillingAction(payload.action);
  if (!action) return json({ error: "ACTION_INVALID" }, 400);
  const householdId = String(payload.householdId ?? "").trim();
  if (!isUuid(householdId)) return json({ error: "HOUSEHOLD_REQUIRED", message: "Choose a household first." }, 400);

  const [{ data: membership, error: membershipError }, { data: household, error: householdError }] = await Promise.all([
    db.from("household_members").select("role").eq("household_id", householdId).eq("user_id", user.id).maybeSingle(),
    db.from("households").select("id,name").eq("id", householdId).maybeSingle(),
  ]);
  if (membershipError || householdError) return json({ error: "HOUSEHOLD_CHECK_FAILED" }, 500);
  if (!membership || !household) return json({ error: "HOUSEHOLD_FORBIDDEN", message: "That household is not available to this account." }, 403);

  if (action === "status") {
    let [{ data: plan }, { data: entitlement, error: entitlementError }] = await Promise.all([
      db.from("household_plans").select("tier,source,updated_at").eq("household_id", householdId).maybeSingle(),
      db.from("billing_entitlements")
        .select("product_id,store,environment,status,transaction_id,original_transaction_id,expires_at,grace_ends_at,will_renew,updated_at")
        .eq("purchaser_user_id", user.id)
        .eq("household_id", householdId)
        .order("last_event_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (entitlementError) return json({ error: "BILLING_STATUS_FAILED" }, 500);
    let reconciliation = "not_required";
    if (plan?.source === "billing" && entitlement) {
      try {
        reconciliation = await reconcileExistingBillingStatus(db, user.id, householdId, entitlement as ExistingBillingEntitlement);
        if (reconciliation !== "cached") {
          const refreshed = await Promise.all([
            db.from("household_plans").select("tier,source,updated_at").eq("household_id", householdId).maybeSingle(),
            db.from("billing_entitlements")
              .select("product_id,store,environment,status,transaction_id,original_transaction_id,expires_at,grace_ends_at,will_renew,updated_at")
              .eq("purchaser_user_id", user.id).eq("household_id", householdId)
              .order("last_event_at", { ascending: false }).limit(1).maybeSingle(),
          ]);
          if (refreshed[0].error || refreshed[1].error) return json({ error: "BILLING_STATUS_FAILED" }, 500);
          plan = refreshed[0].data;
          entitlement = refreshed[1].data;
        }
      } catch (error) {
        console.error("[billing-dispatcher] bounded status reconciliation failed", { userId: user.id, householdId, error: String(error) });
        reconciliation = "degraded";
      }
    }
    return json({ ok: true, householdId, householdName: household.name, plan: plan ?? { tier: "free", source: "default" }, entitlement, reconciliation });
  }

  if (!BILLING_EDIT_ROLES.has(String(membership.role ?? ""))) {
    return json({ error: "HOUSEHOLD_OWNER_REQUIRED", message: "Only the household owner can manage its subscription." }, 403);
  }

  const { data: preference, error: preferenceError } = await db.from("user_preferences")
    .select("active_household_id").eq("user_id", user.id).maybeSingle();
  if (preferenceError) return json({ error: "ACTIVE_HOUSEHOLD_CHECK_FAILED" }, 500);
  if (preference?.active_household_id !== householdId) {
    return json({ error: "ACTIVE_HOUSEHOLD_MISMATCH", message: "Switch to this household and confirm the purchase again." }, 409);
  }

  if (action === "mark_purchasing") {
    const intentId = String(payload.intentId ?? "").trim();
    if (!isUuid(intentId)) return json({ error: "INTENT_INVALID" }, 400);
    const { data, error } = await db.from("billing_purchase_intents")
      .update({ status: "purchasing", updated_at: new Date().toISOString() })
      .eq("id", intentId).eq("user_id", user.id).eq("household_id", householdId)
      .eq("status", "confirmed").gt("expires_at", new Date().toISOString()).select("id").maybeSingle();
    if (error || !data) return json({ error: "INTENT_EXPIRED", message: "Confirm the household again before purchasing." }, 409);
    return json({ ok: true, intentId });
  }

  if (action === "cancel_intent") {
    const intentIds = Array.isArray(payload.intentIds)
      ? [...new Set(payload.intentIds.map(String).filter(isUuid))]
      : [String(payload.intentId ?? "")].filter(isUuid);
    if (!intentIds.length || intentIds.length > REVENUECAT_PRODUCTS.length) return json({ error: "INTENT_INVALID" }, 400);
    const { error } = await db.from("billing_purchase_intents")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .in("id", intentIds).eq("user_id", user.id).eq("household_id", householdId)
      .in("status", ["confirmed", "purchasing"]);
    if (error) return json({ error: "INTENT_CANCEL_FAILED" }, 500);
    return json({ ok: true });
  }

  if (action === "restore_reconcile") {
    const intentIds = Array.isArray(payload.intentIds)
      ? [...new Set(payload.intentIds.map(String).filter(isUuid))]
      : [];
    if (!intentIds.length || intentIds.length > REVENUECAT_PRODUCTS.length) {
      return json({ error: "RESTORE_INTENTS_INVALID" }, 400);
    }
    const { data: intents, error: intentsError } = await db.from("billing_purchase_intents")
      .select("id,product_id,platform,environment,status,expires_at")
      .in("id", intentIds)
      .eq("user_id", user.id)
      .eq("app_user_id", user.id)
      .eq("household_id", householdId)
      .in("status", ["confirmed", "purchasing"])
      .gt("expires_at", new Date().toISOString());
    if (intentsError) return json({ error: "RESTORE_INTENT_CHECK_FAILED" }, 500);
    if (!intents || intents.length !== intentIds.length) {
      return json({ error: "RESTORE_INTENT_EXPIRED", message: "Confirm this household again before restoring." }, 409);
    }
    const platform = String(intents[0].platform) as "ios" | "android";
    if (!intents.every(intent => intent.platform === platform) || !["ios", "android"].includes(platform)) {
      return json({ error: "RESTORE_INTENT_INVALID" }, 409);
    }
    const { data: protectedPlan, error: protectedPlanError } = await db.from("household_plans")
      .select("tier,source").eq("household_id", householdId).maybeSingle();
    if (protectedPlanError) return json({ error: "PLAN_CHECK_FAILED" }, 500);
    if (protectedPlan?.tier === "pro" && ["admin", "grandfathered"].includes(protectedPlan.source)) {
      return json({ error: "PROTECTED_PRO_PLAN", message: "Protected Pro access is not changed by store restore." }, 409);
    }

    let subscriber: Record<string, unknown> | null;
    try { subscriber = await revenueCatSubscriber(user.id); } catch (error) {
      console.error("[billing-dispatcher] subscriber reconciliation failed", { userId: user.id, error: String(error) });
      return json({ error: "RESTORE_VERIFICATION_UNAVAILABLE", message: "The store purchase could not be verified yet. Try again shortly." }, 502);
    }
    if (!subscriber) return json({ ok: true, verified: false, result: "no_active_purchase" });
    const restored = normalizeRevenueCatSubscriberRestore(
      subscriber,
      user.id,
      platform,
      intents.map(intent => intent.product_id).filter(product => REVENUECAT_PRODUCTS.includes(product)),
    );

    if (restored.kind === "invalid") {
      // Ambiguous identity/schema/store/product data must never be interpreted
      // as an expired subscription and must not mutate an existing Pro plan.
      return json({ error: "RESTORE_RESPONSE_INVALID", message: "The store returned purchase data that could not be safely matched." }, 502);
    }

    if (restored.kind === "no_active") {
      // An exact, authenticated RevenueCat customer response with no current Pro
      // entitlement is also authoritative. Reconcile only this user's existing
      // billing binding for this household; protected plans were rejected above.
      const { data: existing, error: existingError } = await db.from("billing_entitlements")
        .select("product_id,store,environment,transaction_id,original_transaction_id,status")
        .eq("purchaser_user_id", user.id)
        .eq("app_user_id", user.id)
        .eq("household_id", householdId)
        .in("status", ["active", "grace", "cancelled"])
        .order("last_event_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingError) return json({ error: "RESTORE_STATE_CHECK_FAILED" }, 500);
      if (!existing) return json({ ok: true, verified: false, result: "no_active_purchase" });
      if (!await billingEnvironmentAllowed(db, existing.environment, [user.id])) {
        return json({ error: "BILLING_ENVIRONMENT_MISMATCH" }, 403);
      }
      const eventAt = restored.eventAt;
      const eventHash = await sha256Hex(`restore-expired:${user.id}:${existing.original_transaction_id}:${eventAt.slice(0, 13)}`);
      const { data, error } = await db.rpc("apply_revenuecat_billing_event", {
        p_provider_event_id: `restore-expired:${eventHash}`,
        p_event_type: "RESTORE_RECONCILIATION",
        p_app_user_id: user.id,
        p_product_id: existing.product_id,
        p_store: existing.store,
        p_environment: existing.environment,
        p_status: "expired",
        p_transaction_id: existing.transaction_id,
        p_original_transaction_id: existing.original_transaction_id,
        p_event_at: eventAt,
        p_purchased_at: null,
        p_expires_at: eventAt,
        p_grace_ends_at: null,
        p_will_renew: false,
        p_raw_event: { source: "revenuecat_api_v1", reconciliation: "no_active_pro_entitlement" },
      });
      if (error) return json({ error: "RESTORE_APPLY_FAILED" }, 500);
      return json({ ok: true, verified: false, result: "expired", reconciliation: data });
    }

    const active = restored.value;
    if (!await billingEnvironmentAllowed(db, active.environment, [user.id])) {
      return json({ error: "BILLING_ENVIRONMENT_MISMATCH" }, 403);
    }
    const matchingIntent = intents.find(intent => intent.product_id === active.productId
      && intent.platform === platform
      && (intent.environment === active.environment
        || (active.environment === "sandbox" && intent.environment === "production")));
    if (!matchingIntent) return json({ error: "RESTORE_PURCHASE_MISMATCH" }, 403);
    const { data: purchasingIntent, error: purchasingError } = await db.from("billing_purchase_intents")
      .update({ status: "purchasing", updated_at: new Date().toISOString() })
      .eq("id", matchingIntent.id).eq("user_id", user.id).eq("household_id", householdId)
      .in("status", ["confirmed", "purchasing"]).select("id").maybeSingle();
    if (purchasingError || !purchasingIntent) {
      return json({ error: "PURCHASE_ALREADY_IN_PROGRESS", message: "Finish the store request already in progress before restoring to another household." }, 409);
    }

    // v1 store_transaction_id changes on renewal and is not a safe ownership
    // key. Reuse only a stable original-transaction binding previously created
    // by a signed RevenueCat webhook. Never bind a new household from v1 data.
    const { data: bindings, error: bindingError } = await db.from("billing_purchase_bindings")
      .select("id,household_id,original_transaction_id")
      .eq("purchaser_user_id", user.id)
      .eq("app_user_id", user.id)
      .eq("store", active.store)
      .eq("environment", active.environment)
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(2);
    if (bindingError) return json({ error: "RESTORE_BINDING_CHECK_FAILED" }, 500);
    if ((bindings?.length ?? 0) > 1) return json({ error: "RESTORE_BINDING_AMBIGUOUS" }, 409);
    if (bindings?.[0] && bindings[0].household_id !== householdId) {
      return json({ error: "RESTORE_BOUND_TO_OTHER_HOUSEHOLD", message: "This purchase is already assigned to a different household." }, 409);
    }

    const stableBindingId = bindings?.[0]?.original_transaction_id
      ?? `restore-owner:${user.id}:${active.store}:${active.environment}:pro`;
    const eventHash = await sha256Hex(`restore-active:${user.id}:${stableBindingId}:${JSON.stringify({
      status: active.status, transactionId: active.transactionId, productId: active.productId,
      store: active.store, environment: active.environment, expiresAt: active.expiresAt,
      graceEndsAt: active.graceEndsAt, willRenew: active.willRenew, eventAt: active.eventAt,
    })}`);
    const { data, error } = await db.rpc("apply_revenuecat_billing_event", {
      p_provider_event_id: `restore-active:${eventHash}`,
      p_event_type: "RESTORE_RECONCILIATION",
      p_app_user_id: user.id,
      p_product_id: active.productId,
      p_store: active.store,
      p_environment: active.environment,
      p_status: active.status,
      p_transaction_id: active.transactionId,
      p_original_transaction_id: stableBindingId,
      p_event_at: active.eventAt,
      p_purchased_at: active.purchasedAt,
      p_expires_at: active.expiresAt,
      p_grace_ends_at: active.graceEndsAt,
      p_will_renew: active.willRenew,
      p_raw_event: { source: "revenuecat_api_v1", reconciliation: "active_pro_entitlement" },
    });
    if (error) return json({ error: "RESTORE_APPLY_FAILED" }, 500);
    if ((data as { result?: unknown } | null)?.result === "retryable") return json({ error: "RESTORE_RETRY_REQUIRED" }, 500);
    const { error: appliedIntentError } = await db.from("billing_purchase_intents")
      .update({ status: "applied", updated_at: new Date().toISOString() })
      .eq("id", matchingIntent.id).eq("user_id", user.id).eq("household_id", householdId)
      .eq("status", "purchasing");
    if (appliedIntentError) return json({ error: "RESTORE_INTENT_FINALIZE_FAILED" }, 500);
    return json({ ok: true, verified: true, result: "restored", reconciliation: data });
  }

  const storeProductId = String(payload.productId ?? "").trim();
  const platform = String(payload.platform ?? "").trim();
  const productId = canonicalBillingProduct(storeProductId, platform);
  const environment = String(payload.environment ?? "").trim();
  const installationId = String(payload.installationId ?? "").trim();
  const confirmedHouseholdName = cleanName(payload.confirmedHouseholdName);
  if ((action !== "restore_intent" && !productId) || !["ios", "android"].includes(platform)
    || !["sandbox", "production"].includes(environment) || !isUuid(installationId)) {
    return json({ error: "PURCHASE_INTENT_INVALID" }, 400);
  }
  if (!await billingEnvironmentAllowed(db, environment, [user.id])) return json({ error: "BILLING_ENVIRONMENT_MISMATCH" }, 403);
  if (confirmedHouseholdName !== cleanName(household.name)) {
    return json({ error: "HOUSEHOLD_CONFIRMATION_MISMATCH", message: "Confirm the currently active household again." }, 409);
  }

  const { data: protectedPlan, error: planError } = await db.from("household_plans")
    .select("tier,source").eq("household_id", householdId).maybeSingle();
  if (planError) return json({ error: "PLAN_CHECK_FAILED" }, 500);
  if (protectedPlan?.tier === "pro" && ["admin", "grandfathered"].includes(protectedPlan.source)) {
    return json({ error: "PROTECTED_PRO_PLAN", message: "This household already has protected Pro access and does not need a subscription." }, 409);
  }

  const expectedStore = platform === "ios" ? "app_store" : "play_store";
  const { data: existingBindings, error: existingBindingError } = await db.from("billing_purchase_bindings")
    .select("household_id,environment")
    .eq("purchaser_user_id", user.id).eq("app_user_id", user.id)
    .eq("store", expectedStore).eq("active", true).limit(2);
  if (existingBindingError) return json({ error: "PURCHASE_BINDING_CHECK_FAILED" }, 500);
  const relevantBindings: Array<{ household_id: string; environment: string }> = [];
  for (const binding of existingBindings ?? []) {
    if (binding.environment === environment || (binding.environment === "sandbox"
      && await billingEnvironmentAllowed(db, "sandbox", [user.id]))) relevantBindings.push(binding);
  }
  if (relevantBindings.length > 1) return json({ error: "PURCHASE_BINDING_AMBIGUOUS" }, 409);
  if (relevantBindings[0] && relevantBindings[0].household_id !== householdId) {
    return json({ error: "PURCHASE_BOUND_TO_OTHER_HOUSEHOLD", message: "This store subscription is already assigned to another household. Switch to that household to manage it." }, 409);
  }

  const { error: staleIntentError } = await db.from("billing_purchase_intents")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("user_id", user.id).eq("platform", platform).eq("environment", environment)
    .eq("status", "purchasing").lte("expires_at", new Date().toISOString());
  if (staleIntentError) return json({ error: "PURCHASE_INTENT_CHECK_FAILED" }, 500);
  const { data: purchaseInProgress, error: inProgressError } = await db.from("billing_purchase_intents")
    .select("id").eq("user_id", user.id).eq("platform", platform).eq("environment", environment)
    .eq("status", "purchasing").gt("expires_at", new Date().toISOString()).limit(1).maybeSingle();
  if (inProgressError) return json({ error: "PURCHASE_INTENT_CHECK_FAILED" }, 500);
  if (purchaseInProgress) return json({ error: "PURCHASE_ALREADY_IN_PROGRESS", message: "Finish the store request already in progress first." }, 409);

  const { error: expireIntentError } = await db.from("billing_purchase_intents")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("user_id", user.id).eq("platform", platform).eq("environment", environment).eq("status", "confirmed");
  if (expireIntentError) return json({ error: "PURCHASE_INTENT_CHECK_FAILED" }, 500);
  if (action === "restore_intent") {
    const { data: intents, error: restoreError } = await db.from("billing_purchase_intents").insert(
      REVENUECAT_PRODUCTS.map(restoreProductId => ({
        user_id: user.id,
        app_user_id: user.id,
        household_id: householdId,
        product_id: restoreProductId,
        platform,
        environment,
        installation_id: installationId,
        confirmed_household_name: confirmedHouseholdName,
      })),
    ).select("id,product_id,expires_at");
    if (restoreError || !intents?.length) return json({ error: "RESTORE_INTENT_FAILED" }, 500);
    return json({ ok: true, intents, householdId, householdName: household.name, appUserId: user.id });
  }
  const { data: intent, error } = await db.from("billing_purchase_intents").insert({
    user_id: user.id,
    app_user_id: user.id,
    household_id: householdId,
    product_id: productId,
    platform,
    environment,
    installation_id: installationId,
    confirmed_household_name: confirmedHouseholdName,
  }).select("id,expires_at").single();
  if (error || !intent) return json({ error: "PURCHASE_INTENT_FAILED" }, 500);
  return json({ ok: true, intentId: intent.id, expiresAt: intent.expires_at, householdId, householdName: household.name, appUserId: user.id, productId });
}

async function handleWebhook(request: Request, rawBody: string) {
  const authorized = await verifyRevenueCatWebhook(
    rawBody,
    request.headers.get("authorization") ?? "",
    request.headers.get("x-revenuecat-webhook-signature") ?? "",
  ).catch(() => false);
  if (!authorized) return json({ error: "WEBHOOK_UNAUTHORIZED" }, 401);

  let payload: { api_version?: unknown; event?: Record<string, unknown> };
  try { payload = JSON.parse(rawBody); } catch { return json({ error: "INVALID_JSON" }, 400); }
  const db = serviceClient();
  const event = payload.event ?? {};
  const deploymentEnvironment = requiredBillingEnvironment();
  const transfer = normalizeRevenueCatTransfer(event);
  if (transfer) {
    if (!await billingEnvironmentAllowed(db, transfer.environment, transfer.transferredFrom)) {
      return json({ error: "BILLING_ENVIRONMENT_MISMATCH" }, 403);
    }
    const { data, error } = await db.rpc("apply_revenuecat_billing_transfer", {
      p_provider_event_id: transfer.providerEventId,
      p_transferred_from: transfer.transferredFrom,
      p_environment: transfer.environment,
      p_event_at: transfer.eventAt,
      p_raw_event: event,
    });
    if (error) return json({ error: "WEBHOOK_APPLY_FAILED" }, 500);
    return json({ received: true, ...(data as Record<string, unknown>) });
  }
  const normalized = normalizeRevenueCatEvent(event);
  if (!normalized) {
    // Do not retain unsupported raw identities. Valid events are idempotently
    // ledgered only after environment and identity validation.
    return json({ received: true, result: "rejected" });
  }
  const { data: existingUser, error: userLookupError } = await db.auth.admin.getUserById(normalized.appUserId);
  if (userLookupError || !existingUser.user) return json({ received: true, result: "deleted_user_ignored" });
  if (!await billingEnvironmentAllowed(db, normalized.environment, [normalized.appUserId])) return json({ error: "BILLING_ENVIRONMENT_MISMATCH" }, 403);

  const { data, error } = await db.rpc("apply_revenuecat_billing_event", {
    p_provider_event_id: normalized.providerEventId,
    p_event_type: normalized.eventType,
    p_app_user_id: normalized.appUserId,
    p_product_id: normalized.productId,
    p_store: normalized.store,
    p_environment: normalized.environment,
    p_status: normalized.status,
    p_transaction_id: normalized.transactionId,
    p_original_transaction_id: normalized.originalTransactionId,
    p_event_at: normalized.eventAt,
    p_purchased_at: normalized.purchasedAt,
    p_expires_at: normalized.expiresAt,
    p_grace_ends_at: normalized.graceEndsAt,
    p_will_renew: normalized.willRenew,
    p_raw_event: event,
  });
  if (error) {
    console.error("[billing-dispatcher] webhook apply failed", { code: error.code, eventId: normalized.providerEventId });
    return json({ error: "WEBHOOK_APPLY_FAILED" }, 500);
  }
  if ((data as { result?: unknown } | null)?.result === "retryable") return json({ error: "WEBHOOK_RETRY_REQUIRED" }, 500);
  return json({ received: true, ...(data as Record<string, unknown>) });
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const rawBody = await request.text();
  if (encoder.encode(rawBody).byteLength > 128 * 1024) return json({ error: "PAYLOAD_TOO_LARGE" }, 413);
  if (request.headers.has("x-revenuecat-webhook-signature")) return handleWebhook(request, rawBody);
  return handleUserAction(request, rawBody);
});
