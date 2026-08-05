import { Feather } from "@expo/vector-icons";
import React, { useMemo } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import {
  DesktopCard,
  DesktopPage,
  SummaryMetricCard,
  desktopPalette as palette,
} from "@/components/desktop/DesktopUI";
import type { DailyBalance } from "@/context/BudgetContext";
import {
  calendarEventKind,
  desktopCalendarCells,
  desktopCalendarWeekDates,
  summarizeCalendarEvents,
  summarizeCalendarMonth,
  uniqueCalendarEvents,
  type DesktopCalendarEventKind,
} from "@/lib/desktopCalendar";
import type { FinancialEvent } from "@/lib/forecast";

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

type DesktopCalendarPageProps = {
  month: number;
  year: number;
  selectedDate: string | null;
  dailyBalances: DailyBalance[];
  transferTransactionIds: ReadonlySet<string>;
  getDailyBalances: (month: number, year: number) => DailyBalance[];
  onToday: () => void;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onOpenMonthSelector: () => void;
  onAddTransaction: (date?: string | null) => void;
  onSelectDate: (date: string) => void;
  onCloseSelectedDay: () => void;
  onOpenEvent: (event: FinancialEvent) => void;
};

function money(value: number, signed = false) {
  const sign = signed ? (value > 0 ? "+" : value < 0 ? "−" : "") : "";
  return `${sign}${Math.abs(value).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function displayDate(value: string, includeWeekday = false) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12).toLocaleDateString(undefined, {
    ...(includeWeekday ? { weekday: "long" as const } : {}),
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function shortDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function eventTone(kind: DesktopCalendarEventKind) {
  return {
    income: { color: palette.green, background: palette.greenSoft },
    bill: { color: palette.purple, background: palette.purpleSoft },
    expense: { color: palette.red, background: palette.redSoft },
    transfer: { color: palette.blue, background: palette.blueSoft },
    other: { color: palette.amber, background: palette.amberSoft },
  }[kind];
}

function eventLabel(event: FinancialEvent) {
  if (event.name?.trim()) return event.name.trim();
  if (event.sourceType === "income") return "Income";
  if (event.sourceType === "bill") return "Bill";
  if (event.sourceType === "extra_payment") return "Debt payment";
  if (event.sourceType === "reconciliation") return "Bank balance update";
  return "Calendar item";
}

function IconButton({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <Feather name={icon} size={17} color={palette.textSecondary} />
    </Pressable>
  );
}

function CalendarHeader({
  month,
  year,
  compact,
  onToday,
  onPreviousMonth,
  onNextMonth,
  onOpenMonthSelector,
  onAdd,
}: Pick<
  DesktopCalendarPageProps,
  | "month"
  | "year"
  | "onToday"
  | "onPreviousMonth"
  | "onNextMonth"
  | "onOpenMonthSelector"
> & { compact: boolean; onAdd: () => void }) {
  return (
    <View style={[styles.pageHeader, compact && styles.pageHeaderCompact]}>
      <View style={styles.pageHeaderCopy}>
        <Text accessibilityRole="header" style={styles.pageTitle}>Calendar</Text>
        <Text style={styles.pageSubtitle}>
          View your month at a glance. Click any day to see details.
        </Text>
      </View>
      <View style={[styles.monthControls, compact && styles.monthControlsCompact]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go to today"
          onPress={onToday}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryButtonText}>Today</Text>
        </Pressable>
        <View style={styles.arrowGroup}>
          <IconButton icon="chevron-left" label="Previous month" onPress={onPreviousMonth} />
          <IconButton icon="chevron-right" label="Next month" onPress={onNextMonth} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Choose month. Current month is ${MONTHS[month]} ${year}`}
          onPress={onOpenMonthSelector}
          style={({ pressed }) => [styles.monthSelector, pressed && styles.pressed]}
        >
          <Feather name="calendar" size={15} color={palette.textSecondary} />
          <Text style={styles.monthSelectorText}>{MONTHS[month]} {year}</Text>
          <Feather name="chevron-down" size={15} color={palette.muted} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add transaction"
          onPress={onAdd}
          style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
        >
          <Feather name="plus" size={16} color="#ffffff" />
          <Text style={styles.addButtonText}>Add</Text>
          <Feather name="chevron-down" size={14} color="#ffffff" />
        </Pressable>
      </View>
    </View>
  );
}

function CalendarEventPill({
  event,
  transferTransactionIds,
}: {
  event: FinancialEvent;
  transferTransactionIds: ReadonlySet<string>;
}) {
  const kind = calendarEventKind(event, transferTransactionIds);
  const tone = eventTone(kind);
  return (
    <View
      accessibilityLabel={`${eventLabel(event)}, ${kind}, ${money(event.amount, true)}`}
      style={[styles.eventPill, { backgroundColor: tone.background }]}
    >
      <View style={[styles.eventDot, { backgroundColor: tone.color }]} />
      <Text numberOfLines={1} style={styles.eventName}>{eventLabel(event)}</Text>
      <Text style={[styles.eventAmount, { color: tone.color }]}>
        {money(event.amount, true)}
      </Text>
    </View>
  );
}

function CalendarLegend() {
  return (
    <View accessibilityLabel="Calendar legend" style={styles.legend}>
      {(["income", "bill", "expense", "transfer", "other"] as const).map((kind) => {
        const tone = eventTone(kind);
        return (
          <View key={kind} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: tone.color }]} />
            <Text style={styles.legendText}>{kind.charAt(0).toUpperCase() + kind.slice(1)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function DesktopMonthGrid({
  month,
  year,
  selectedDate,
  dailyBalances,
  transferTransactionIds,
  lowestBalanceDate,
  lowestBalance,
  compact,
  onSelectDate,
}: Pick<
  DesktopCalendarPageProps,
  "month" | "year" | "selectedDate" | "dailyBalances" | "transferTransactionIds" | "onSelectDate"
> & {
  lowestBalanceDate: string;
  lowestBalance: number;
  compact: boolean;
}) {
  const cells = useMemo(() => desktopCalendarCells(year, month), [month, year]);
  const balancesByDay = useMemo(
    () => new Map(dailyBalances.map((day) => [day.day, day] as const)),
    [dailyBalances],
  );
  const today = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }, []);

  return (
    <DesktopCard style={styles.calendarCard}>
      <View style={styles.weekdayRow}>
        {WEEKDAYS.map((day) => <Text key={day} style={styles.weekday}>{day}</Text>)}
      </View>
      <View style={styles.calendarGrid}>
        {cells.map((cell) => {
          const balance = cell.inCurrentMonth ? balancesByDay.get(cell.day) : undefined;
          const events = balance?.events ?? [];
          const visibleEvents = events.slice(0, compact ? 2 : 3);
          const hiddenCount = Math.max(0, events.length - visibleEvents.length);
          const selected = selectedDate === cell.date;
          const isToday = today === cell.date;
          const isLowest = cell.date === lowestBalanceDate;
          return (
            <Pressable
              key={cell.date}
              accessibilityRole="button"
              accessibilityLabel={`${displayDate(cell.date, true)}. ${events.length} scheduled ${events.length === 1 ? "item" : "items"}${balance ? `. Projected balance ${money(balance.balance)}` : ""}`}
              accessibilityState={{ selected }}
              disabled={!cell.inCurrentMonth}
              onPress={() => onSelectDate(cell.date)}
              style={({ pressed }) => [
                styles.dayCell,
                compact && styles.dayCellCompact,
                !cell.inCurrentMonth && styles.dayCellOutside,
                selected && styles.dayCellSelected,
                pressed && cell.inCurrentMonth && styles.dayCellPressed,
              ]}
            >
              <View style={styles.dayTopRow}>
                <View style={[styles.dayNumberWrap, (selected || isToday) && styles.dayNumberActive]}>
                  <Text style={[styles.dayNumber, !cell.inCurrentMonth && styles.dayNumberMuted, (selected || isToday) && styles.dayNumberActiveText]}>{cell.day}</Text>
                </View>
                {isToday && !selected ? <Text style={styles.todayLabel}>Today</Text> : null}
              </View>
              {visibleEvents.map((event) => (
                <CalendarEventPill
                  key={event.id}
                  event={event}
                  transferTransactionIds={transferTransactionIds}
                />
              ))}
              {hiddenCount > 0 ? (
                <Text style={styles.moreText}>+{hiddenCount} more</Text>
              ) : null}
              {isLowest ? (
                <View style={styles.lowestCellBadge}>
                  <Text style={styles.lowestCellLabel}>Lowest balance</Text>
                  <Text style={styles.lowestCellValue}>{money(lowestBalance)}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <CalendarLegend />
    </DesktopCard>
  );
}

function SummaryRows({ summary }: { summary: ReturnType<typeof summarizeCalendarEvents> }) {
  return (
    <View style={styles.summaryRows}>
      <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Income</Text><Text style={[styles.summaryValue, { color: palette.green }]}>{money(summary.income)}</Text></View>
      <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Expenses</Text><Text style={[styles.summaryValue, { color: palette.red }]}>−{money(summary.expenses)}</Text></View>
      <View style={[styles.summaryRow, styles.summaryNet]}><Text style={styles.summaryNetLabel}>Net</Text><Text style={[styles.summaryNetValue, { color: summary.net >= 0 ? palette.purple : palette.red }]}>{money(summary.net, true)}</Text></View>
    </View>
  );
}

function BalanceTrend({ balances, label }: { balances: number[]; label: string }) {
  const min = Math.min(...balances);
  const max = Math.max(...balances);
  const span = Math.max(1, max - min);
  return (
    <View accessibilityLabel={label} style={styles.trend}>
      {balances.map((balance, index) => (
        <View key={`${index}-${balance}`} style={styles.trendColumn}>
          <View style={[styles.trendBar, { height: 8 + ((balance - min) / span) * 24 }]} />
        </View>
      ))}
    </View>
  );
}

function SelectedDayPanel({
  selectedDate,
  selectedDay,
  weekDates,
  weekDays,
  transferTransactionIds,
  onClose,
  onAddTransaction,
  onOpenEvent,
}: {
  selectedDate: string;
  selectedDay?: DailyBalance;
  weekDates: string[];
  weekDays: DailyBalance[];
  transferTransactionIds: ReadonlySet<string>;
  onClose: () => void;
  onAddTransaction: () => void;
  onOpenEvent: (event: FinancialEvent) => void;
}) {
  const events = selectedDay?.events ?? [];
  const daySummary = summarizeCalendarEvents(events, transferTransactionIds);
  const weekSummary = summarizeCalendarEvents(
    uniqueCalendarEvents(weekDays),
    transferTransactionIds,
  );
  const weekLabel = `Week of ${shortDate(weekDates[0] ?? selectedDate)} – ${shortDate(weekDates[6] ?? selectedDate)}`;
  const trendValues = weekDays.length ? weekDays.map((day) => day.balance) : [selectedDay?.balance ?? 0];
  return (
    <DesktopCard style={styles.detailPanel}>
      <View style={styles.detailHeader}>
        <Text style={styles.detailTitle}>{displayDate(selectedDate, true)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close selected day details" onPress={onClose} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
          <Text style={styles.closeText}>Close</Text>
          <Feather name="x" size={17} color={palette.textSecondary} />
        </Pressable>
      </View>
      <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator>
        <Text style={styles.sectionTitle}>Daily Summary</Text>
        <SummaryRows summary={daySummary} />

        <Text style={styles.sectionTitle}>Scheduled Items ({events.length})</Text>
        <View style={styles.scheduledList}>
          {events.length ? events.map((event) => {
            const kind = calendarEventKind(event, transferTransactionIds);
            const tone = eventTone(kind);
            const canOpen = event.sourceType !== "reconciliation";
            return (
              <Pressable
                key={event.id}
                accessibilityRole={canOpen ? "button" : undefined}
                accessibilityLabel={`${canOpen ? "Open" : "View"} ${eventLabel(event)}`}
                disabled={!canOpen}
                onPress={() => onOpenEvent(event)}
                style={({ pressed }) => [styles.scheduledRow, pressed && styles.pressed]}
              >
                <View style={[styles.scheduledIcon, { backgroundColor: tone.background }]}><View style={[styles.scheduledDot, { backgroundColor: tone.color }]} /></View>
                <View style={styles.scheduledCopy}><Text numberOfLines={1} style={styles.scheduledName}>{eventLabel(event)}</Text><Text style={styles.scheduledCategory}>{kind.charAt(0).toUpperCase() + kind.slice(1)}</Text></View>
                <Text style={[styles.scheduledAmount, { color: tone.color }]}>{money(event.amount, true)}</Text>
                {canOpen ? <Feather name="chevron-right" size={16} color={palette.muted} /> : null}
              </Pressable>
            );
          }) : (
            <View style={styles.emptyState}><Feather name="calendar" size={20} color={palette.purple} /><Text style={styles.emptyTitle}>Nothing scheduled</Text><Text style={styles.emptyText}>This date has no forecast events yet.</Text></View>
          )}
        </View>

        <Pressable accessibilityRole="button" accessibilityLabel={`Add transaction on ${displayDate(selectedDate)}`} onPress={onAddTransaction} style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}>
          <Feather name="plus" size={15} color="#ffffff" /><Text style={styles.primaryActionText}>Add Transaction</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Add Note, coming soon" disabled style={styles.disabledAction}>
          <Feather name="file-text" size={15} color={palette.faint} /><Text style={styles.disabledActionText}>Add Note · Coming Soon</Text>
        </Pressable>

        <View style={styles.balanceCard}>
          <View style={styles.balanceIcon}><Feather name="shield" size={16} color={palette.purple} /></View>
          <View style={styles.balanceCopy}><Text style={styles.balanceLabel}>Lowest Balance</Text><Text style={styles.balanceValue}>{money(selectedDay?.balance ?? 0)}</Text><Text style={styles.balanceDetail}>This day</Text></View>
          <BalanceTrend balances={trendValues} label={`Balance trend for ${weekLabel}`} />
        </View>

        <View style={styles.weekCard}>
          <Text style={styles.sectionTitle}>{weekLabel}</Text>
          <SummaryRows summary={weekSummary} />
        </View>
      </ScrollView>
    </DesktopCard>
  );
}

export function DesktopCalendarPage(props: DesktopCalendarPageProps) {
  const { width } = useWindowDimensions();
  const compact = width < 1220;
  const summary = useMemo(
    () => summarizeCalendarMonth(props.dailyBalances, props.year, props.month, props.transferTransactionIds),
    [props.dailyBalances, props.month, props.transferTransactionIds, props.year],
  );
  const selectedDay = useMemo(() => {
    if (!props.selectedDate) return undefined;
    const day = Number(props.selectedDate.slice(8, 10));
    return props.dailyBalances.find((item) => item.day === day);
  }, [props.dailyBalances, props.selectedDate]);
  const weekDates = useMemo(
    () => props.selectedDate ? desktopCalendarWeekDates(props.selectedDate) : [],
    [props.selectedDate],
  );
  const weekDays = useMemo(() => {
    const monthCache = new Map<string, DailyBalance[]>();
    return weekDates.flatMap((date) => {
      const [year, month, day] = date.split("-").map(Number);
      const key = `${year}-${month}`;
      let days = monthCache.get(key);
      if (!days) {
        days = props.getDailyBalances(month - 1, year);
        monthCache.set(key, days);
      }
      const match = days.find((item) => item.day === day);
      return match ? [match] : [];
    });
  }, [props.getDailyBalances, weekDates]);

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.pageScroll} contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator>
        <DesktopPage style={styles.pageReset}>
          <CalendarHeader
            month={props.month}
            year={props.year}
            compact={compact}
            onToday={props.onToday}
            onPreviousMonth={props.onPreviousMonth}
            onNextMonth={props.onNextMonth}
            onOpenMonthSelector={props.onOpenMonthSelector}
            onAdd={() => props.onAddTransaction(props.selectedDate)}
          />
          <View style={[styles.metrics, compact && styles.metricsCompact]}>
            <View style={[styles.metricItem, compact && styles.metricItemCompact]}>
              <SummaryMetricCard label="Total Income" value={money(summary.income)} detail={`${summary.incomeCount} income ${summary.incomeCount === 1 ? "item" : "items"}`} icon="arrow-up" tone="green" />
            </View>
            <View style={[styles.metricItem, compact && styles.metricItemCompact]}>
              <SummaryMetricCard label="Total Expenses" value={money(summary.expenses)} detail={`${summary.expenseCount} bills & expenses`} icon="arrow-down" tone="red" />
            </View>
            <View style={[styles.metricItem, compact && styles.metricItemCompact]}>
              <SummaryMetricCard label="Net Flow" value={money(summary.net, true)} detail="Income - Expenses" icon="trending-up" tone="purple" />
            </View>
            <View style={[styles.metricItem, compact && styles.metricItemCompact]}>
              <SummaryMetricCard label="Lowest Balance" value={money(summary.lowestBalance)} detail={shortDate(summary.lowestBalanceDate)} icon="shield" tone="blue" />
            </View>
          </View>
          <View style={styles.mainRow}>
            <View style={styles.calendarColumn}>
              <DesktopMonthGrid
                month={props.month}
                year={props.year}
                selectedDate={props.selectedDate}
                dailyBalances={props.dailyBalances}
                transferTransactionIds={props.transferTransactionIds}
                lowestBalanceDate={summary.lowestBalanceDate}
                lowestBalance={summary.lowestBalance}
                compact={compact}
                onSelectDate={props.onSelectDate}
              />
            </View>
            {props.selectedDate ? (
              <SelectedDayPanel
                selectedDate={props.selectedDate}
                selectedDay={selectedDay}
                weekDates={weekDates}
                weekDays={weekDays}
                transferTransactionIds={props.transferTransactionIds}
                onClose={props.onCloseSelectedDay}
                onAddTransaction={() => props.onAddTransaction(props.selectedDate)}
                onOpenEvent={props.onOpenEvent}
              />
            ) : null}
          </View>
        </DesktopPage>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.canvas },
  pageScroll: { flex: 1 },
  pageContent: { minHeight: "100%" as never },
  pageReset: { minHeight: "100%" as never },
  pageHeader: { minHeight: 62, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 18, marginBottom: 14 },
  pageHeaderCompact: { flexWrap: "wrap" },
  pageHeaderCopy: { flex: 1, minWidth: 280 },
  pageTitle: { color: palette.text, fontSize: 25, lineHeight: 31, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.7 },
  pageSubtitle: { color: palette.muted, fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular", marginTop: 2 },
  monthControls: { flexDirection: "row", alignItems: "center", gap: 8 },
  monthControlsCompact: { flexWrap: "wrap", justifyContent: "flex-end" },
  secondaryButton: { minHeight: 38, borderRadius: 7, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { color: palette.textSecondary, fontSize: 11, fontFamily: "Inter_600SemiBold" },
  arrowGroup: { flexDirection: "row" },
  iconButton: { width: 38, height: 38, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, alignItems: "center", justifyContent: "center", marginLeft: -1 },
  monthSelector: { minHeight: 38, borderRadius: 7, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  monthSelectorText: { color: palette.textSecondary, fontSize: 11, fontFamily: "Inter_600SemiBold" },
  addButton: { minHeight: 38, borderRadius: 7, backgroundColor: palette.purple, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  addButtonText: { color: "#ffffff", fontSize: 11, fontFamily: "Inter_700Bold" },
  pressed: { opacity: 0.72 },
  metrics: { flexDirection: "row", gap: 12, marginBottom: 14 },
  metricsCompact: { flexWrap: "wrap" },
  metricItem: { flex: 1, minWidth: 0 },
  metricItemCompact: { flexGrow: 0, flexBasis: "48%" as never },
  mainRow: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  calendarColumn: { flex: 1, minWidth: 0 },
  calendarCard: { overflow: "hidden" },
  weekdayRow: { minHeight: 43, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: palette.border },
  weekday: { width: "14.2857%" as never, textAlign: "center", color: palette.textSecondary, fontSize: 10, fontFamily: "Inter_700Bold" },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: { width: "14.2857%" as never, minHeight: 116, padding: 8, borderRightWidth: 1, borderBottomWidth: 1, borderColor: palette.borderSoft, backgroundColor: palette.surface },
  dayCellCompact: { minHeight: 102, padding: 6 },
  dayCellOutside: { backgroundColor: palette.surfaceMuted, opacity: 0.62 },
  dayCellSelected: { backgroundColor: palette.purpleSoft, borderColor: palette.purple },
  dayCellPressed: { opacity: 0.72 },
  dayTopRow: { minHeight: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  dayNumberWrap: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dayNumberActive: { backgroundColor: palette.purple },
  dayNumber: { color: palette.textSecondary, fontSize: 10, fontFamily: "Inter_700Bold" },
  dayNumberMuted: { color: palette.faint },
  dayNumberActiveText: { color: "#ffffff" },
  todayLabel: { color: palette.purple, fontSize: 7, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  eventPill: { minHeight: 19, borderRadius: 5, paddingHorizontal: 5, marginBottom: 3, flexDirection: "row", alignItems: "center", gap: 4, overflow: "hidden" },
  eventDot: { width: 5, height: 5, borderRadius: 3 },
  eventName: { flex: 1, minWidth: 0, color: palette.text, fontSize: 7.5, fontFamily: "Inter_600SemiBold" },
  eventAmount: { fontSize: 7, fontFamily: "Inter_700Bold" },
  moreText: { color: palette.purple, fontSize: 7.5, fontFamily: "Inter_700Bold", marginTop: 1 },
  lowestCellBadge: { marginTop: "auto", paddingTop: 4 },
  lowestCellLabel: { color: palette.blue, fontSize: 7, fontFamily: "Inter_700Bold", textTransform: "uppercase" },
  lowestCellValue: { color: palette.purple, fontSize: 9, fontFamily: "Inter_800ExtraBold", marginTop: 1 },
  legend: { minHeight: 50, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 12, paddingVertical: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendText: { color: palette.muted, fontSize: 9, fontFamily: "Inter_500Medium" },
  detailPanel: { width: "30%" as never, minWidth: 286, maxWidth: 365, overflow: "hidden" },
  detailHeader: { minHeight: 52, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: palette.borderSoft },
  detailTitle: { flex: 1, color: palette.text, fontSize: 12, lineHeight: 17, fontFamily: "Inter_800ExtraBold" },
  closeButton: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 },
  closeText: { color: palette.textSecondary, fontSize: 9, fontFamily: "Inter_600SemiBold" },
  detailScroll: { maxHeight: 720 },
  detailContent: { padding: 14, gap: 12 },
  sectionTitle: { color: palette.text, fontSize: 10, fontFamily: "Inter_800ExtraBold" },
  summaryRows: { gap: 8 },
  summaryRow: { minHeight: 22, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  summaryLabel: { color: palette.textSecondary, fontSize: 9, fontFamily: "Inter_600SemiBold" },
  summaryValue: { fontSize: 9, fontFamily: "Inter_700Bold" },
  summaryNet: { borderTopWidth: 1, borderTopColor: palette.borderSoft, paddingTop: 9, marginTop: 2 },
  summaryNetLabel: { color: palette.text, fontSize: 9, fontFamily: "Inter_700Bold" },
  summaryNetValue: { fontSize: 10, fontFamily: "Inter_800ExtraBold" },
  scheduledList: { borderTopWidth: 1, borderTopColor: palette.borderSoft },
  scheduledRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 9, borderBottomWidth: 1, borderBottomColor: palette.borderSoft, paddingVertical: 8 },
  scheduledIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  scheduledDot: { width: 7, height: 7, borderRadius: 4 },
  scheduledCopy: { flex: 1, minWidth: 0 },
  scheduledName: { color: palette.text, fontSize: 9, fontFamily: "Inter_700Bold" },
  scheduledCategory: { color: palette.muted, fontSize: 8, marginTop: 2 },
  scheduledAmount: { fontSize: 9, fontFamily: "Inter_700Bold" },
  emptyState: { minHeight: 110, alignItems: "center", justifyContent: "center", padding: 12 },
  emptyTitle: { color: palette.text, fontSize: 10, fontFamily: "Inter_700Bold", marginTop: 7 },
  emptyText: { color: palette.muted, fontSize: 8, marginTop: 3, textAlign: "center" },
  primaryAction: { minHeight: 38, borderRadius: 7, backgroundColor: palette.purple, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  primaryActionText: { color: "#ffffff", fontSize: 10, fontFamily: "Inter_700Bold" },
  disabledAction: { minHeight: 38, borderRadius: 7, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surfaceMuted, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, opacity: 0.72 },
  disabledActionText: { color: palette.faint, fontSize: 9, fontFamily: "Inter_600SemiBold" },
  balanceCard: { minHeight: 76, borderRadius: 8, backgroundColor: palette.purpleSoft, padding: 11, flexDirection: "row", alignItems: "center", gap: 9 },
  balanceIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: palette.surface, alignItems: "center", justifyContent: "center" },
  balanceCopy: { flex: 1, minWidth: 0 },
  balanceLabel: { color: palette.text, fontSize: 9, fontFamily: "Inter_700Bold" },
  balanceValue: { color: palette.text, fontSize: 14, fontFamily: "Inter_800ExtraBold", marginTop: 2 },
  balanceDetail: { color: palette.muted, fontSize: 8, marginTop: 1 },
  trend: { width: 92, height: 42, flexDirection: "row", alignItems: "flex-end", gap: 3 },
  trendColumn: { flex: 1, height: 38, justifyContent: "flex-end" },
  trendBar: { width: "100%", borderRadius: 3, backgroundColor: palette.purple },
  weekCard: { borderWidth: 1, borderColor: palette.borderSoft, borderRadius: 8, padding: 11, gap: 10 },
});
