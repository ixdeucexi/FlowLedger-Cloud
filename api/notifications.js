const routes = Object.freeze({
  config: require("./_utils/notificationRoutes/config"),
  "overdue-bills": require("./_utils/notificationRoutes/overdue-bills"),
  preferences: require("./_utils/notificationRoutes/preferences"),
  subscription: require("./_utils/notificationRoutes/subscription"),
  test: require("./_utils/notificationRoutes/test"),
});

function notificationRouteAction(req) {
  const queryAction = Array.isArray(req.query?.notificationAction)
    ? req.query.notificationAction[0]
    : req.query?.notificationAction;
  if (typeof queryAction === "string" && queryAction) return queryAction;
  try {
    const pathname = new URL(req.url || "/", "https://flowledger-algo.com").pathname;
    return pathname.split("/").filter(Boolean).at(-1) || "";
  } catch {
    return "";
  }
}

async function notifications(req, res) {
  const handler = routes[notificationRouteAction(req)];
  if (!handler) return res.status(404).json({ error: "NOTIFICATION_ROUTE_NOT_FOUND" });
  return handler(req, res);
}

module.exports = notifications;
module.exports.notificationRouteAction = notificationRouteAction;
