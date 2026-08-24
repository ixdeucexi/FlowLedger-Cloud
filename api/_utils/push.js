const webpush = require("web-push");
const { optional, pushEnvironment, required } = require("./env");
const { notificationPreferenceEnabled } = require("./notificationPreferences");
const { serviceSupabase, safeError } = require("./supabase");

function vapidDetails() {
  return {
    subject: optional("VAPID_SUBJECT") || "https://flowledger-algo.com",
    publicKey: required("VAPID_PUBLIC_KEY"),
    privateKey: required("VAPID_PRIVATE_KEY"),
  };
}

const EXPO_PUSH_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";

function assertDbResult(result, fallback) {
  if (result?.error) throw Object.assign(new Error(fallback), { cause: result.error });
  return result;
}

function allowlistedNativeRoute(value) {
  const route = String(value || "");
  if (/^\/bills(?:\?attention=overdue)?$/.test(route)) return route;
  if (route === "/transactions") return route;
  if (/^\/more\?section=(review|feedback)$/.test(route)) return route;
  return "/(tabs)";
}

async function sendExpoNotification(db, device, payload, householdId, eventIds = []) {
  const response = await fetch(EXPO_PUSH_SEND_URL, {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      to: device.expo_push_token,
      title: String(payload.title || "FlowLedger update").slice(0, 80),
      body: String(payload.body || "Open FlowLedger to review your plan.").slice(0, 180),
      data: { route: allowlistedNativeRoute(payload.url), ...(typeof householdId === "string" ? { householdId } : {}) },
      sound: "default",
      priority: "high",
      channelId: "flowledger-alerts",
    }),
  });
  const body = await response.json().catch(() => ({}));
  const ticket = Array.isArray(body?.data) ? body.data[0] : body?.data;
  if (!response.ok || !ticket || ticket.status === "error") {
    const detail = String(ticket?.details?.error || ticket?.message || `Expo HTTP ${response.status}`).slice(0, 500);
    const invalid = ticket?.details?.error === "DeviceNotRegistered";
    assertDbResult(await db.from("native_push_devices").update({
      status: invalid ? "invalid" : "active",
      last_error: detail,
      updated_at: new Date().toISOString(),
    }).eq("id", device.id), "Native push device failure state was not saved.");
    return { delivered: false, active: !invalid, error: detail };
  }
  if (!ticket.id) return { delivered: false, active: true, error: "Expo did not return a receipt ticket." };
  const { error: receiptError } = await db.from("native_push_receipts").upsert({
    ticket_id: ticket.id,
    device_id: device.id,
    event_ids: [...new Set(eventIds.filter(Boolean))],
    status: "pending",
    attempt_count: 0,
    next_check_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "ticket_id", ignoreDuplicates: true });
  if (receiptError) return { delivered: false, active: true, error: "Expo receipt tracking could not be saved." };
  assertDbResult(await db.from("native_push_devices").update({
    status: "active",
    last_error: null,
    last_success_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", device.id), "Native push device success state was not saved.");
  return { delivered: false, accepted: true, active: true, error: null };
}

async function sendPushToUser(userId, payload, preferenceKey, householdId, eventIds = []) {
  const db = serviceSupabase();
  if (preferenceKey && !(await notificationPreferenceEnabled(db, userId, preferenceKey))) {
    return { delivered: 0, accepted: 0, activeSubscriptions: 0, errors: [], skipped: true };
  }
  if (typeof householdId === "string") {
    const { data: membership, error: membershipError } = await db.from("household_members").select("user_id")
      .eq("user_id", userId).eq("household_id", householdId).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) return { delivered: 0, accepted: 0, activeSubscriptions: 0, errors: [], skipped: true };
  }
  let nativeRequest = db.from("native_push_devices").select("id,expo_push_token").eq("user_id", userId)
    .eq("environment", pushEnvironment()).eq("status", "active");
  if (householdId === null) nativeRequest = null;
  else if (typeof householdId === "string") nativeRequest = nativeRequest.eq("household_id", householdId);
  const [{ data: subscriptions, error }, nativeResult] = await Promise.all([
    db.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id", userId),
    nativeRequest || Promise.resolve({ data: [], error: null }),
  ]);
  const { data: nativeDevices, error: nativeError } = nativeResult;
  if (error) throw error;
  if (nativeError) throw nativeError;

  let delivered = 0;
  let accepted = 0;
  let activeSubscriptions = 0;
  const errors = [];
  for (const subscription of subscriptions || []) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
        {
          TTL: 60 * 60 * 12,
          urgency: "high",
          topic: String(payload.tag || "flowledger-activity").slice(0, 32),
          vapidDetails: vapidDetails(),
        },
      );
      delivered += 1;
      activeSubscriptions += 1;
      assertDbResult(await db
        .from("push_subscriptions")
        .update({ last_success_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", subscription.id), "Web push delivery state was not saved.");
    } catch (error) {
      const statusCode = Number(error && error.statusCode);
      if (statusCode === 404 || statusCode === 410) {
        assertDbResult(await db.from("push_subscriptions").delete().eq("id", subscription.id), "Expired web push destination was not removed.");
      } else {
        activeSubscriptions += 1;
        errors.push(safeError(error, "Push delivery failed."));
      }
    }
  }
  for (const device of nativeDevices || []) {
    try {
      const result = await sendExpoNotification(db, device, payload, householdId, eventIds);
      if (result.delivered) delivered += 1;
      if (result.accepted) accepted += 1;
      if (result.active) activeSubscriptions += 1;
      if (result.error) errors.push(result.error);
    } catch (error) {
      activeSubscriptions += 1;
      errors.push(safeError(error, "Native push delivery failed."));
    }
  }
  return { delivered, accepted, activeSubscriptions, errors };
}

async function hasPushDestination(db, userId, householdId) {
  if (typeof householdId === "string") {
    const { data: membership, error: membershipError } = await db.from("household_members").select("user_id")
      .eq("user_id", userId).eq("household_id", householdId).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) return false;
  }
  let nativeRequest = db.from("native_push_devices").select("id").eq("user_id", userId)
    .eq("environment", pushEnvironment()).eq("status", "active");
  if (typeof householdId === "string") nativeRequest = nativeRequest.eq("household_id", householdId);
  else if (householdId === null) nativeRequest = null;
  const [{ data: web, error: webError }, { data: native, error: nativeError }] = await Promise.all([
    db.from("push_subscriptions").select("id").eq("user_id", userId).limit(1).maybeSingle(),
    nativeRequest ? nativeRequest.limit(1).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (webError) throw webError;
  if (nativeError) throw nativeError;
  return Boolean(web || native);
}

async function recordDeliveryResult(db, events, result) {
  const eventIds = events.map(event => event.id);
  const now = new Date().toISOString();
  if (result.skipped || result.delivered > 0 || result.activeSubscriptions === 0) {
    const { error } = await db
      .from("push_notification_events")
      .update({
        delivered_at: now,
        last_error: result.skipped || result.delivered > 0 ? null : "No active push subscription.",
        delivery_claim_id: null,
        delivery_claimed_at: null,
      })
      .in("id", eventIds);
    if (error) throw error;
    return;
  }
  if (result.accepted > 0) {
    const { error } = await db.from("push_notification_events")
      .update({ last_error: "Waiting for device delivery confirmation.", delivery_claim_id: null, delivery_claimed_at: null }).in("id", eventIds);
    if (error) throw error;
    return;
  }
  const { error } = await db
    .from("push_notification_events")
    .update({ last_error: result.errors[0] || "Push delivery failed.", delivery_claim_id: null, delivery_claimed_at: null })
    .in("id", eventIds);
  if (error) throw error;
}

async function deliverPendingNotifications(userId) {
  const db = serviceSupabase();
  const { data: events, error } = await db.rpc("claim_push_notification_events", { p_user_id: userId, p_limit: 50 });
  if (error) throw error;
  if (!events?.length) return { delivered: 0, events: 0 };

  let delivered = 0;
  const groups = new Map();
  for (const event of events) {
    const eventType = event.event_type || "posted";
    const key = `${eventType}:${event.household_id || "legacy"}`;
    if (!groups.has(key)) groups.set(key, { eventType, householdId: event.household_id || null, events: [] });
    groups.get(key).events.push(event);
  }
  for (const group of groups.values()) {
    const { eventType, householdId, events: matching } = group;
    if (!matching.length) continue;
    const count = eventType === "overdue_bill"
      ? new Set(matching.map(event => event.bill_id).filter(Boolean)).size
      : matching.length;
    const isPending = eventType === "pending";
    const isOverdueBill = eventType === "overdue_bill";
    const payload = isOverdueBill ? {
      title: count === 1 ? "Bill past due" : `${count} bills need attention`,
      body: count === 1
        ? "A planned bill is past due and still has money left. Open FlowLedger to review it."
        : "Past-due bills still need action. Open FlowLedger to review them.",
      url: "/bills?attention=overdue",
      tag: "flowledger-overdue",
      badgeCount: count,
    } : isPending ? {
      title: count === 1 ? "New pending transaction" : `${count} pending transactions`,
      body: count === 1
        ? "A bank transaction is pending. It is visible in Activity but is not counted yet."
        : "New pending bank activity is visible and will not be counted until it posts.",
      url: "/transactions",
      tag: "flowledger-pending",
      badgeCount: count,
    } : {
      title: count === 1 ? "New transaction ready" : `${count} new transactions ready`,
      body: count === 1
        ? "A posted bank transaction is waiting in Review Center."
        : "Posted bank transactions are waiting in Review Center.",
      url: "/more?section=review",
      tag: "flowledger-review",
      badgeCount: count,
    };
    const preferenceKey = isOverdueBill
      ? "overdue_bills"
      : isPending
        ? "pending_transactions"
        : "posted_transactions";
    if (householdId === null) {
      await recordDeliveryResult(db, matching, { delivered: 0, accepted: 0, activeSubscriptions: 0, errors: [], skipped: true });
      continue;
    }
    const result = await sendPushToUser(userId, payload, preferenceKey, householdId, matching.map(event => event.id));
    delivered += result.delivered;
    await recordDeliveryResult(db, matching, result);
  }

  return { delivered, events: events.length };
}

async function queuePostedTransactionNotifications(userId, householdId, transactionIds) {
  if (!householdId) throw new Error("PUSH_HOUSEHOLD_REQUIRED");
  const uniqueIds = [...new Set((transactionIds || []).filter(Boolean))];
  if (!uniqueIds.length) return deliverPendingNotifications(userId);

  const db = serviceSupabase();
  if (!await hasPushDestination(db, userId, householdId)) return { delivered: 0, events: 0 };

  const { error } = await db.from("push_notification_events").upsert(
    uniqueIds.map(transactionId => ({
      user_id: userId,
      household_id: householdId,
      transaction_id: transactionId,
      event_type: "posted",
      event_key: `posted:${transactionId}`,
    })),
    { onConflict: "user_id,event_key", ignoreDuplicates: true },
  );
  if (error) throw error;
  return deliverPendingNotifications(userId);
}

async function queuePendingTransactionNotifications(userId, householdId, plaidTransactionIds) {
  if (!householdId) throw new Error("PUSH_HOUSEHOLD_REQUIRED");
  const uniqueIds = [...new Set((plaidTransactionIds || []).filter(Boolean))];
  if (!uniqueIds.length) return deliverPendingNotifications(userId);

  const db = serviceSupabase();
  if (!await hasPushDestination(db, userId, householdId)) return { delivered: 0, events: 0 };

  const { error } = await db.from("push_notification_events").upsert(
    uniqueIds.map(plaidTransactionId => ({
      user_id: userId,
      household_id: householdId,
      transaction_id: null,
      plaid_transaction_id: plaidTransactionId,
      event_type: "pending",
      event_key: `pending:${plaidTransactionId}`,
    })),
    { onConflict: "user_id,event_key", ignoreDuplicates: true },
  );
  if (error) throw error;
  return deliverPendingNotifications(userId);
}

function overdueReminderStage(daysPastDue) {
  const days = Math.max(1, Math.trunc(Number(daysPastDue) || 1));
  if (days <= 2) return "first";
  if (days <= 6) return "three-day";
  return `week-${Math.floor(days / 7)}`;
}

async function queueOverdueBillNotifications(userId, overdueOccurrences) {
  const alerts = (overdueOccurrences || []).filter(alert =>
    alert?.billId && alert?.occurrenceDate && Number(alert?.remainingAmount) > 0.005
  );
  if (!alerts.length) return deliverPendingNotifications(userId);

  const db = serviceSupabase();
  const householdIds = [...new Set(alerts.map(alert => alert.householdId).filter(Boolean))];
  if (!householdIds.length) throw new Error("PUSH_HOUSEHOLD_REQUIRED");
  const destinationChecks = await Promise.all(householdIds.map(householdId => hasPushDestination(db, userId, householdId)));
  if (!destinationChecks.some(Boolean)) return { delivered: 0, events: 0 };

  const { error } = await db.from("push_notification_events").upsert(
    alerts.map(alert => ({
      user_id: userId,
      household_id: alert.householdId,
      transaction_id: null,
      plaid_transaction_id: null,
      bill_id: alert.billId,
      occurrence_date: alert.occurrenceDate,
      event_type: "overdue_bill",
      event_key: `overdue:${alert.billId}:${alert.occurrenceDate}:${overdueReminderStage(alert.daysPastDue)}`,
    })),
    { onConflict: "user_id,event_key", ignoreDuplicates: true },
  );
  if (error) throw error;
  return deliverPendingNotifications(userId);
}

const deliverPendingPostedTransactionNotifications = deliverPendingNotifications;

async function processExpoReceipts(now = new Date()) {
  const db = serviceSupabase();
  const { data: rows, error } = await db.from("native_push_receipts")
    .select("id,ticket_id,device_id,event_ids,attempt_count")
    .eq("status", "pending").lte("next_check_at", now.toISOString()).order("created_at").limit(100);
  if (error) throw error;
  if (!rows?.length) return { checked: 0, succeeded: 0, failed: 0, pending: 0 };
  let body;
  try {
    const response = await fetch(EXPO_PUSH_RECEIPTS_URL, {
      method: "POST", headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ ids: rows.map(row => row.ticket_id) }),
    });
    if (!response.ok) throw new Error(`Expo receipt HTTP ${response.status}`);
    body = await response.json();
  } catch (fetchError) {
    for (const row of rows) {
      const attempts = row.attempt_count + 1;
      assertDbResult(await db.rpc("apply_native_push_receipt", {
        p_receipt_id: row.id, p_status: attempts >= 8 ? "abandoned" : "pending",
        p_attempt_count: attempts,
        p_next_check_at: new Date(now.getTime() + Math.min(60, 2 ** attempts) * 60 * 1000).toISOString(),
        p_error: safeError(fetchError, "Expo receipt lookup failed."), p_device_invalid: false,
      }), "Expo receipt retry state was not saved.");
    }
    return { checked: rows.length, succeeded: 0, failed: 0, pending: rows.length };
  }
  let succeeded = 0;
  let failed = 0;
  let pending = 0;
  for (const row of rows) {
    const receipt = body?.data?.[row.ticket_id];
    if (!receipt) {
      pending += 1;
      const attempts = row.attempt_count + 1;
      assertDbResult(await db.rpc("apply_native_push_receipt", {
        p_receipt_id: row.id, p_status: attempts >= 8 ? "abandoned" : "pending",
        p_attempt_count: attempts,
        p_next_check_at: new Date(now.getTime() + Math.min(60, 2 ** attempts) * 60 * 1000).toISOString(),
        p_error: "Expo receipt is not ready.", p_device_invalid: false,
      }), "Expo receipt not-ready state was not saved.");
      continue;
    }
    const receiptError = receipt.status === "error"
      ? String(receipt.message || receipt.details?.error || "Expo receipt failed.").slice(0, 500) : null;
    const invalid = receipt.details?.error === "DeviceNotRegistered";
    const status = receipt.status === "ok" ? "succeeded" : "failed";
    assertDbResult(await db.rpc("apply_native_push_receipt", {
      p_receipt_id: row.id, p_status: status, p_attempt_count: row.attempt_count + 1,
      p_next_check_at: now.toISOString(), p_error: receiptError, p_device_invalid: invalid,
    }), "Expo receipt result was not applied atomically.");
    if (receipt.status === "ok") succeeded += 1; else failed += 1;
  }
  return { checked: rows.length, succeeded, failed, pending };
}

module.exports = {
  assertDbResult,
  deliverPendingNotifications,
  deliverPendingPostedTransactionNotifications,
  queueOverdueBillNotifications,
  queuePendingTransactionNotifications,
  queuePostedTransactionNotifications,
  sendPushToUser,
  allowlistedNativeRoute,
  hasPushDestination,
  processExpoReceipts,
};
