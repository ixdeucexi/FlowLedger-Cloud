import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";

import {
  CardHeader,
  DesktopCard,
  DesktopPage,
  DesktopSearch,
  EmptyState,
  FilterButton,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  SummaryMetricCard,
  desktopPalette as palette,
  desktopTableStyles as table,
} from "@/components/desktop/DesktopUI";
import { DataFreshnessLabel } from "@/components/DataFreshnessLabel";
import { exportActivityCsv } from "@/lib/activityCsv";

export type DesktopActivityRow = {
  id: string;
  date: string;
  amount: number;
  label: string;
  category: string;
  source:
    | "transaction"
    | "bank_transaction"
    | "bill_payment"
    | "income"
    | "extra_payment"
    | "transfer";
  editable: boolean;
  pending?: boolean;
  detail?: string;
  accountName?: string;
  note?: string;
  debtName?: string;
  runningBalance?: number;
};

type Summary = { title: string; income: number; out: number; net: number; transactions?: number };
type ActivityTab =
  | "All Activity"
  | "Transactions"
  | "Transfers"
  | "Adjustments";

function money(value: number, signed = false) {
  const prefix = signed ? (value > 0 ? "+" : value < 0 ? "−" : "") : "";
  return `${prefix}${Math.abs(value).toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateLabel(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day, 12).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function dateGroupLabel(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day, 12).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function sourceLabel(source: DesktopActivityRow["source"]) {
  if (source === "bank_transaction") return "Bank";
  if (source === "bill_payment") return "Bill";
  if (source === "extra_payment") return "Adjustment";
  return source.charAt(0).toUpperCase() + source.slice(1);
}

function exportRows(rows: DesktopActivityRow[]) {
  exportActivityCsv(rows.map(row => ({
    date: row.date,
    description: row.label,
    category: row.category,
    account: row.accountName,
    amount: row.amount,
    type: sourceLabel(row.source),
    appliedDebt: row.debtName,
    note: row.note,
    runningBalance: row.runningBalance,
  })));
}

export function DesktopActivityPage({
  rows,
  summary,
  onAdd,
  onOpen,
  dateRangeLabel,
  onDateRangePress,
  search: controlledSearch,
  onSearchChange,
  categoryFilter,
  onCategoryPress,
  typeFilter,
  onTypePress,
  hasActiveFilters,
  onResetFilters,
  hasMore,
  loadingMore,
  loadError,
  onLoadMore,
}: {
  rows: DesktopActivityRow[];
  summary: Summary;
  onAdd: () => void;
  onOpen: (id: string) => void;
  dateRangeLabel: string;
  onDateRangePress: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  categoryFilter: string;
  onCategoryPress: () => void;
  typeFilter: string;
  onTypePress: () => void;
  hasActiveFilters: boolean;
  onResetFilters: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  loadError?: string | null;
  onLoadMore: () => void;
}) {
  const [tab, setTab] = useState<ActivityTab>("All Activity");
  const [account, setAccount] = useState("All Accounts");
  const [sortBy, setSortBy] = useState<"date" | "description" | "category" | "account" | "amount" | "type">("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const accounts = useMemo(
    () =>
      Array.from(
        new Set(
          rows
            .map((row) => row.accountName)
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort(),
    [rows],
  );
  const cycle = (
    current: string,
    values: string[],
    update: (value: string) => void,
  ) => update(values[(values.indexOf(current) + 1) % values.length]);
  const filtered = useMemo(
    () =>
      rows
        .filter((row) => {
          const tabMatch =
            tab === "All Activity" ||
            (tab === "Transactions" &&
              !["transfer", "extra_payment"].includes(row.source)) ||
            (tab === "Transfers" && row.source === "transfer") ||
            (tab === "Adjustments" && row.source === "extra_payment");
          return (
            tabMatch &&
            (account === "All Accounts" || row.accountName === account)
          );
        })
        .sort((left, right) => {
          const direction = sortDirection === "asc" ? 1 : -1;
          const leftValue = sortBy === "date" ? left.date : sortBy === "description" ? left.label : sortBy === "category" ? left.category : sortBy === "account" ? left.accountName ?? "" : sortBy === "amount" ? left.amount : sourceLabel(left.source);
          const rightValue = sortBy === "date" ? right.date : sortBy === "description" ? right.label : sortBy === "category" ? right.category : sortBy === "account" ? right.accountName ?? "" : sortBy === "amount" ? right.amount : sourceLabel(right.source);
          return typeof leftValue === "number" && typeof rightValue === "number"
            ? (leftValue - rightValue) * direction
            : String(leftValue).localeCompare(String(rightValue)) * direction;
        }),
    [account, rows, sortBy, sortDirection, tab],
  );
  const groupedActivity = useMemo(() => {
    const groups: Array<{ date: string; rows: DesktopActivityRow[] }> = [];
    filtered.forEach((row) => {
      const date = row.date.slice(0, 10);
      const current = groups[groups.length - 1];
      if (current?.date === date) current.rows.push(row);
      else groups.push({ date, rows: [row] });
    });
    return groups;
  }, [filtered]);

  const spending = useMemo(() => {
    const totals = new Map<string, number>();
    rows
      .filter(
        (row) => row.amount < 0 && row.source !== "transfer" && !row.pending,
      )
      .forEach((row) =>
        totals.set(
          row.category,
          (totals.get(row.category) ?? 0) + Math.abs(row.amount),
        ),
      );
    const grandTotal = Array.from(totals.values()).reduce(
      (sum, value) => sum + value,
      0,
    );
    return Array.from(totals.entries())
      .map(([label, amount], index) => ({
        label,
        amount,
        percent: grandTotal ? Math.round((amount / grandTotal) * 100) : 0,
        color: [
          "#6d3bea",
          "#1570ef",
          "#039855",
          "#dc6803",
          "#d92d20",
          "#0e9384",
        ][index % 6],
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6);
  }, [rows]);

  const toggleSort = (column: typeof sortBy) => {
    if (sortBy === column) setSortDirection(value => value === "asc" ? "desc" : "asc");
    else {
      setSortBy(column);
      setSortDirection(column === "date" || column === "amount" ? "desc" : "asc");
    }
  };
  return (
    <DesktopPage>
      <ScrollView
        style={styles.pageScroll}
        contentContainerStyle={styles.pageContent}
        showsVerticalScrollIndicator
      >
        <PageHeader
          title="Activity"
          description="See all of your financial activity in one place."
          actions={
            <>
              <SecondaryButton
                label="Export"
                icon="upload"
                onPress={() => exportRows(filtered)}
              />
              <PrimaryButton label="Add Transaction" onPress={onAdd} />
            </>
          }
        />
        <DataFreshnessLabel compact />
        <View style={styles.metrics}>
          <SummaryMetricCard
            label="Total Inflows"
            value={money(summary.income, true)}
            detail={summary.title}
            icon="arrow-down"
            tone="green"
          />
          <SummaryMetricCard
            label="Total Outflows"
            value={money(-summary.out, true)}
            detail={summary.title}
            icon="arrow-up"
            tone="red"
          />
          <SummaryMetricCard
            label="Net Flow"
            value={money(summary.net, true)}
            detail={summary.title}
            icon="trending-up"
          />
          <SummaryMetricCard
            label="Transactions"
            value={String(summary.transactions ?? rows.filter((row) => !row.pending).length)}
            detail="This period"
            icon="file-text"
            tone="blue"
          />
        </View>
        <View style={styles.tabs}>
          {(
            [
              "All Activity",
              "Transactions",
              "Transfers",
              "Adjustments",
            ] as ActivityTab[]
          ).map((item) => (
            <Pressable
              key={item}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === item }}
              onPress={() => setTab(item)}
              style={[styles.tab, tab === item && styles.tabActive]}
            >
              <Text
                style={[styles.tabText, tab === item && styles.tabTextActive]}
              >
                {item}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.mainRow}>
          <DesktopCard style={styles.activityCard}>
            <View style={styles.filters}>
              <DesktopSearch
                value={controlledSearch}
                onChangeText={onSearchChange}
                placeholder="Search merchant or description..."
              />
              <FilterButton
                label={dateRangeLabel}
                onPress={onDateRangePress}
                active={dateRangeLabel !== "This Month"}
              />
              <FilterButton
                label={account}
                onPress={() =>
                  cycle(account, ["All Accounts", ...accounts], setAccount)
                }
                active={account !== "All Accounts"}
              />
              <FilterButton
                label={categoryFilter === "all" ? "All Categories" : categoryFilter}
                onPress={onCategoryPress}
                active={categoryFilter !== "all"}
              />
              <FilterButton
                label={typeFilter === "all" ? "All Types" : typeFilter === "income" ? "Inflows" : "Outflows"}
                onPress={onTypePress}
                active={typeFilter !== "all"}
              />
              {hasActiveFilters ? (
                <SecondaryButton label="Reset" icon="x" onPress={onResetFilters} />
              ) : null}
            </View>
            <View style={table.header}>
              <SortHeader label="Date" column="date" style={styles.colDate} active={sortBy === "date"} direction={sortDirection} onPress={toggleSort} />
              <SortHeader label="Description" column="description" style={styles.colDescription} active={sortBy === "description"} direction={sortDirection} onPress={toggleSort} />
              <SortHeader label="Category" column="category" style={styles.colCategory} active={sortBy === "category"} direction={sortDirection} onPress={toggleSort} />
              <SortHeader label="Account" column="account" style={styles.colAccount} active={sortBy === "account"} direction={sortDirection} onPress={toggleSort} />
              <SortHeader label="Amount" column="amount" style={styles.colAmount} active={sortBy === "amount"} direction={sortDirection} onPress={toggleSort} />
              <SortHeader label="Type" column="type" style={styles.colType} active={sortBy === "type"} direction={sortDirection} onPress={toggleSort} />
              <Text style={[table.headerText, styles.colAction]} />
            </View>
            {filtered.length ? (
              groupedActivity.map((group) => (
                <View key={group.date}>
                  <View style={styles.dateGroupHeader}>
                    <Text style={styles.dateGroupTitle}>
                      {dateGroupLabel(group.date)}
                    </Text>
                    <Text style={styles.dateGroupCount}>
                      {group.rows.length} {group.rows.length === 1 ? "transaction" : "transactions"}
                    </Text>
                  </View>
                  {group.rows.map((row) => (
                    <Pressable
                      key={row.id}
                      onPress={() => onOpen(row.id)}
                      style={({ pressed }) => [
                        table.row,
                        pressed && styles.pressed,
                      ]}
                    >
                  <Text style={[table.cellText, styles.colDate]}>
                    {dateLabel(row.date)}
                  </Text>
                  <View style={[styles.colDescription, styles.descriptionCell]}>
                    <View
                      style={[
                        styles.activityIcon,
                        {
                          backgroundColor:
                            row.amount >= 0
                              ? palette.greenSoft
                              : palette.purpleSoft,
                        },
                      ]}
                    >
                      <Feather
                        name={
                          row.source === "transfer"
                            ? "repeat"
                            : row.amount >= 0
                              ? "trending-up"
                              : "shopping-bag"
                        }
                        size={14}
                        color={row.amount >= 0 ? palette.green : palette.purple}
                      />
                    </View>
                    <View style={styles.descriptionCopy}>
                      <Text style={table.cellStrong} numberOfLines={1}>
                        {row.label}
                      </Text>
                      {row.debtName ? (
                        <View style={styles.debtIndicator}>
                          <Feather name="credit-card" size={9} color={palette.purple} />
                          <Text style={styles.debtIndicatorText} numberOfLines={1}>Applied to {row.debtName}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                  <View style={styles.colCategory}>
                    <StatusBadge label={row.category} tone="gray" />
                  </View>
                  <Text
                    style={[table.cellText, styles.colAccount]}
                    numberOfLines={1}
                  >
                    {row.accountName ?? "—"}
                  </Text>
                  <View style={styles.colAmount}>
                    <Text
                      style={[
                        table.cellStrong,
                        { color: row.amount >= 0 ? palette.green : palette.red },
                      ]}
                    >
                      {money(row.amount, true)}
                    </Text>
                    {row.runningBalance != null ? (
                      <Text style={styles.runningBalance}>Balance {money(row.runningBalance)}</Text>
                    ) : null}
                  </View>
                  <View style={styles.colType}>
                    <StatusBadge
                      label={row.pending ? "Pending" : sourceLabel(row.source)}
                      tone={
                        row.pending
                          ? "amber"
                          : row.source === "transfer"
                            ? "blue"
                            : row.amount >= 0
                              ? "green"
                              : "red"
                      }
                    />
                  </View>
                  <View style={styles.colAction}>
                    <Feather
                      name={row.editable ? "edit-2" : "chevron-right"}
                      size={14}
                      color={palette.muted}
                    />
                  </View>
                    </Pressable>
                  ))}
                </View>
              ))
            ) : (
              <EmptyState
                title="No activity found"
                message="Try changing your filters or add a transaction."
                action={
                  <PrimaryButton label="Add Transaction" onPress={onAdd} />
                }
              />
            )}
            {loadError ? (
              <View style={styles.loadMoreState}>
                <Text style={styles.loadMoreError}>{loadError}</Text>
                <SecondaryButton label="Retry" icon="refresh-cw" onPress={onLoadMore} />
              </View>
            ) : hasMore ? (
              <View style={styles.loadMoreState}>
                <SecondaryButton label={loadingMore ? "Loading…" : "Load more"} icon="chevron-down" onPress={onLoadMore} />
              </View>
            ) : null}
          </DesktopCard>
          <View style={styles.insightsColumn}>
            <DesktopCard>
              <CardHeader title="Activity Summary" />
              <View style={styles.summaryBody}>
                <SummaryRow
                  label="Inflows"
                  value={money(summary.income, true)}
                  color={palette.green}
                />
                <SummaryRow
                  label="Outflows"
                  value={money(-summary.out, true)}
                  color={palette.red}
                />
                <View style={styles.summaryDivider} />
                <SummaryRow
                  label="Net Flow"
                  value={money(summary.net, true)}
                  color={palette.purple}
                />
              </View>
            </DesktopCard>
            <DesktopCard>
              <CardHeader title="Spending by Category" />
              <View style={styles.spendingBody}>
                {spending.length ? (
                  spending.map((item) => (
                    <View key={item.label} style={styles.spendingRow}>
                      <View
                        style={[styles.dot, { backgroundColor: item.color }]}
                      />
                      <Text style={styles.spendingLabel} numberOfLines={1}>
                        {item.label}
                      </Text>
                      <Text style={styles.spendingAmount}>
                        {money(item.amount)}
                      </Text>
                      <Text style={styles.spendingPercent}>
                        {item.percent}%
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.emptyTiny}>
                    No spending in this period.
                  </Text>
                )}
              </View>
            </DesktopCard>
          </View>
        </View>
      </ScrollView>
    </DesktopPage>
  );
}

function SummaryRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
    </View>
  );
}

function SortHeader({
  label,
  column,
  style,
  active,
  direction,
  onPress,
}: {
  label: string;
  column: "date" | "description" | "category" | "account" | "amount" | "type";
  style: StyleProp<ViewStyle>;
  active: boolean;
  direction: "asc" | "desc";
  onPress: (column: "date" | "description" | "category" | "account" | "amount" | "type") => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Sort by ${label}`}
      onPress={() => onPress(column)}
      style={[style, styles.sortHeader]}
    >
      <Text style={table.headerText}>{label}</Text>
      {active ? <Feather name={direction === "asc" ? "chevron-up" : "chevron-down"} size={12} color={palette.purple} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pageScroll: { flex: 1, margin: -22 },
  pageContent: { padding: 22 },
  metrics: { flexDirection: "row", gap: 12, marginBottom: 14 },
  tabs: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 28,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  tab: {
    height: 42,
    justifyContent: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: { borderBottomColor: palette.purple },
  tabText: {
    color: palette.muted,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  tabTextActive: { color: palette.purpleDark, fontFamily: "Inter_700Bold" },
  mainRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  activityCard: { flex: 2.2, minWidth: 0, overflow: "hidden" },
  insightsColumn: { flex: 1, minWidth: 240, gap: 12 },
  filters: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    padding: 10,
    flexWrap: "wrap",
  },
  colDate: { flex: 0.82, minWidth: 60 },
  colDescription: { flex: 1.7, minWidth: 90 },
  colCategory: { flex: 1.05, minWidth: 70 },
  colAccount: { flex: 1, minWidth: 62 },
  colAmount: { flex: 0.92, minWidth: 70 },
  colType: { flex: 0.88, minWidth: 65 },
  colAction: { width: 24, alignItems: "flex-end" },
  descriptionCell: { flexDirection: "row", alignItems: "center", gap: 7 },
  descriptionCopy: { flex: 1, minWidth: 0 },
  activityIcon: {
    width: 27,
    height: 27,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  sortHeader: { flexDirection: "row", alignItems: "center", gap: 3 },
  loadMoreState: { minHeight: 66, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, padding: 12 },
  loadMoreError: { color: palette.red, fontSize: 12, fontFamily: "Inter_600SemiBold" },
  runningBalance: { color: palette.muted, fontSize: 10, fontFamily: "Inter_500Medium", marginTop: 2 },
  dateGroupHeader: {
    minHeight: 36,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    backgroundColor: palette.surfaceMuted,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  dateGroupTitle: {
    flex: 1,
    color: palette.text,
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
  dateGroupCount: {
    color: palette.muted,
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  debtIndicator: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  debtIndicatorText: { flexShrink: 1, color: palette.purple, fontSize: 11, fontFamily: "Inter_700Bold" },
  summaryBody: { padding: 14 },
  summaryRow: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  summaryLabel: {
    color: palette.textSecondary,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  summaryValue: { fontSize: 12, fontFamily: "Inter_700Bold" },
  summaryDivider: {
    height: 1,
    backgroundColor: palette.borderSoft,
    marginVertical: 5,
  },
  spendingBody: { padding: 14 },
  spendingRow: {
    minHeight: 25,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  spendingLabel: {
    flex: 1,
    color: palette.textSecondary,
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  spendingAmount: {
    color: palette.text,
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  spendingPercent: {
    width: 28,
    textAlign: "right",
    color: palette.muted,
    fontSize: 11,
  },
  emptyTiny: {
    color: palette.muted,
    fontSize: 12,
    textAlign: "center",
    paddingVertical: 18,
  },
  pressed: { opacity: 0.68 },
});
