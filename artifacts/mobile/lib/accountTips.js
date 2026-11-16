// Educational reminders shared by the notification bell and the push outbox.
// Keep this catalog free of private data and claims about a user's finances.
const ACCOUNT_TIPS = Object.freeze([
  Object.freeze({
    key: "planned-money",
    title: "Balance isn't all spending money",
    body: "Your checking balance may include money already planned for bills. Check your forecast before spending.",
    route: "/(tabs)",
  }),
  Object.freeze({
    key: "pending-charges",
    title: "Watch pending charges",
    body: "Pending charges can change before they post. Review Activity and avoid counting the same payment twice.",
    route: "/transactions",
  }),
  Object.freeze({
    key: "review-activity",
    title: "Review posted activity",
    body: "Match posted transactions to bills, income, or categories in Review Center to help keep your plan accurate.",
    route: "/more?section=review",
  }),
  Object.freeze({
    key: "look-ahead",
    title: "Look ahead to payday",
    body: "Review upcoming bills alongside your next income before making a purchase. Timing matters as much as the balance.",
    route: "/bills",
  }),
  Object.freeze({
    key: "savings-purpose",
    title: "Give savings a purpose",
    body: "Use savings buckets to organize money for specific goals. Review each bucket's purpose before using that money elsewhere.",
    route: "/(tabs)",
  }),
  Object.freeze({
    key: "check-balances",
    title: "Check balances regularly",
    body: "Compare your account balances with your bank regularly. Review recent activity and pending charges before adjusting a balance.",
    route: "/transactions",
  }),
]);

const WEEK_MS = 7 * 86_400_000;
const EPOCH_MONDAY = Date.UTC(2026, 0, 5);

function getWeeklyAccountTip(now = new Date()) {
  const date = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  const timestamp = date.toISOString();
  const week = timestamp.slice(0, 10);
  const weekIndex = Math.floor((date.getTime() - EPOCH_MONDAY) / WEEK_MS);
  const tip = ACCOUNT_TIPS[((weekIndex % ACCOUNT_TIPS.length) + ACCOUNT_TIPS.length) % ACCOUNT_TIPS.length];
  return { ...tip, id: `tip:${week}`, week, timestamp };
}

module.exports = { ACCOUNT_TIPS, getWeeklyAccountTip };
