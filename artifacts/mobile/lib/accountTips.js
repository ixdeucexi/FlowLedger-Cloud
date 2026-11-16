// Educational reminders shared by the notification bell and the push outbox.
// Keep this catalog free of private data and claims about a user's finances.
const ACCOUNT_TIPS = Object.freeze([
  Object.freeze({
    key: "planned-money",
    title: "Balance isn't all spending money",
    body: "Your checking balance may include money already planned for bills. Check your forecast before spending.",
    explanation: "A balance shows money in the account, while your plan also considers bills and other commitments. Review your forecast before deciding how much room you have for something new.",
    actionLabel: "Open Forecast",
    route: "/monthly",
  }),
  Object.freeze({
    key: "pending-charges",
    title: "Watch pending charges",
    body: "Pending charges can change before they post. Review Activity and avoid counting the same payment twice.",
    explanation: "A pending charge is still being processed, and its final amount can differ. Review its status in Activity before entering a separate payment or matching it to a planned item.",
    actionLabel: "Open Activity",
    route: "/transactions",
  }),
  Object.freeze({
    key: "review-activity",
    title: "Review posted activity",
    body: "Match posted transactions to bills, income, or categories in Review Center to help keep your plan accurate.",
    explanation: "Review Center helps you confirm what a posted transaction belongs to. Matching it to an existing planned item helps keep the same activity from being recorded twice.",
    actionLabel: "Open Review Center",
    route: "/more?section=review",
  }),
  Object.freeze({
    key: "look-ahead",
    title: "Look ahead to payday",
    body: "Review upcoming bills alongside your next income before making a purchase. Timing matters as much as the balance.",
    explanation: "Money arriving later may be needed for a bill due sooner. Start by reviewing upcoming bill dates, then compare them with your next income and forecast before changing your plan.",
    actionLabel: "Open Bills",
    route: "/bills",
  }),
  Object.freeze({
    key: "savings-purpose",
    title: "Give savings a purpose",
    body: "Use savings buckets to organize money for specific goals. Review each bucket's purpose before using that money elsewhere.",
    explanation: "A bucket gives part of your savings a purpose. Open Goals & buckets to review what the money is set aside for before using it elsewhere.",
    actionLabel: "Open Goals & buckets",
    route: "/more?section=goals",
  }),
  Object.freeze({
    key: "check-balances",
    title: "Check balances regularly",
    body: "Compare your account balances with your bank regularly. Review recent activity and pending charges before adjusting a balance.",
    explanation: "Open Accounts to compare your balances with your bank. If a balance differs, review recent and pending activity before deciding whether the account balance needs updating.",
    actionLabel: "Open Accounts",
    route: "/accounts",
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

/** Reconstruct a trusted catalog entry; URLs carry a week, never arbitrary copy or destinations. */
function getAccountTipForWeek(week, now = new Date()) {
  if (typeof week !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(week)) return null;
  const date = new Date(`${week}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== week || date.getUTCDay() !== 1) return null;
  const current = getWeeklyAccountTip(now);
  if (!current || week > current.week) return null;
  return getWeeklyAccountTip(date);
}

function accountTipRoute(week, now = new Date()) {
  const tip = getAccountTipForWeek(week, now);
  return tip ? `/(tabs)?accountTip=${tip.week}` : null;
}

function accountTipWeekFromRoute(value, now = new Date()) {
  if (typeof value !== "string") return null;
  const match = /^\/\(tabs\)\?accountTip=(\d{4}-\d{2}-\d{2})$/.exec(value);
  return match && getAccountTipForWeek(match[1], now) ? match[1] : null;
}

module.exports = { ACCOUNT_TIPS, getWeeklyAccountTip, getAccountTipForWeek, accountTipRoute, accountTipWeekFromRoute };
