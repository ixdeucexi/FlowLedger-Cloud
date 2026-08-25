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
import { DataFreshnessLabel } from "@/components/DataFreshnessLabel";
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
import { calendarVisibleForecastEvents, formatEventStatus } from "@/lib/forecastDisplay";

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
  projectedDailyBalances: DailyBalance[];
  transferTransactionIds: ReadonlySet<string>;
  overdueBillOccurrenceKeys: ReadonlySet<string>;
  safetyFloor: number;
  getCalendarDailyBalances: (month: number, year: number) => DailyBalance[];
  onToday: () => void;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onOpenMonthSelector: () => void;
  simulatorLocked: boolean;
  onOpenPlanSimulator: () => void;
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
    bill: { color: palette.amber, background: palette.amberSoft },
    plan: { color: palette.blue, background: palette.blueSoft },
    spending: { color: palette.purple, background: palette.purpleSoft },
    risk: { color: palette.red, background: palette.redSoft },
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
  simulatorLocked,
  onOpenPlanSimulator,
  onAdd,
}: Pick<
  DesktopCalendarPageProps,
  | "month"
  | "year"
  | "onToday"
  | "onPreviousMonth"
  | "onNextMonth"
  | "onOpenMonthSelector"
  | "simulatorLocked"
  | "onOpenPlanSimulator"
> & { compact: boolean; onAdd: () => void }) {
  return (
    <View style={[styles.pageHeader, compact && styles.pageHeaderCompact]}>
      <View style={styles.pageHeaderCopy}>
        <Text accessibilityRole="header" style={styles.pageTitle}>Forecast</Text>
        <Text style={styles.pageSubtitle}>
          View your month at a glance. Click any day to see details.
        </Text>
        <DataFreshnessLabel compact />
      </View>
      <View style={[styles.monthControls, compact && styles.monthControlsCompact]}>
        <Pressable
          nativeID="guided-tour-monthly"
          accessibilityRole="button"
          accessibilityLabel={`${simulatorLocked ? "Locked Pro " : ""}Plan Simulator`}
          onPress={onOpenPlanSimulator}
          style={({ pressed }) => [styles.simulatorButton, pressed && styles.pressed]}
        >
          <Feather name={simulatorLocked ? "lock" : "sliders"} size={15} color={palette.purple} />
          <Text style={styles.simulatorButtonText}>Plan Simulator</Text>
        </Pressable>
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
  overdueBillOccurrenceKeys,
}: {
  event: FinancialEvent;
  transferTransactionIds: ReadonlySet<string>;
  overdueBillOccurrenceKeys: ReadonlySet<string>;
}) {
  const kind = calendarEventKind(
    event,
    transferTransactionIds,
    overdueBillOccurrenceKeys,
  );
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
      {(["income", "bill", "plan", "spending", "risk"] as const).map((kind) => {
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
  overdueBillOccurrenceKeys,
  safetyFloor,
  lowestBalanceDate,
  lowestBalance,
  compact,
  onSelectDate,
}: Pick<
  DesktopCalendarPageProps,
  "month" | "year" | "selectedDate" | "dailyBalances" | "transferTransactionIds" | "overdueBillOccurrenceKeys" | "safetyFloor" | "onSelectDate"
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
          const events = calendarVisibleForecastEvents(balance?.events);
          const visibleEvents = events.slice(0, compact ? 2 : 3);
          const hiddenCount = Math.max(0, events.length - visibleEvents.length);
          const selected = selectedDate === cell.date;
          const isToday = today === cell.date;
          const isLowest = cell.date === lowestBalanceDate;
          const tightestForecastIsRisk = lowestBalance < safetyFloor;
          const isActualClose = balance?.balanceSource === "actual_close";
          return (
            <Pressable
              key={cell.date}
              accessibilityRole="button"
              accessibilityLabel={`${displayDate(cell.date, true)}. ${events.length} scheduled ${events.length === 1 ? "item" : "items"}${balance ? `. ${isActualClose ? "Actual bank close" : "Projected close"} ${money(balance.balance)}` : ""}`}
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
                  overdueBillOccurrenceKeys={overdueBillOccurrenceKeys}
                />
              ))}
              {hiddenCount > 0 ? (
                <Text style={styles.moreText}>+{hiddenCount} more</Text>
              ) : null}
              {balance ? (
                <Text style={styles.dayBalanceSource}>{isActualClose ? "Actual close" : "Projected"} · {money(balance.balance)}</Text>
              ) : null}
              {isLowest ? (
                <View style={[styles.lowestCellBadge, tightestForecastIsRisk && styles.riskCellBadge]}>
                  <Text style={[styles.lowestCellLabel, tightestForecastIsRisk && styles.riskCellLabel]}>
                    {tightestForecastIsRisk ? "Build room · Tightest forecast" : "Tightest forecast point"}
                  </Text>
                  <Text style={[styles.lowestCellValue, tightestForecastIsRisk && styles.riskCellValue]}>{money(lowestBalance)}</Text>
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
      <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Expenses</Text><Text style={[styles.summaryValue, { color: palette.purple }]}>−{money(summary.expenses)}</Text></View>
      <View style={[styles.summaryRow, styles.summaryNet]}><Text style={styles.summaryNetLabel}>Net</Text><Text style={[styles.summaryNetValue, { color: summary.net >= 0 ? palette.green : palette.red }]}>{money(summary.net, true)}</Text></View>
    </View>
  );
}

function BalanceTrend({
  balances,
  label,
  tone = "plan",
}: {
  balances: number[];
  label: string;
  tone?: "plan" | "risk";
}) {
  const min = Math.min(...balances);
  const max = Math.max(...balances);
  const span = Math.max(1, max - min);
  return (
    <View accessibilityLabel={label} style={styles.trend}>
      {balances.map((balance, index) => (
        <View key={`${index}-${balance}`} style={styles.trendColumn}>
          <View style={[styles.trendBar, { backgroundColor: tone === "risk" ? palette.red : palette.blue, height: 8 + ((balance - min) / span) * 24 }]} />
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
  overdueBillOccurrenceKeys,
  safetyFloor,
  onClose,
  onAddTransaction,
  onOpenEvent,
}: {
  selectedDate: string;
  selectedDay?: DailyBalance;
  weekDates: string[];
  weekDays: DailyBalance[];
  transferTransactionIds: ReadonlySet<string>;
  overdueBillOccurrenceKeys: ReadonlySet<string>;
  safetyFloor: number;
  onClose: () => void;
  onAddTransaction: () => void;
  onOpenEvent: (event: FinancialEvent) => void;
}) {
  const events = calendarVisibleForecastEvents(selectedDay?.events);
  const daySummary = summarizeCalendarEvents(events, transferTransactionIds);
  const weekSummary = summarizeCalendarEvents(
    uniqueCalendarEvents(weekDays),
    transferTransactionIds,
  );
  const weekLabel = `Week of ${shortDate(weekDates[0] ?? selectedDate)} – ${shortDate(weekDates[6] ?? selectedDate)}`;
  const trendValues = weekDays.length ? weekDays.map((day) => day.balance) : [selectedDay?.balance ?? 0];
  const isRiskDay = Boolean(selectedDay && selectedDay.balance < safetyFloor);
  const isActualClose = selectedDay?.balanceSource === "actual_close";
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
            const kind = calendarEventKind(
              event,
              transferTransactionIds,
              overdueBillOccurrenceKeys,
            );
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
                <View style={styles.scheduledCopy}><Text numberOfLines={1} style={styles.scheduledName}>{eventLabel(event)}</Text><Text style={styles.scheduledCategory}>{event.status === "pending" ? formatEventStatus(event.status) : kind.charAt(0).toUpperCase() + kind.slice(1)}</Text></View>
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

        <View style={[styles.balanceCard, isRiskDay && styles.riskBalanceCard]}>
          <View style={[styles.balanceIcon, isRiskDay && styles.riskBalanceIcon]}><Feather name="shield" size={18} color={isRiskDay ? palette.red : palette.blue} /></View>
          <View style={styles.balanceCopy}><Text style={styles.balanceLabel}>{isActualClose ? "Actual Bank Close" : isRiskDay ? "Projected Risk Balance" : "Projected Daily Balance"}</Text><Text style={[styles.balanceValue, isRiskDay && styles.riskBalanceValue]}>{money(selectedDay?.balance ?? 0)}</Text><Text style={styles.balanceDetail}>{isActualClose ? `Last verified bank balance for this completed day${isRiskDay ? ` · below ${money(safetyFloor)} safety floor` : ""}` : isRiskDay ? `Projected below ${money(safetyFloor)} safety floor` : "Projected close for this day"}</Text></View>
          <BalanceTrend balances={trendValues} label={`Balance trend for ${weekLabel}`} tone={isRiskDay ? "risk" : "plan"} />
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
    () => summarizeCalendarMonth(props.projectedDailyBalances, props.year, props.month, props.transferTransactionIds),
    [props.month, props.projectedDailyBalances, props.transferTransactionIds, props.year],
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
        days = props.getCalendarDailyBalances(month - 1, year);
        monthCache.set(key, days);
      }
      const match = days.find((item) => item.day === day);
      return match ? [match] : [];
    });
  }, [props.getCalendarDailyBalances, weekDates]);

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
            simulatorLocked={props.simulatorLocked}
            onOpenPlanSimulator={props.onOpenPlanSimulator}
            onAdd={() => props.onAddTransaction(props.selectedDate)}
          />
          <View style={[styles.metrics, compact && styles.metricsCompact]}>
            <View style={[styles.metricItem, compact && styles.metricItemCompact]}>
              <SummaryMetricCard label="Total Income" value={money(summary.income)} detail={`${summary.incomeCount} income ${summary.incomeCount === 1 ? "item" : "items"}`} icon="arrow-up" tone="green" />
            </View>
            <View style={[styles.metricItem, compact && styles.metricItemCompact]}>
              <SummaryMetricCard label="Total Expenses" value={money(summary.expenses)} detail={`${summary.expenseCount} bills & expenses`} icon="arrow-down" tone="purple" />
            </View>
            <View style={[styles.metricItem, compact && styles.metricItemCompact]}>
              <SummaryMetricCard label="Net Flow" value={money(summary.net, true)} detail="Income - Expenses" icon="trending-up" tone="purple" />
            </View>
            <View style={[styles.metricItem, compact && styles.metricItemCompact]}>
              <SummaryMetricCard label="Tightest Forecast Point" value={money(summary.lowestBalance)} detail={shortDate(summary.lowestBalanceDate)} icon="shield" tone="blue" />
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
                overdueBillOccurrenceKeys={props.overdueBillOccurrenceKeys}
                safetyFloor={props.safetyFloor}
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
                overdueBillOccurrenceKeys={props.overdueBillOccurrenceKeys}
                safetyFloor={props.safetyFloor}
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
  pageTitle: { color: palette.text, fontSize: 27, lineHeight: 33, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.7 },
  pageSubtitle: { color: palette.muted, fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular", marginTop: 2 },
  monthControls: { flexDirection: "row", alignItems: "center", gap: 8 },
  monthControlsCompact: { flexWrap: "wrap", justifyContent: "flex-end" },
  secondaryButton: { minHeight: 38, borderRadius: 7, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { color: palette.textSecondary, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  arrowGroup: { flexDirection: "row" },
  iconButton: { width: 38, height: 38, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, alignItems: "center", justifyContent: "center", marginLeft: -1 },
  monthSelector: { minHeight: 38, borderRadius: 7, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  monthSelectorText: { color: palette.textSecondary, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  addButton: { minHeight: 38, borderRadius: 7, backgroundColor: palette.purple, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  addButtonText: { color: "#ffffff", fontSize: 13, fontFamily: "Inter_700Bold" },
  simulatorButton: { minHeight: 44, borderRadius: 7, borderWidth: 1, borderColor: palette.purple, backgroundColor: palette.purpleSoft, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  simulatorButtonText: { color: palette.purple, fontSize: 12, fontFamily: "Inter_700Bold" },
  pressed: { opacity: 0.72 },
  metrics: { flexDirection: "row", gap: 12, marginBottom: 14 },
  metricsCompact: { flexWrap: "wrap" },
  metricItem: { flex: 1, minWidth: 0 },
  metricItemCompact: { flexGrow: 0, flexBasis: "48%" as never },
  mainRow: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  calendarColumn: { flex: 1, minWidth: 0 },
  calendarCard: { overflow: "hidden" },
  weekdayRow: { minHeight: 48, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: palette.border },
  weekday: { width: "14.2857%" as never, textAlign: "center", color: palette.textSecondary, fontSize: 12, fontFamily: "Inter_700Bold" },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: { width: "14.2857%" as never, minHeight: 136, padding: 9, borderRightWidth: 1, borderBottomWidth: 1, borderColor: palette.borderSoft, backgroundColor: palette.surface },
  dayCellCompact: { minHeight: 120, padding: 7 },
  dayCellOutside: { backgroundColor: palette.surfaceMuted, opacity: 0.62 },
  dayCellSelected: { backgroundColor: palette.purpleSoft, borderColor: palette.purple },
  dayCellPressed: { opacity: 0.72 },
  dayTopRow: { minHeight: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  dayNumberWrap: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dayNumberActive: { backgroundColor: palette.purple },
  dayNumber: { color: palette.textSecondary, fontSize: 12, fontFamily: "Inter_700Bold" },
  dayNumberMuted: { color: palette.faint },
  dayNumberActiveText: { color: "#ffffff" },
  todayLabel: { color: palette.purple, fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  eventPill: { minHeight: 24, borderRadius: 6, paddingHorizontal: 7, marginBottom: 4, flexDirection: "row", alignItems: "center", gap: 5, overflow: "hidden" },
  eventDot: { width: 7, height: 7, borderRadius: 4 },
  eventName: { flex: 1, minWidth: 0, color: palette.text, fontSize: 11, fontFamily: "Inter_600SemiBold" },
  eventAmount: { fontSize: 11, fontFamily: "Inter_700Bold" },
  moreText: { color: palette.purple, fontSize: 11, fontFamily: "Inter_700Bold", marginTop: 1 },
  dayBalanceSource: { color: palette.textSecondary, fontSize: 10, fontFamily: "Inter_600SemiBold", marginTop: 3 },
  lowestCellBadge: { marginTop: "auto", paddingTop: 5 },
  lowestCellLabel: { color: palette.blue, fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase" },
  lowestCellValue: { color: palette.blue, fontSize: 12, fontFamily: "Inter_800ExtraBold", marginTop: 2 },
  riskCellBadge: { borderRadius: 6, backgroundColor: palette.redSoft, paddingHorizontal: 5, paddingBottom: 4 },
  riskCellLabel: { color: palette.red },
  riskCellValue: { color: palette.red },
  legend: { minHeight: 56, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 20, paddingHorizontal: 14, paddingVertical: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: palette.muted, fontSize: 12, fontFamily: "Inter_600SemiBold" },
  detailPanel: { width: "32%" as never, minWidth: 306, maxWidth: 405, overflow: "hidden" },
  detailHeader: { minHeight: 60, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: palette.borderSoft },
  detailTitle: { flex: 1, color: palette.text, fontSize: 14, lineHeight: 19, fontFamily: "Inter_800ExtraBold" },
  closeButton: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 },
  closeText: { color: palette.textSecondary, fontSize: 11, fontFamily: "Inter_600SemiBold" },
  detailScroll: { maxHeight: 850 },
  detailContent: { padding: 16, gap: 15 },
  sectionTitle: { color: palette.text, fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  summaryRows: { gap: 9 },
  summaryRow: { minHeight: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  summaryLabel: { color: palette.textSecondary, fontSize: 12, fontFamily: "Inter_600SemiBold" },
  summaryValue: { fontSize: 12, fontFamily: "Inter_700Bold" },
  summaryNet: { borderTopWidth: 1, borderTopColor: palette.borderSoft, paddingTop: 9, marginTop: 2 },
  summaryNetLabel: { color: palette.text, fontSize: 12, fontFamily: "Inter_700Bold" },
  summaryNetValue: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  scheduledList: { borderTopWidth: 1, borderTopColor: palette.borderSoft },
  scheduledRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: palette.borderSoft, paddingVertical: 10 },
  scheduledIcon: { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  scheduledDot: { width: 7, height: 7, borderRadius: 4 },
  scheduledCopy: { flex: 1, minWidth: 0 },
  scheduledName: { color: palette.text, fontSize: 13, fontFamily: "Inter_700Bold" },
  scheduledCategory: { color: palette.muted, fontSize: 11, marginTop: 3 },
  scheduledAmount: { fontSize: 12, fontFamily: "Inter_700Bold" },
  emptyState: { minHeight: 110, alignItems: "center", justifyContent: "center", padding: 12 },
  emptyTitle: { color: palette.text, fontSize: 12, fontFamily: "Inter_700Bold", marginTop: 7 },
  emptyText: { color: palette.muted, fontSize: 11, marginTop: 3, textAlign: "center" },
  primaryAction: { minHeight: 44, borderRadius: 8, backgroundColor: palette.purple, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  primaryActionText: { color: "#ffffff", fontSize: 13, fontFamily: "Inter_700Bold" },
  disabledAction: { minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surfaceMuted, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, opacity: 0.72 },
  disabledActionText: { color: palette.faint, fontSize: 12, fontFamily: "Inter_600SemiBold" },
  balanceCard: { minHeight: 92, borderRadius: 9, backgroundColor: palette.blueSoft, padding: 13, flexDirection: "row", alignItems: "center", gap: 10 },
  riskBalanceCard: { backgroundColor: palette.redSoft },
  balanceIcon: { width: 36, height: 36, borderRadius: 9, backgroundColor: palette.surface, alignItems: "center", justifyContent: "center" },
  riskBalanceIcon: { borderWidth: 1, borderColor: palette.red },
  balanceCopy: { flex: 1, minWidth: 0 },
  balanceLabel: { color: palette.text, fontSize: 12, fontFamily: "Inter_700Bold" },
  balanceValue: { color: palette.text, fontSize: 18, fontFamily: "Inter_800ExtraBold", marginTop: 3 },
  riskBalanceValue: { color: palette.red },
  balanceDetail: { color: palette.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  trend: { width: 92, height: 42, flexDirection: "row", alignItems: "flex-end", gap: 3 },
  trendColumn: { flex: 1, height: 38, justifyContent: "flex-end" },
  trendBar: { width: "100%", borderRadius: 3, backgroundColor: palette.blue },
  weekCard: { borderWidth: 1, borderColor: palette.borderSoft, borderRadius: 9, padding: 13, gap: 11 },
});
