import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AddTransactionModal } from "@/components/AddTransactionModal";
import { CalendarView } from "@/components/CalendarView";
import { EmptyState } from "@/components/EmptyState";
import { MonthPicker } from "@/components/MonthPicker";
import { SnowballModal } from "@/components/SnowballModal";
import colors from "@/constants/colors";
import type { Transaction } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

const MONTH_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];

type Tab = "bills" | "calendar";

export default function MonthlyScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    bills, getEntriesForMonth, ensureMonthlyEntries, togglePaid,
    runSnowball, settings, selectedYear, setSelectedYear,
    getTransactionsForMonth, addTransaction, updateTransaction, deleteTransaction,
  } = useBudget();

  const [month, setMonth] = useState(new Date().getMonth());
  const [activeTab, setActiveTab] = useState<Tab>("bills");
  const [snowballVisible, setSnowballVisible] = useState(false);
  const [txModalVisible, setTxModalVisible] = useState(false);
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => { ensureMonthlyEntries(month, selectedYear); }, [month, selectedYear, bills.length]);

  const entries = useMemo(() => getEntriesForMonth(month, selectedYear), [month, selectedYear, getEntriesForMonth]);
  const txList = useMemo(() => getTransactionsForMonth(month, selectedYear), [month, selectedYear, getTransactionsForMonth]);

  const entriesWithBills = useMemo(() =>
    entries.map(e => {
      const bill = bills.find(b => b.id === e.billId);
      if (!bill) return null;
      return { entry: e, bill };
    }).filter((x): x is NonNullable<typeof x> => x !== null).sort((a, b) => a.bill.due_day - b.bill.due_day),
    [entries, bills]
  );

  const totalDue = entriesWithBills.reduce((s, x) => s + x.bill.amount, 0);
  const totalPaid = entriesWithBills.reduce((s, x) => s + x.entry.paid_amount, 0);
  const txIncome = txList.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const txExpense = txList.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

  const selectedDateTxs = selectedDate ? txList.filter(t => t.date === selectedDate) : txList;

  const handleDayPress = (date: string) => {
    setSelectedDate(prev => prev === date ? null : date);
    setSelectedDate(date);
  };

  const handleDeleteTx = (id: string) => {
    Alert.alert("Delete Transaction", "Remove this transaction?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); deleteTransaction(id); } },
    ]);
  };

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 + webTopPad }]}>
        <Text style={[styles.title, { color: c.foreground }]}>{MONTH_FULL[month]}</Text>
        <View style={styles.headerBtns}>
          {activeTab === "bills" ? (
            <Pressable
              onPress={() => setSnowballVisible(true)}
              style={({ pressed }) => [styles.snowBtn, { backgroundColor: c.primary + "20", opacity: pressed ? 0.7 : 1 }]}
            >
              <Feather name="zap" size={16} color={c.primary} />
              <Text style={[styles.snowBtnText, { color: c.primary }]}>
                {settings.paymentMethod === "snowball" ? "Snowball" : "Avalanche"}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => { setEditTx(null); setSelectedDate(null); setTxModalVisible(true); }}
              style={({ pressed }) => [styles.addTxBtn, { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}
            >
              <Feather name="plus" size={18} color={c.primaryForeground} />
            </Pressable>
          )}
        </View>
      </View>

      <MonthPicker selectedMonth={month} onSelect={setMonth} year={selectedYear} onYearChange={setSelectedYear} />

      <View style={[styles.tabBar, { backgroundColor: c.card, borderRadius: colors.radius, marginHorizontal: 16 }]}>
        {(["bills", "calendar"] as Tab[]).map(t => (
          <Pressable
            key={t}
            onPress={() => setActiveTab(t)}
            style={[styles.tabBtn, { backgroundColor: activeTab === t ? c.primary : "transparent", borderRadius: colors.radius - 2 }]}
          >
            <Feather name={t === "bills" ? "list" : "calendar"} size={14} color={activeTab === t ? c.primaryForeground : c.mutedForeground} />
            <Text style={[styles.tabBtnText, { color: activeTab === t ? c.primaryForeground : c.mutedForeground }]}>
              {t === "bills" ? "Bills" : "Calendar"}
            </Text>
          </Pressable>
        ))}
      </View>

      {activeTab === "bills" ? (
        <>
          <View style={[styles.summaryRow, { backgroundColor: c.card, borderRadius: colors.radius, marginHorizontal: 16, marginTop: 12 }]}>
            {[
              { label: "Due", value: `$${totalDue.toFixed(0)}`, color: c.foreground },
              { label: "Paid", value: `$${totalPaid.toFixed(0)}`, color: c.success },
              { label: "Left", value: `$${(totalDue - totalPaid).toFixed(0)}`, color: c.destructive },
            ].map((item, i) => (
              <React.Fragment key={item.label}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: c.border }]} />}
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryLabel, { color: c.mutedForeground }]}>{item.label}</Text>
                  <Text style={[styles.summaryValue, { color: item.color }]}>{item.value}</Text>
                </View>
              </React.Fragment>
            ))}
          </View>

          <FlatList
            data={entriesWithBills}
            keyExtractor={item => item.entry.id}
            contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
            scrollEnabled={entriesWithBills.length > 0}
            ListEmptyComponent={<EmptyState icon="calendar" title="No Bills" message="Bills show here when recurring bills are set up." />}
            renderItem={({ item: { entry, bill } }) => {
              const progress = bill.amount > 0 ? Math.min(entry.paid_amount / bill.amount, 1) : 0;
              return (
                <Pressable
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); togglePaid(entry.id); }}
                  style={[styles.entryCard, { backgroundColor: c.card, borderRadius: colors.radius, borderLeftColor: entry.paid ? c.success : bill.is_debt ? c.destructive : c.primary }]}
                >
                  <View style={[styles.checkBox, { borderColor: entry.paid ? c.success : c.border, backgroundColor: entry.paid ? c.success : "transparent" }]}>
                    {entry.paid && <Feather name="check" size={14} color="#fff" />}
                  </View>
                  <View style={styles.entryBody}>
                    <View style={styles.entryTop}>
                      <Text style={[styles.entryName, { color: c.foreground, textDecorationLine: entry.paid ? "line-through" : "none" }]}>{bill.name}</Text>
                      <Text style={[styles.entryAmount, { color: c.foreground }]}>${bill.amount.toFixed(2)}</Text>
                    </View>
                    <View style={styles.entryMeta}>
                      <Text style={[styles.entryDue, { color: c.mutedForeground }]}>Due day {bill.due_day}</Text>
                      {bill.is_debt && bill.balance > 0 && (
                        <Text style={[styles.entryDue, { color: c.destructive }]}>Balance: ${bill.balance.toFixed(0)}</Text>
                      )}
                    </View>
                    {entry.paid_amount > 0 && (
                      <View style={{ marginTop: 6 }}>
                        <View style={[styles.progressBg, { backgroundColor: c.muted }]}>
                          <View style={[styles.progressFill, { width: `${progress * 100}%` as any, backgroundColor: c.success }]} />
                        </View>
                      </View>
                    )}
                  </View>
                </Pressable>
              );
            }}
          />
        </>
      ) : (
        <ScrollView contentContainerStyle={[styles.calScroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
          <View style={{ marginHorizontal: 16, marginTop: 12 }}>
            <View style={[styles.txSummary, { backgroundColor: c.card, borderRadius: colors.radius }]}>
              <View style={styles.txSumItem}>
                <Text style={[styles.txSumLabel, { color: c.mutedForeground }]}>Income</Text>
                <Text style={[styles.txSumValue, { color: c.success }]}>${txIncome.toFixed(0)}</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: c.border }]} />
              <View style={styles.txSumItem}>
                <Text style={[styles.txSumLabel, { color: c.mutedForeground }]}>Spent</Text>
                <Text style={[styles.txSumValue, { color: c.destructive }]}>${txExpense.toFixed(0)}</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: c.border }]} />
              <View style={styles.txSumItem}>
                <Text style={[styles.txSumLabel, { color: c.mutedForeground }]}>Net</Text>
                <Text style={[styles.txSumValue, { color: txIncome - txExpense >= 0 ? c.success : c.destructive }]}>
                  ${(txIncome - txExpense).toFixed(0)}
                </Text>
              </View>
            </View>

            <CalendarView month={month} year={selectedYear} transactions={txList} onDayPress={handleDayPress} />

            {selectedDate && (
              <View style={{ marginBottom: 8 }}>
                <View style={styles.dateHeader}>
                  <Text style={[styles.dateTitle, { color: c.foreground }]}>{selectedDate}</Text>
                  <Pressable
                    onPress={() => { setEditTx(null); setTxModalVisible(true); }}
                    style={({ pressed }) => [styles.addTxBtn, { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}
                  >
                    <Feather name="plus" size={16} color={c.primaryForeground} />
                  </Pressable>
                </View>
              </View>
            )}

            {(selectedDate ? txList.filter(t => t.date === selectedDate) : txList.slice().sort((a, b) => b.date.localeCompare(a.date))).map(tx => (
              <Pressable
                key={tx.id}
                onPress={() => { setEditTx(tx); setTxModalVisible(true); }}
                onLongPress={() => handleDeleteTx(tx.id)}
                style={[styles.txRow, { backgroundColor: c.card, borderRadius: colors.radius }]}
              >
                <View style={[styles.txIcon, { backgroundColor: tx.amount > 0 ? c.success + "20" : c.destructive + "20" }]}>
                  <Feather name={tx.amount > 0 ? "arrow-down-left" : "arrow-up-right"} size={16} color={tx.amount > 0 ? c.success : c.destructive} />
                </View>
                <View style={styles.txInfo}>
                  <Text style={[styles.txNote, { color: c.foreground }]}>{tx.note || tx.category}</Text>
                  <Text style={[styles.txDate, { color: c.mutedForeground }]}>{tx.date} · {tx.category}</Text>
                </View>
                <Text style={[styles.txAmount, { color: tx.amount > 0 ? c.success : c.destructive }]}>
                  {tx.amount > 0 ? "+" : ""}${Math.abs(tx.amount).toFixed(2)}
                </Text>
              </Pressable>
            ))}

            {txList.length === 0 && (
              <EmptyState icon="credit-card" title="No Transactions" message="Tap the + button to add a transaction for this month." actionLabel="Add Transaction" onAction={() => { setEditTx(null); setTxModalVisible(true); }} />
            )}
          </View>
        </ScrollView>
      )}

      <SnowballModal
        visible={snowballVisible}
        onClose={() => setSnowballVisible(false)}
        method={settings.paymentMethod}
        onRun={(amount) => runSnowball(month, selectedYear, amount)}
      />

      <AddTransactionModal
        visible={txModalVisible}
        onClose={() => { setTxModalVisible(false); setEditTx(null); }}
        onSave={(data) => {
          if ("id" in data) updateTransaction(data as Transaction);
          else addTransaction({ ...data, date: selectedDate ?? data.date });
        }}
        editTx={editTx}
        defaultDate={selectedDate ?? undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingBottom: 10 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  headerBtns: { flexDirection: "row", gap: 8, alignItems: "center" },
  snowBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  snowBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  addTxBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  tabBar: { flexDirection: "row", padding: 4, gap: 4, marginBottom: 0 },
  tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10 },
  tabBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  summaryRow: { flexDirection: "row", padding: 14, marginBottom: 4 },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  summaryValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  divider: { width: 1 },
  list: { paddingHorizontal: 16, paddingTop: 8 },
  entryCard: { flexDirection: "row", alignItems: "center", padding: 14, marginBottom: 8, borderLeftWidth: 3, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1 },
  checkBox: { width: 26, height: 26, borderRadius: 7, borderWidth: 2, alignItems: "center", justifyContent: "center", marginRight: 12 },
  entryBody: { flex: 1 },
  entryTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  entryName: { fontSize: 15, fontFamily: "Inter_600SemiBold", flex: 1 },
  entryAmount: { fontSize: 15, fontFamily: "Inter_700Bold", marginLeft: 8 },
  entryMeta: { flexDirection: "row", gap: 12, marginTop: 4 },
  entryDue: { fontSize: 12, fontFamily: "Inter_400Regular" },
  progressBg: { height: 3, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: 3, borderRadius: 2 },
  calScroll: { paddingTop: 4 },
  txSummary: { flexDirection: "row", padding: 14, marginBottom: 12 },
  txSumItem: { flex: 1, alignItems: "center" },
  txSumLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  txSumValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  dateHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8, marginTop: 8 },
  dateTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  txRow: { flexDirection: "row", alignItems: "center", padding: 12, marginBottom: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1 },
  txIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: 12 },
  txInfo: { flex: 1 },
  txNote: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  txDate: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  txAmount: { fontSize: 14, fontFamily: "Inter_700Bold", marginLeft: 8 },
});
