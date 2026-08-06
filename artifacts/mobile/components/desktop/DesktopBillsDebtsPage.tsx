import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AddBillModal } from "@/components/AddBillModal";
import {
  CardHeader,
  DesktopCard,
  DesktopPage,
  DesktopSearch,
  EmptyState,
  FilterButton,
  PageHeader,
  PrimaryButton,
  StatusBadge,
  SummaryMetricCard,
  Toggle,
  desktopPalette as palette,
  desktopTableStyles as table,
} from "@/components/desktop/DesktopUI";
import type { Bill } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { orderActiveDebtsForStrategy } from "@/lib/debtOrder";
import { effectiveDebtMinimum } from "@/lib/snowball";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CATEGORY_COLORS = [
  "#6d3bea",
  "#1570ef",
  "#039855",
  "#dc6803",
  "#d92d20",
  "#7f56d9",
  "#0e9384",
];

function money(value: number) {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function displayDate(year: number, month: number, day: number) {
  return new Date(year, month, day, 12).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function frequencyLabel(bill: Bill) {
  if (!bill.is_recurring) return "One-time";
  if (bill.frequency === "quarterly") return "Every 3 months";
  return bill.frequency.charAt(0).toUpperCase() + bill.frequency.slice(1);
}

function nextOccurrenceFor(
  bill: Bill,
  getOccurrences: (bill: Bill, month: number, year: number) => number[],
  from = new Date(),
) {
  const today = new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate(),
    12,
  );
  for (let offset = 0; offset < 72; offset += 1) {
    const absolute = from.getMonth() + offset;
    const month = absolute % 12;
    const year = from.getFullYear() + Math.floor(absolute / 12);
    for (const day of getOccurrences(bill, month, year)) {
      const date = new Date(year, month, day, 12);
      if (date >= today)
        return { day, month, year, date, iso: isoDate(year, month, day) };
    }
  }
  return null;
}

type BillRow = {
  bill: Bill;
  day: number;
  month: number;
  year: number;
  date: Date;
  iso: string;
  amount: number;
  paid: number;
};

export function DesktopBillsDebtsPage() {
  const params = useLocalSearchParams<{ view?: string }>();
  const router = useRouter();
  const {
    bills,
    addBill,
    updateBill,
    stopFutureBill,
    deleteBill,
    deleteBillMistake,
    settings,
    updateSettings,
    getMonthlyBills,
    getBillOccurrencesInMonth,
    getBillMonthlyTotal,
    getBillEffectiveMonthlyTotal,
    getPaidAmount,
    previewDebtSnowball,
  } = useBudget();
  const isDebt = params.view === "debt";
  const now = useMemo(() => new Date(), []);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All Categories");
  const [statusFilter, setStatusFilter] = useState("All Status");
  const [showPaid, setShowPaid] = useState(true);
  const [billTab, setBillTab] = useState("Overview");
  const [debtSort, setDebtSort] = useState<"snowball" | "balance" | "interest">(
    "snowball",
  );
  const [calendarCursor, setCalendarCursor] = useState({
    month: now.getMonth(),
    year: now.getFullYear(),
  });

  const nonDebtBills = useMemo(
    () => bills.filter((bill) => !bill.is_debt && !bill.end_date),
    [bills],
  );
  const debtBills = useMemo(
    () => bills.filter((bill) => bill.is_debt),
    [bills],
  );
  const currentMonthBills = useMemo(
    () =>
      getMonthlyBills(now.getMonth(), now.getFullYear()).filter(
        (bill) => !bill.is_debt,
      ),
    [getMonthlyBills, now],
  );

  const currentRows = useMemo<BillRow[]>(
    () =>
      currentMonthBills
        .flatMap((bill) => {
          const days = getBillOccurrencesInMonth(
            bill,
            now.getMonth(),
            now.getFullYear(),
          );
          if (!days.length) return [];
          const total = getBillMonthlyTotal(
            bill,
            now.getMonth(),
            now.getFullYear(),
          );
          const paid = getPaidAmount(
            bill.id,
            now.getMonth(),
            now.getFullYear(),
          );
          return days.map((day) => ({
            bill,
            day,
            month: now.getMonth(),
            year: now.getFullYear(),
            date: new Date(now.getFullYear(), now.getMonth(), day, 12),
            iso: isoDate(now.getFullYear(), now.getMonth(), day),
            amount: total / days.length,
            paid: paid / days.length,
          }));
        })
        .sort((left, right) => left.date.getTime() - right.date.getTime()),
    [
      currentMonthBills,
      getBillMonthlyTotal,
      getBillOccurrencesInMonth,
      getPaidAmount,
      now,
    ],
  );

  const upcomingRows = useMemo<BillRow[]>(
    () =>
      nonDebtBills
        .flatMap((bill) => {
          const next = nextOccurrenceFor(bill, getBillOccurrencesInMonth, now);
          if (!next) return [];
          const occurrences = getBillOccurrencesInMonth(
            bill,
            next.month,
            next.year,
          );
          const total = getBillMonthlyTotal(bill, next.month, next.year);
          const paid = getPaidAmount(bill.id, next.month, next.year);
          return [
            {
              bill,
              ...next,
              amount: occurrences.length ? total / occurrences.length : total,
              paid: occurrences.length ? paid / occurrences.length : paid,
            },
          ];
        })
        .sort((left, right) => left.date.getTime() - right.date.getTime()),
    [
      getBillMonthlyTotal,
      getBillOccurrencesInMonth,
      getPaidAmount,
      nonDebtBills,
      now,
    ],
  );

  const totalMonthly = currentRows.reduce((sum, row) => sum + row.amount, 0);
  const paidThisMonth = currentRows.reduce(
    (sum, row) => sum + Math.min(row.amount, row.paid),
    0,
  );
  const sevenDays = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 7,
    23,
    59,
  );
  const dueNextSeven = upcomingRows.filter(
    (row) => row.date <= sevenDays && row.paid + 0.005 < row.amount,
  );
  const remainingThisMonth = currentRows.reduce(
    (sum, row) => sum + Math.max(0, row.amount - row.paid),
    0,
  );

  const categories = useMemo(
    () => Array.from(new Set(nonDebtBills.map((bill) => bill.category))).sort(),
    [nonDebtBills],
  );
  const filteredBillRows = useMemo(
    () =>
      upcomingRows.filter((row) => {
        const query = search.trim().toLowerCase();
        const status =
          row.paid + 0.005 >= row.amount
            ? "Paid"
            : row.date < now
              ? "Overdue"
              : "Upcoming";
        return (
          (!query ||
            row.bill.name.toLowerCase().includes(query) ||
            row.bill.category.toLowerCase().includes(query)) &&
          (categoryFilter === "All Categories" ||
            row.bill.category === categoryFilter) &&
          (statusFilter === "All Status" || status === statusFilter) &&
          (showPaid || status !== "Paid")
        );
      }),
    [categoryFilter, now, search, showPaid, statusFilter, upcomingRows],
  );

  const openBill = useCallback((bill: Bill | null) => {
    setEditingBill(bill);
    setModalVisible(true);
  }, []);

  const saveBill = useCallback(
    (data: Omit<Bill, "id" | "created_at"> | Bill) => {
      if ("id" in data) return updateBill(data);
      return addBill(data);
    },
    [addBill, updateBill],
  );

  const nextCategoryFilter = () => {
    const options = ["All Categories", ...categories];
    setCategoryFilter(
      options[(options.indexOf(categoryFilter) + 1) % options.length],
    );
  };

  const nextStatusFilter = () => {
    const options = ["All Status", "Upcoming", "Paid", "Overdue"];
    setStatusFilter(
      options[(options.indexOf(statusFilter) + 1) % options.length],
    );
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
      >
        {isDebt ? (
          <DebtsDesktop
            bills={debtBills}
            search={search}
            onSearch={setSearch}
            sort={debtSort}
            onSort={setDebtSort}
            snowball={settings.paymentMethod === "snowball"}
            onSnowball={(value) =>
              void updateSettings({
                paymentMethod: value ? "snowball" : "avalanche",
              })
            }
            onAdd={() => openBill(null)}
            onOpen={openBill}
            onPlan={() => router.push("/snowball-plan" as never)}
            getOccurrences={getBillOccurrencesInMonth}
            preview={previewDebtSnowball(now.getMonth(), now.getFullYear())}
            now={now}
          />
        ) : (
          <DesktopPage style={styles.pageReset}>
            <PageHeader
              title="Bills"
              description="Manage your bills and never miss a payment."
              actions={
                <PrimaryButton
                  label="Add Bill"
                  onPress={() => openBill(null)}
                />
              }
            />
            <View style={styles.tabs}>
              {[
                "Overview",
                "All Bills",
                "By Category",
                "Calendar",
                "Upcoming",
              ].map((tabName) => (
                <Pressable
                  key={tabName}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: billTab === tabName }}
                  onPress={() => setBillTab(tabName)}
                  style={[styles.tab, billTab === tabName && styles.tabActive]}
                >
                  <Text
                    style={[
                      styles.tabText,
                      billTab === tabName && styles.tabTextActive,
                    ]}
                  >
                    {tabName}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.metrics}>
              <SummaryMetricCard
                label="Total Monthly Bills"
                value={money(totalMonthly)}
                detail={`${currentMonthBills.length} bills`}
                icon="credit-card"
              />
              <SummaryMetricCard
                label="Due in Next 7 Days"
                value={money(
                  dueNextSeven.reduce(
                    (sum, row) => sum + Math.max(0, row.amount - row.paid),
                    0,
                  ),
                )}
                detail={`${dueNextSeven.length} bills`}
                icon="calendar"
                tone="red"
              />
              <SummaryMetricCard
                label="Paid This Month"
                value={money(paidThisMonth)}
                detail={`${currentRows.filter((row) => row.paid + 0.005 >= row.amount).length} payments`}
                icon="check-circle"
                tone="green"
              />
              <SummaryMetricCard
                label="Remaining This Month"
                value={money(remainingThisMonth)}
                detail={`${currentRows.filter((row) => row.paid + 0.005 < row.amount).length} payments`}
                icon="pie-chart"
              />
            </View>
            {billTab === "Overview" ||
            billTab === "Upcoming" ||
            billTab === "Calendar" ? (
              <View style={styles.billOverviewRow}>
                {billTab !== "Calendar" ? (
                  <UpcomingBills
                    rows={
                      billTab === "Upcoming"
                        ? upcomingRows
                        : upcomingRows.slice(0, 6)
                    }
                    onOpen={openBill}
                    onViewAll={
                      billTab === "Overview"
                        ? () => setBillTab("Upcoming")
                        : undefined
                    }
                  />
                ) : null}
                {billTab === "Calendar" ? (
                  <BillCalendar
                    cursor={calendarCursor}
                    onPrevious={() =>
                      setCalendarCursor((previous) =>
                        previous.month === 0
                          ? { month: 11, year: previous.year - 1 }
                          : { month: previous.month - 1, year: previous.year },
                      )
                    }
                    onNext={() =>
                      setCalendarCursor((previous) =>
                        previous.month === 11
                          ? { month: 0, year: previous.year + 1 }
                          : { month: previous.month + 1, year: previous.year },
                      )
                    }
                    bills={getMonthlyBills(
                      calendarCursor.month,
                      calendarCursor.year,
                    ).filter((bill) => !bill.is_debt)}
                    getOccurrences={getBillOccurrencesInMonth}
                    getTotal={getBillEffectiveMonthlyTotal}
                    getPaid={getPaidAmount}
                    onOpenDate={(date) =>
                      router.push({
                        pathname: "/(tabs)/monthly",
                        params: {
                          openDate: date,
                          openDateAt: String(Date.now()),
                        },
                      } as never)
                    }
                  />
                ) : null}
              </View>
            ) : null}
            {billTab !== "Calendar" && billTab !== "Upcoming" ? (
              <BillsTable
                rows={filteredBillRows}
                search={search}
                onSearch={setSearch}
                category={categoryFilter}
                onCategory={nextCategoryFilter}
                status={statusFilter}
                onStatus={nextStatusFilter}
                showPaid={showPaid}
                onShowPaid={setShowPaid}
                onOpen={openBill}
              />
            ) : null}
          </DesktopPage>
        )}
      </ScrollView>
      <AddBillModal
        visible={modalVisible}
        onClose={() => {
          setModalVisible(false);
          setEditingBill(null);
        }}
        onSave={saveBill}
        onDelete={deleteBill}
        onStopFuture={stopFutureBill}
        onDeleteMistake={deleteBillMistake}
        editBill={editingBill}
        forceDebt={isDebt}
      />
    </View>
  );
}

function UpcomingBills({
  rows,
  onOpen,
  onViewAll,
}: {
  rows: BillRow[];
  onOpen: (bill: Bill) => void;
  onViewAll?: () => void;
}) {
  return (
    <DesktopCard style={styles.overviewCard}>
      <CardHeader
        title="Upcoming Bills"
        action={
          onViewAll ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="View all upcoming bills"
              onPress={onViewAll}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text style={styles.textLink}>View all</Text>
            </Pressable>
          ) : undefined
        }
      />
      {rows.length ? (
        <>
          <View style={styles.upcomingTableHeader}>
            <Text style={[styles.upcomingHeaderText, styles.upcomingHeaderBill]}>Bill</Text>
            <Text style={[styles.upcomingHeaderText, styles.upcomingDate]}>Due date</Text>
            <Text style={[styles.upcomingHeaderText, styles.upcomingAmountColumn]}>Amount</Text>
            <Text style={[styles.upcomingHeaderText, styles.upcomingStatusColumn]}>Status</Text>
          </View>
          {rows.map((row) => {
            const paid = row.paid + 0.005 >= row.amount;
            return (
              <Pressable
                key={`${row.bill.id}-${row.iso}`}
                onPress={() => onOpen(row.bill)}
                style={({ pressed }) => [
                  styles.upcomingRow,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.upcomingBillCell}>
                  <View style={styles.billIcon}>
                    <Feather name="file-text" size={15} color={palette.purple} />
                  </View>
                  <View style={styles.upcomingName}>
                    <Text style={styles.rowStrong} numberOfLines={1}>{row.bill.name}</Text>
                    <Text style={styles.rowMuted} numberOfLines={1}>{row.bill.category}</Text>
                  </View>
                </View>
                <View style={styles.upcomingDate}>
                  <Text style={styles.rowText}>
                    {displayDate(row.year, row.month, row.day)}
                  </Text>
                </View>
                <Text style={[styles.upcomingAmount, styles.upcomingAmountColumn]}>{money(row.amount)}</Text>
                <View style={styles.upcomingStatusColumn}>
                  <StatusBadge
                    label={paid ? "Paid" : "Upcoming"}
                    tone={paid ? "green" : "purple"}
                  />
                </View>
              </Pressable>
            );
          })}
        </>
      ) : (
        <EmptyState
          title="No upcoming bills"
          message="Add a bill to start building your schedule."
        />
      )}
    </DesktopCard>
  );
}

function BillCalendar({
  cursor,
  onPrevious,
  onNext,
  bills,
  getOccurrences,
  getTotal,
  getPaid,
  onOpenDate,
}: {
  cursor: { month: number; year: number };
  onPrevious: () => void;
  onNext: () => void;
  bills: Bill[];
  getOccurrences: (bill: Bill, month: number, year: number) => number[];
  getTotal: (bill: Bill, month: number, year: number) => number;
  getPaid: (billId: string, month: number, year: number) => number;
  onOpenDate: (date: string) => void;
}) {
  const firstDay = new Date(cursor.year, cursor.month, 1).getDay();
  const days = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const entries = useMemo(() => {
    const map = new Map<number, { amount: number; paid: boolean }>();
    bills.forEach((bill) => {
      const occurrenceDays = getOccurrences(bill, cursor.month, cursor.year);
      const perOccurrence = occurrenceDays.length
        ? getTotal(bill, cursor.month, cursor.year) / occurrenceDays.length
        : 0;
      const paidPer = occurrenceDays.length
        ? getPaid(bill.id, cursor.month, cursor.year) / occurrenceDays.length
        : 0;
      occurrenceDays.forEach((day) => {
        const existing = map.get(day) ?? { amount: 0, paid: true };
        map.set(day, {
          amount: existing.amount + perOccurrence,
          paid: existing.paid && paidPer + 0.005 >= perOccurrence,
        });
      });
    });
    return map;
  }, [bills, cursor.month, cursor.year, getOccurrences, getPaid, getTotal]);
  return (
    <DesktopCard style={styles.overviewCard}>
      <CardHeader
        title={`${MONTHS[cursor.month]} ${cursor.year}`}
        action={
          <View style={styles.calendarActions}>
            <Pressable onPress={onPrevious} style={styles.chevron}>
              <Feather name="chevron-left" size={16} color={palette.muted} />
            </Pressable>
            <Pressable onPress={onNext} style={styles.chevron}>
              <Feather name="chevron-right" size={16} color={palette.muted} />
            </Pressable>
          </View>
        }
      />
      <View style={styles.weekHeader}>
        {WEEKDAYS.map((day) => (
          <Text key={day} style={styles.weekday}>
            {day}
          </Text>
        ))}
      </View>
      <View style={styles.calendarGrid}>
        {Array.from({ length: 42 }, (_, index) => {
          const day = index - firstDay + 1;
          const entry = day >= 1 && day <= days ? entries.get(day) : undefined;
          return (
            <Pressable
              key={index}
              disabled={day < 1 || day > days}
              onPress={() =>
                onOpenDate(isoDate(cursor.year, cursor.month, day))
              }
              style={({ pressed }) => [
                styles.calendarCell,
                pressed && styles.pressed,
              ]}
            >
              {day >= 1 && day <= days ? (
                <>
                  <Text style={styles.calendarDay}>{day}</Text>
                  {entry ? (
                    <Text
                      style={[
                        styles.calendarAmount,
                        { color: entry.paid ? palette.green : palette.purple },
                      ]}
                      numberOfLines={1}
                    >
                      {money(entry.amount).replace(".00", "")}
                    </Text>
                  ) : null}
                </>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.legend}>
        <View style={[styles.legendDot, { backgroundColor: palette.purple }]} />
        <Text style={styles.rowMuted}>Due</Text>
        <View style={[styles.legendDot, { backgroundColor: palette.green }]} />
        <Text style={styles.rowMuted}>Paid</Text>
      </View>
    </DesktopCard>
  );
}

function BillsTable({
  rows,
  search,
  onSearch,
  category,
  onCategory,
  status,
  onStatus,
  showPaid,
  onShowPaid,
  onOpen,
}: {
  rows: BillRow[];
  search: string;
  onSearch: (value: string) => void;
  category: string;
  onCategory: () => void;
  status: string;
  onStatus: () => void;
  showPaid: boolean;
  onShowPaid: (value: boolean) => void;
  onOpen: (bill: Bill) => void;
}) {
  return (
    <DesktopCard style={styles.tableCard}>
      <View style={styles.tableToolbar}>
        <DesktopSearch
          value={search}
          onChangeText={onSearch}
          placeholder="Search bills..."
        />
        <FilterButton
          label={category}
          onPress={onCategory}
          active={category !== "All Categories"}
        />
        <FilterButton
          label={status}
          onPress={onStatus}
          active={status !== "All Status"}
        />
        <Toggle label="Show Paid" value={showPaid} onChange={onShowPaid} />
      </View>
      <View style={table.header}>
        <Text style={[table.headerText, styles.colBill]}>Bill</Text>
        <Text style={[table.headerText, styles.colCategory]}>Category</Text>
        <Text style={[table.headerText, styles.colDate]}>Due Date</Text>
        <Text style={[table.headerText, styles.colAmount]}>Amount</Text>
        <Text style={[table.headerText, styles.colFrequency]}>Frequency</Text>
        <Text style={[table.headerText, styles.colStatus]}>Status</Text>
        <Text style={[table.headerText, styles.colActions]}>Actions</Text>
      </View>
      {rows.length ? (
        rows.map((row) => {
          const paid = row.paid + 0.005 >= row.amount;
          const overdue = !paid && row.date < new Date();
          return (
            <Pressable
              key={`${row.bill.id}-${row.iso}`}
              onPress={() => onOpen(row.bill)}
              style={({ pressed }) => [table.row, pressed && styles.pressed]}
            >
              <View style={styles.colBill}>
                <Text style={table.cellStrong}>{row.bill.name}</Text>
                <Text style={styles.rowMuted}>{row.bill.category}</Text>
              </View>
              <View style={styles.colCategory}>
                <StatusBadge label={row.bill.category} tone="green" />
              </View>
              <Text style={[table.cellText, styles.colDate]}>
                {displayDate(row.year, row.month, row.day)}
              </Text>
              <Text style={[table.cellStrong, styles.colAmount]}>
                {money(row.amount)}
              </Text>
              <Text style={[table.cellText, styles.colFrequency]}>
                {frequencyLabel(row.bill)}
              </Text>
              <View style={styles.colStatus}>
                <StatusBadge
                  label={paid ? "Paid" : overdue ? "Overdue" : "Upcoming"}
                  tone={paid ? "green" : overdue ? "red" : "purple"}
                />
              </View>
              <View style={[styles.colActions, styles.actionIcons]}>
                <Feather name="edit-2" size={14} color={palette.muted} />
                <Feather name="more-vertical" size={15} color={palette.muted} />
              </View>
            </Pressable>
          );
        })
      ) : (
        <EmptyState
          title="No bills found"
          message="Try changing your filters or add a new bill."
        />
      )}
    </DesktopCard>
  );
}

function DebtsDesktop({
  bills,
  search,
  onSearch,
  sort,
  onSort,
  snowball,
  onSnowball,
  onAdd,
  onOpen,
  onPlan,
  getOccurrences,
  preview,
  now,
}: {
  bills: Bill[];
  search: string;
  onSearch: (value: string) => void;
  sort: "snowball" | "balance" | "interest";
  onSort: (value: "snowball" | "balance" | "interest") => void;
  snowball: boolean;
  onSnowball: (value: boolean) => void;
  onAdd: () => void;
  onOpen: (bill: Bill) => void;
  onPlan: () => void;
  getOccurrences: (bill: Bill, month: number, year: number) => number[];
  preview: ReturnType<ReturnType<typeof useBudget>["previewDebtSnowball"]>;
  now: Date;
}) {
  const active = bills.filter((bill) => bill.balance > 0.005);
  const strategy = snowball ? "snowball" : "avalanche";
  const ordered = orderActiveDebtsForStrategy(active, strategy);
  const rank = new Map(ordered.map((bill, index) => [bill.id, index + 1]));
  const total = active.reduce((sum, bill) => sum + bill.balance, 0);
  const monthly = active.reduce(
    (sum, bill) =>
      sum + effectiveDebtMinimum(bill.amount, bill.snowball_minimum_boost ?? 0),
    0,
  );
  const nextDue = active
    .flatMap((bill) => {
      const next = nextOccurrenceFor(bill, getOccurrences, now);
      return next ? [{ bill, ...next }] : [];
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime())[0];
  const categories = Array.from(
    new Set(active.map((bill) => bill.category)),
  ).map((category, index) => ({
    category,
    amount: active
      .filter((bill) => bill.category === category)
      .reduce((sum, bill) => sum + bill.balance, 0),
    color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
  }));
  const filtered = active
    .filter(
      (bill) =>
        !search.trim() ||
        bill.name.toLowerCase().includes(search.trim().toLowerCase()) ||
        bill.category.toLowerCase().includes(search.trim().toLowerCase()),
    )
    .sort((left, right) => {
      if (sort === "interest")
        return (
          right.interest_rate - left.interest_rate ||
          left.balance - right.balance
        );
      if (sort === "balance") return left.balance - right.balance;
      return (rank.get(left.id) ?? 999) - (rank.get(right.id) ?? 999);
    });
  const projected = preview.debtFreeDate
    ? new Date(`${preview.debtFreeDate}-01T12:00:00`).toLocaleDateString(
        undefined,
        { month: "short", year: "numeric" },
      )
    : "Add safe extra";
  const completedCount = bills.filter((bill) => bill.balance <= 0.005).length;
  const progress = bills.length
    ? Math.round((completedCount / bills.length) * 100)
    : 0;
  return (
    <DesktopPage style={styles.pageReset}>
      <PageHeader
        title="Debts"
        description="Track and pay off your debt with purpose."
        actions={<PrimaryButton label="Add Debt" onPress={onAdd} />}
      />
      <View style={styles.metrics}>
        <SummaryMetricCard
          label="Total Due"
          value={money(total)}
          detail="All active debts combined"
          icon="credit-card"
        />
        <SummaryMetricCard
          label="Monthly Payments"
          value={money(monthly)}
          detail="Minimums and rollovers"
          icon="calendar"
          tone="green"
        />
        <SummaryMetricCard
          label="Next Due"
          value={
            nextDue
              ? displayDate(nextDue.year, nextDue.month, nextDue.day)
              : "No due date"
          }
          detail={nextDue?.bill.name ?? "No active debts"}
          icon="calendar"
          tone="red"
        />
        <SummaryMetricCard
          label="Projected Payoff"
          value={projected}
          detail={
            preview.debtFreeDate
              ? "Using your current plan"
              : "No projection yet"
          }
          icon="target"
        />
      </View>
      <View style={styles.debtOverviewRow}>
        <DesktopCard style={styles.debtOverviewCard}>
          <CardHeader
            title="Debt Snowball Progress"
            action={
              <Pressable onPress={onPlan}>
                <Text style={styles.textLink}>Open plan</Text>
              </Pressable>
            }
          />
          <View style={styles.progressBody}>
            <View style={styles.progressCopy}>
              <Text style={styles.progressTitle}>
                {snowball
                  ? "Pay off your smallest debt first."
                  : "Pay off your highest-rate debt first."}
              </Text>
              <Text style={styles.progressPercent}>{progress}% complete</Text>
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${progress}%` as never },
                ]}
              />
            </View>
            <View style={styles.progressLabels}>
              <Text style={styles.rowMuted}>{completedCount} paid off</Text>
              <Text style={styles.rowMuted}>{active.length} remaining</Text>
            </View>
          </View>
        </DesktopCard>
        <DesktopCard style={styles.debtOverviewCard}>
          <CardHeader title="Debt Breakdown" />
          <View style={styles.breakdownBody}>
            <View style={styles.breakdownBar}>
              {categories.map((item) => (
                <View
                  key={item.category}
                  style={{
                    flex: total > 0 ? item.amount / total : 1,
                    backgroundColor: item.color,
                  }}
                />
              ))}
            </View>
            {categories.slice(0, 5).map((item) => (
              <View key={item.category} style={styles.breakdownRow}>
                <View
                  style={[styles.legendDot, { backgroundColor: item.color }]}
                />
                <Text style={[styles.rowText, { flex: 1 }]}>
                  {item.category}
                </Text>
                <Text style={styles.rowStrong}>{money(item.amount)}</Text>
                <Text style={styles.breakdownPct}>
                  {total ? Math.round((item.amount / total) * 100) : 0}%
                </Text>
              </View>
            ))}
          </View>
        </DesktopCard>
      </View>
      <DesktopCard style={styles.tableCard}>
        <View style={styles.tableToolbar}>
          <DesktopSearch
            value={search}
            onChangeText={onSearch}
            placeholder="Search debts..."
          />
          <FilterButton
            label={
              sort === "snowball"
                ? "Snowball order"
                : sort === "balance"
                  ? "Lowest balance"
                  : "Highest interest"
            }
            onPress={() =>
              onSort(
                sort === "snowball"
                  ? "balance"
                  : sort === "balance"
                    ? "interest"
                    : "snowball",
              )
            }
            active={sort !== "snowball"}
          />
          <View style={styles.toolbarSpacer} />
          <Toggle
            label="Snowball Order"
            value={snowball}
            onChange={onSnowball}
          />
        </View>
        <View style={table.header}>
          <Text style={[table.headerText, styles.debtColName]}>Debt</Text>
          <Text style={[table.headerText, styles.debtColCategory]}>
            Category
          </Text>
          <Text style={[table.headerText, styles.debtColBalance]}>Balance</Text>
          <Text style={[table.headerText, styles.debtColApr]}>
            Interest Rate
          </Text>
          <Text style={[table.headerText, styles.debtColMinimum]}>
            Min. Payment
          </Text>
          <Text style={[table.headerText, styles.debtColDue]}>Due Date</Text>
          <Text style={[table.headerText, styles.debtColStatus]}>
            Snowball Status
          </Text>
          <Text style={[table.headerText, styles.colActions]}>Actions</Text>
        </View>
        {filtered.length ? (
          filtered.map((bill) => {
            const next = nextOccurrenceFor(bill, getOccurrences, now);
            const position = rank.get(bill.id);
            return (
              <Pressable
                key={bill.id}
                onPress={() => onOpen(bill)}
                style={({ pressed }) => [table.row, pressed && styles.pressed]}
              >
                <View style={[styles.debtColName, styles.debtNameCell]}>
                  <View style={styles.billIcon}>
                    <Feather
                      name="credit-card"
                      size={15}
                      color={palette.purple}
                    />
                  </View>
                  <View>
                    <Text style={table.cellStrong}>{bill.name}</Text>
                    <Text style={styles.rowMuted}>
                      {bill.is_recurring ? "Recurring debt" : "Debt"}
                    </Text>
                  </View>
                </View>
                <View style={styles.debtColCategory}>
                  <StatusBadge label={bill.category} tone="gray" />
                </View>
                <View style={styles.debtColBalance}>
                  <Text style={table.cellStrong}>{money(bill.balance)}</Text>
                  <View style={styles.miniTrack}>
                    <View
                      style={[
                        styles.miniFill,
                        {
                          width:
                            `${Math.max(8, 100 - (position ?? active.length) * (70 / Math.max(1, active.length)))}%` as never,
                        },
                      ]}
                    />
                  </View>
                </View>
                <Text style={[table.cellText, styles.debtColApr]}>
                  {bill.interest_rate.toFixed(2)}%
                </Text>
                <Text style={[table.cellStrong, styles.debtColMinimum]}>
                  {money(
                    effectiveDebtMinimum(
                      bill.amount,
                      bill.snowball_minimum_boost ?? 0,
                    ),
                  )}
                </Text>
                <Text style={[table.cellText, styles.debtColDue]}>
                  {next ? displayDate(next.year, next.month, next.day) : "—"}
                </Text>
                <View style={styles.debtColStatus}>
                  <StatusBadge
                    label={
                      position === 1
                        ? "Smallest"
                        : position
                          ? `${position}${position === 2 ? "nd" : position === 3 ? "rd" : "th"}`
                          : "Excluded"
                    }
                    tone={position === 1 ? "green" : "purple"}
                  />
                </View>
                <View style={[styles.colActions, styles.actionIcons]}>
                  <Feather
                    name="more-vertical"
                    size={15}
                    color={palette.muted}
                  />
                </View>
              </Pressable>
            );
          })
        ) : (
          <EmptyState
            title="No debts found"
            message="Add a debt to begin your payoff plan."
            action={<PrimaryButton label="Add Debt" onPress={onAdd} />}
          />
        )}
      </DesktopCard>
    </DesktopPage>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.canvas },
  scroll: { flex: 1 },
  scrollContent: { minHeight: "100%" },
  pageReset: { flex: 0 },
  tabs: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 28,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    marginBottom: 14,
    paddingHorizontal: 8,
  },
  tab: {
    height: 42,
    justifyContent: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    paddingHorizontal: 1,
  },
  tabActive: { borderBottomColor: palette.purple },
  tabText: {
    color: palette.muted,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  tabTextActive: { color: palette.purpleDark, fontFamily: "Inter_700Bold" },
  metrics: { flexDirection: "row", gap: 12, marginBottom: 14 },
  billOverviewRow: { marginBottom: 14 },
  overviewCard: { width: "100%", minWidth: 0, overflow: "hidden" },
  textLink: {
    color: palette.purpleDark,
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    textTransform: "capitalize",
  },
  upcomingRow: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  upcomingTableHeader: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 20,
    backgroundColor: palette.surfaceMuted,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  upcomingHeaderText: {
    color: palette.muted,
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    textTransform: "uppercase",
    letterSpacing: 0.35,
  },
  upcomingHeaderBill: { flex: 1, paddingLeft: 46 },
  upcomingBillCell: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  billIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: palette.purpleSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  upcomingName: { flex: 1, minWidth: 0 },
  upcomingDate: { width: 180, minWidth: 0 },
  upcomingAmountColumn: { width: 130 },
  upcomingAmount: {
    color: palette.text,
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  upcomingStatusColumn: { width: 110, alignItems: "flex-start" },
  rowStrong: { color: palette.text, fontSize: 12, fontFamily: "Inter_700Bold" },
  rowText: {
    color: palette.textSecondary,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  rowMuted: {
    color: palette.muted,
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  calendarActions: { flexDirection: "row", gap: 4 },
  chevron: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  weekHeader: {
    height: 31,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  weekday: {
    flex: 1,
    textAlign: "center",
    color: palette.muted,
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap" },
  calendarCell: {
    width: `${100 / 7}%` as never,
    height: 41,
    padding: 5,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: palette.borderSoft,
  },
  calendarDay: {
    color: palette.textSecondary,
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  calendarAmount: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    marginTop: 2,
  },
  legend: {
    minHeight: 38,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
  },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  tableCard: { overflow: "hidden" },
  tableToolbar: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    padding: 10,
  },
  toolbarSpacer: { flex: 1 },
  colBill: { flex: 1.55, minWidth: 100 },
  colCategory: { flex: 1, minWidth: 80 },
  colDate: { flex: 1, minWidth: 80 },
  colAmount: { flex: 0.8, minWidth: 70 },
  colFrequency: { flex: 0.9, minWidth: 70 },
  colStatus: { flex: 0.8, minWidth: 70 },
  colActions: { width: 65 },
  actionIcons: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 13,
  },
  debtOverviewRow: { flexDirection: "row", gap: 12, marginBottom: 14 },
  debtOverviewCard: { flex: 1, minWidth: 0 },
  progressBody: { padding: 16 },
  progressCopy: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  progressTitle: {
    color: palette.textSecondary,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  progressPercent: {
    color: palette.text,
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
  progressTrack: {
    height: 13,
    borderRadius: 7,
    backgroundColor: palette.borderSoft,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 7,
    backgroundColor: palette.green,
  },
  progressLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  breakdownBody: { padding: 15 },
  breakdownBar: {
    height: 16,
    borderRadius: 8,
    overflow: "hidden",
    flexDirection: "row",
    marginBottom: 10,
  },
  breakdownRow: {
    minHeight: 23,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  breakdownPct: {
    width: 34,
    textAlign: "right",
    color: palette.muted,
    fontSize: 11,
  },
  debtColName: { flex: 1.5, minWidth: 130 },
  debtColCategory: { flex: 0.85, minWidth: 72 },
  debtColBalance: { flex: 1.05, minWidth: 90 },
  debtColApr: { flex: 0.8, minWidth: 66 },
  debtColMinimum: { flex: 0.95, minWidth: 80 },
  debtColDue: { flex: 0.95, minWidth: 82 },
  debtColStatus: { flex: 0.9, minWidth: 76 },
  debtNameCell: { flexDirection: "row", alignItems: "center", gap: 9 },
  miniTrack: {
    width: 76,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.borderSoft,
    overflow: "hidden",
    marginTop: 5,
  },
  miniFill: { height: "100%", borderRadius: 2, backgroundColor: palette.green },
  pressed: { opacity: 0.68 },
});
