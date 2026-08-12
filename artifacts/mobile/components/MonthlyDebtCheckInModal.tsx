import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useState } from "react";
import { Image, Modal, Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/AppText";
import type { Bill } from "@/context/BudgetContext";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { useMembership } from "@/context/MembershipContext";
import { useColors } from "@/hooks/useColors";
import {
  calendarMonthKey,
  monthlyDebtCheckInStorageKey,
  needsMonthlyDebtCheckIn,
} from "@/lib/monthlyDebtCheckIn";

const FLO_LOGO = require("@/assets/brand/flo-logo.jpg");

function money(value: number): string {
  return Math.max(0, Number(value) || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function MonthlyDebtCheckInModal({ onReview }: { onReview: () => void }) {
  const c = useColors();
  const { user } = useAuth();
  const { bills, activeHousehold, demoMode } = useBudget();
  const { effectiveTier, loading } = useMembership();
  const [visible, setVisible] = useState(false);

  const activeDebts = useMemo(
    () => bills
      .filter((bill) => bill.is_debt && bill.balance > 0.009 && !bill.end_date)
      .sort((left, right) => left.balance - right.balance || left.name.localeCompare(right.name)),
    [bills],
  );
  const monthKey = calendarMonthKey();
  const householdId = activeHousehold?.householdId ?? activeHousehold?.budgetId ?? "personal";
  const storageKey = user?.id
    ? monthlyDebtCheckInStorageKey(user.id, householdId, monthKey)
    : null;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (
      loading
      || demoMode
      || effectiveTier !== "free"
      || !storageKey
      || !needsMonthlyDebtCheckIn(activeDebts)
    ) {
      setVisible(false);
      return () => { cancelled = true; };
    }

    void AsyncStorage.getItem(storageKey).then((seen) => {
      if (cancelled || seen) return;
      timer = setTimeout(() => {
        if (!cancelled) setVisible(true);
      }, 900);
    }).catch(() => undefined);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeDebts, demoMode, effectiveTier, loading, storageKey]);

  const closeForMonth = async () => {
    setVisible(false);
    if (storageKey) await AsyncStorage.setItem(storageKey, new Date().toISOString()).catch(() => undefined);
  };

  const review = async () => {
    await closeForMonth();
    onReview();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => void closeForMonth()}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.primary + "55" }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={[styles.avatarWrap, { borderColor: c.primary + "55" }]}>
              <Image source={FLO_LOGO} style={styles.avatar} resizeMode="cover" />
            </View>
            <View style={styles.headerCopy}>
              <AppText tone="label" style={[styles.eyebrow, { color: c.primary }]}>MONTHLY CHECK-IN FROM FLO</AppText>
              <AppText tone="title" style={[styles.title, { color: c.foreground }]}>Keep your debt plan current</AppText>
            </View>
            <Pressable accessibilityLabel="Close monthly debt check-in" hitSlop={10} onPress={() => void closeForMonth()}>
              <Feather name="x" size={22} color={c.mutedForeground} />
            </Pressable>
          </View>

          <AppText style={[styles.message, { color: c.foreground }]}>
            Have any balances or minimum payments changed? Review them once this month so Forecast and Snowball use the right numbers.
          </AppText>

          <View style={[styles.debtList, { backgroundColor: c.muted, borderColor: c.border }]}>
            {activeDebts.slice(0, 3).map((debt: Bill) => (
              <View key={debt.id} style={styles.debtRow}>
                <View style={styles.debtNameWrap}>
                  <AppText tone="title" numberOfLines={1} style={[styles.debtName, { color: c.foreground }]}>{debt.name}</AppText>
                  <AppText style={[styles.debtMeta, { color: c.mutedForeground }]}>{money(debt.amount)} minimum</AppText>
                </View>
                <AppText tone="number" style={[styles.debtBalance, { color: c.foreground }]}>{money(debt.balance)}</AppText>
              </View>
            ))}
            {activeDebts.length > 3 ? (
              <AppText style={[styles.more, { color: c.mutedForeground }]}>+{activeDebts.length - 3} more active debt{activeDebts.length - 3 === 1 ? "" : "s"}</AppText>
            ) : null}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Review debt balances and minimum payments"
            onPress={() => void review()}
            style={({ pressed }) => [styles.primary, { backgroundColor: c.primary, opacity: pressed ? 0.8 : 1 }]}
          >
            <Feather name="edit-3" size={17} color={c.primaryForeground} />
            <AppText tone="title" style={[styles.primaryText, { color: c.primaryForeground }]}>Review balances & minimums</AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss debt check-in until next month"
            onPress={() => void closeForMonth()}
            style={({ pressed }) => [styles.secondary, { borderColor: c.border, opacity: pressed ? 0.72 : 1 }]}
          >
            <AppText tone="title" style={[styles.secondaryText, { color: c.foreground }]}>Everything is current</AppText>
          </Pressable>
          <AppText style={[styles.note, { color: c.mutedForeground }]}>Free plan check-in · Flo will ask again next month.</AppText>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(2,6,23,0.78)", alignItems: "center", justifyContent: "center", padding: 20 },
  card: { width: "100%", maxWidth: 520, borderWidth: 1, borderRadius: 28, padding: 18, shadowColor: "#000", shadowOffset: { width: 0, height: 22 }, shadowOpacity: 0.42, shadowRadius: 34, elevation: 18 },
  handle: { alignSelf: "center", width: 42, height: 4, borderRadius: 999, backgroundColor: "rgba(148,163,184,0.42)", marginBottom: 15 },
  header: { flexDirection: "row", alignItems: "center", gap: 11 },
  avatarWrap: { width: 52, height: 52, borderRadius: 18, overflow: "hidden", borderWidth: 1, backgroundColor: "#020617" },
  avatar: { width: "100%", height: "100%" },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { fontSize: 9, letterSpacing: 1.3 },
  title: { fontSize: 21, lineHeight: 25, letterSpacing: -0.5 },
  message: { fontSize: 15, lineHeight: 22, fontFamily: "Inter_600SemiBold", marginTop: 17 },
  debtList: { borderWidth: 1, borderRadius: 17, paddingHorizontal: 13, paddingVertical: 7, marginTop: 15 },
  debtRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12 },
  debtNameWrap: { flex: 1, minWidth: 0 },
  debtName: { fontSize: 13 },
  debtMeta: { fontSize: 11, marginTop: 2 },
  debtBalance: { fontSize: 14 },
  more: { fontSize: 11, fontFamily: "Inter_600SemiBold", paddingBottom: 7 },
  primary: { minHeight: 50, borderRadius: 16, marginTop: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryText: { fontSize: 14 },
  secondary: { minHeight: 46, borderRadius: 16, borderWidth: 1, marginTop: 8, alignItems: "center", justifyContent: "center" },
  secondaryText: { fontSize: 13 },
  note: { fontSize: 10, lineHeight: 15, textAlign: "center", marginTop: 10, fontFamily: "Inter_500Medium" },
});
