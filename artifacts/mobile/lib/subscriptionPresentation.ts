const SUBSCRIPTION_BILL_WORDS = [
  "subscription", "netflix", "hulu", "spotify", "disney", "apple", "google",
  "youtube", "prime", "peacock", "paramount", "max", "hbo", "chatgpt", "gym",
  "fitness", "membership", "streaming",
];

export interface ScheduledSubscriptionBill {
  id: string;
  name: string;
  amount: number;
  category?: string | null;
  frequency?: string | null;
  is_recurring?: boolean;
  is_debt?: boolean;
  start_date?: string | null;
  end_date?: string | null;
  due_day?: number;
}

export interface ScheduledSubscriptionRow<T extends ScheduledSubscriptionBill> {
  bill: T;
  chargeAmount: number | null;
  monthlyEquivalent: number | null;
  cadenceLabel: string;
}

/** An annualized monthly estimate, not this month's dated cash-flow schedule. */
export function subscriptionMonthlyEquivalent(amount: number, frequency?: string | null): number | null {
  const cents = currencyCents(amount);
  if (cents === null) return null;
  let numerator: number;
  let denominator: number;
  switch (frequency ?? "monthly") {
    case "weekly": numerator = 13; denominator = 3; break;
    case "biweekly": numerator = 13; denominator = 6; break;
    case "quarterly": numerator = 1; denominator = 3; break;
    case "yearly": numerator = 1; denominator = 12; break;
    case "monthly": numerator = 1; denominator = 1; break;
    default: return null;
  }
  // Divide before scaling so large valid cents cannot lose a penny in an unsafe intermediate product.
  const wholeCents = Math.floor(cents / denominator) * numerator;
  const monthlyCents = wholeCents + Math.round((cents % denominator) * numerator / denominator);
  return Number.isSafeInteger(wholeCents) && Number.isSafeInteger(monthlyCents) ? monthlyCents / 100 : null;
}

export function subscriptionCadenceLabel(frequency?: string | null): string {
  switch (frequency ?? "monthly") {
    case "weekly": return "Weekly";
    case "biweekly": return "Every 2 weeks";
    case "quarterly": return "Quarterly";
    case "yearly": return "Yearly";
    case "monthly": return "Monthly";
    default: return "Frequency unavailable";
  }
}

export function isSubscriptionStyleBill(bill: ScheduledSubscriptionBill): boolean {
  if (bill.is_recurring === false || bill.is_debt) return false;
  const text = `${bill.name} ${bill.category ?? ""}`.toLowerCase();
  return SUBSCRIPTION_BILL_WORDS.some(word => text.includes(word));
}

/** Saved bills and unresolved bank suggestions are separate measures; never add them together. */
export function buildScheduledSubscriptionSummary<T extends ScheduledSubscriptionBill>(
  bills: readonly T[],
  today: string,
  linkedBillIds: readonly string[] = [],
): { rows: ScheduledSubscriptionRow<T>[]; monthlyEstimate: number | null; unavailableCount: number } {
  if (!isIsoDay(today)) throw new RangeError("Choose a valid subscription review date.");
  const unique = new Map<string, T>();
  const linkedIds = new Set(linkedBillIds);
  for (const bill of bills) {
    if (!bill.id || unique.has(bill.id) || bill.is_recurring === false || bill.is_debt
      || (!linkedIds.has(bill.id) && !isSubscriptionStyleBill(bill))) continue;
    if (bill.start_date && (!isIsoDay(bill.start_date) || bill.start_date > today)) continue;
    if (bill.end_date && (!isIsoDay(bill.end_date) || bill.end_date < today)) continue;
    unique.set(bill.id, bill);
  }
  const rows = [...unique.values()]
    .sort((left, right) => (left.due_day ?? 31) - (right.due_day ?? 31) || left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
    .map(bill => ({
      bill,
      chargeAmount: currencyCents(bill.amount) === null ? null : bill.amount,
      monthlyEquivalent: subscriptionMonthlyEquivalent(bill.amount, bill.frequency),
      cadenceLabel: subscriptionCadenceLabel(bill.frequency),
    }));
  const unavailableCount = rows.filter(row => row.monthlyEquivalent === null).length;
  const totalCents = rows.reduce((total, row) => total + Math.round((row.monthlyEquivalent ?? 0) * 100), 0);
  return {
    rows,
    monthlyEstimate: unavailableCount || !Number.isSafeInteger(totalCents) ? null : totalCents / 100,
    unavailableCount,
  };
}

/** The existing subscription conversion RPC only supports these two cadences. */
export function canCreateSubscriptionBill(cadence: string): boolean {
  return cadence === "weekly" || cadence === "monthly";
}

export function subscriptionAmountLabel(amount: number | null): string {
  return amount === null ? "—" : `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function currencyCents(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) && cents / 100 === value ? cents : null;
}

function isIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
