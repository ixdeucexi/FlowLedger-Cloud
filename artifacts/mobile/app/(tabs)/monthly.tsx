import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, FlatList, Keyboard, Platform,
  Pressable, ScrollView, StyleSheet, Text,
  TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AddTransactionModal } from "@/components/AddTransactionModal";
import { CalendarView } from "@/components/CalendarView";
import { EmptyState } from "@/components/EmptyState";
import { MonthPicker } from "@/components/MonthPicker";
import colors from "@/constants/colors";
import type { Transaction } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

const MONTH_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];

type TabView = "bills" | "calendar";

function PayStatus({ paid, partial }: { paid: boolean; partial: boolean }) {
  const c = useColors();
  if (paid) return <View style={[ps.badge, { backgroundColor: c.success + "25" }]}><Text style={[ps.text, { color: c.success }]}>PAID</Text></View>;
  if (partial) return <View style={[ps.badge, { backgroundColor: c.warning + "25" }]}><Text style={[ps.text, { color: c.warning }]}>PARTIAL</Text></View>;
  return <View style={[ps.badge, { backgroundColor: c.destructive + "20" }]}><Text style={[ps.text, { color: c.destructive }]}>UNPAID</Text></View>;
}
const ps = StyleSheet.create({
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  text: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
});

export default function MonthlyScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    bills, getAmount, getPaidAmount, setPaidAmount, setCustomAmount,
    getMonthlyBills, runSnowball, settings,
    selectedYear, setSelectedYear, dashboardFilter, setDashboardFilter,
    getTransactionsForMonth, addTransaction, updateTransaction, deleteTransaction,
    getCashFlow, getMonthlyIncome, getDailyBalances,
    saveExtraPayment, getExtraPayment,
  } = useBudget();

  const [month, setMonth] = useState(new Date().getMonth());
  const [activeTab, setActiveTab] = useState<TabView>("bills");
  const [txModalVisible, setTxModalVisible] = useState(false);
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editingAmounts, setEditingAmounts] = useState<Record<string, string>>({});
  const [editingPaid, setEditingPaid] = useState<Record<string, string>>({});
  const [billFilter, setBillFilter] = useState<"all" | "paid" | "unpaid">("all");
  const [extraPayment, setExtraPayment] = useState("");
  const [snowballResults, setSnowballResults] = useState<{ name: string; payment: number; paidOff: boolean }[]>([]);
  const [showSnowballResults, setShowSnowballResults] = useState(false);

  useEffect(() => {
    if (dashboardFilter === "paid") { setBillFilter("paid"); setActiveTab("bills"); setDashboardFilter(null); }
    else if (dashboardFilter === "unpaid") { setBillFilter("unpaid"); setActiveTab("bills"); setDashboardFilter(null); }
  }, [dashboardFilter]);

  const monthBills = useMemo(() => getMonthlyBills(month, selectedYear), [getMonthlyBills, month, selectedYear]);

  const billsWithData = useMemo(() => {
    return monthBills.map(b => {
      const amount = getAmount(b, month, selectedYear);
      const paid = getPaidAmount(b.id, month, selectedYear);
      const isPaid = amount > 0 && paid >= amount;
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
  const totalPaid = useMemo(() => monthBills.reduce((s, b) => s + Math.min(getPaidAmount(b.id, month, selectedYear), getAmount(b, month, selectedYear)), 0), [monthBills, getPaidAmount, getAmount, month, selectedYear]);

  const txList = useMemo(() => getTransactionsForMonth(month, selectedYear), [getTransactionsForMonth, month, selectedYear]);
  const dailyBalances = useMemo(() => getDailyBalances(month, selectedYear), [getDailyBalances, month, selectedYear]);
  const txIncome = txList.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const txExpense = txList.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

  const isFuture = useMemo(() => {
    const now = new Date();
    return selectedYear > now.getFullYear() || (selectedYear === now.getFullYear() && month > now.getMonth());
  }, [month, selectedYear]);

  const cashFlow = useMemo(() => getCashFlow(month, selectedYear), [getCashFlow, month, selectedYear]);
  const monthlyIncome = getMonthlyIncome();

  const handlePaidBlur = useCallback((billId: string, key: string) => {
    const val = editingPaid[key];
    if (val === undefined) return;
    const parsed = parseFloat(val) || 0;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPaidAmount(billId, month, selectedYear, parsed);
    setEditingPaid(p => { const n = { ...p }; delete n[key]; return n; });
  }, [editingPaid, setPaidAmount, month, selectedYear]);

  const handleAmtBlur = useCallback((bill: { id: string; amount: number }, key: string) => {
    const val = editingAmounts[key];
    if (val === undefined) return;
    const parsed = parseFloat(val);
    setCustomAmount(bill.id, month, selectedYear, isNaN(parsed) || parsed === bill.amount ? undefined : parsed);
    setEditingAmounts(p => { const n = { ...p }; delete n[key]; return n; });
  }, [editingAmounts, setCustomAmount, month, selectedYear]);

  const handleQuickPaid = useCallback((billId: string, amount: number, isPaid: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPaidAmount(billId, month, selectedYear, isPaid ? 0 : amount);
  }, [setPaidAmount, month, selectedYear]);

  const handleApplyExtra = () => {
    const amt = parseFloat(extraPayment);
    if (isNaN(amt) || amt <= 0) return;
    const debtCount = bills.filter(b => b.is_debt && b.balance > 0).length;
    if (debtCount === 0) { Alert.alert("No Debts", "You have no active debts to apply extra payments to."); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const results = runSnowball(month, selectedYear, amt);
    saveExtraPayment(month, selectedYear, amt, results);
    setSnowballResults(results.map(r => ({ name: r.billName, payment: r.payment, paidOff: r.paidOff })));
    setShowSnowballResults(true);
    setExtraPayment("");
    Keyboard.dismiss();
  };

  const handleDeleteTx = (id: string) => {
    const doDelete = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); deleteTransaction(id); };
    if (Platform.OS === "web") { doDelete(); return; }
    Alert.alert("Delete Transaction", "Remove this transaction?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: doDelete },
    ]);
  };

  const displayedTxs = selectedDate
    ? txList.filter(t => t.date === selectedDate)
    : txList.slice().sort((a, b) => b.date.localeCompare(a.date));

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 + webTopPad }]}>
        <View>
          <Text style={[styles.title, { color: c.foreground }]}>{MONTH_FULL[month]} {selectedYear}</Text>
          {isFuture && <Text style={[styles.forecastTag, { color: c.primary }]}>Forecast Mode</Text>}
        </View>
        {activeTab === "calendar" && (
          <Pressable
            onPress={() => { setEditTx(null); setTxModalVisible(true); }}
            style={({ pressed }) => [styles.iconBtn, { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}
          >
            <Feather name="plus" size={18} color={c.primaryForeground} />
          </Pressable>
        )}
      </View>

      <MonthPicker selectedMonth={month} onSelect={m => { setMonth(m); setSelectedDate(null); }} year={selectedYear} onYearChange={setSelectedYear} />

      <View style={[styles.tabBar, { backgroundColor: c.muted, marginHorizontal: 16, borderRadius: colors.radius }]}>
        {(["bills", "calendar"] as TabView[]).map(t => (
          <Pressable
            key={t}
            onPress={() => setActiveTab(t)}
            style={[styles.tabBtn, { backgroundColor: activeTab === t ? c.card : "transparent", borderRadius: colors.radius - 2 }]}
          >
            <Feather name={t === "bills" ? "list" : "calendar"} size={14} color={activeTab === t ? c.primary : c.mutedForeground} />
            <Text style={[styles.tabBtnText, { color: activeTab === t ? c.primary : c.mutedForeground }]}>
              {t === "bills" ? "Bills" : "Calendar"}
            </Text>
          </Pressable>
        ))}
      </View>

      {activeTab === "bills" ? (
        <>
          <View style={[styles.summaryRow, { backgroundColor: c.card, marginHorizontal: 16, borderRadius: colors.radius, marginTop: 10 }]}>
            {[
              { label: "Due", value: `$${totalDue.toFixed(0)}`, color: c.foreground },
              { label: "Paid", value: `$${totalPaid.toFixed(0)}`, color: c.success },
              { label: "Left", value: `$${Math.max(0, totalDue - totalPaid).toFixed(0)}`, color: c.destructive },
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

          {monthlyIncome > 0 && (
            <View style={[styles.cfBar, { backgroundColor: c.card, marginHorizontal: 16, borderRadius: 10, marginTop: 8 }]}>
              <View style={styles.cfBarInner}>
                <Text style={[styles.cfLabel, { color: c.mutedForeground }]}>
                  {isFuture ? "Forecast" : "Available"} Cash
                </Text>
                <Text style={[styles.cfValue, { color: cashFlow.remaining >= 0 ? c.success : c.destructive }]}>
                  {cashFlow.remaining >= 0 ? "+" : ""}${cashFlow.remaining.toFixed(0)}
                </Text>
              </View>
            </View>
          )}

          <View style={[styles.extraCard, { backgroundColor: c.card, marginHorizontal: 16, borderRadius: colors.radius, marginTop: 8 }]}>
            <View style={styles.extraHeader}>
              <Feather name="zap" size={14} color={c.primary} />
              <Text style={[styles.extraTitle, { color: c.foreground }]}>
                Extra Debt Payment ({settings.paymentMethod === "snowball" ? "Snowball" : "Avalanche"})
              </Text>
            </View>
            <View style={styles.extraRow}>
              <TextInput
                style={[styles.extraInput, { backgroundColor: c.muted, color: c.foreground }]}
                value={extraPayment}
                onChangeText={setExtraPayment}
                placeholder="$ amount"
                placeholderTextColor={c.mutedForeground}
                keyboardType="decimal-pad"
                returnKeyType="done"
                onSubmitEditing={handleApplyExtra}
              />
              <Pressable
                onPress={handleApplyExtra}
                style={({ pressed }) => [styles.applyBtn, { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}
              >
                <Text style={[styles.applyBtnText, { color: c.primaryForeground }]}>Apply Extra</Text>
              </Pressable>
            </View>
            {showSnowballResults && snowballResults.length > 0 && (
              <View style={[styles.resultsBox, { backgroundColor: c.muted, borderRadius: 8 }]}>
                {snowballResults.map((r, i) => (
                  <View key={i} style={styles.resultRow}>
                    <Feather name={r.paidOff ? "check-circle" : "arrow-right"} size={13} color={r.paidOff ? c.success : c.primary} />
                    <Text style={[styles.resultText, { color: r.paidOff ? c.success : c.foreground }]}>
                      {r.name}: <Text style={{ fontFamily: "Inter_700Bold" }}>${r.payment.toFixed(2)}</Text>
                      {r.paidOff ? " — PAID OFF! 🎉" : ""}
                    </Text>
                  </View>
                ))}
                <Pressable onPress={() => setShowSnowballResults(false)} style={styles.dismissBtn}>
                  <Text style={[styles.dismissText, { color: c.mutedForeground }]}>Dismiss</Text>
                </Pressable>
              </View>
            )}
          </View>

          <View style={[styles.billFilterRow, { paddingHorizontal: 16, marginTop: 8, marginBottom: 4 }]}>
            {(["all", "paid", "unpaid"] as const).map(f => (
              <Pressable key={f} onPress={() => setBillFilter(f)} style={[styles.pill, { backgroundColor: billFilter === f ? c.primary : c.muted, borderRadius: 20 }]}>
                <Text style={[styles.pillText, { color: billFilter === f ? c.primaryForeground : c.mutedForeground }]}>
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
              const showAmt = editingAmounts[amtKey] !== undefined ? editingAmounts[amtKey] : amount.toFixed(2);
              const showPaid = editingPaid[paidKey] !== undefined ? editingPaid[paidKey] : paid > 0 ? paid.toFixed(2) : "";
              const remaining = Math.max(0, amount - paid);

              return (
                <View style={[styles.entryCard, { backgroundColor: c.card, borderRadius: colors.radius, borderLeftColor: borderColor }]}>
                  <View style={styles.entryTop}>
                    <View style={styles.entryLeft}>
                      <Text style={[styles.entryName, { color: c.foreground }]}>{bill.name}</Text>
                      <Text style={[styles.entryMeta, { color: c.mutedForeground }]}>Due day {bill.due_day} · {bill.category}</Text>
                    </View>
                    <View style={styles.entryRight}>
                      <PayStatus paid={isPaid} partial={isPartial} />
                      <Pressable
                        onPress={() => handleQuickPaid(bill.id, amount, isPaid)}
                        style={({ pressed }) => [styles.quickPaidBtn, { backgroundColor: isPaid ? c.muted : c.success + "20", opacity: pressed ? 0.7 : 1, borderRadius: 8, marginTop: 6 }]}
                      >
                        <Feather name={isPaid ? "x" : "check"} size={12} color={isPaid ? c.mutedForeground : c.success} />
                        <Text style={[styles.quickPaidText, { color: isPaid ? c.mutedForeground : c.success }]}>
                          {isPaid ? "Unpay" : "Mark Paid"}
                        </Text>
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.amtRow}>
                    <View style={styles.amtField}>
                      <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Amount</Text>
                      <TextInput
                        style={[styles.fieldInput, { backgroundColor: c.muted, color: c.foreground }]}
                        value={showAmt}
                        onChangeText={v => setEditingAmounts(p => ({ ...p, [amtKey]: v }))}
                        onFocus={() => setEditingAmounts(p => ({ ...p, [amtKey]: amount.toFixed(2) }))}
                        onBlur={() => handleAmtBlur({ id: bill.id, amount: bill.amount }, amtKey)}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                        onSubmitEditing={Keyboard.dismiss}
                      />
                    </View>
                    <View style={styles.amtField}>
                      <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Paid</Text>
                      <TextInput
                        style={[styles.fieldInput, { backgroundColor: isPaid ? c.success + "20" : c.muted, color: isPaid ? c.success : c.foreground }]}
                        value={showPaid}
                        onChangeText={v => setEditingPaid(p => ({ ...p, [paidKey]: v }))}
                        onFocus={() => setEditingPaid(p => ({ ...p, [paidKey]: paid > 0 ? paid.toFixed(2) : "" }))}
                        onBlur={() => handlePaidBlur(bill.id, paidKey)}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor={c.mutedForeground}
                        returnKeyType="done"
                        onSubmitEditing={Keyboard.dismiss}
                      />
                    </View>
                    <View style={styles.amtField}>
                      <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Left</Text>
                      <View style={[styles.leftBox, { backgroundColor: remaining > 0 ? c.destructive + "15" : c.success + "15" }]}>
                        <Text style={[styles.leftText, { color: remaining > 0 ? c.destructive : c.success }]}>${remaining.toFixed(2)}</Text>
                      </View>
                    </View>
                  </View>

                  {bill.is_debt && bill.balance > 0 && (
                    <View style={[styles.debtNote, { backgroundColor: c.muted }]}>
                      <Text style={[styles.debtNoteText, { color: c.mutedForeground }]}>
                        Debt balance: <Text style={{ color: c.destructive, fontFamily: "Inter_600SemiBold" }}>${bill.balance.toFixed(2)}</Text>
                        {bill.interest_rate > 0 ? ` · ${bill.interest_rate}% APR` : ""}
                        {` · Payoff priority #${bill.priority}`}
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

            <CalendarView
              month={month}
              year={selectedYear}
              transactions={txList}
              selectedDate={selectedDate}
              onDayPress={(date) => setSelectedDate(prev => prev === date ? null : date)}
              dailyBalances={dailyBalances}
            />

            <View style={styles.txListHeader}>
              <Text style={[styles.txListTitle, { color: c.foreground }]}>
                {selectedDate ? selectedDate : `All Transactions (${txList.length})`}
              </Text>
              <Pressable
                onPress={() => { setEditTx(null); setTxModalVisible(true); }}
                style={({ pressed }) => [styles.iconBtn, { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}
              >
                <Feather name="plus" size={16} color={c.primaryForeground} />
              </Pressable>
            </View>

            {displayedTxs.length === 0 ? (
              <EmptyState icon="credit-card" title="No Transactions" message={selectedDate ? "Tap + to log a transaction for this day." : "Tap a day or use + to add transactions."} />
            ) : (
              displayedTxs.map(tx => (
                <View
                  key={tx.id}
                  style={[styles.txRow, { backgroundColor: c.card, borderRadius: colors.radius }]}
                >
                  <Pressable
                    onPress={() => { setEditTx(tx); setTxModalVisible(true); }}
                    style={styles.txMain}
                  >
                    <View style={[styles.txIcon, { backgroundColor: tx.amount > 0 ? c.success + "20" : c.destructive + "20" }]}>
                      <Feather name={tx.amount > 0 ? "arrow-down-left" : "arrow-up-right"} size={15} color={tx.amount > 0 ? c.success : c.destructive} />
                    </View>
                    <View style={styles.txBody}>
                      <Text style={[styles.txNote, { color: c.foreground }]}>{tx.note || tx.category}</Text>
                      <Text style={[styles.txDate, { color: c.mutedForeground }]}>{tx.date} · {tx.category}</Text>
                    </View>
                    <Text style={[styles.txAmt, { color: tx.amount > 0 ? c.success : c.destructive }]}>
                      {tx.amount > 0 ? "+" : ""}{tx.amount.toFixed(2)}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => handleDeleteTx(tx.id)} hitSlop={8} style={styles.txDelete}>
                    <Feather name="trash-2" size={14} color={c.destructive} />
                  </Pressable>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      )}

      <AddTransactionModal
        visible={txModalVisible}
        onClose={() => { setTxModalVisible(false); setEditTx(null); }}
        onSave={(data) => {
          if (editTx && "id" in data) {
            updateTransaction(data as Transaction);
          } else {
            addTransaction(data as Omit<Transaction, "id">);
          }
        }}
        editTx={editTx}
        defaultDate={selectedDate ?? undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingBottom: 8 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  forecastTag: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginTop: 1 },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  tabBar: { flexDirection: "row", padding: 4, gap: 4 },
  tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9 },
  tabBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  summaryRow: { flexDirection: "row", padding: 12 },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 },
  summaryValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  sep: { width: 1 },
  cfBar: { paddingHorizontal: 14, paddingVertical: 10 },
  cfBarInner: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cfLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  cfValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  extraCard: { padding: 12 },
  extraHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  extraTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  extraRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  extraInput: { flex: 1, height: 40, borderRadius: 8, paddingHorizontal: 12, fontSize: 15, fontFamily: "Inter_400Regular" },
  applyBtn: { paddingHorizontal: 16, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  applyBtnText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  resultsBox: { marginTop: 10, padding: 10 },
  resultRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  resultText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  dismissBtn: { marginTop: 8, alignItems: "center" },
  dismissText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  billFilterRow: { flexDirection: "row", gap: 6 },
  pill: { paddingHorizontal: 12, paddingVertical: 5 },
  pillText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  list: { paddingHorizontal: 16, paddingTop: 6 },
  entryCard: { marginBottom: 10, borderLeftWidth: 4, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  entryTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", padding: 12, paddingBottom: 6 },
  entryLeft: { flex: 1 },
  entryName: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  entryMeta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  entryRight: { alignItems: "flex-end" },
  quickPaidBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4 },
  quickPaidText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  amtRow: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
  amtField: { flex: 1 },
  fieldLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  fieldInput: { height: 34, borderRadius: 7, paddingHorizontal: 9, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  leftBox: { height: 34, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  leftText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  debtNote: { marginHorizontal: 12, marginBottom: 10, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  debtNoteText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  calScroll: { paddingTop: 8 },
  txSummary: { flexDirection: "row", padding: 12, marginBottom: 10 },
  txSumItem: { flex: 1, alignItems: "center" },
  txSumLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 },
  txSumValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  txListHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8, marginTop: 4 },
  txListTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  txRow: { flexDirection: "row", alignItems: "center", marginBottom: 7, overflow: "hidden" },
  txMain: { flex: 1, flexDirection: "row", alignItems: "center", padding: 11 },
  txIcon: { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center", marginRight: 10 },
  txBody: { flex: 1 },
  txNote: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  txDate: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  txAmt: { fontSize: 14, fontFamily: "Inter_700Bold", marginLeft: 8 },
  txDelete: { paddingHorizontal: 14, paddingVertical: 11 },
});
