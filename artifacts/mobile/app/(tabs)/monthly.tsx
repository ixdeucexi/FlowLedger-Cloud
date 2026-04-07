import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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

type TabView = "bills" | "calendar";

function PaymentStatusBadge({ paid, partial }: { paid: boolean; partial: boolean }) {
  const c = useColors();
  if (paid) return (
    <View style={[styles.badge, { backgroundColor: c.success + "25" }]}>
      <Text style={[styles.badgeText, { color: c.success }]}>PAID</Text>
    </View>
  );
  if (partial) return (
    <View style={[styles.badge, { backgroundColor: c.warning + "25" }]}>
      <Text style={[styles.badgeText, { color: c.warning }]}>PARTIAL</Text>
    </View>
  );
  return (
    <View style={[styles.badge, { backgroundColor: c.destructive + "20" }]}>
      <Text style={[styles.badgeText, { color: c.destructive }]}>UNPAID</Text>
    </View>
  );
}

export default function MonthlyScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    bills, getAmount, getPaidAmount, setPaidAmount, setCustomAmount,
    getMonthlyBills, runSnowball, settings,
    selectedYear, setSelectedYear, dashboardFilter, setDashboardFilter,
    getTransactionsForMonth, addTransaction, updateTransaction, deleteTransaction,
  } = useBudget();

  const [month, setMonth] = useState(new Date().getMonth());
  const [activeTab, setActiveTab] = useState<TabView>("bills");
  const [snowballVisible, setSnowballVisible] = useState(false);
  const [txModalVisible, setTxModalVisible] = useState(false);
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editingAmounts, setEditingAmounts] = useState<Record<string, string>>({});
  const [editingPaid, setEditingPaid] = useState<Record<string, string>>({});
  const [billFilter, setBillFilter] = useState<"all" | "paid" | "unpaid">("all");

  useEffect(() => {
    if (dashboardFilter === "paid") { setBillFilter("paid"); setDashboardFilter(null); }
    else if (dashboardFilter === "unpaid") { setBillFilter("unpaid"); setDashboardFilter(null); }
  }, [dashboardFilter]);

  const monthBills = useMemo(() => getMonthlyBills(month, selectedYear), [getMonthlyBills, month, selectedYear]);

  const billsWithData = useMemo(() => {
    return monthBills
      .map(b => {
        const amount = getAmount(b, month, selectedYear);
        const paid = getPaidAmount(b.id, month, selectedYear);
        const isPaid = paid >= amount && amount > 0;
        const isPartial = paid > 0 && !isPaid;
        return { bill: b, amount, paid, isPaid, isPartial };
      })
      .filter(x => {
        if (billFilter === "paid") return x.isPaid;
        if (billFilter === "unpaid") return !x.isPaid;
        return true;
      })
      .sort((a, b) => a.bill.due_day - b.bill.due_day);
  }, [monthBills, getAmount, getPaidAmount, month, selectedYear, billFilter]);

  const totalDue = useMemo(() => monthBills.reduce((s, b) => s + getAmount(b, month, selectedYear), 0), [monthBills, getAmount, month, selectedYear]);
  const totalPaid = useMemo(() => monthBills.reduce((s, b) => s + getPaidAmount(b.id, month, selectedYear), 0), [monthBills, getPaidAmount, month, selectedYear]);

  const txList = useMemo(() => getTransactionsForMonth(month, selectedYear), [getTransactionsForMonth, month, selectedYear]);
  const txIncome = txList.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const txExpense = txList.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

  const handlePaidAmountBlur = useCallback((billId: string, key: string) => {
    const val = editingPaid[key];
    if (val === undefined) return;
    const parsed = parseFloat(val) || 0;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPaidAmount(billId, month, selectedYear, parsed);
    setEditingPaid(p => { const n = { ...p }; delete n[key]; return n; });
  }, [editingPaid, setPaidAmount, month, selectedYear]);

  const handleCustomAmountBlur = useCallback((bill: { id: string; amount: number }, key: string) => {
    const val = editingAmounts[key];
    if (val === undefined) return;
    const parsed = parseFloat(val);
    const finalAmount = isNaN(parsed) || parsed === bill.amount ? undefined : parsed;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCustomAmount(bill.id, month, selectedYear, finalAmount);
    setEditingAmounts(p => { const n = { ...p }; delete n[key]; return n; });
  }, [editingAmounts, setCustomAmount, month, selectedYear]);

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
              style={({ pressed }) => [styles.zapBtn, { backgroundColor: c.primary + "20", opacity: pressed ? 0.7 : 1 }]}
            >
              <Feather name="zap" size={15} color={c.primary} />
              <Text style={[styles.zapBtnText, { color: c.primary }]}>
                {settings.paymentMethod === "snowball" ? "Snowball" : "Avalanche"}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => { setEditTx(null); setTxModalVisible(true); }}
              style={({ pressed }) => [styles.iconBtn, { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}
            >
              <Feather name="plus" size={18} color={c.primaryForeground} />
            </Pressable>
          )}
        </View>
      </View>

      <MonthPicker selectedMonth={month} onSelect={setMonth} year={selectedYear} onYearChange={setSelectedYear} />

      <View style={[styles.tabBar, { backgroundColor: c.muted, borderRadius: colors.radius, marginHorizontal: 16, marginBottom: 10 }]}>
        {(["bills", "calendar"] as TabView[]).map(t => (
          <Pressable
            key={t}
            onPress={() => setActiveTab(t)}
            style={[styles.tabBtn, { backgroundColor: activeTab === t ? c.card : "transparent", borderRadius: colors.radius - 2 }]}
          >
            <Feather name={t === "bills" ? "list" : "calendar"} size={14} color={activeTab === t ? c.primary : c.mutedForeground} />
            <Text style={[styles.tabBtnText, { color: activeTab === t ? c.primary : c.mutedForeground }]}>
              {t === "bills" ? "Bills" : "Transactions"}
            </Text>
          </Pressable>
        ))}
      </View>

      {activeTab === "bills" ? (
        <>
          <View style={[styles.summaryRow, { backgroundColor: c.card, marginHorizontal: 16, borderRadius: colors.radius, marginBottom: 8 }]}>
            {[
              { label: "Due", value: `$${totalDue.toFixed(0)}`, color: c.foreground },
              { label: "Paid", value: `$${Math.min(totalPaid, totalDue).toFixed(0)}`, color: c.success },
              { label: "Remaining", value: `$${Math.max(0, totalDue - totalPaid).toFixed(0)}`, color: c.destructive },
            ].map((s, i) => (
              <React.Fragment key={s.label}>
                {i > 0 && <View style={[styles.sep, { backgroundColor: c.border }]} />}
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryLabel, { color: c.mutedForeground }]}>{s.label}</Text>
                  <Text style={[styles.summaryValue, { color: s.color }]}>{s.value}</Text>
                </View>
              </React.Fragment>
            ))}
          </View>

          <View style={[styles.billFilterRow, { paddingHorizontal: 16, marginBottom: 4 }]}>
            {(["all", "paid", "unpaid"] as const).map(f => (
              <Pressable
                key={f}
                onPress={() => setBillFilter(f)}
                style={[styles.filterPill, { backgroundColor: billFilter === f ? c.primary : c.muted, borderRadius: 20 }]}
              >
                <Text style={[styles.filterPillText, { color: billFilter === f ? c.primaryForeground : c.mutedForeground }]}>
                  {f === "all" ? "All" : f === "paid" ? "Paid" : "Unpaid"}
                </Text>
              </Pressable>
            ))}
          </View>

          <FlatList
            data={billsWithData}
            keyExtractor={item => item.bill.id}
            contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<EmptyState icon="calendar" title="No Bills" message="Add recurring bills to track them here." />}
            renderItem={({ item: { bill, amount, paid, isPaid, isPartial } }) => {
              const borderColor = isPaid ? c.success : isPartial ? c.warning : c.destructive;
              const amtKey = `${bill.id}-${month}-${selectedYear}-amt`;
              const paidKey = `${bill.id}-${month}-${selectedYear}-paid`;
              const displayAmt = editingAmounts[amtKey] !== undefined ? editingAmounts[amtKey] : amount.toFixed(2);
              const displayPaid = editingPaid[paidKey] !== undefined ? editingPaid[paidKey] : paid > 0 ? paid.toFixed(2) : "";
              const remaining = Math.max(0, amount - paid);

              return (
                <View style={[styles.entryCard, { backgroundColor: c.card, borderRadius: colors.radius, borderLeftColor: borderColor, borderLeftWidth: 4 }]}>
                  <View style={styles.entryTop}>
                    <View style={styles.entryLeft}>
                      <Text style={[styles.entryName, { color: c.foreground }]}>{bill.name}</Text>
                      <Text style={[styles.entryMeta, { color: c.mutedForeground }]}>Due day {bill.due_day} · {bill.category}</Text>
                    </View>
                    <PaymentStatusBadge paid={isPaid} partial={isPartial} />
                  </View>

                  <View style={styles.amountRow}>
                    <View style={styles.amountField}>
                      <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Amount this month</Text>
                      <TextInput
                        style={[styles.fieldInput, { backgroundColor: c.muted, color: c.foreground }]}
                        value={displayAmt}
                        onChangeText={v => setEditingAmounts(p => ({ ...p, [amtKey]: v }))}
                        onFocus={() => setEditingAmounts(p => ({ ...p, [amtKey]: amount > 0 ? amount.toFixed(2) : "" }))}
                        onBlur={() => handleCustomAmountBlur({ id: bill.id, amount: bill.amount }, amtKey)}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                        onSubmitEditing={Keyboard.dismiss}
                      />
                    </View>

                    <View style={styles.amountField}>
                      <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Paid amount</Text>
                      <TextInput
                        style={[styles.fieldInput, { backgroundColor: isPaid ? c.success + "20" : c.muted, color: isPaid ? c.success : c.foreground, borderWidth: isPaid ? 1 : 0, borderColor: c.success }]}
                        value={displayPaid}
                        onChangeText={v => setEditingPaid(p => ({ ...p, [paidKey]: v }))}
                        onFocus={() => setEditingPaid(p => ({ ...p, [paidKey]: paid > 0 ? paid.toFixed(2) : "" }))}
                        onBlur={() => handlePaidAmountBlur(bill.id, paidKey)}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor={c.mutedForeground}
                        returnKeyType="done"
                        onSubmitEditing={Keyboard.dismiss}
                      />
                    </View>

                    <View style={styles.amountField}>
                      <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Remaining</Text>
                      <View style={[styles.remainingBox, { backgroundColor: remaining > 0 ? c.destructive + "15" : c.success + "15" }]}>
                        <Text style={[styles.remainingText, { color: remaining > 0 ? c.destructive : c.success }]}>
                          ${remaining.toFixed(2)}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {bill.is_debt && bill.balance > 0 && (
                    <View style={[styles.debtBar, { backgroundColor: c.muted }]}>
                      <Text style={[styles.debtBarText, { color: c.mutedForeground }]}>
                        Debt balance: <Text style={{ color: c.destructive, fontFamily: "Inter_600SemiBold" }}>${bill.balance.toFixed(2)}</Text>
                      </Text>
                    </View>
                  )}
                </View>
              );
            }}
          />
        </>
      ) : (
        <ScrollView contentContainerStyle={[styles.calScroll, { paddingBottom: insets.bottom + 100 }]}>
          <View style={{ paddingHorizontal: 16 }}>
            <View style={[styles.txSummary, { backgroundColor: c.card, borderRadius: colors.radius }]}>
              {[
                { label: "Income", val: `$${txIncome.toFixed(0)}`, color: c.success },
                { label: "Spent", val: `$${txExpense.toFixed(0)}`, color: c.destructive },
                { label: "Net", val: `$${(txIncome - txExpense).toFixed(0)}`, color: txIncome - txExpense >= 0 ? c.success : c.destructive },
              ].map((s, i) => (
                <React.Fragment key={s.label}>
                  {i > 0 && <View style={[styles.sep, { backgroundColor: c.border }]} />}
                  <View style={styles.txSumItem}>
                    <Text style={[styles.txSumLabel, { color: c.mutedForeground }]}>{s.label}</Text>
                    <Text style={[styles.txSumValue, { color: s.color }]}>{s.val}</Text>
                  </View>
                </React.Fragment>
              ))}
            </View>

            <CalendarView month={month} year={selectedYear} transactions={txList} onDayPress={(date) => { setSelectedDate(prev => prev === date ? null : date); }} />

            {selectedDate && (
              <View style={styles.dateHeader}>
                <Text style={[styles.dateTitle, { color: c.foreground }]}>{selectedDate}</Text>
                <Pressable
                  onPress={() => { setEditTx(null); setTxModalVisible(true); }}
                  style={({ pressed }) => [styles.iconBtn, { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}
                >
                  <Feather name="plus" size={16} color={c.primaryForeground} />
                </Pressable>
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
                <View style={styles.txBody}>
                  <Text style={[styles.txNote, { color: c.foreground }]}>{tx.note || tx.category}</Text>
                  <Text style={[styles.txDate, { color: c.mutedForeground }]}>{tx.date} · {tx.category}</Text>
                </View>
                <Text style={[styles.txAmt, { color: tx.amount > 0 ? c.success : c.destructive }]}>
                  {tx.amount > 0 ? "+" : ""}{tx.amount.toFixed(2)}
                </Text>
              </Pressable>
            ))}

            {txList.length === 0 && !selectedDate && (
              <EmptyState icon="credit-card" title="No Transactions" message="Tap + to log a transaction for this month." actionLabel="Add" onAction={() => { setEditTx(null); setTxModalVisible(true); }} />
            )}
          </View>
        </ScrollView>
      )}

      <SnowballModal
        visible={snowballVisible}
        onClose={() => setSnowballVisible(false)}
        method={settings.paymentMethod}
        onRun={amount => runSnowball(month, selectedYear, amount)}
      />

      <AddTransactionModal
        visible={txModalVisible}
        onClose={() => { setTxModalVisible(false); setEditTx(null); }}
        onSave={(data) => {
          if ("id" in data) updateTransaction(data as Transaction);
          else addTransaction({ ...data, date: selectedDate ?? (data as any).date ?? new Date().toISOString().split("T")[0] });
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
  zapBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  zapBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  tabBar: { flexDirection: "row", padding: 4, gap: 4 },
  tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10 },
  tabBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  summaryRow: { flexDirection: "row", padding: 14 },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  summaryValue: { fontSize: 17, fontFamily: "Inter_700Bold" },
  sep: { width: 1 },
  billFilterRow: { flexDirection: "row", gap: 6 },
  filterPill: { paddingHorizontal: 12, paddingVertical: 5 },
  filterPillText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  list: { paddingHorizontal: 16, paddingTop: 6 },
  entryCard: { marginBottom: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  entryTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", padding: 14, paddingBottom: 8 },
  entryLeft: { flex: 1 },
  entryName: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 3 },
  entryMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, marginLeft: 8 },
  badgeText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  amountRow: { flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingBottom: 14 },
  amountField: { flex: 1 },
  fieldLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  fieldInput: { height: 36, borderRadius: 8, paddingHorizontal: 10, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  remainingBox: { height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  remainingText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  debtBar: { marginHorizontal: 14, marginBottom: 10, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 6 },
  debtBarText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  calScroll: { paddingTop: 4 },
  txSummary: { flexDirection: "row", padding: 14, marginBottom: 12 },
  txSumItem: { flex: 1, alignItems: "center" },
  txSumLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  txSumValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  dateHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8, marginTop: 4 },
  dateTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  txRow: { flexDirection: "row", alignItems: "center", padding: 12, marginBottom: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1 },
  txIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: 12 },
  txBody: { flex: 1 },
  txNote: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  txDate: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  txAmt: { fontSize: 14, fontFamily: "Inter_700Bold", marginLeft: 8 },
});
