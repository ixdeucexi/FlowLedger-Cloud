/** Shared subscription pattern detector. Keep legacy client behavior unchanged. */
const KNOWN_SUBSCRIPTION_WORDS = [
  "netflix", "hulu", "spotify", "disney", "apple", "google", "youtube",
  "prime", "chatgpt", "gym", "fitness", "subscription",
];

function normalizeMerchant(value) {
  return value.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(pos|debit|card|purchase|payment|inc|llc|co)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function daysBetween(a, b) {
  const start = new Date(`${a}T00:00:00`);
  const end = new Date(`${b}T00:00:00`);
  return Math.abs(Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

function inferCadence(dates) {
  if (dates.length < 2) return "unknown";
  const sorted = dates.slice().sort();
  const gaps = [];
  for (let index = 1; index < sorted.length; index++) gaps.push(daysBetween(sorted[index - 1], sorted[index]));
  const avg = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  if (avg >= 5 && avg <= 9) return "weekly";
  if (avg >= 24 && avg <= 38) return "monthly";
  if (avg >= 330 && avg <= 400) return "annual";
  return "unknown";
}

function merchantHasDuplicate(merchant, groups) {
  const words = new Set(merchant.split(" ").filter(word => word.length > 3));
  if (!words.size) return false;
  let similar = 0;
  groups.forEach((_items, other) => {
    if (other === merchant) return;
    if (other.split(" ").some(word => words.has(word))) similar += 1;
  });
  return similar > 0;
}

function detectSubscriptions(transactions) {
  const expenses = transactions.filter(transaction => transaction.amount < 0);
  const groups = new Map();
  expenses.forEach(transaction => {
    const merchant = normalizeMerchant(transaction.description);
    if (!merchant) return;
    if (!groups.has(merchant)) groups.set(merchant, []);
    groups.get(merchant).push(transaction);
  });
  const candidates = [];
  groups.forEach((items, merchant) => {
    const sorted = items.slice().sort((a, b) => a.date.localeCompare(b.date));
    const cadence = inferCadence(sorted.map(item => item.date));
    const amountValues = sorted.map(item => Math.abs(item.amount));
    const averageAmount = roundCurrency(amountValues.reduce((sum, amount) => sum + amount, 0) / amountValues.length);
    const lastAmount = roundCurrency(amountValues[amountValues.length - 1] ?? 0);
    const firstAmount = roundCurrency(amountValues[0] ?? 0);
    const likelyByName = KNOWN_SUBSCRIPTION_WORDS.some(word => merchant.includes(word));
    if (sorted.length < 2 && !likelyByName) return;
    if (cadence === "unknown" && !likelyByName) return;
    const monthlyEquivalent = cadence === "weekly" ? averageAmount * 4.33
      : cadence === "annual" ? averageAmount / 12 : averageAmount;
    candidates.push({
      merchant, cadence, averageAmount, lastAmount,
      monthlyEquivalent: roundCurrency(monthlyEquivalent),
      yearlyEquivalent: roundCurrency(monthlyEquivalent * 12),
      transactionIds: sorted.map(item => item.id),
      priceIncrease: lastAmount > firstAmount + 0.99,
      duplicateRisk: merchantHasDuplicate(merchant, groups),
      confidence: cadence !== "unknown" && sorted.length >= 3 ? "high" : likelyByName ? "medium" : "low",
    });
  });
  return candidates.sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent);
}

module.exports = { detectSubscriptions, normalizeMerchant, KNOWN_SUBSCRIPTION_WORDS };
