export type SearchResultKind =
  | "Bill"
  | "Debt"
  | "Goal"
  | "Activity"
  | "Category"
  | "Report"
  | "Settings"
  | "Review Center"
  | "Command";

export type UniversalSearchResult = {
  id: string;
  kind: SearchResultKind;
  title: string;
  subtitle: string;
  icon: string;
  route: string;
  params?: Record<string, string>;
  keywords?: string;
};

export type UniversalSearchInput = {
  bills: Array<{ id: string; name: string; category: string; is_debt: boolean; balance: number; amount: number }>;
  goals: Array<{ id: string; name: string; current_amount: number; target_amount: number; archived_at?: string }>;
  transactions: Array<{ id: string; date: string; note: string; category: string; merchant_name?: string; amount: number; removed_at?: string; pending?: boolean }>;
  categories: string[];
  settings: Array<{ id: string; label: string; description: string; icon: string }>;
};

export const APP_COMMANDS: readonly UniversalSearchResult[] = [
  { id: "add-bill", kind: "Command", title: "Add Bill", subtitle: "Create a recurring or one-time bill", icon: "file-plus", route: "/(tabs)", params: { action: "bill", add: "1" } },
  { id: "add-income", kind: "Command", title: "Add Income", subtitle: "Add an income source", icon: "arrow-down-left", route: "/(tabs)", params: { action: "income", add: "1" } },
  { id: "add-debt", kind: "Command", title: "Add Debt", subtitle: "Add a debt to your snowball", icon: "credit-card", route: "/(tabs)", params: { action: "debt", add: "1" } },
  { id: "add-goal", kind: "Command", title: "Add Goal", subtitle: "Create a savings or planned-spending goal", icon: "target", route: "/(tabs)", params: { action: "goal", add: "1" } },
  { id: "add-transaction", kind: "Command", title: "Add Transaction", subtitle: "Record manual Activity", icon: "plus-circle", route: "/(tabs)/transactions", params: { add: "1" } },
  { id: "open-calendar", kind: "Command", title: "Open Calendar", subtitle: "View your monthly forecast", icon: "calendar", route: "/(tabs)/monthly" },
  { id: "open-activity", kind: "Command", title: "Search Activity", subtitle: "Browse posted transaction history", icon: "repeat", route: "/(tabs)/transactions" },
  { id: "open-reports", kind: "Command", title: "Open Reports", subtitle: "View reports and insights", icon: "bar-chart-2", route: "/(tabs)/reports" },
  { id: "open-review", kind: "Command", title: "Open Review Center", subtitle: "Resolve activity that needs attention", icon: "check-square", route: "/(tabs)/review" },
  { id: "open-settings", kind: "Command", title: "Open Settings", subtitle: "Manage your app and account", icon: "settings", route: "/(tabs)/more" },
] as const;

function currency(value: number) {
  return Math.abs(Number.isFinite(value) ? value : 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function matches(result: UniversalSearchResult, query: string) {
  const haystack = `${result.title} ${result.subtitle} ${result.kind} ${result.keywords ?? ""}`.toLowerCase();
  return query.split(/\s+/).filter(Boolean).every(part => haystack.includes(part));
}

function deduplicate(results: UniversalSearchResult[]) {
  const seen = new Set<string>();
  return results.filter(result => {
    const key = `${result.kind}:${result.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildUniversalSearchIndex(input: UniversalSearchInput): UniversalSearchResult[] {
  const results: UniversalSearchResult[] = [];

  input.bills.forEach(bill => {
    if (bill.is_debt) {
      results.push({
        id: bill.id,
        kind: "Debt",
        title: bill.name,
        subtitle: `${bill.category || "Debt"} · ${currency(bill.balance)} balance`,
        icon: "credit-card",
        route: "/(tabs)/bills",
        params: { view: "debt" },
      });
    } else {
      results.push({
        id: bill.id,
        kind: "Bill",
        title: bill.name,
        subtitle: `${bill.category || "Bill"} · ${currency(bill.amount)}`,
        icon: "file-text",
        route: "/(tabs)/bills",
        params: { view: "bills" },
      });
    }
  });

  input.goals.filter(goal => !goal.archived_at).forEach(goal => {
    const progress = goal.target_amount > 0 ? Math.min(100, Math.round((goal.current_amount / goal.target_amount) * 100)) : 0;
    results.push({
      id: goal.id,
      kind: "Goal",
      title: goal.name,
      subtitle: `${progress}% funded`,
      icon: "target",
      route: "/(tabs)/more",
      params: { section: "goals" },
    });
  });

  input.transactions.filter(transaction => !transaction.removed_at && transaction.pending !== true).forEach(transaction => {
    results.push({
      id: transaction.id,
      kind: "Activity",
      title: transaction.merchant_name?.trim() || transaction.note?.trim() || transaction.category || "Transaction",
      subtitle: `${transaction.date} · ${transaction.category || "Other"} · ${transaction.amount >= 0 ? "+" : "−"}${currency(transaction.amount)}`,
      icon: transaction.amount >= 0 ? "arrow-down-left" : "arrow-up-right",
      route: "/(tabs)/transactions",
      params: { activityId: transaction.id, activityDate: transaction.date, activityAt: String(Date.now()) },
      keywords: transaction.note,
    });
  });

  Array.from(new Set(input.categories.filter(Boolean))).forEach(category => {
    results.push({
      id: category.toLowerCase(),
      kind: "Category",
      title: category,
      subtitle: "Filter Activity by category",
      icon: "tag",
      route: "/(tabs)/transactions",
      params: { category, range: "all_time" },
    });
  });

  results.push(
    { id: "reports", kind: "Report", title: "Reports & Insights", subtitle: "Trends, category totals, and financial insights", icon: "bar-chart-2", route: "/(tabs)/reports", keywords: "spending income net flow" },
    { id: "review", kind: "Review Center", title: "Review Center", subtitle: "Match and categorize posted bank activity", icon: "check-square", route: "/(tabs)/review", keywords: "attention posted transactions" },
  );

  input.settings.forEach(setting => results.push({
    id: setting.id,
    kind: "Settings",
    title: setting.label,
    subtitle: setting.description,
    icon: setting.icon,
    route: "/(tabs)/more",
    params: { section: setting.id },
  }));

  return deduplicate(results);
}

export function searchUniversalIndex(index: UniversalSearchResult[], query: string, limit = 28) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return index
    .filter(result => matches(result, normalized))
    .sort((left, right) => {
      const leftTitle = left.title.toLowerCase();
      const rightTitle = right.title.toLowerCase();
      const leftExact = leftTitle === normalized ? 0 : leftTitle.startsWith(normalized) ? 1 : 2;
      const rightExact = rightTitle === normalized ? 0 : rightTitle.startsWith(normalized) ? 1 : 2;
      return leftExact - rightExact || left.title.localeCompare(right.title);
    })
    .slice(0, limit);
}

export function filterCommands(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...APP_COMMANDS];
  return APP_COMMANDS.filter(command => matches(command, normalized));
}

export function mergeSearchResults(local: UniversalSearchResult[], remote: UniversalSearchResult[], limit = 32) {
  return deduplicate([...local, ...remote]).slice(0, limit);
}
