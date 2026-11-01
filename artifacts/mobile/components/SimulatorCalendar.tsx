import { PrivacyPressable as Pressable, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import { AppText } from "@/components/AppText";
import Feather from "@expo/vector-icons/Feather";
import React, { useMemo, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { useCalendarAppearance } from "@/hooks/useCalendarAppearance";
import { useColors } from "@/hooks/useColors";
import { CALENDAR_CATEGORIES } from "@/lib/calendarColors";
import { formatCompactCalendarAmount, formatEventAmount, formatEventStatus } from "@/lib/forecastDisplay";
import { simulationCalendarCells, simulationCalendarDays, simulationCalendarDifference, simulationCalendarEventKind, simulationCalendarMonth, simulationCalendarMonths, simulationCalendarSelectedDay } from "@/lib/planSimulationCalendar";
import type { CanonicalPlanSimulationDay, PlanSimulationResult } from "@/lib/planSimulator";
import type { FinancialEvent } from "@/lib/forecast";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

function MoneyValue({ value, color, small = false }: { value?: number; color: string; small?: boolean }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.moneyScroll} contentContainerStyle={styles.moneyScrollContent}>
    <AppText sensitive tone="number" style={[styles.money, small && styles.moneySmall, { color }]}>{value !== undefined && Number.isFinite(value) ? money(value) : "Not available"}</AppText>
  </ScrollView>;
}

function DayTotals({ label, day, safetyFloor }: { label: string; day?: CanonicalPlanSimulationDay; safetyFloor: number }) {
  const c = useColors();
  const balance = day && Number.isFinite(day.balance) ? day.balance : undefined;
  return <View style={[styles.totalCard, { backgroundColor: c.background, borderColor: c.border }]}>
    <AppText style={[styles.totalLabel, { color: c.mutedForeground }]}>{label}</AppText>
    <MoneyValue value={balance} color={balance !== undefined && balance < 0 ? c.destructive : balance !== undefined && balance < safetyFloor ? c.warning : c.foreground} />
    <View style={styles.dailyFlow}><AppText style={[styles.flowLabel, { color: c.mutedForeground }]}>In</AppText><MoneyValue value={day?.inflow} color={c.success} small /></View>
    <View style={styles.dailyFlow}><AppText style={[styles.flowLabel, { color: c.mutedForeground }]}>Out</AppText><MoneyValue value={day?.outflow} color={c.destructive} small /></View>
  </View>;
}

function DayEvents({ label, day, resolveEventLabel }: { label: string; day?: CanonicalPlanSimulationDay; resolveEventLabel: (event: FinancialEvent) => string }) {
  const c = useColors();
  const tones = useCalendarAppearance();
  return <View style={styles.eventSection}>
    <AppText accessibilityRole="header" style={[styles.eventSectionTitle, { color: c.foreground }]}>{label}</AppText>
    {!day ? <AppText style={[styles.note, { color: c.mutedForeground }]}>Daily results are not available for this date.</AppText> : !day.events.length ? <AppText style={[styles.note, { color: c.mutedForeground }]}>No payments or deposits.</AppText> : day.events.map((event, index) => {
      const kind = simulationCalendarEventKind(event), tone = tones[kind];
      return <View key={`${event.id}:${index}`} style={[styles.event, { borderColor: c.border }]}>
        <View style={[styles.eventDot, { backgroundColor: tone.color }]} />
        <View style={styles.eventCopy}><AppText style={[styles.eventName, { color: c.foreground }]}>{resolveEventLabel(event)}</AppText><AppText style={[styles.eventStatus, { color: c.mutedForeground }]}>{formatEventStatus(event.status)}</AppText></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.eventAmountScroll}><AppText sensitive style={[styles.eventAmount, { color: event.amount < 0 ? c.destructive : c.success }]}>{Number.isFinite(event.amount) ? formatEventAmount(event.amount) : "Not available"}</AppText></ScrollView>
      </View>;
    })}
  </View>;
}

export function SimulatorCalendar({ baseline, scenario, startDate, endDate, scenarioName, safetyFloor, resolveEventLabel }: { baseline: PlanSimulationResult; scenario: PlanSimulationResult; startDate: string; endDate: string; scenarioName: string; safetyFloor: number; resolveEventLabel: (event: FinancialEvent) => string }) {
  const c = useColors();
  const tones = useCalendarAppearance();
  const { width } = useWindowDimensions();
  const scenarioDays = useMemo(() => simulationCalendarDays(scenario.days, startDate, endDate), [scenario.days, startDate, endDate]);
  const currentDays = useMemo(() => simulationCalendarDays(baseline.days, startDate, endDate), [baseline.days, startDate, endDate]);
  const months = useMemo(() => simulationCalendarMonths(scenarioDays), [scenarioDays]);
  const [requestedMonth, setRequestedMonth] = useState<string | null>(null);
  const [requestedDate, setRequestedDate] = useState<string | null>(null);
  const detailsHeadingRef = useRef<View>(null);
  const month = simulationCalendarMonth(months, requestedMonth);
  const cells = useMemo(() => month ? simulationCalendarCells(month, scenarioDays, currentDays) : [], [month, scenarioDays, currentDays]);
  const selected = simulationCalendarSelectedDay(cells, requestedDate);
  const index = month ? months.indexOf(month) : -1;
  const difference = simulationCalendarDifference(selected?.scenario, selected?.current);
  const monthTitle = month ? new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "No daily results";
  const navigate = (offset: number) => { const next = months[index + offset];if (next) { setRequestedMonth(next);setRequestedDate(null); } };
  const selectDate = (date: string) => {
    setRequestedDate(date);
    if (Platform.OS === "web") requestAnimationFrame(() => {
      const heading = detailsHeadingRef.current as unknown as { scrollIntoView?: (options: { behavior: "smooth"; block: "start" }) => void; focus?: (options: { preventScroll: boolean }) => void } | null;
      heading?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      heading?.focus?.({ preventScroll: true });
    });
  };

  return <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
    <AppText tone="label" style={[styles.eyebrow, { color: c.primary }]}>WORKING SCENARIO</AppText>
    <AppText accessibilityRole="header" tone="title" style={[styles.title, { color: c.foreground }]}>Scenario calendar</AppText>
    <AppText style={[styles.scenarioName, { color: c.foreground }]}>{scenarioName || "Untitled scenario"}</AppText>
    <AppText style={[styles.note, { color: c.mutedForeground }]}>Projected daily balances and payments for your working draft. Select a day for its details below.</AppText>
    <AppText style={[styles.range, { color: c.mutedForeground }]}>Working draft range · {new Date(`${startDate}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} – {new Date(`${endDate}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</AppText>
    {!scenario.complete ? <View accessibilityRole="alert" style={[styles.warning, { backgroundColor: c.warning + "12", borderColor: c.warning + "66" }]}><AppText style={[styles.warningTitle, { color: c.warning }]}>Some changes need attention</AppText><AppText style={[styles.note, { color: c.foreground }]}>This calendar shows only the changes that could be modeled. Review these issues before relying on the result.</AppText>{scenario.issues.map((issue, issueIndex) => <AppText key={`${issue.changeId}:${issueIndex}`} style={[styles.note, { color: c.foreground }]}>{issue.message}</AppText>)}</View> : null}
    <View style={styles.monthNavigation}>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous simulator month" accessibilityState={{ disabled: index <= 0 }} disabled={index <= 0} onPress={() => navigate(-1)} style={({ pressed }) => [styles.arrow, { backgroundColor: c.background, borderColor: c.border, opacity: index <= 0 ? .35 : pressed ? .65 : 1 }]}><Feather name="chevron-left" size={22} color={c.foreground} /></Pressable>
      <AppText accessibilityRole="header" style={[styles.monthTitle, { color: c.foreground }]}>{monthTitle}</AppText>
      <Pressable accessibilityRole="button" accessibilityLabel="Next simulator month" accessibilityState={{ disabled: index < 0 || index >= months.length - 1 }} disabled={index < 0 || index >= months.length - 1} onPress={() => navigate(1)} style={({ pressed }) => [styles.arrow, { backgroundColor: c.background, borderColor: c.border, opacity: index < 0 || index >= months.length - 1 ? .35 : pressed ? .65 : 1 }]}><Feather name="chevron-right" size={22} color={c.foreground} /></Pressable>
    </View>
    {month ? <View style={[styles.gridFrame, { borderColor: c.border }]}>
      <View style={styles.weekdays}>{WEEKDAYS.map(day => <AppText key={day} style={[styles.weekday, { color: c.mutedForeground }]}>{day}</AppText>)}</View>
      <View style={styles.grid}>{cells.map(cell => {
        const available = Boolean(cell.scenario && Number.isFinite(cell.scenario.balance));
        const active = selected?.date === cell.date;
        const balance = cell.scenario?.balance;
        const tone = balance !== undefined && balance < safetyFloor ? tones.risk : tones.income;
        const events: FinancialEvent[] = available ? cell.scenario!.events : [];
        return <Pressable key={cell.date} accessibilityRole="button" accessibilityLabel={available ? `Open simulator day ${cell.date}` : `Simulator day ${cell.date} is outside available results`} accessibilityState={{ disabled: !available, selected: active }} disabled={!available} onPress={() => selectDate(cell.date)} style={({ pressed }) => [styles.cell, width >= 768 && styles.cellWide, { borderColor: c.border, backgroundColor: active ? c.primary + "18" : c.background, opacity: pressed ? .7 : 1 }, active && { borderColor: c.primary }]}>
          <AppText style={[styles.dayNumber, { color: available ? c.foreground : c.mutedForeground, opacity: cell.inCurrentMonth ? 1 : .35 }]}>{cell.day}</AppText>
          {available && balance !== undefined ? <><AppText sensitive numberOfLines={1} style={[styles.gridBalance, width < 400 && styles.gridBalanceNarrow, width < 360 && styles.gridBalanceSmall, width >= 768 && styles.gridBalanceWide, { color: tone.color }]}>{formatCompactCalendarAmount(balance, undefined, width < 600 ? 1000 : 10_000)}</AppText>{events.slice(0, width >= 768 ? 3 : 2).map((event, eventIndex) => { const eventTone = tones[simulationCalendarEventKind(event)];return <View key={`${event.id}:${eventIndex}`} style={[styles.chip, { backgroundColor: eventTone.bg, borderColor: eventTone.border }]}><AppText numberOfLines={1} style={[styles.chipLabel, { color: eventTone.text }]}>{resolveEventLabel(event)}</AppText></View>; })}{events.length > (width >= 768 ? 3 : 2) ? <AppText style={[styles.more, { color: c.mutedForeground }]}>+{events.length - (width >= 768 ? 3 : 2)} more</AppText> : null}</> : <AppText style={[styles.unavailable, { color: c.mutedForeground }]}>{cell.inCurrentMonth ? "—" : ""}</AppText>}
          {active ? <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, styles.selectedCellBorder, { borderColor: c.primary }]} /> : null}
        </Pressable>;
      })}</View>
    </View> : <AppText style={[styles.note, { color: c.mutedForeground }]}>Daily results are not available for this scenario.</AppText>}
    <AppText style={[styles.gridNote, { color: c.mutedForeground }]}>Grid balances are rounded. Day details show exact amounts. Only dates in this draft’s forecast range are available.</AppText>
    <View style={styles.legend}>{CALENDAR_CATEGORIES.map(category => <View key={category.id} style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: tones[category.id].color }]} /><AppText style={[styles.legendLabel, { color: c.mutedForeground }]}>{category.label}</AppText></View>)}</View>
    {selected ? <View style={[styles.details, { borderColor: c.border }]}>
      <View ref={detailsHeadingRef} focusable tabIndex={-1} accessibilityRole="header" accessibilityLabel={dateLabel(selected.date)}><AppText style={[styles.dayTitle, { color: c.foreground }]}>{dateLabel(selected.date)}</AppText></View>
      <View style={styles.totals}><DayTotals label="Scenario closing balance" day={selected.scenario} safetyFloor={safetyFloor} /><DayTotals label="Current plan closing balance" day={selected.current} safetyFloor={safetyFloor} /></View>
      <View style={[styles.difference, { backgroundColor: c.background, borderColor: c.border }]}><AppText style={[styles.note, { color: c.mutedForeground }]}>Difference from current plan</AppText><ScrollView horizontal showsHorizontalScrollIndicator={false}><AppText sensitive style={[styles.differenceValue, { color: difference === null ? c.mutedForeground : difference >= 0 ? c.success : c.warning }]}>{difference === null ? "Not available" : `${difference > 0 ? "+" : ""}${money(difference)}`}</AppText></ScrollView></View>
      <View style={[styles.eventsColumns, width >= 768 && styles.eventsColumnsWide]}><DayEvents label="Scenario payments & deposits" day={selected.scenario} resolveEventLabel={resolveEventLabel} /><DayEvents label="Current plan payments & deposits" day={selected.current} resolveEventLabel={resolveEventLabel} /></View>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 24, padding: 14, minWidth: 0 }, eyebrow: { fontSize: 10, fontFamily: "Inter_800ExtraBold" }, title: { fontSize: 24, fontFamily: "Inter_800ExtraBold", marginTop: 4 }, scenarioName: { fontSize: 14, fontFamily: "Inter_700Bold", marginTop: 8 }, note: { fontSize: 12, lineHeight: 18 }, range: { fontSize: 11, lineHeight: 16, marginTop: 8 },
  warning: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 14, gap: 4 }, warningTitle: { fontSize: 14, fontFamily: "Inter_700Bold" }, monthNavigation: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 18 }, arrow: { width: 44, height: 44, borderWidth: 1, borderRadius: 13, alignItems: "center", justifyContent: "center" }, monthTitle: { flex: 1, minWidth: 0, fontSize: 18, fontFamily: "Inter_800ExtraBold", textAlign: "center" },
  gridFrame: { borderWidth: 1, borderRadius: 15, overflow: "hidden" }, weekdays: { flexDirection: "row", paddingVertical: 10 }, weekday: { width: "14.285714%", fontSize: 10, textAlign: "center", fontFamily: "Inter_700Bold" }, grid: { flexDirection: "row", flexWrap: "wrap" }, cell: { width: "14.285714%", minWidth: 0, minHeight: 104, borderRightWidth: 1, borderTopWidth: 1, paddingHorizontal: 2, paddingVertical: 6, gap: 3, overflow: "hidden" }, cellWide: { minHeight: 132, padding: 9, gap: 5 }, dayNumber: { fontSize: 13, fontFamily: "Inter_700Bold", textAlign: "center" }, gridBalance: { fontSize: 10, fontFamily: "Inter_800ExtraBold", textAlign: "center" }, gridBalanceNarrow: { fontSize: 9, letterSpacing: -0.2 }, gridBalanceSmall: { fontSize: 8, letterSpacing: -0.3 }, selectedCellBorder: { borderWidth: 2 }, gridBalanceWide: { fontSize: 14 }, unavailable: { textAlign: "center", fontSize: 12 }, chip: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 2, paddingVertical: 1, minWidth: 0 }, chipLabel: { fontSize: 9, fontFamily: "Inter_600SemiBold" }, more: { fontSize: 8, textAlign: "center" }, gridNote: { fontSize: 11, lineHeight: 16, marginTop: 10 }, legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 12 }, legendItem: { flexDirection: "row", alignItems: "center", gap: 4 }, legendDot: { width: 7, height: 7, borderRadius: 4 }, legendLabel: { fontSize: 10 },
  details: { borderTopWidth: 1, paddingTop: 20, marginTop: 20, gap: 14 }, dayTitle: { fontSize: 18, fontFamily: "Inter_800ExtraBold" }, totals: { flexDirection: "row", gap: 10 }, totalCard: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 15, padding: 11, gap: 6 }, totalLabel: { fontSize: 11, minHeight: 30, fontFamily: "Inter_700Bold" }, moneyScroll: { flexGrow: 0, minWidth: 0 }, moneyScrollContent: { alignItems: "center" }, money: { fontSize: 22, fontFamily: "Inter_800ExtraBold" }, moneySmall: { fontSize: 12, fontFamily: "Inter_600SemiBold" }, dailyFlow: { flexDirection: "row", alignItems: "center", gap: 5 }, flowLabel: { fontSize: 10, width: 23 }, difference: { borderWidth: 1, borderRadius: 13, padding: 11, gap: 4 }, differenceValue: { fontSize: 17, fontFamily: "Inter_800ExtraBold" }, eventsColumns: { gap: 18 }, eventsColumnsWide: { flexDirection: "row", gap: 24 }, eventSection: { flex: 1, minWidth: 0, gap: 7 }, eventSectionTitle: { fontSize: 14, fontFamily: "Inter_700Bold", marginBottom: 3 }, event: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, paddingTop: 10, paddingBottom: 3 }, eventDot: { width: 7, height: 7, borderRadius: 4 }, eventCopy: { flex: 1, minWidth: 0 }, eventName: { fontSize: 13, fontFamily: "Inter_600SemiBold" }, eventStatus: { fontSize: 10, marginTop: 2 }, eventAmountScroll: { flexGrow: 0, maxWidth: "43%" }, eventAmount: { fontSize: 13, fontFamily: "Inter_700Bold" },
});
