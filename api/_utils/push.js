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

async function deliverPendingPostedTransactionNotifications(userId) {
  const db = serviceSupabase();
  const { data: events, error } = await db
    .from("push_notification_events")
    .select("id,event_type")
    .eq("user_id", userId)
    .is("delivered_at", null)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw error;
  if (!events?.length) return { delivered: 0, events: 0 };

  let delivered = 0;
  for (const eventType of ["pending", "posted"]) {
    const matching = events.filter(event => (event.event_type || "posted") === eventType);
    if (!matching.length) continue;
    const count = matching.length;
    const isPending = eventType === "pending";
    const result = await sendPushToUser(userId, isPending ? {
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
  if (!uniqueIds.length) return deliverPendingPostedTransactionNotifications(userId);

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
  return deliverPendingPostedTransactionNotifications(userId);
}

async function queuePendingTransactionNotifications(userId, plaidTransactionIds) {
  const uniqueIds = [...new Set((plaidTransactionIds || []).filter(Boolean))];
  if (!uniqueIds.length) return deliverPendingPostedTransactionNotifications(userId);

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
  return deliverPendingPostedTransactionNotifications(userId);
}

module.exports = {
  deliverPendingPostedTransactionNotifications,
  queuePendingTransactionNotifications,
  queuePostedTransactionNotifications,
  sendPushToUser,
};
