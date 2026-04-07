import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { ExtraPaymentModal } from "@/components/ExtraPaymentModal";
import { MonthPicker } from "@/components/MonthPicker";
import colors from "@/constants/colors";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

const MONTH_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function MonthlyScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    bills,
    getEntriesForMonth,
    ensureMonthlyEntries,
    updateMonthlyEntry,
    togglePaid,
    addExtraPayment,
    selectedYear,
    setSelectedYear,
  } = useBudget();

  const [month, setMonth] = useState(new Date().getMonth());
  const [extraModalVisible, setExtraModalVisible] = useState(false);
  const [editingDueDay, setEditingDueDay] = useState<string | null>(null);
  const [dueDayInput, setDueDayInput] = useState("");

  useEffect(() => {
    ensureMonthlyEntries(month, selectedYear);
  }, [month, selectedYear, bills.length, ensureMonthlyEntries]);

  const entries = useMemo(
    () => getEntriesForMonth(month, selectedYear),
    [month, selectedYear, getEntriesForMonth]
  );

  const entriesWithBills = useMemo(
    () =>
      entries
        .map(e => {
          const bill = bills.find(b => b.id === e.billId);
          if (!bill) return null;
          return { entry: e, bill };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b) => a.entry.dueDay - b.entry.dueDay),
    [entries, bills]
  );

  const totalDue = entriesWithBills.reduce((s, x) => s + x.bill.amount, 0);
  const totalPaid = entriesWithBills.reduce((s, x) => s + x.entry.paidAmount, 0);

  const handleDueDaySave = useCallback(
    (entryId: string) => {
      const day = parseInt(dueDayInput);
      if (isNaN(day) || day < 1 || day > 31) return;
      const entry = entries.find(e => e.id === entryId);
      if (entry) {
        updateMonthlyEntry({ ...entry, dueDay: day });
      }
      setEditingDueDay(null);
      setDueDayInput("");
    },
    [dueDayInput, entries, updateMonthlyEntry]
  );

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <View style={[styles.headerArea, { paddingTop: insets.top + 12 + webTopPad }]}>
        <Text style={[styles.title, { color: c.foreground }]}>
          {MONTH_FULL[month]} {selectedYear}
        </Text>
        <Pressable
          onPress={() => setExtraModalVisible(true)}
          style={({ pressed }) => [
            styles.extraBtn,
            { backgroundColor: (c as any).accent ?? "#f0b429", opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Feather name="plus-circle" size={16} color={(c as any).accentForeground ?? "#1a1a2e"} />
          <Text style={[styles.extraBtnText, { color: (c as any).accentForeground ?? "#1a1a2e" }]}>
            Extra
          </Text>
        </Pressable>
      </View>

      <MonthPicker
        selectedMonth={month}
        onSelect={setMonth}
        year={selectedYear}
        onYearChange={setSelectedYear}
      />

      <View style={[styles.summaryRow, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryLabel, { color: c.mutedForeground }]}>Due</Text>
          <Text style={[styles.summaryValue, { color: c.foreground }]}>${totalDue.toFixed(2)}</Text>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: c.border }]} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryLabel, { color: c.mutedForeground }]}>Paid</Text>
          <Text style={[styles.summaryValue, { color: (c as any).success ?? "#2ecc71" }]}>
            ${totalPaid.toFixed(2)}
          </Text>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: c.border }]} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryLabel, { color: c.mutedForeground }]}>Left</Text>
          <Text style={[styles.summaryValue, { color: c.destructive }]}>
            ${(totalDue - totalPaid).toFixed(2)}
          </Text>
        </View>
      </View>

      <FlatList
        data={entriesWithBills}
        keyExtractor={item => item.entry.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        scrollEnabled={entriesWithBills.length > 0}
        ListEmptyComponent={
          <EmptyState
            icon="calendar"
            title="No Bills This Month"
            message="Add bills in the Payment Schedule tab to see them here."
          />
        }
        renderItem={({ item: { entry, bill } }) => {
          const remaining = bill.amount - entry.paidAmount;
          const isEditing = editingDueDay === entry.id;

          return (
            <Pressable
              style={[
                styles.entryRow,
                {
                  backgroundColor: c.card,
                  borderRadius: colors.radius,
                  borderLeftColor: entry.paid ? ((c as any).success ?? "#2ecc71") : c.primary,
                },
              ]}
            >
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  togglePaid(entry.id);
                }}
                style={[
                  styles.checkbox,
                  {
                    borderColor: entry.paid ? ((c as any).success ?? "#2ecc71") : c.border,
                    backgroundColor: entry.paid ? ((c as any).success ?? "#2ecc71") : "transparent",
                  },
                ]}
              >
                {entry.paid ? <Feather name="check" size={14} color="#fff" /> : null}
              </Pressable>

              <View style={styles.entryInfo}>
                <Text
                  style={[
                    styles.entryName,
                    { color: c.foreground, textDecorationLine: entry.paid ? "line-through" : "none" },
                  ]}
                >
                  {bill.name}
                </Text>
                <View style={styles.entryMeta}>
                  {isEditing ? (
                    <View style={styles.dueDayEdit}>
                      <TextInput
                        style={[styles.dueDayInput, { backgroundColor: c.muted, color: c.foreground }]}
                        value={dueDayInput}
                        onChangeText={setDueDayInput}
                        keyboardType="number-pad"
                        autoFocus
                        maxLength={2}
                        onBlur={() => handleDueDaySave(entry.id)}
                        onSubmitEditing={() => handleDueDaySave(entry.id)}
                      />
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => {
                        setEditingDueDay(entry.id);
                        setDueDayInput(entry.dueDay.toString());
                      }}
                      hitSlop={4}
                    >
                      <Text style={[styles.dueDay, { color: c.mutedForeground }]}>
                        Due: Day {entry.dueDay}
                      </Text>
                    </Pressable>
                  )}
                </View>
              </View>

              <View style={styles.entryRight}>
                <Text style={[styles.entryAmount, { color: c.foreground }]}>
                  ${bill.amount.toFixed(2)}
                </Text>
                {entry.paidAmount > 0 && !entry.paid ? (
                  <Text style={[styles.entryPaid, { color: (c as any).success ?? "#2ecc71" }]}>
                    -${entry.paidAmount.toFixed(2)}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        }}
      />

      <ExtraPaymentModal
        visible={extraModalVisible}
        onClose={() => setExtraModalVisible(false)}
        onApply={(amount, method) => addExtraPayment(month, selectedYear, amount, method)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  headerArea: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  extraBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  extraBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  summaryRow: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  summaryItem: {
    flex: 1,
    alignItems: "center",
  },
  summaryDivider: {
    width: 1,
  },
  summaryLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  list: {
    paddingHorizontal: 16,
  },
  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    marginBottom: 8,
    borderLeftWidth: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  entryInfo: {
    flex: 1,
  },
  entryName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  entryMeta: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  dueDay: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  dueDayEdit: {
    flexDirection: "row",
    alignItems: "center",
  },
  dueDayInput: {
    width: 40,
    height: 28,
    borderRadius: 6,
    textAlign: "center",
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  entryRight: {
    alignItems: "flex-end",
  },
  entryAmount: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  entryPaid: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
  },
});
