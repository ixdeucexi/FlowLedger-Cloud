import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { AppText } from "@/components/AppText";
import { PrivacyPressable as Pressable, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import type { ForecastAccountDescriptor, ForecastAccountRef } from "@/lib/accountForecasts";
import { compactDateOnly, dateOnlyToLocalDate } from "@/lib/dateLabels";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const finite = (value: number | null) => value !== null && Number.isFinite(value);
const amount = (value: number | null) => finite(value) ? currency.format(value!) : null;
const validDate = (date: string | null) => Boolean(date && dateOnlyToLocalDate(date));
const asOf = (date: string | null) => date && validDate(date)
  ? `As of ${compactDateOnly(date)}, ${date.slice(0, 4)}`
  : "Balance date unavailable";

/** Observed cash balances only; the existing catalog owns identity and scope. */
export function AccountBalancesCard() {
  const c = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const {
    activeHousehold, forecastAccounts, startupCoreReady, loading, loadError,
    accountForecastReady, accountForecastError, forecastVisibilityReady, forecastVisibilityError,
    hiddenForecastAccountRefs, setSelectedForecastAccountRef,
  } = useBudget();
  const scope = user?.id && activeHousehold?.householdId && activeHousehold?.budgetId
    ? JSON.stringify([user.id, activeHousehold.householdId, activeHousehold.budgetId])
    : null;
  const ready = Boolean(scope && startupCoreReady && !loading && !loadError);
  const [manualExpandedScope, setManualExpandedScope] = useState<string | null>(null);
  useEffect(() => { setManualExpandedScope(null); }, [scope]);
  const navigationReady = accountForecastReady && forecastVisibilityReady && !accountForecastError && !forecastVisibilityError;
  const latest = useRef({ scope, generation: 0, ready, forecastAccounts, navigationReady,
    hiddenForecastAccountRefs, setSelectedForecastAccountRef });
  const generation = latest.current.generation + Number(latest.current.scope !== scope);
  latest.current = { scope, generation, ready, forecastAccounts, navigationReady,
    hiddenForecastAccountRefs, setSelectedForecastAccountRef };

  const openForecast = (ref: ForecastAccountRef) => {
    const current = latest.current;
    const account = current.forecastAccounts.find(row => row.ref === ref);
    if (current.scope !== scope || current.generation !== generation || !current.ready
      || !current.navigationReady
      || current.hiddenForecastAccountRefs.includes(ref) || !account?.active
      || account.unavailableReason || !finite(account.currentBalance) || !validDate(account.asOfDate)) return;
    current.setSelectedForecastAccountRef(account.ref);
    router.push("/(tabs)/monthly");
  };
  const accounts = ready ? forecastAccounts.filter(account => account.active) : [];
  const connected = accounts.filter(account => account.source === "bank");
  const manual = accounts.filter(account => account.source === "manual");
  const showManual = !connected.length || manualExpandedScope === scope;

  const row = (account: ForecastAccountDescriptor, index: number) => {
    const current = amount(account.currentBalance);
    const available = amount(account.availableBalance);
    const showAvailable = available !== null && available !== current;
    const hidden = hiddenForecastAccountRefs.includes(account.ref);
    const forecastStatus = hidden ? "Forecast off"
      : account.unavailableReason || current === null || !validDate(account.asOfDate) || accountForecastError || forecastVisibilityError
        ? "Forecast unavailable"
        : !accountForecastReady || !forecastVisibilityReady ? "Forecast loading" : null;
    const enabled = forecastStatus === null;
    const label = `${account.name}${account.mask ? ` · ••${account.mask}` : ""}`;
    const date = asOf(account.asOfDate);
    const balanceLabel = `Current balance ${current ?? "unavailable"}.${showAvailable ? ` Available balance ${available}.` : ""} ${date}.`;
    const large = (current?.length ?? 0) > 12 || (available?.length ?? 0) > 12;
    return (
      <Pressable
        key={account.ref}
        accessibilityRole="button"
        accessibilityLabel={`${enabled ? "View forecast for " : "Account balance for "}${label}. ${balanceLabel}${forecastStatus ? ` ${forecastStatus}.` : ""}`}
        accessibilityHint={enabled ? "Opens this account's calendar" : account.unavailableReason ?? undefined}
        disabled={!enabled}
        onPress={() => openForecast(account.ref)}
        style={({ pressed }) => [styles.row, index > 0 && { borderTopWidth: 1, borderTopColor: c.border }, { opacity: pressed ? 0.72 : 1 }]}
      >
        <View style={[styles.icon, { backgroundColor: c.primary + "12" }]}>
          <Feather name={account.type === "savings" ? "heart" : "credit-card"} size={16} color={c.primary} />
        </View>
        <View style={[styles.rowContent, large && styles.largeRow]}>
          <View style={styles.identity}>
            <AppText style={[styles.name, { color: c.foreground }]} numberOfLines={2}>{account.name}</AppText>
            <AppText style={[styles.detail, { color: c.mutedForeground }]}>
              {account.source === "manual" ? "Manual · " : ""}{account.type === "savings" ? "Savings" : account.type === "cash" ? "Cash" : "Checking"}{account.mask ? ` · ••${account.mask}` : ""}
            </AppText>
            <AppText style={[styles.date, { color: c.mutedForeground }]}>{date}</AppText>
            {forecastStatus ? <AppText style={[styles.date, { color: c.mutedForeground }]}>{forecastStatus}</AppText> : null}
          </View>
          <View style={[styles.values, large && styles.largeValues]}>
            {current !== null ? (
              <AppText sensitive tone="number" accessibilityLabel={`Current balance ${current}`} numberOfLines={1}
                style={[styles.balance, current.length > 16 && styles.longBalance, { color: account.currentBalance! < 0 ? c.destructive : c.foreground }]}>
                {current}
              </AppText>
            ) : <AppText style={[styles.unavailable, { color: c.mutedForeground }]}>Balance unavailable</AppText>}
            {showAvailable ? <AppText style={[styles.available, { color: c.mutedForeground }]} numberOfLines={1}>Available {available}</AppText> : null}
          </View>
        </View>
        <View style={styles.chevron}>
          {enabled ? <Feather name="chevron-right" size={15} color={c.mutedForeground} /> : null}
        </View>
      </Pressable>
    );
  };

  return (
    <View accessibilityLabel="Account balances" style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.header}>
        <AppText tone="title" style={[styles.title, { color: c.foreground }]}>Accounts</AppText>
        <AppText style={[styles.columnLabel, { color: c.mutedForeground }]}>Current balance</AppText>
      </View>
      {loadError ? <AppText accessibilityRole="alert" style={[styles.message, { color: c.mutedForeground }]}>Account balances couldn't be loaded. Try refreshing.</AppText>
        : !ready ? <AppText style={[styles.message, { color: c.mutedForeground }]}>Loading account balances…</AppText>
          : !accounts.length ? <AppText style={[styles.message, { color: c.mutedForeground }]}>No checking or savings accounts yet.</AppText>
            : <>
              {connected.map(row)}
              {connected.length > 0 && manual.length > 0 ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Manual accounts (${manual.length})`}
                  aria-expanded={showManual}
                  accessibilityState={{ expanded: showManual }}
                  onPress={() => {
                    if (latest.current.scope !== scope || latest.current.generation !== generation || !latest.current.ready) return;
                    setManualExpandedScope(previous => previous === scope ? null : scope);
                  }}
                  style={[styles.manualToggle, { borderTopColor: c.border }]}>
                  <AppText style={[styles.manualLabel, { color: c.mutedForeground }]}>Manual accounts ({manual.length})</AppText>
                  <Feather name={showManual ? "chevron-up" : "chevron-down"} size={16} color={c.mutedForeground} />
                </Pressable>
              ) : null}
              {showManual ? manual.map(row) : null}
            </>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: "100%", minWidth: 0, borderWidth: 1, borderRadius: 22, paddingHorizontal: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: 15, paddingBottom: 3 },
  title: { fontSize: 17, fontWeight: "700" },
  columnLabel: { fontSize: 11 },
  row: { width: "100%", minWidth: 0, minHeight: 76, paddingVertical: 13, flexDirection: "row", alignItems: "center", gap: 9 },
  icon: { width: 30, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  rowContent: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10 },
  largeRow: { flexDirection: "column", alignItems: "stretch", gap: 5 },
  identity: { flex: 1, minWidth: 0 },
  name: { fontSize: 13, fontWeight: "600", flexShrink: 1 },
  detail: { fontSize: 11, marginTop: 3 },
  date: { fontSize: 10, marginTop: 2 },
  values: { alignItems: "flex-end", flexShrink: 0, maxWidth: "63%" },
  largeValues: { alignSelf: "flex-end", maxWidth: "100%" },
  balance: { fontSize: 18, fontWeight: "700", fontVariant: ["tabular-nums"] },
  longBalance: { fontSize: 16 },
  available: { fontSize: 10, marginTop: 4 },
  unavailable: { fontSize: 11, maxWidth: 100, textAlign: "right" },
  chevron: { width: 12, flexShrink: 0 },
  manualToggle: { minHeight: 44, borderTopWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  manualLabel: { fontSize: 12, fontWeight: "600" },
  message: { fontSize: 13, paddingVertical: 20 },
});
