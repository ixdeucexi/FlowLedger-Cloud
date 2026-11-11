import Feather from "@expo/vector-icons/Feather";
import React, { useEffect, useMemo, useState } from "react";
import { Modal, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  PrivacyPressable as Pressable,
  PrivacyText as Text,
  PrivacyView as View,
} from "@/components/privacy/PrivacyPrimitives";
import {
  AccountForecastPicker,
  accountForecastLabel,
} from "@/components/AccountForecastPicker";
import { AccountForecastSettings } from "@/components/AccountForecastSettings";
import { CalendarAmountLabel } from "@/components/CalendarAmountLabel";
import { CalendarView } from "@/components/CalendarView";
import { useBudget } from "@/context/BudgetContext";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import type { ForecastAccountRef } from "@/lib/accountForecasts";
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
const money = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "Unavailable"
    : value.toLocaleString("en-US", { style: "currency", currency: "USD" });

function AccountAmount({
  label,
  value,
  color,
}: {
  label: string;
  value: number | null | undefined;
  color?: string;
}) {
  const c = useColors();
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricLabel, { color: c.mutedForeground }]}>
        {label}
      </Text>
      <CalendarAmountLabel
        label={money(value)}
        accessibilityLabel={`${label} ${money(value)}`}
        textStyle={[styles.metricAmount, { color: color ?? c.foreground }]}
      />
    </View>
  );
}

export function AccountForecastPanel({
  accountRef,
  month,
  year,
  onPreviousMonth,
  onNextMonth,
  onToday,
  onOpenEvent,
}: {
  accountRef: ForecastAccountRef;
  month: number;
  year: number;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  onOpenEvent?: (event: FinancialEvent) => void;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    getAccountForecast,
    selectedForecastAccountRef,
    setSelectedForecastAccountRef,
    activeHousehold,
    accountForecastReady,
    accountForecastError,
  } = useBudget();
  const forecast = useMemo(
    () => getAccountForecast(accountRef, month, year),
    [getAccountForecast, accountRef, month, year],
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const account = forecast.account;
  const day = selectedDate
    ? forecast.days.find(
        (item) =>
          item.balanceDate === selectedDate ||
          `${year}-${String(month + 1).padStart(2, "0")}-${String(item.day).padStart(2, "0")}` ===
            selectedDate,
      )
    : undefined;
  useEffect(() => {
    setSelectedDate(null);
    setManaging(false);
  }, [accountRef, month, year, activeHousehold?.householdId]);
  useBackDismiss(Boolean(selectedDate), () => setSelectedDate(null));
  useBackDismiss(managing, () => setManaging(false));
  const unavailable = accountForecastError || forecast.unavailableReason;
  const selectedEvents =
    day?.events?.filter((event) => event.kind !== "bank_adjustment") ?? [];

  return (
    <>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 116 },
        ]}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={[styles.brand, { color: c.primary }]}>
              FLOWLEDGER ALGO
            </Text>
            <Text style={[styles.title, { color: c.foreground }]}>
              Forecast
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Today’s account forecast"
            onPress={onToday}
            style={[
              styles.today,
              {
                backgroundColor: c.primary + "16",
                borderColor: c.primary + "40",
              },
            ]}
          >
            <Feather name="calendar" size={18} color={c.primary} />
            <Text style={[styles.todayText, { color: c.primary }]}>Today</Text>
          </Pressable>
        </View>
        <AccountForecastPicker
          label="Forecast account"
          includeHousehold
          visibleOnly
          allowUnassigned={false}
          value={selectedForecastAccountRef}
          onChange={setSelectedForecastAccountRef}
        />
        {!accountForecastReady ? (
          <View
            style={[
              styles.notice,
              { backgroundColor: c.card, borderColor: c.border },
            ]}
          >
            <Text style={[styles.note, { color: c.mutedForeground }]}>
              Loading account details…
            </Text>
          </View>
        ) : null}
        {account ? (
          <View
            style={[
              styles.summary,
              { backgroundColor: c.card, borderColor: c.border },
            ]}
          >
            <View style={styles.accountHeading}>
              <View style={styles.accountCopy}>
                <Text style={[styles.accountName, { color: c.foreground }]}>
                  {accountForecastLabel(account)}
                </Text>
                <Text style={[styles.note, { color: c.mutedForeground }]}>
                  {account.type === "savings"
                    ? "Savings"
                    : account.type === "cash"
                      ? "Cash"
                      : "Checking"}
                  {account.asOfDate
                    ? ` · Balance as of ${account.asOfDate}`
                    : " · Balance date unavailable"}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Planning settings for ${account.name}`}
                onPress={() => setManaging(true)}
                style={styles.iconButton}
              >
                <Feather name="sliders" size={20} color={c.primary} />
              </Pressable>
            </View>
            <View style={styles.metrics}>
              <AccountAmount
                label="Current balance"
                value={account.currentBalance}
              />
              <AccountAmount
                label="Available balance"
                value={account.availableBalance}
              />
            </View>
            <View style={[styles.summaryDivider, { borderColor: c.border }]}>
              <View style={styles.metrics}>
                <AccountAmount
                  label="Projected month end"
                  value={forecast.endingBalance}
                  color={
                    forecast.endingBalance !== null &&
                    forecast.endingBalance < 0
                      ? c.destructive
                      : c.foreground
                  }
                />
                <AccountAmount
                  label="Least breathing room"
                  value={forecast.lowestBalance}
                  color={
                    forecast.lowestBalance !== null &&
                    forecast.lowestBalance < 0
                      ? c.destructive
                      : c.foreground
                  }
                />
              </View>
            </View>
            {account.type === "savings" ? (
              <View
                style={[styles.interest, { backgroundColor: c.success + "0d" }]}
              >
                <Feather name="trending-up" size={17} color={c.success} />
                <View style={styles.interestCopy}>
                  <Text style={[styles.interestTitle, { color: c.foreground }]}>
                    {account.savingsApy === null
                      ? "Add an APY to estimate interest"
                      : `${account.savingsApy}% APY · estimated interest ${money(forecast.estimatedInterest)}`}
                  </Text>
                  <Text style={[styles.small, { color: c.mutedForeground }]}>
                    Estimated interest; your bank’s credits may differ.
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}
        {unavailable ? (
          <View
            accessibilityRole="alert"
            style={[
              styles.notice,
              {
                backgroundColor: c.warning + "10",
                borderColor: c.warning + "40",
              },
            ]}
          >
            <Feather name="info" size={18} color={c.warning} />
            <Text style={[styles.noticeText, { color: c.foreground }]}>
              {unavailable}
            </Text>
          </View>
        ) : null}
        {forecast.unassigned.length ? (
          <View
            style={[
              styles.notice,
              {
                backgroundColor: c.warning + "0d",
                borderColor: c.warning + "35",
              },
            ]}
          >
            <Feather name="help-circle" size={18} color={c.warning} />
            <View style={styles.noticeCopy}>
              <Text style={[styles.noticeTitle, { color: c.foreground }]}>
                {forecast.unassigned.length} planned{" "}
                {forecast.unassigned.length === 1 ? "item needs" : "items need"}{" "}
                an account
              </Text>
              <Text style={[styles.note, { color: c.mutedForeground }]}>
                This forecast includes activity linked to this account. Assign
                the remaining plans for a fuller picture.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setManaging(true)}
                style={styles.textButton}
              >
                <Text style={[styles.textButtonText, { color: c.primary }]}>
                  Assign accounts
                </Text>
                <Feather name="arrow-right" size={15} color={c.primary} />
              </Pressable>
            </View>
          </View>
        ) : null}
        {forecast.lowestBalance !== null && forecast.lowestBalance < 0 ? (
          <View
            accessibilityRole="alert"
            style={[
              styles.notice,
              {
                backgroundColor: c.destructive + "12",
                borderColor: c.destructive + "40",
              },
            ]}
          >
            <Feather name="alert-triangle" size={18} color={c.destructive} />
            <Text style={[styles.noticeText, { color: c.foreground }]}>
              This account needs more breathing room. Money in another
              account won’t cover it until you plan a transfer.
            </Text>
          </View>
        ) : null}
        <View style={styles.monthNavigation}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous account forecast month"
            onPress={onPreviousMonth}
            style={[styles.monthArrow, { borderColor: c.border }]}
          >
            <Feather name="chevron-left" size={24} color={c.mutedForeground} />
          </Pressable>
          <Text style={[styles.monthTitle, { color: c.foreground }]}>
            {MONTHS[month]} {year}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next account forecast month"
            onPress={onNextMonth}
            style={[styles.monthArrow, { borderColor: c.border }]}
          >
            <Feather name="chevron-right" size={24} color={c.mutedForeground} />
          </Pressable>
        </View>
        <CalendarView
          eventsOnly
          month={month}
          year={year}
          transactions={[]}
          dailyBalances={forecast.days}
          selectedDate={selectedDate}
          onDayPress={setSelectedDate}
          safetyFloor={account?.safetyFloor ?? 0}
        />
        <Text style={[styles.footnote, { color: c.mutedForeground }]}>
          Projected from this account’s recorded balance. Estimated interest is
          a forecast, not a posted transaction.
        </Text>
      </ScrollView>
      <Modal
        visible={Boolean(selectedDate)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedDate(null)}
      >
        <View style={styles.overlay}>
          <Pressable
            accessibilityLabel="Close account day"
            style={StyleSheet.absoluteFillObject}
            onPress={() => setSelectedDate(null)}
          />
          <View
            style={[
              styles.daySheet,
              { backgroundColor: c.background, borderColor: c.border },
            ]}
          >
            <View style={styles.sheetHeading}>
              <View style={styles.headerCopy}>
                <Text style={[styles.sheetEyebrow, { color: c.primary }]}>
                  {account?.name ?? "Account"}
                </Text>
                <Text style={[styles.dayTitle, { color: c.foreground }]}>
                  {selectedDate}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close account day"
                onPress={() => setSelectedDate(null)}
                style={styles.iconButton}
              >
                <Feather name="x" size={23} color={c.mutedForeground} />
              </Pressable>
            </View>
            <AccountAmount
              label="Projected closing balance"
              value={day?.balanceSource === "unavailable" ? null : day?.balance}
            />
            <ScrollView
              style={styles.dayEvents}
              contentContainerStyle={styles.dayEventsContent}
            >
              {selectedEvents.map((event) => {
                const estimated =
                  String(event.kind) === "estimated_interest" ||
                  event.estimated;
                const canOpen = Boolean(
                  onOpenEvent &&
                  !estimated &&
                  [
                    "bill",
                    "income",
                    "transaction",
                    "goal",
                    "decision",
                    "extra_payment",
                  ].includes(event.sourceType),
                );
                return (
                  <View
                    key={event.id}
                    style={[
                      styles.event,
                      { backgroundColor: c.card, borderColor: c.border },
                    ]}
                  >
                    <View style={styles.eventCopy}>
                      <Text style={[styles.eventName, { color: c.foreground }]}>
                        {event.name || "Planned activity"}
                      </Text>
                      <Text style={[styles.note, { color: c.mutedForeground }]}>
                        {estimated
                          ? "Estimated interest"
                          : event.status === "actual" ||
                              event.status === "applied" ||
                              event.status === "finalized"
                            ? "Recorded activity"
                            : "Planned activity"}
                      </Text>
                    </View>
                    <View style={styles.eventRight}>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                      >
                        <Text
                          sensitive
                          style={[
                            styles.eventAmount,
                            {
                              color:
                                event.amount >= 0 ? c.success : c.foreground,
                            },
                          ]}
                        >
                          {money(event.amount)}
                        </Text>
                      </ScrollView>
                      {canOpen ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Open ${event.name || "activity"}`}
                          onPress={() => {
                            setSelectedDate(null);
                            onOpenEvent?.(event);
                          }}
                          style={styles.eventOpen}
                        >
                          <Text
                            style={[
                              styles.textButtonText,
                              { color: c.primary },
                            ]}
                          >
                            Open
                          </Text>
                          <Feather
                            name="chevron-right"
                            size={14}
                            color={c.primary}
                          />
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                );
              })}
              {!selectedEvents.length ? (
                <Text style={[styles.emptyDay, { color: c.mutedForeground }]}>
                  {day?.balanceSource === "unavailable"
                    ? "A recorded starting balance is needed for this date."
                    : "No planned activity for this account on this day."}
                </Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
      <Modal
        visible={managing}
        transparent
        animationType="fade"
        onRequestClose={() => setManaging(false)}
      >
        <View style={styles.overlay}>
          <Pressable
            accessibilityLabel="Close account planning"
            style={StyleSheet.absoluteFillObject}
            onPress={() => setManaging(false)}
          />
          <View
            style={[
              styles.manageSheet,
              { backgroundColor: c.background, borderColor: c.border },
            ]}
          >
            <View style={styles.sheetHeading}>
              <Text style={[styles.dayTitle, { color: c.foreground }]}>
                Account planning
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close account planning"
                onPress={() => setManaging(false)}
                style={styles.iconButton}
              >
                <Feather name="x" size={23} color={c.mutedForeground} />
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.manageContent}
              keyboardShouldPersistTaps="handled"
            >
              <AccountForecastSettings initialAccountRef={accountRef} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: 1140,
    alignSelf: "center",
    paddingHorizontal: 16,
    gap: 20,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerCopy: { flex: 1, minWidth: 0 },
  brand: { fontFamily: "Inter_800ExtraBold", fontSize: 10, letterSpacing: 2 },
  title: {
    fontSize: 32,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -1,
    marginTop: 4,
  },
  today: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  todayText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  summary: { borderWidth: 1, borderRadius: 24, padding: 16, gap: 16 },
  accountHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  accountCopy: { flex: 1, minWidth: 0 },
  accountName: { fontSize: 18, fontFamily: "Inter_700Bold", lineHeight: 25 },
  note: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },
  metrics: { flexDirection: "row", gap: 16 },
  metric: { flex: 1, minWidth: 0, gap: 6, alignItems: "flex-start" },
  metricLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  metricAmount: { fontSize: 21, fontFamily: "Inter_800ExtraBold" },
  summaryDivider: { borderTopWidth: 1, paddingTop: 16 },
  interest: { flexDirection: "row", gap: 9, borderRadius: 12, padding: 11 },
  interestCopy: { flex: 1, minWidth: 0, gap: 3 },
  interestTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    lineHeight: 18,
  },
  small: { fontSize: 11, lineHeight: 16 },
  notice: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  noticeCopy: { flex: 1, minWidth: 0, gap: 5 },
  noticeTitle: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_700Bold" },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 20 },
  textButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 6,
    paddingBottom: 3,
  },
  textButtonText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  monthNavigation: { flexDirection: "row", alignItems: "center", gap: 10 },
  monthArrow: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  monthTitle: {
    flex: 1,
    minWidth: 0,
    textAlign: "center",
    fontSize: 18,
    textTransform: "uppercase",
    fontFamily: "Inter_800ExtraBold",
  },
  footnote: { fontSize: 11, lineHeight: 17 },
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  daySheet: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "85%",
    padding: 18,
    borderRadius: 24,
    borderWidth: 1,
    gap: 18,
  },
  sheetHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  sheetEyebrow: { fontSize: 11, fontFamily: "Inter_700Bold" },
  dayTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  dayEvents: { flexGrow: 0 },
  dayEventsContent: { gap: 10 },
  event: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 13,
    borderWidth: 1,
    borderRadius: 14,
  },
  eventCopy: { flex: 1, minWidth: 0, gap: 5 },
  eventName: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  eventRight: { minWidth: 0, maxWidth: "45%", gap: 8, alignItems: "flex-end" },
  eventAmount: { fontSize: 15, fontFamily: "Inter_700Bold", flexShrink: 0 },
  eventOpen: { flexDirection: "row", alignItems: "center", paddingVertical: 3 },
  emptyDay: { fontSize: 13, lineHeight: 20, paddingVertical: 16 },
  manageSheet: {
    width: "100%",
    maxWidth: 760,
    maxHeight: "90%",
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    gap: 12,
  },
  manageContent: { paddingBottom: 20 },
});
