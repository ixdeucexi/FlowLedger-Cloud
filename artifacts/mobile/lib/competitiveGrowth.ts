export type MoneyDirection = "income" | "expense" | "transfer" | "debt_payment" | "any";

export interface GrowthTransaction {
  id: string;
  date: string;
  amount: number;
  description: string;
  category?: string | null;
  accountId?: string | null;
  importHash?: string | null;
  source?: "manual" | "import" | "bill" | "income" | "debt";
  householdMemberId?: string | null;
  linkedBillId?: string | null;
}

export interface GrowthBill {
  id: string;
  name: string;
  amount: number;
  category: string;
  dueDay: number;
  isDebt?: boolean;
  isRecurring?: boolean;
  stopped?: boolean;
}

export interface GrowthDebt {
  id: string;
  name: string;
  balance: number;
  minimumPayment: number;
  apr?: number | null;
  dueDay?: number | null;
  includeInSnowball?: boolean;
}

export interface GrowthGoal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate?: string | null;
  type?: "savings" | "planned_expense" | "emergency_fund" | "house" | "car" | "other";
}

export interface TransactionRule {
  id: string;
  name: string;
  matchType: "contains" | "exact" | "starts_with" | "amount_range";
  matchValue?: string | null;
  amountMin?: number | null;
  amountMax?: number | null;
  direction?: MoneyDirection;
  category?: string | null;
  markAsTransfer?: boolean;
  linkedBillId?: string | null;
  priority?: number | null;
  isActive?: boolean;
}

export interface RuleApplication {
  transactionId: string;
  ruleId: string | null;
  category: string | null;
  markAsTransfer: boolean;
  linkedBillId: string | null;
  reason: string;
}

export type ReviewReason =
  | "missing_category"
  | "imported"
  | "possible_duplicate"
  | "unusual_amount"
  | "household_edit"
  | "possible_subscription"
  | "bill_match_uncertain"
  | "possible_debt_or_goal";

export interface ReviewItem {
  transactionId: string;
  reasons: ReviewReason[];
  priority: "low" | "medium" | "high";
  summary: string;
}

export interface SubscriptionCandidate {
  merchant: string;
  cadence: "weekly" | "monthly" | "annual" | "unknown";
  averageAmount: number;
  lastAmount: number;
  monthlyEquivalent: number;
  yearlyEquivalent: number;
  transactionIds: string[];
  priceIncrease: boolean;
  duplicateRisk: boolean;
  confidence: "low" | "medium" | "high";
}

export interface ForecastReadinessInput {
  accounts: number;
  hasCurrentBalance: boolean;
  incomes: number;
  recurringBills: number;
  debts: number;
  goals: number;
  debtPayoffSelected?: boolean;
  savingsSelected?: boolean;
  safetyFloorReviewed?: boolean;
  firstForecastViewed?: boolean;
  reconciledRecently?: boolean;
}

export interface ForecastReadinessResult {
  score: number;
  completed: string[];
  missing: string[];
  nextStep: string;
  whyItMatters: string;
}

export interface GoalFundingPlan {
  goalId: string;
  monthlyNeeded: number;
  safeMonthlyContribution: number;
  status: "on_track" | "behind" | "unsafe" | "needs_date";
  message: string;
}

export interface ReportsSummary {
  income: number;
  spending: number;
  net: number;
  topCategory: string | null;
  categoryTotals: { category: string; amount: number }[];
  subscriptionTotal: number;
  debtTotal: number;
  goalProgress: { goalId: string; name: string; percent: number }[];
  insight: string;
}

export interface ReminderItem {
  id: string;
  type:
    | "bill_due"
    | "low_balance"
    | "planned_decision"
    | "debt_milestone"
    | "goal_behind"
    | "subscription_increase"
    | "transaction_review"
    | "reconcile_account"
    | "household_change";
  title: string;
  message: string;
  date?: string | null;
  severity: "info" | "watch" | "risk";
}

export interface ChildProfile {
  id: string;
  name: string;
  allowanceAmount?: number | null;
  allowanceFrequency?: "weekly" | "biweekly" | "monthly" | null;
  savingsGoal?: number | null;
  currentSavings?: number | null;
  spendingLimit?: number | null;
}

const KNOWN_SUBSCRIPTION_WORDS = [
  "netflix",
  "hulu",
  "spotify",
  "disney",
  "apple",
  "google",
  "youtube",
  "prime",
  "chatgpt",
  "gym",
  "fitness",
  "subscription",
];

export function normalizeMerchant(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(pos|debit|card|purchase|payment|inc|llc|co)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function applyTransactionRules(
  transaction: GrowthTransaction,
  rules: TransactionRule[],
): RuleApplication {
  const description = normalizeMerchant(transaction.description);
  const direction = transaction.amount >= 0 ? "income" : "expense";
  const candidates = rules
    .filter(rule => rule.isActive !== false)
    .filter(rule => !rule.direction || rule.direction === "any" || rule.direction === direction)
    .filter(rule => ruleMatches(transaction, description, rule))
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  const rule = candidates[0];
  if (!rule) {
    return {
      transactionId: transaction.id,
      ruleId: null,
      category: transaction.category ?? null,
      markAsTransfer: false,
      linkedBillId: null,
      reason: "No matching rule.",
    };
  }

  return {
    transactionId: transaction.id,
    ruleId: rule.id,
    category: rule.category ?? transaction.category ?? null,
    markAsTransfer: Boolean(rule.markAsTransfer),
    linkedBillId: rule.linkedBillId ?? null,
    reason: `Matched ${rule.name}.`,
  };
}

export function buildReviewQueue(
  transactions: GrowthTransaction[],
  rules: TransactionRule[],
): ReviewItem[] {
  const byHash = new Map<string, number>();
  const byMerchant = new Map<string, GrowthTransaction[]>();
  transactions.forEach(transaction => {
    if (transaction.importHash) byHash.set(transaction.importHash, (byHash.get(transaction.importHash) ?? 0) + 1);
    const merchant = normalizeMerchant(transaction.description);
    if (!byMerchant.has(merchant)) byMerchant.set(merchant, []);
    byMerchant.get(merchant)!.push(transaction);
  });

  const subscriptionMerchants = new Set(detectSubscriptions(transactions).map(item => item.merchant));

  return transactions
    .map(transaction => {
      const reasons: ReviewReason[] = [];
      const category = transaction.category?.trim();
      if (!category || category.toLowerCase() === "other") reasons.push("missing_category");
      if (transaction.source === "import") reasons.push("imported");
      if (transaction.importHash && (byHash.get(transaction.importHash) ?? 0) > 1) reasons.push("possible_duplicate");
      if (isUnusualAmount(transaction, byMerchant.get(normalizeMerchant(transaction.description)) ?? [])) reasons.push("unusual_amount");
      if (transaction.householdMemberId) reasons.push("household_edit");
      if (subscriptionMerchants.has(normalizeMerchant(transaction.description))) reasons.push("possible_subscription");
      if (!applyTransactionRules(transaction, rules).ruleId && maybeBillLike(transaction)) reasons.push("bill_match_uncertain");
      if (maybeDebtOrGoal(transaction)) reasons.push("possible_debt_or_goal");

      const unique = Array.from(new Set(reasons));
      const priority = unique.includes("possible_duplicate") || unique.includes("unusual_amount")
        ? "high"
        : unique.length >= 2
        ? "medium"
        : "low";

      return {
        transactionId: transaction.id,
        reasons: unique,
        priority,
        summary: summarizeReviewReasons(unique),
      } satisfies ReviewItem;
    })
    .filter(item => item.reasons.length > 0)
    .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority));
}

export function detectSubscriptions(transactions: GrowthTransaction[]): SubscriptionCandidate[] {
  const expenses = transactions.filter(transaction => transaction.amount < 0);
  const groups = new Map<string, GrowthTransaction[]>();
  expenses.forEach(transaction => {
    const merchant = normalizeMerchant(transaction.description);
    if (!merchant) return;
    if (!groups.has(merchant)) groups.set(merchant, []);
    groups.get(merchant)!.push(transaction);
  });

  const candidates: SubscriptionCandidate[] = [];
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

    const monthlyEquivalent = cadence === "weekly"
      ? averageAmount * 4.33
      : cadence === "annual"
      ? averageAmount / 12
      : averageAmount;

    candidates.push({
      merchant,
      cadence,
      averageAmount,
      lastAmount,
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

export function evaluateForecastReadiness(input: ForecastReadinessInput): ForecastReadinessResult {
  const checks = [
    { ok: input.accounts > 0, label: "Add an account", why: "I need at least one account to anchor your forecast." },
    { ok: input.hasCurrentBalance, label: "Add a current balance", why: "A dated balance keeps the forecast from starting at zero." },
    { ok: input.incomes > 0, label: "Add income", why: "Income tells me when money comes in." },
    { ok: input.recurringBills > 0, label: "Add recurring bills", why: "Bills are the biggest reason forecasts get tight." },
    { ok: !input.debtPayoffSelected || input.debts > 0, label: "Add debts", why: "Debt payoff needs balances and minimums." },
    { ok: !input.savingsSelected || input.goals > 0, label: "Add savings goals", why: "Goals show what money should be protected." },
    { ok: Boolean(input.safetyFloorReviewed), label: "Review your safety floor", why: "The floor is the safe line I protect." },
    { ok: Boolean(input.firstForecastViewed), label: "View your first forecast", why: "This confirms the plan creates the days you expect." },
    { ok: Boolean(input.reconciledRecently), label: "Reconcile an account", why: "Fresh balances make every answer more trustworthy." },
  ];
  const completed = checks.filter(check => check.ok).map(check => check.label);
  const missingChecks = checks.filter(check => !check.ok);
  const score = Math.round((completed.length / checks.length) * 100);
  return {
    score,
    completed,
    missing: missingChecks.map(check => check.label),
    nextStep: missingChecks[0]?.label ?? "Your forecast is ready to use.",
    whyItMatters: missingChecks[0]?.why ?? "I have enough setup to explain your plan with confidence.",
  };
}

export function buildGoalFundingPlans(
  goals: GrowthGoal[],
  safeMonthlyAmount: number,
  today = new Date(),
): GoalFundingPlan[] {
  return goals.map(goal => {
    const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
    const months = goal.targetDate ? monthsUntil(goal.targetDate, today) : 0;
    const monthlyNeeded = months > 0 ? roundCurrency(remaining / months) : remaining;
    const safeMonthlyContribution = roundCurrency(Math.min(monthlyNeeded, Math.max(0, safeMonthlyAmount)));
    const status: GoalFundingPlan["status"] = !goal.targetDate
      ? "needs_date"
      : remaining <= 0
      ? "on_track"
      : safeMonthlyContribution <= 0
      ? "unsafe"
      : safeMonthlyContribution + 0.01 >= monthlyNeeded
      ? "on_track"
      : "behind";
    return {
      goalId: goal.id,
      monthlyNeeded,
      safeMonthlyContribution,
      status,
      message: goalFundingMessage(goal.name, status, monthlyNeeded, safeMonthlyContribution),
    };
  });
}

export function buildReportsSummary(
  transactions: GrowthTransaction[],
  bills: GrowthBill[],
  debts: GrowthDebt[],
  goals: GrowthGoal[],
): ReportsSummary {
  const income = roundCurrency(transactions.filter(tx => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0));
  const spending = roundCurrency(Math.abs(transactions.filter(tx => tx.amount < 0).reduce((sum, tx) => sum + tx.amount, 0)));
  const categoryMap = new Map<string, number>();
  transactions.filter(tx => tx.amount < 0).forEach(tx => {
    const category = tx.category || "Uncategorized";
    categoryMap.set(category, roundCurrency((categoryMap.get(category) ?? 0) + Math.abs(tx.amount)));
  });
  const categoryTotals = Array.from(categoryMap.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
  const subscriptions = detectSubscriptions(transactions);
  const debtTotal = roundCurrency(debts.reduce((sum, debt) => sum + Math.max(0, debt.balance), 0));
  const recurringBills = roundCurrency(bills.filter(bill => bill.isRecurring !== false && !bill.stopped).reduce((sum, bill) => sum + Math.max(0, bill.amount), 0));
  return {
    income,
    spending,
    net: roundCurrency(income - spending - recurringBills),
    topCategory: categoryTotals[0]?.category ?? null,
    categoryTotals,
    subscriptionTotal: roundCurrency(subscriptions.reduce((sum, sub) => sum + sub.monthlyEquivalent, 0)),
    debtTotal,
    goalProgress: goals.map(goal => ({
      goalId: goal.id,
      name: goal.name,
      percent: goal.targetAmount > 0 ? Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100)) : 0,
    })),
    insight: categoryTotals[0]
      ? `${categoryTotals[0].category} is the largest flexible spending area I found.`
      : subscriptions.length
      ? "Subscriptions are worth reviewing because recurring charges quietly reduce cushion."
      : "Your reports will get stronger as more activity is added.",
  };
}

export function buildSmartReminders(input: {
  today: string;
  bills: GrowthBill[];
  reviewCount: number;
  subscriptionIncreases: number;
  lowestBalance?: number | null;
  safetyFloor: number;
  goals?: GoalFundingPlan[];
  needsReconcile?: boolean;
}): ReminderItem[] {
  const todayDay = Number(input.today.split("-")[2] ?? "1");
  const reminders: ReminderItem[] = [];
  input.bills
    .filter(bill => !bill.stopped && bill.dueDay >= todayDay && bill.dueDay <= todayDay + 3)
    .slice(0, 3)
    .forEach(bill => {
      reminders.push({
        id: `bill-${bill.id}`,
        type: "bill_due",
        title: `${bill.name} is due soon`,
        message: `I see ${bill.name} due on day ${bill.dueDay}. Keep it in the plan before spending extra.`,
        severity: "info",
      });
    });
  if ((input.lowestBalance ?? input.safetyFloor) < input.safetyFloor) {
    reminders.push({
      id: "low-balance",
      type: "low_balance",
      title: "Low balance risk",
      message: "I found a date that may drop below your safety floor.",
      severity: "risk",
    });
  }
  if (input.reviewCount > 0) {
    reminders.push({
      id: "review",
      type: "transaction_review",
      title: `${input.reviewCount} transactions need review`,
      message: "Reviewing these helps categories, subscriptions, and reports stay accurate.",
      severity: "watch",
    });
  }
  if (input.subscriptionIncreases > 0) {
    reminders.push({
      id: "subscription-increase",
      type: "subscription_increase",
      title: "Subscription price change",
      message: "I found a recurring charge that may have increased.",
      severity: "watch",
    });
  }
  if (input.needsReconcile) {
    reminders.push({
      id: "reconcile",
      type: "reconcile_account",
      title: "Account needs reconciliation",
      message: "A fresh balance makes every forecast answer stronger.",
      severity: "info",
    });
  }
  input.goals?.filter(goal => goal.status === "behind" || goal.status === "unsafe").slice(0, 2).forEach(goal => {
    reminders.push({
      id: `goal-${goal.goalId}`,
      type: "goal_behind",
      title: "Goal needs attention",
      message: goal.message,
      severity: goal.status === "unsafe" ? "risk" : "watch",
    });
  });
  return reminders;
}


export function buildChildMoneySummary(children: ChildProfile[]) {
  return children.map(child => {
    const progress = child.savingsGoal && child.savingsGoal > 0
      ? Math.min(100, Math.round(((child.currentSavings ?? 0) / child.savingsGoal) * 100))
      : 0;
    return {
      id: child.id,
      name: child.name,
      progress,
      message: child.savingsGoal
        ? `${child.name} is ${progress}% toward their savings goal.`
        : `${child.name} is ready for a starter money plan.`,
    };
  });
}

function ruleMatches(transaction: GrowthTransaction, description: string, rule: TransactionRule) {
  if (rule.matchType === "amount_range") {
    const amount = Math.abs(transaction.amount);
    const minOk = rule.amountMin == null || amount >= rule.amountMin;
    const maxOk = rule.amountMax == null || amount <= rule.amountMax;
    return minOk && maxOk;
  }
  const needle = normalizeMerchant(rule.matchValue ?? "");
  if (!needle) return false;
  if (rule.matchType === "exact") return description === needle;
  if (rule.matchType === "starts_with") return description.startsWith(needle);
  return description.includes(needle);
}

function maybeBillLike(transaction: GrowthTransaction) {
  const merchant = normalizeMerchant(transaction.description);
  return transaction.amount < 0 && (KNOWN_SUBSCRIPTION_WORDS.some(word => merchant.includes(word)) || /auto|bill|pay|loan|insurance|electric|water|internet|phone/.test(merchant));
}

function maybeDebtOrGoal(transaction: GrowthTransaction) {
  const merchant = normalizeMerchant(transaction.description);
  return transaction.amount < 0 && /card|loan|debt|capital|discover|savings|transfer|goal/.test(merchant);
}

function isUnusualAmount(transaction: GrowthTransaction, peers: GrowthTransaction[]) {
  const comparable = peers.filter(peer => peer.id !== transaction.id && Math.sign(peer.amount) === Math.sign(transaction.amount));
  if (comparable.length < 3) return false;
  const average = comparable.reduce((sum, peer) => sum + Math.abs(peer.amount), 0) / comparable.length;
  if (average <= 0) return false;
  return Math.abs(transaction.amount) > average * 1.75 || Math.abs(transaction.amount) < average * 0.35;
}

function summarizeReviewReasons(reasons: ReviewReason[]) {
  if (reasons.includes("possible_duplicate")) return "Possible duplicate transaction.";
  if (reasons.includes("possible_subscription")) return "Possible subscription to review.";
  if (reasons.includes("missing_category")) return "Category needs review.";
  if (reasons.includes("unusual_amount")) return "Amount looks unusual for this merchant.";
  return "Review this transaction before reports use it.";
}

function priorityRank(priority: ReviewItem["priority"]) {
  return priority === "high" ? 3 : priority === "medium" ? 2 : 1;
}

function inferCadence(dates: string[]): SubscriptionCandidate["cadence"] {
  if (dates.length < 2) return "unknown";
  const sorted = dates.slice().sort();
  const gaps: number[] = [];
  for (let index = 1; index < sorted.length; index++) {
    gaps.push(daysBetween(sorted[index - 1], sorted[index]));
  }
  const avg = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  if (avg >= 5 && avg <= 9) return "weekly";
  if (avg >= 24 && avg <= 38) return "monthly";
  if (avg >= 330 && avg <= 400) return "annual";
  return "unknown";
}

function merchantHasDuplicate(merchant: string, groups: Map<string, GrowthTransaction[]>) {
  const words = new Set(merchant.split(" ").filter(word => word.length > 3));
  if (!words.size) return false;
  let similar = 0;
  groups.forEach((_items, other) => {
    if (other === merchant) return;
    const overlap = other.split(" ").some(word => words.has(word));
    if (overlap) similar += 1;
  });
  return similar > 0;
}

function daysBetween(a: string, b: string) {
  const start = new Date(`${a}T00:00:00`);
  const end = new Date(`${b}T00:00:00`);
  return Math.abs(Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

function monthsUntil(date: string, today: Date) {
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime()) || target <= today) return 0;
  const years = target.getFullYear() - today.getFullYear();
  const months = target.getMonth() - today.getMonth();
  return Math.max(1, years * 12 + months + (target.getDate() >= today.getDate() ? 0 : -1));
}

function goalFundingMessage(name: string, status: GoalFundingPlan["status"], needed: number, safe: number) {
  if (status === "needs_date") return `${name} needs a target date before I can build a funding plan.`;
  if (status === "on_track") return `${name} can stay on track at about $${needed.toFixed(0)} per month.`;
  if (status === "unsafe") return `I would pause ${name} contributions until the cushion has room.`;
  return `${name} needs about $${needed.toFixed(0)} per month, but only $${safe.toFixed(0)} looks safe right now.`;
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
