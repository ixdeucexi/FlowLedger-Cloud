import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  useWindowDimensions,
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
  desktopPalette as palette,
  desktopTableStyles as table,
} from "@/components/desktop/DesktopUI";
import { DataFreshnessLabel } from "@/components/DataFreshnessLabel";
import { exportActivityCsv } from "@/lib/activityCsv";
import {
  countsInDisplayedCashFlow,
  groupDisplayedActivityByDate,
  summarizeDisplayedActivity,
} from "@/lib/desktopActivity";

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
  countsInCashFlow: boolean;
  detail?: string;
  accountName?: string;
  note?: string;
  debtName?: string;
  runningBalance?: number;
};

type Summary = {
  title: string;
  income: number;
  out: number;
  net: number;
  transactions?: number;
};
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
  exportActivityCsv(
    rows.map((row) => ({
      date: row.date,
      description: row.label,
      category: row.category,
      account: row.accountName,
      amount: row.amount,
      type: sourceLabel(row.source),
      appliedDebt: row.debtName,
      note: row.note,
      runningBalance: row.runningBalance,
    })),
  );
}

export function DesktopActivityPage({
  rows,
  summary,
  summaryIsPartial,
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
  summaryIsPartial: boolean;
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
  const { width } = useWindowDimensions();
  const stackInsights = width < 1200;
  const stackHero = width < 1100;
  const [tab, setTab] = useState<ActivityTab>("All Activity");
  const [account, setAccount] = useState("All Accounts");
  const [sortBy, setSortBy] = useState<
    "date" | "description" | "category" | "account" | "amount" | "type"
  >("date");
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
          const leftValue =
            sortBy === "date"
              ? left.date
              : sortBy === "description"
                ? left.label
                : sortBy === "category"
                  ? left.category
                  : sortBy === "account"
                    ? (left.accountName ?? "")
                    : sortBy === "amount"
                      ? left.amount
                      : sourceLabel(left.source);
          const rightValue =
            sortBy === "date"
              ? right.date
              : sortBy === "description"
                ? right.label
                : sortBy === "category"
                  ? right.category
                  : sortBy === "account"
                    ? (right.accountName ?? "")
                    : sortBy === "amount"
                      ? right.amount
                      : sourceLabel(right.source);
          return typeof leftValue === "number" && typeof rightValue === "number"
            ? (leftValue - rightValue) * direction
            : String(leftValue).localeCompare(String(rightValue)) * direction;
        }),
    [account, rows, sortBy, sortDirection, tab],
  );
  const groupedActivity = useMemo(
    () => groupDisplayedActivityByDate(filtered, sortBy === "date"),
    [filtered, sortBy],
  );
  const hasLocalDisplayFilters =
    tab !== "All Activity" || account !== "All Accounts";

  const visibleSummary = useMemo(
    () =>
      !hasLocalDisplayFilters
        ? summary
        : {
            title: "Visible activity",
            ...summarizeDisplayedActivity(filtered),
          },
    [filtered, hasLocalDisplayFilters, summary],
  );
  const visibleSummaryIsPartial =
    summaryIsPartial || (hasMore && hasLocalDisplayFilters);

  const spending = useMemo(() => {
    const totals = new Map<string, number>();
    filtered
      .filter(
        (row) =>
          row.amount < 0 &&
          !row.pending &&
          countsInDisplayedCashFlow(row),
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
  }, [filtered]);

  const toggleSort = (column: typeof sortBy) => {
    if (sortBy === column)
      setSortDirection((value) => (value === "asc" ? "desc" : "asc"));
    else {
      setSortBy(column);
      setSortDirection(
        column === "date" || column === "amount" ? "desc" : "asc",
      );
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
          description="Track every dollar in and out, then review what needs attention."
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
        <DesktopCard style={styles.flowHero}>
          <View style={styles.flowHeroHeader}>
            <View style={styles.flowHeroHeading}>
              <Text style={styles.flowEyebrow}>
                {visibleSummaryIsPartial ? "LOADED TOTALS" : "CASH FLOW"}
              </Text>
              <Text style={styles.flowTitle}>{visibleSummary.title}</Text>
            </View>
            <StatusBadge
              label={
                visibleSummary.net >= 0 ? "Positive flow" : "Outflows higher"
              }
              tone={visibleSummary.net >= 0 ? "green" : "red"}
            />
          </View>
          <View
            style={StyleSheet.flatten([
              styles.flowHeroBody,
              stackHero && styles.flowHeroBodyStack,
            ])}
          >
            <View
              style={StyleSheet.flatten([
                styles.netFlowBlockBase,
                stackHero ? styles.netFlowBlockStack : styles.netFlowBlock,
              ])}
            >
              <Text style={styles.netFlowLabel}>NET MOVEMENT</Text>
              <Text
                style={[
                  styles.netFlowValue,
                  {
                    color:
                      visibleSummary.net >= 0 ? palette.green : palette.red,
                  },
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {money(visibleSummary.net, true)}
              </Text>
              <Text style={styles.netFlowDetail}>
                Income after bills and spending
              </Text>
            </View>
            <View
              style={StyleSheet.flatten([
                styles.flowSupportGridBase,
                stackHero
                  ? styles.flowSupportGridStack
                  : styles.flowSupportGrid,
              ])}
            >
              <View style={styles.flowSupportCard}>
                <View
                  style={[
                    styles.flowSupportIcon,
                    { backgroundColor: palette.greenSoft },
                  ]}
                >
                  <Feather
                    name="arrow-down-left"
                    size={17}
                    color={palette.green}
                  />
                </View>
                <View style={styles.flowSupportCopy}>
                  <Text style={styles.flowSupportLabel}>INFLOWS</Text>
                  <Text
                    style={[styles.flowSupportValue, { color: palette.green }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.72}
                  >
                    {money(visibleSummary.income)}
                  </Text>
                </View>
              </View>
              <View style={styles.flowSupportCard}>
                <View
                  style={[
                    styles.flowSupportIcon,
                    { backgroundColor: palette.redSoft },
                  ]}
                >
                  <Feather
                    name="arrow-up-right"
                    size={17}
                    color={palette.red}
                  />
                </View>
                <View style={styles.flowSupportCopy}>
                  <Text style={styles.flowSupportLabel}>OUTFLOWS</Text>
                  <Text
                    style={[styles.flowSupportValue, { color: palette.red }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.72}
                  >
                    {money(visibleSummary.out)}
                  </Text>
                </View>
              </View>
              <View style={styles.flowSupportCard}>
                <View
                  style={[
                    styles.flowSupportIcon,
                    { backgroundColor: palette.blueSoft },
                  ]}
                >
                  <Feather name="file-text" size={17} color={palette.blue} />
                </View>
                <View style={styles.flowSupportCopy}>
                  <Text style={styles.flowSupportLabel}>ENTRIES</Text>
                  <Text style={styles.flowSupportValue} numberOfLines={1}>
                    {visibleSummary.transactions ??
                      filtered.filter((row) => !row.pending).length}
                  </Text>
                </View>
              </View>
            </View>
          </View>
          {visibleSummaryIsPartial ? (
            <View style={styles.partialSummaryNotice}>
              <Feather name="info" size={14} color={palette.amber} />
              <Text style={styles.partialSummaryText}>
                {hasLocalDisplayFilters
                  ? "These totals cover loaded activity matching this view. Load more for the full range."
                  : "These totals cover loaded activity. Load more to extend the range."}
              </Text>
            </View>
          ) : null}
        </DesktopCard>
        <View style={styles.tabs} accessibilityRole="tablist">
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
              aria-selected={tab === item}
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
        <View
          style={StyleSheet.flatten([
            styles.mainRow,
            stackInsights && styles.mainRowStack,
          ])}
        >
          <DesktopCard
            style={StyleSheet.flatten([
              styles.activityCardBase,
              stackInsights ? styles.activityCardStack : styles.activityCard,
            ])}
          >
            <CardHeader
              title="Recent Activity"
              action={
                <StatusBadge label={`${filtered.length} shown`} tone="gray" />
              }
            />
            <View nativeID="guided-tour-transactions" style={styles.filters}>
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
                label={
                  categoryFilter === "all" ? "All Categories" : categoryFilter
                }
                onPress={onCategoryPress}
                active={categoryFilter !== "all"}
              />
              <FilterButton
                label={
                  typeFilter === "all"
                    ? "All Types"
                    : typeFilter === "income"
                      ? "Inflows"
                      : "Outflows"
                }
                onPress={onTypePress}
                active={typeFilter !== "all"}
              />
              {hasActiveFilters ? (
                <SecondaryButton
                  label="Reset"
                  icon="x"
                  onPress={onResetFilters}
                />
              ) : null}
            </View>
            {hasMore ? (
              <View style={styles.loadedScopeNotice}>
                <Feather name="info" size={13} color={palette.blue} />
                <Text style={styles.loadedScopeText}>
                  Sorting and view filters apply to loaded activity. Load more
                  for the full range.
                </Text>
              </View>
            ) : null}
            <View style={table.header}>
              <SortHeader
                label="Date"
                column="date"
                style={styles.colDate}
                active={sortBy === "date"}
                direction={sortDirection}
                onPress={toggleSort}
              />
              <SortHeader
                label="Description"
                column="description"
                style={styles.colDescription}
                active={sortBy === "description"}
                direction={sortDirection}
                onPress={toggleSort}
              />
              <SortHeader
                label="Category"
                column="category"
                style={styles.colCategory}
                active={sortBy === "category"}
                direction={sortDirection}
                onPress={toggleSort}
              />
              <SortHeader
                label="Account"
                column="account"
                style={styles.colAccount}
                active={sortBy === "account"}
                direction={sortDirection}
                onPress={toggleSort}
              />
              <SortHeader
                label="Amount"
                column="amount"
                style={styles.colAmount}
                active={sortBy === "amount"}
                direction={sortDirection}
                onPress={toggleSort}
              />
              <SortHeader
                label="Type"
                column="type"
                style={styles.colType}
                active={sortBy === "type"}
                direction={sortDirection}
                onPress={toggleSort}
              />
              <Text style={[table.headerText, styles.colAction]} />
            </View>
            {filtered.length ? (
              groupedActivity.map((group) => (
                <View key={group.date || `sorted-${sortBy}`}>
                  {group.date ? (
                    <View style={styles.dateGroupHeader}>
                      <Text style={styles.dateGroupTitle}>
                        {dateGroupLabel(group.date)}
                      </Text>
                      <Text style={styles.dateGroupCount}>
                        {group.rows.length}{" "}
                        {group.rows.length === 1
                          ? "transaction"
                          : "transactions"}
                      </Text>
                    </View>
                  ) : null}
                  {group.rows.map((row) => (
                    <Pressable
                      key={row.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${row.label}, ${dateLabel(row.date)}, ${row.category}, ${money(row.amount, true)}${row.pending ? ", pending" : ""}`}
                      onPress={() => onOpen(row.id)}
                      style={({ pressed }) => [
                        table.row,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[table.cellText, styles.colDate]}>
                        {dateLabel(row.date)}
                      </Text>
                      <View
                        style={[styles.colDescription, styles.descriptionCell]}
                      >
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
                            color={
                              row.amount >= 0 ? palette.green : palette.purple
                            }
                          />
                        </View>
                        <View style={styles.descriptionCopy}>
                          <Text style={table.cellStrong} numberOfLines={1}>
                            {row.label}
                          </Text>
                          {row.debtName ? (
                            <View style={styles.debtIndicator}>
                              <Feather
                                name="credit-card"
                                size={9}
                                color={palette.purple}
                              />
                              <Text
                                style={styles.debtIndicatorText}
                                numberOfLines={1}
                              >
                                Applied to {row.debtName}
                              </Text>
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
                            {
                              color:
                                row.amount >= 0 ? palette.green : palette.red,
                            },
                          ]}
                        >
                          {money(row.amount, true)}
                        </Text>
                        {row.runningBalance != null ? (
                          <Text style={styles.runningBalance}>
                            Balance {money(row.runningBalance)}
                          </Text>
                        ) : null}
                      </View>
                      <View style={styles.colType}>
                        <StatusBadge
                          label={
                            row.pending ? "Pending" : sourceLabel(row.source)
                          }
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
                <SecondaryButton
                  label="Retry"
                  icon="refresh-cw"
                  onPress={onLoadMore}
                />
              </View>
            ) : hasMore ? (
              <View style={styles.loadMoreState}>
                <SecondaryButton
                  label={loadingMore ? "Loading…" : "Load more"}
                  icon="chevron-down"
                  onPress={onLoadMore}
                />
              </View>
            ) : null}
          </DesktopCard>
          <View
            style={StyleSheet.flatten([
              styles.insightsColumnBase,
              stackInsights && styles.insightsColumnStack,
              !stackInsights && styles.insightsColumn,
            ])}
          >
            <DesktopCard>
              <CardHeader title="Spending Mix" />
              <View style={styles.spendingBody}>
                {spending.length ? (
                  spending.map((item) => (
                    <View key={item.label} style={styles.spendingItem}>
                      <View style={styles.spendingRow}>
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
                      <View style={styles.spendingTrack}>
                        <View
                          style={[
                            styles.spendingFill,
                            {
                              backgroundColor: item.color,
                              width:
                                `${Math.max(3, item.percent)}%` as `${number}%`,
                            },
                          ]}
                        />
                      </View>
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
  onPress: (
    column: "date" | "description" | "category" | "account" | "amount" | "type",
  ) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        active
          ? `Sort by ${label}, currently ${direction === "asc" ? "ascending" : "descending"}`
          : `Sort by ${label}`
      }
      onPress={() => onPress(column)}
      style={[style, styles.sortHeader]}
    >
      <Text style={table.headerText}>{label}</Text>
      {active ? (
        <Feather
          name={direction === "asc" ? "chevron-up" : "chevron-down"}
          size={12}
          color={palette.purple}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pageScroll: { flex: 1, margin: -22 },
  pageContent: { padding: 22 },
  flowHero: { padding: 20, marginBottom: 14, borderRadius: 16 },
  flowHeroHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
    marginBottom: 18,
  },
  flowHeroHeading: { flex: 1, minWidth: 0 },
  flowEyebrow: {
    color: palette.purple,
    fontSize: 10,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 1,
  },
  flowTitle: {
    color: palette.text,
    fontSize: 20,
    fontFamily: "Inter_800ExtraBold",
    marginTop: 4,
  },
  flowHeroBody: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 18,
  },
  flowHeroBodyStack: { flexDirection: "column" },
  netFlowBlockBase: {
    minWidth: 240,
    justifyContent: "center",
    paddingRight: 18,
    borderRightWidth: 1,
    borderRightColor: palette.borderSoft,
  },
  netFlowBlock: { flex: 1.05 },
  netFlowBlockStack: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "auto",
    minWidth: 0,
    paddingRight: 0,
    paddingBottom: 16,
    borderRightWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
    minHeight: 96,
  },
  netFlowLabel: {
    color: palette.muted,
    fontSize: 10,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.8,
  },
  netFlowValue: {
    fontSize: 38,
    lineHeight: 46,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -1.1,
    marginTop: 3,
  },
  netFlowDetail: {
    color: palette.textSecondary,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
  },
  flowSupportGridBase: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },
  flowSupportGrid: { flex: 2 },
  flowSupportGridStack: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "auto",
    width: "100%",
  },
  flowSupportCard: {
    flex: 1,
    minWidth: 0,
    minHeight: 96,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 13,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: 13,
    backgroundColor: palette.surfaceMuted,
  },
  flowSupportIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  flowSupportCopy: { flex: 1, minWidth: 0 },
  flowSupportLabel: {
    color: palette.muted,
    fontSize: 9,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.7,
  },
  flowSupportValue: {
    color: palette.text,
    fontSize: 17,
    fontFamily: "Inter_800ExtraBold",
    marginTop: 3,
  },
  partialSummaryNotice: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: palette.amberSoft,
  },
  partialSummaryText: {
    flex: 1,
    color: palette.textSecondary,
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  tabs: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 14,
    marginBottom: 12,
    padding: 4,
    backgroundColor: palette.surfaceMuted,
  },
  tab: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  tabActive: { backgroundColor: palette.purple },
  tabText: {
    color: palette.muted,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  tabTextActive: { color: "#ffffff", fontFamily: "Inter_700Bold" },
  mainRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  mainRowStack: { flexDirection: "column" },
  activityCardBase: {
    minWidth: 0,
    overflow: "hidden",
  },
  activityCard: { flex: 2.2 },
  activityCardStack: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "auto",
    width: "100%",
  },
  insightsColumnBase: { minWidth: 240, gap: 12 },
  insightsColumn: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  insightsColumnStack: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "auto",
    width: "100%",
    minWidth: 0,
  },
  filters: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    padding: 10,
    flexWrap: "wrap",
  },
  loadedScopeNotice: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
    backgroundColor: palette.blueSoft,
  },
  loadedScopeText: {
    flex: 1,
    color: palette.textSecondary,
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
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
  loadMoreState: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 12,
  },
  loadMoreError: {
    color: palette.red,
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  runningBalance: {
    color: palette.muted,
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
  },
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
  debtIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 2,
  },
  debtIndicatorText: {
    flexShrink: 1,
    color: palette.purple,
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  spendingBody: { padding: 14 },
  spendingItem: { marginBottom: 13 },
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
  spendingTrack: {
    height: 5,
    marginTop: 7,
    marginLeft: 14,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: palette.surfaceMuted,
  },
  spendingFill: { height: "100%", borderRadius: 999 },
  emptyTiny: {
    color: palette.muted,
    fontSize: 12,
    textAlign: "center",
    paddingVertical: 18,
  },
  pressed: { opacity: 0.68 },
});
