const webpush = require("web-push");
const { optional, required } = require("./env");
const { serviceSupabase, safeError } = require("./supabase");

function vapidDetails() {
  return {
    subject: optional("VAPID_SUBJECT") || "https://flowledger-algo.com",
    publicKey: required("VAPID_PUBLIC_KEY"),
    privateKey: required("VAPID_PRIVATE_KEY"),
  };
}

async function sendPushToUser(userId, payload) {
  const db = serviceSupabase();
  const { data: subscriptions, error } = await db
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("user_id", userId);
  if (error) throw error;

  let delivered = 0;
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
      await db
        .from("push_subscriptions")
        .update({ last_success_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", subscription.id);
    } catch (error) {
      const statusCode = Number(error && error.statusCode);
      if (statusCode === 404 || statusCode === 410) {
        await db.from("push_subscriptions").delete().eq("id", subscription.id);
      } else {
        activeSubscriptions += 1;
        errors.push(safeError(error, "Push delivery failed."));
      }
    }
  }
  return { delivered, activeSubscriptions, errors };
}

async function recordDeliveryResult(db, events, result) {
  const eventIds = events.map(event => event.id);
  const now = new Date().toISOString();
  if (result.delivered > 0 || result.activeSubscriptions === 0) {
    const { error } = await db
      .from("push_notification_events")
      .update({
        delivered_at: now,
        last_error: result.delivered > 0 ? null : "No active push subscription.",
      })
      .in("id", eventIds);
    if (error) throw error;
    return;
  }
  const { error } = await db
    .from("push_notification_events")
    .update({ last_error: result.errors[0] || "Push delivery failed." })
    .in("id", eventIds);
  if (error) throw error;
}

async function deliverPendingNotifications(userId) {
  const db = serviceSupabase();
  const { data: events, error } = await db
    .from("push_notification_events")
    .select("id,event_type,bill_id,occurrence_date")
    .eq("user_id", userId)
    .is("delivered_at", null)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw error;
  if (!events?.length) return { delivered: 0, events: 0 };

  let delivered = 0;
  for (const eventType of ["pending", "posted", "overdue_bill"]) {
    const matching = events.filter(event => (event.event_type || "posted") === eventType);
    if (!matching.length) continue;
    const count = eventType === "overdue_bill"
      ? new Set(matching.map(event => event.bill_id).filter(Boolean)).size
      : matching.length;
    const isPending = eventType === "pending";
    const isOverdueBill = eventType === "overdue_bill";
    const result = await sendPushToUser(userId, isOverdueBill ? {
      title: count === 1 ? "Bill past due" : `${count} bills need attention`,
      body: count === 1
        ? "A planned bill is past due and still has money left. Open FlowLedger to review it."
        : "Past-due bills still need action. Open FlowLedger to review them.",
      url: "/bills?attention=overdue",
      tag: "flowledger-overdue",
    } : isPending ? {
      title: count === 1 ? "New pending transaction" : `${count} pending transactions`,
      body: count === 1
        ? "A bank transaction is pending. It is visible in Activity but is not counted yet."
        : "New pending bank activity is visible and will not be counted until it posts.",
      url: "/transactions",
      tag: "flowledger-pending",
    } : {
      title: count === 1 ? "New transaction ready" : `${count} new transactions ready`,
      body: count === 1
        ? "A posted bank transaction is waiting in Review Center."
        : "Posted bank transactions are waiting in Review Center.",
      url: "/more?section=review",
      tag: "flowledger-review",
    });
    delivered += result.delivered;
    await recordDeliveryResult(db, matching, result);
  }

  return { delivered, events: events.length };
}

async function queuePostedTransactionNotifications(userId, transactionIds) {
  const uniqueIds = [...new Set((transactionIds || []).filter(Boolean))];
  if (!uniqueIds.length) return deliverPendingNotifications(userId);

  const db = serviceSupabase();
  const { data: subscription, error: subscriptionError } = await db
    .from("push_subscriptions")
    .select("id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (subscriptionError) throw subscriptionError;
  if (!subscription) return { delivered: 0, events: 0 };

  const { error } = await db.from("push_notification_events").upsert(
    uniqueIds.map(transactionId => ({
      user_id: userId,
      transaction_id: transactionId,
      event_type: "posted",
      event_key: `posted:${transactionId}`,
    })),
    { onConflict: "user_id,event_key", ignoreDuplicates: true },
  );
  if (error) throw error;
  return deliverPendingNotifications(userId);
}

async function queuePendingTransactionNotifications(userId, plaidTransactionIds) {
  const uniqueIds = [...new Set((plaidTransactionIds || []).filter(Boolean))];
  if (!uniqueIds.length) return deliverPendingNotifications(userId);

  const db = serviceSupabase();
  const { data: subscription, error: subscriptionError } = await db
    .from("push_subscriptions")
    .select("id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (subscriptionError) throw subscriptionError;
  if (!subscription) return { delivered: 0, events: 0 };

  const { error } = await db.from("push_notification_events").upsert(
    uniqueIds.map(plaidTransactionId => ({
      user_id: userId,
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
  const { data: subscription, error: subscriptionError } = await db
    .from("push_subscriptions")
    .select("id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (subscriptionError) throw subscriptionError;
  if (!subscription) return { delivered: 0, events: 0 };

  const { error } = await db.from("push_notification_events").upsert(
    alerts.map(alert => ({
      user_id: userId,
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

module.exports = {
  deliverPendingNotifications,
  deliverPendingPostedTransactionNotifications,
  queueOverdueBillNotifications,
  queuePendingTransactionNotifications,
  queuePostedTransactionNotifications,
  sendPushToUser,
};
