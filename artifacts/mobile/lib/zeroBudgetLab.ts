import AsyncStorage from "@react-native-async-storage/async-storage";

export type ZeroBudgetTargetCadence = "monthly" | "weekly" | "by_date" | "none";
export type ZeroBudgetMoneyAction = "assign" | "spend";
export type ZeroBudgetLabTransactionStatus =
  | "pending"
  | "needs_review"
  | "categorized";

export interface ZeroBudgetLabTransaction {
  id: string;
  name: string;
  amount: number;
  date: string;
  status: ZeroBudgetLabTransactionStatus;
  categoryId?: string;
}

export interface ZeroBudgetLabBill {
  id: string;
  name: string;
  categoryId: string;
  amount: number;
  dueDay: number;
  required: boolean;
}

export interface ZeroBudgetLabDailyBalance {
  day: number;
  balance?: number;
  labels: string[];
}

export interface ZeroBudgetLabGroup {
  id: string;
  name: string;
  collapsed: boolean;
}

export interface ZeroBudgetLabCategory {
  id: string;
  groupId: string;
  name: string;
  emoji: string;
  targetAmount: number;
  targetCadence: ZeroBudgetTargetCadence;
  dueDay?: number;
  assignedByMonth: Record<string, number>;
  spentByMonth: Record<string, number>;
}

export interface ZeroBudgetLabState {
  version: 2;
  selectedMonth: string;
  defaultMonthlyIncome: number;
  incomeByMonth: Record<string, number>;
  hideAmounts: boolean;
  groups: ZeroBudgetLabGroup[];
  categories: ZeroBudgetLabCategory[];
  transactions: ZeroBudgetLabTransaction[];
}

export interface ZeroBudgetCategorySummary {
  category: ZeroBudgetLabCategory;
  monthlyTarget: number;
  assigned: number;
  spent: number;
  available: number;
  needed: number;
  progress: number;
  status: "funded" | "partial" | "unfunded" | "overspent";
}

export interface ZeroBudgetMonthSummary {
  income: number;
  assigned: number;
  spent: number;
  readyToAssign: number;
  monthlyTargets: number;
  categories: ZeroBudgetCategorySummary[];
}

export const ZERO_BUDGET_LAB_CHECKING_BALANCE = 1689.39;

export const ZERO_BUDGET_LAB_BILLS: ZeroBudgetLabBill[] = [
  {
    id: "lab-rent",
    name: "Rent / Mortgage",
    categoryId: "rent",
    amount: 1468,
    dueDay: 4,
    required: true,
  },
  {
    id: "lab-utilities",
    name: "Utilities",
    categoryId: "utilities",
    amount: 480,
    dueDay: 15,
    required: true,
  },
  {
    id: "lab-phone",
    name: "Phone & Internet",
    categoryId: "phone",
    amount: 154,
    dueDay: 31,
    required: true,
  },
];

export function monthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftZeroBudgetMonth(value: string, delta: number): string {
  const [year, month] = value.split("-").map(Number);
  return monthKey(new Date(year, month - 1 + delta, 1));
}

export function formatZeroBudgetMonth(value: string): string {
  const [year, month] = value.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export function monthlyTarget(category: ZeroBudgetLabCategory): number {
  if (category.targetCadence === "none") return 0;
  const target = Math.max(0, Number(category.targetAmount) || 0);
  return roundMoney(category.targetCadence === "weekly" ? target * 4 : target);
}

export function summarizeZeroBudget(
  state: ZeroBudgetLabState,
  selectedMonth = state.selectedMonth,
): ZeroBudgetMonthSummary {
  const categories = state.categories.map((category) => {
    const target = monthlyTarget(category);
    const assigned = roundMoney(
      Math.max(0, category.assignedByMonth[selectedMonth] ?? 0),
    );
    const spent = roundMoney(
      Math.max(0, category.spentByMonth[selectedMonth] ?? 0),
    );
    const available = roundMoney(assigned - spent);
    const needed = roundMoney(Math.max(0, target - assigned));
    const status =
      available < -0.005
        ? "overspent"
        : target > 0 && assigned + 0.005 >= target
          ? "funded"
          : assigned > 0
            ? "partial"
            : "unfunded";
    return {
      category,
      monthlyTarget: target,
      assigned,
      spent,
      available,
      needed,
      progress:
        target > 0
          ? Math.min(100, Math.round((assigned / target) * 100))
          : assigned > 0
            ? 100
            : 0,
      status,
    } satisfies ZeroBudgetCategorySummary;
  });
  const income = roundMoney(
    Math.max(
      0,
      state.incomeByMonth[selectedMonth] ?? state.defaultMonthlyIncome,
    ),
  );
  const assigned = roundMoney(
    categories.reduce((sum, row) => sum + row.assigned, 0),
  );
  const spent = roundMoney(categories.reduce((sum, row) => sum + row.spent, 0));
  return {
    income,
    assigned,
    spent,
    readyToAssign: roundMoney(income - assigned),
    monthlyTargets: roundMoney(
      categories.reduce((sum, row) => sum + row.monthlyTarget, 0),
    ),
    categories,
  };
}

export function zeroBudgetLabBillPaid(
  state: ZeroBudgetLabState,
  bill: ZeroBudgetLabBill,
): number {
  const category = state.categories.find((item) => item.id === bill.categoryId);
  return roundMoney(
    Math.min(
      bill.amount,
      Math.max(0, category?.spentByMonth[state.selectedMonth] ?? 0),
    ),
  );
}

export function zeroBudgetLabFlowScore(state: ZeroBudgetLabState): number {
  const summary = summarizeZeroBudget(state);
  const overspent = summary.categories.filter(
    (row) => row.status === "overspent",
  ).length;
  const underfundedRequired = ZERO_BUDGET_LAB_BILLS.filter((bill) => {
    const category = summary.categories.find(
      (row) => row.category.id === bill.categoryId,
    );
    return (category?.assigned ?? 0) + 0.005 < bill.amount;
  }).length;
  const reviewCount = state.transactions.filter(
    (transaction) =>
      transaction.date.startsWith(state.selectedMonth) &&
      transaction.status === "needs_review",
  ).length;
  return Math.max(
    0,
    Math.min(
      100,
      84 - overspent * 8 - underfundedRequired * 5 - reviewCount * 2,
    ),
  );
}

export function zeroBudgetLabDailyBalances(
  state: ZeroBudgetLabState,
  now = new Date(),
): ZeroBudgetLabDailyBalance[] {
  const [year, month] = state.selectedMonth.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const isCurrentMonth =
    now.getFullYear() === year && now.getMonth() + 1 === month;
  const anchorDay = isCurrentMonth ? Math.min(now.getDate(), daysInMonth) : 1;
  const summary = summarizeZeroBudget(state);
  const paycheck = roundMoney(summary.income / 2);
  const incomeDays = [9, 23].filter((day) => day <= daysInMonth);
  const billRemaining = new Map(
    ZERO_BUDGET_LAB_BILLS.map((bill) => [
      bill.id,
      roundMoney(Math.max(0, bill.amount - zeroBudgetLabBillPaid(state, bill))),
    ]),
  );
  let balance = ZERO_BUDGET_LAB_CHECKING_BALANCE;

  return Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const labels: string[] = [];
    const dayTransactions = state.transactions.filter(
      (transaction) =>
        transaction.date ===
        `${state.selectedMonth}-${String(day).padStart(2, "0")}`,
    );
    dayTransactions.forEach((transaction) =>
      labels.push(
        transaction.status === "pending"
          ? `${transaction.name} pending`
          : transaction.name,
      ),
    );
    ZERO_BUDGET_LAB_BILLS.filter((bill) => bill.dueDay === day).forEach(
      (bill) => labels.push(bill.name),
    );
    if (incomeDays.includes(day)) labels.push("Payday");

    if (day < anchorDay) return { day, labels };
    if (day === anchorDay) {
      const overdue = ZERO_BUDGET_LAB_BILLS.filter(
        (bill) => bill.dueDay <= anchorDay,
      ).reduce((sum, bill) => sum + (billRemaining.get(bill.id) ?? 0), 0);
      balance = roundMoney(balance - overdue);
    } else {
      if (incomeDays.includes(day)) balance = roundMoney(balance + paycheck);
      const due = ZERO_BUDGET_LAB_BILLS.filter(
        (bill) => bill.dueDay === day,
      ).reduce((sum, bill) => sum + (billRemaining.get(bill.id) ?? 0), 0);
      balance = roundMoney(balance - due);
    }
    return { day, balance, labels };
  });
}

export function applyZeroBudgetMoney(
  state: ZeroBudgetLabState,
  categoryId: string,
  amount: number,
  action: ZeroBudgetMoneyAction,
  assignmentMode: "add" | "subtract" | "set" = "add",
): ZeroBudgetLabState {
  const safeAmount = roundMoney(Math.max(0, Number(amount) || 0));
  if (!safeAmount) return state;
  return {
    ...state,
    categories: state.categories.map((category) => {
      if (category.id !== categoryId) return category;
      if (action === "spend") {
        const spent = roundMoney(
          (category.spentByMonth[state.selectedMonth] ?? 0) + safeAmount,
        );
        return {
          ...category,
          spentByMonth: {
            ...category.spentByMonth,
            [state.selectedMonth]: spent,
          },
        };
      }
      const current = category.assignedByMonth[state.selectedMonth] ?? 0;
      const assigned =
        assignmentMode === "set"
          ? safeAmount
          : assignmentMode === "subtract"
            ? Math.max(0, current - safeAmount)
            : current + safeAmount;
      return {
        ...category,
        assignedByMonth: {
          ...category.assignedByMonth,
          [state.selectedMonth]: roundMoney(assigned),
        },
      };
    }),
  };
}

export function categorizeZeroBudgetTransaction(
  state: ZeroBudgetLabState,
  transactionId: string,
  categoryId: string,
): ZeroBudgetLabState {
  const transaction = state.transactions.find(
    (item) => item.id === transactionId,
  );
  if (
    !transaction ||
    transaction.status === "pending" ||
    !state.categories.some((item) => item.id === categoryId)
  )
    return state;
  const transactionMonth = transaction.date.slice(0, 7);
  const amount = roundMoney(Math.max(0, Number(transaction.amount) || 0));
  if (!amount) return state;

  return {
    ...state,
    transactions: state.transactions.map((item) =>
      item.id === transactionId
        ? { ...item, status: "categorized", categoryId }
        : item,
    ),
    categories: state.categories.map((category) => {
      let nextSpent = category.spentByMonth[transactionMonth] ?? 0;
      if (
        transaction.status === "categorized" &&
        transaction.categoryId === category.id
      )
        nextSpent -= amount;
      if (category.id === categoryId) nextSpent += amount;
      return nextSpent === (category.spentByMonth[transactionMonth] ?? 0)
        ? category
        : {
            ...category,
            spentByMonth: {
              ...category.spentByMonth,
              [transactionMonth]: roundMoney(Math.max(0, nextSpent)),
            },
          };
    }),
  };
}

export function postZeroBudgetTransaction(
  state: ZeroBudgetLabState,
  transactionId: string,
): ZeroBudgetLabState {
  const transaction = state.transactions.find(
    (item) => item.id === transactionId,
  );
  if (!transaction || transaction.status !== "pending") return state;
  return {
    ...state,
    transactions: state.transactions.map((item) =>
      item.id === transactionId ? { ...item, status: "needs_review" } : item,
    ),
  };
}

export function moveZeroBudgetCategory(
  state: ZeroBudgetLabState,
  categoryId: string,
  direction: -1 | 1,
): ZeroBudgetLabState {
  const category = state.categories.find((item) => item.id === categoryId);
  if (!category) return state;
  const groupCategories = state.categories.filter(
    (item) => item.groupId === category.groupId,
  );
  const currentIndex = groupCategories.findIndex(
    (item) => item.id === categoryId,
  );
  const target = groupCategories[currentIndex + direction];
  if (!target) return state;
  const categories = [...state.categories];
  const fromIndex = categories.findIndex((item) => item.id === categoryId);
  const toIndex = categories.findIndex((item) => item.id === target.id);
  [categories[fromIndex], categories[toIndex]] = [
    categories[toIndex],
    categories[fromIndex],
  ];
  return { ...state, categories };
}

export function createZeroBudgetLabState(now = new Date()): ZeroBudgetLabState {
  const selectedMonth = monthKey(now);
  const assigned = (amount: number) => ({ [selectedMonth]: amount });
  const spent = (amount: number) => ({ [selectedMonth]: amount });
  return {
    version: 2,
    selectedMonth,
    defaultMonthlyIncome: 3028.42,
    incomeByMonth: { [selectedMonth]: 3028.42 },
    hideAmounts: false,
    groups: [
      { id: "bills", name: "Bills", collapsed: false },
      { id: "needs", name: "Needs", collapsed: false },
      { id: "wants", name: "Wants", collapsed: false },
    ],
    categories: [
      {
        id: "rent",
        groupId: "bills",
        name: "Rent / Mortgage",
        emoji: "🏠",
        targetAmount: 1468,
        targetCadence: "by_date",
        dueDay: 4,
        assignedByMonth: assigned(1468),
        spentByMonth: spent(1468),
      },
      {
        id: "phone",
        groupId: "bills",
        name: "Phone & Internet",
        emoji: "📱",
        targetAmount: 154,
        targetCadence: "by_date",
        dueDay: 31,
        assignedByMonth: assigned(35.21),
        spentByMonth: spent(0),
      },
      {
        id: "utilities",
        groupId: "bills",
        name: "Utilities",
        emoji: "⚡",
        targetAmount: 480,
        targetCadence: "monthly",
        assignedByMonth: assigned(480),
        spentByMonth: spent(0),
      },
      {
        id: "groceries",
        groupId: "needs",
        name: "Groceries",
        emoji: "🛒",
        targetAmount: 10,
        targetCadence: "weekly",
        assignedByMonth: assigned(40),
        spentByMonth: spent(30),
      },
      {
        id: "transportation",
        groupId: "needs",
        name: "Transportation",
        emoji: "🚗",
        targetAmount: 20,
        targetCadence: "weekly",
        assignedByMonth: assigned(80),
        spentByMonth: spent(60),
      },
      {
        id: "medical",
        groupId: "needs",
        name: "Medical expenses",
        emoji: "🩺",
        targetAmount: 70,
        targetCadence: "monthly",
        assignedByMonth: assigned(70),
        spentByMonth: spent(0),
      },
      {
        id: "emergency",
        groupId: "needs",
        name: "Emergency fund",
        emoji: "🛟",
        targetAmount: 200,
        targetCadence: "monthly",
        assignedByMonth: assigned(100),
        spentByMonth: spent(0),
      },
      {
        id: "dining",
        groupId: "wants",
        name: "Dining out",
        emoji: "🍽️",
        targetAmount: 200,
        targetCadence: "monthly",
        assignedByMonth: assigned(100),
        spentByMonth: spent(0),
      },
      {
        id: "entertainment",
        groupId: "wants",
        name: "Entertainment",
        emoji: "🍿",
        targetAmount: 60,
        targetCadence: "monthly",
        assignedByMonth: assigned(60),
        spentByMonth: spent(0),
      },
      {
        id: "vacation",
        groupId: "wants",
        name: "Vacation",
        emoji: "🏝️",
        targetAmount: 300,
        targetCadence: "monthly",
        assignedByMonth: assigned(0),
        spentByMonth: spent(0),
      },
    ],
    transactions: [
      {
        id: "sample-walmart",
        name: "Walmart",
        amount: 84.02,
        date: `${selectedMonth}-18`,
        status: "needs_review",
      },
      {
        id: "sample-shell",
        name: "Shell",
        amount: 47.36,
        date: `${selectedMonth}-19`,
        status: "needs_review",
      },
      {
        id: "sample-cinemark",
        name: "Cinemark Theatres",
        amount: 54.66,
        date: `${selectedMonth}-20`,
        status: "needs_review",
      },
      {
        id: "sample-utilities",
        name: "Huntsville Utilities",
        amount: 350,
        date: `${selectedMonth}-20`,
        status: "needs_review",
      },
      {
        id: "sample-apple-pending",
        name: "Apple.com/bill",
        amount: 9.99,
        date: `${selectedMonth}-21`,
        status: "pending",
      },
    ],
  };
}

export function normalizeZeroBudgetLabState(
  value: unknown,
  now = new Date(),
): ZeroBudgetLabState {
  if (!value || typeof value !== "object") return createZeroBudgetLabState(now);
  const candidate = value as Partial<ZeroBudgetLabState>;
  if (
    candidate.version !== 2 ||
    !Array.isArray(candidate.groups) ||
    !Array.isArray(candidate.categories)
  ) {
    return createZeroBudgetLabState(now);
  }
  const defaults = createZeroBudgetLabState(now);
  return {
    ...defaults,
    ...candidate,
    version: 2,
    selectedMonth: /^\d{4}-\d{2}$/.test(candidate.selectedMonth ?? "")
      ? candidate.selectedMonth!
      : monthKey(now),
    defaultMonthlyIncome: Math.max(
      0,
      Number(candidate.defaultMonthlyIncome) || 0,
    ),
    incomeByMonth:
      candidate.incomeByMonth && typeof candidate.incomeByMonth === "object"
        ? candidate.incomeByMonth
        : {},
    hideAmounts: Boolean(candidate.hideAmounts),
    groups: candidate.groups,
    categories: candidate.categories,
    transactions: Array.isArray(candidate.transactions)
      ? candidate.transactions
      : defaults.transactions,
  };
}

function storageKey(userId: string) {
  return `flowledger-admin-zero-budget-lab-v2-${userId}`;
}

export async function loadZeroBudgetLabState(
  userId: string,
): Promise<ZeroBudgetLabState> {
  const raw = await AsyncStorage.getItem(storageKey(userId)).catch(() => null);
  if (!raw) return createZeroBudgetLabState();
  try {
    return normalizeZeroBudgetLabState(JSON.parse(raw));
  } catch {
    return createZeroBudgetLabState();
  }
}

export async function saveZeroBudgetLabState(
  userId: string,
  state: ZeroBudgetLabState,
): Promise<void> {
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(state));
}

export async function resetZeroBudgetLabState(
  userId: string,
): Promise<ZeroBudgetLabState> {
  const state = createZeroBudgetLabState();
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(state));
  return state;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
