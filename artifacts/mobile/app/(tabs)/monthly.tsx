import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, FlatList, Keyboard, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text,
  TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AddTransactionModal } from "@/components/AddTransactionModal";
import { CalendarView } from "@/components/CalendarView";
import { EmptyState } from "@/components/EmptyState";
import { MonthPicker } from "@/components/MonthPicker";
import colors from "@/constants/colors";
import type { Bill, Transaction } from "@/context/BudgetContext";
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
    getCustomDueDay, setCustomDueDay,
    getMonthlyBills, getBillOccurrencesInMonth, getBillMonthlyTotal, runSnowball, settings,
    selectedYear, setSelectedYear, dashboardFilter, setDashboardFilter,
    getTransactionsForMonth, addTransaction, updateTransaction, deleteTransaction,
    getCashFlow, getMonthlyIncome, getDailyBalances, getIncomeOccurrencesInMonth,
    saveExtraPayment, getExtraPayment,
  } = useBudget();

  const [month, setMonth] = useState(new Date().getMonth());
  const [activeTab, setActiveTab] = useState<TabView>("bills");
  const [txModalVisible, setTxModalVisible] = useState(false);
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editingAmounts, setEditingAmounts] = useState<Record<string, string>>({});
  const [editingPaid, setEditingPaid] = useState<Record<string, string>>({});
  const [editingDueDays, setEditingDueDays] = useState<Record<string, string>>({});
  const [billFilter, setBillFilter] = useState<"all" | "paid" | "unpaid">("all");
  const [extraPayment, setExtraPayment] = useState("");
  const [snowballResults, setSnowballResults] = useState<{ name: string; payment: number; paidOff: boolean }[]>([]);
  const [showSnowballResults, setShowSnowballResults] = useState(false);
  const [dueDayPickerBill, setDueDayPickerBill] = useState<Bill | null>(null);

  useEffect(() => {
    if (dashboardFilter === "paid") { setBillFilter("paid"); setActiveTab("bills"); setDashboardFilter(null); }
    else if (dashboardFilter === "unpaid") { setBillFilter("unpaid"); setActiveTab("bills"); setDashboardFilter(null); }
  }, [dashboardFilter]);

  const monthBills = useMemo(() => getMonthlyBills(month, selectedYear), [getMonthlyBills, month, selectedYear]);

  const billsWithData = useMemo(() => {
    return monthBills.map(b => {
      // monthlyAmount = per-occurrence × number of occurrences this month
      // (for monthly bills this equals getAmount; for weekly bills it's ×4-5)
      const monthlyAmount = getBillMonthlyTotal(b, month, selectedYear);
      const perOccurrence = getAmount(b, month, selectedYear);
      const paid = getPaidAmount(b.id, month, selectedYear);
      const isPaid = monthlyAmount > 0 && paid >= monthlyAmount;
      const isPartial = paid > 0 && !isPaid;
      return { bill: b, amount: monthlyAmount, perOccurrence, paid, isPaid, isPartial };
    })
    .filter(x => {
      if (billFilter === "paid") return x.isPaid;
      if (billFilter === "unpaid") return !x.isPaid;
      return true;
    })
    .sort((a, b) => a.bill.due_day - b.bill.due_day);
  }, [monthBills, getAmount, getPaidAmount, month, selectedYear, billFilter]);

  const totalDue = useMemo(() => monthBills.reduce((s, b) => s + getBillMonthlyTotal(b, month, selectedYear), 0), [monthBills, getBillMonthlyTotal, month, selectedYear]);
  const totalPaid = useMemo(() => monthBills.reduce((s, b) => s + Math.min(getPaidAmount(b.id, month, selectedYear), getBillMonthlyTotal(b, month, selectedYear)), 0), [monthBills, getPaidAmount, getBillMonthlyTotal, month, selectedYear]);

  const txList = useMemo(() => getTransactionsForMonth(month, selectedYear), [getTransactionsForMonth, month, selectedYear]);
  const dailyBalances = useMemo(() => getDailyBalances(month, selectedYear), [getDailyBalances, month, selectedYear]);
  const incomeOccurrences = useMemo(() => {
    const occurrences = getIncomeOccurrencesInMonth(month, selectedYear);
    const flat: { day: number; name: string; amount: number; frequency: string }[] = [];
    occurrences.forEach(({ income: inc, days }) => {
      days.forEach(day => flat.push({ day, name: inc.name, amount: inc.amount, frequency: inc.frequency }));
    });
    return flat.sort((a, b) => a.day - b.day);
  }, [getIncomeOccurrencesInMonth, month, selectedYear]);
  const txIncome = txList.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const txExpense = txList.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

  const selectedDay = selectedDate ? parseInt(selectedDate.split("-")[2]) : null;

  const scheduledBillsForDay = useMemo(() => {
    if (selectedDay === null) return [];
    return monthBills.filter(b => getBillOccurrencesInMonth(b, month, selectedYear).includes(selectedDay));
  }, [monthBills, getBillOccurrencesInMonth, selectedDay, month, selectedYear]);

  const goalsForSelectedDay = useMemo(() => {
    if (selectedDay === null) return [];
    const db = dailyBalances.find(d => d.day === selectedDay);
    return db ? db.goalExpenses : [];
  }, [selectedDay, dailyBalances]);

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

  const handleDueDayBlur = useCallback((billId: string, originalDueDay: number, key: string) => {
    const val = editingDueDays[key];
    if (val === undefined) return;
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 31 && parsed !== originalDueDay) {
      setCustomDueDay(billId, month, selectedYear, parsed);
    } else if (isNaN(parsed) || val.trim() === "") {
      setCustomDueDay(billId, month, selectedYear, undefined);
    }
    setEditingDueDays(p => { const n = { ...p }; delete n[key]; return n; });
  }, [editingDueDays, setCustomDueDay, month, selectedYear]);

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
          <FlatList
            data={billsWithData}
            keyExtractor={item => item.bill.id}
            style={{ flex: 1 }}
            contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<EmptyState icon="calendar" title="No Bills" message="Add recurring bills to track them here." />}
            ListHeaderComponent={
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

                {incomeOccurrences.length > 0 && (
                  <View style={[styles.incomeCard, { backgroundColor: c.card, marginHorizontal: 16, borderRadius: colors.radius, marginTop: 8 }]}>
                    <View style={styles.incomeHeader}>
                      <Feather name="trending-up" size={14} color={c.success} />
                      <Text style={[styles.incomeTitle, { color: c.foreground }]}>Income This Month</Text>
                      <Text style={[styles.incomeTotalText, { color: c.success }]}>
                        ${incomeOccurrences.reduce((s, o) => s + o.amount, 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </Text>
                    </View>
                    {incomeOccurrences.map((occ, idx) => (
                      <View key={`${occ.name}-${occ.day}-${idx}`} style={[styles.incomeRow, idx > 0 && { borderTopWidth: 1, borderTopColor: c.border }]}>
                        <View style={[styles.incomeDayBadge, { backgroundColor: c.success + "22" }]}>
                          <Text style={[styles.incomeDayNum, { color: c.success }]}>{occ.day}</Text>
                        </View>
                        <Text style={[styles.incomeName, { color: c.foreground }]}>{occ.name}</Text>
                        <Text style={[styles.incomeAmt, { color: c.success }]}>+${occ.amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</Text>
                      </View>
                    ))}
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
              </>
            }
            renderItem={({ item: { bill, amount, perOccurrence, paid, isPaid, isPartial } }) => {
              const borderColor = isPaid ? c.success : isPartial ? c.warning : c.destructive;
              const amtKey = `${bill.id}-${month}-${selectedYear}-amt`;
              const paidKey = `${bill.id}-${month}-${selectedYear}-paid`;
              const dayKey = `${bill.id}-${month}-${selectedYear}-day`;
              const isWeekly = bill.frequency === "weekly";
              const occCount = isWeekly ? Math.round(amount / (perOccurrence || 1)) : 1;
              // For weekly bills: the TextInput edits the per-occurrence (weekly) amount
              const editableAmt = isWeekly ? perOccurrence : amount;
              const showAmt = editingAmounts[amtKey] !== undefined ? editingAmounts[amtKey] : editableAmt.toFixed(2);
              const showPaid = editingPaid[paidKey] !== undefined ? editingPaid[paidKey] : paid > 0 ? paid.toFixed(2) : "";
              const remaining = Math.max(0, amount - paid);
              const customDay = getCustomDueDay(bill.id, month, selectedYear);
              const effectiveDueDay = customDay ?? bill.due_day;
              const showDay = editingDueDays[dayKey] !== undefined ? editingDueDays[dayKey] : effectiveDueDay.toString();
              const WEEKDAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

              return (
                <View style={[styles.entryCard, { backgroundColor: c.card, borderRadius: colors.radius, borderLeftColor: borderColor }]}>
                  <View style={styles.entryTop}>
                    <View style={styles.entryLeft}>
                      <Text style={[styles.entryName, { color: c.foreground }]}>{bill.name}</Text>
                      <Text style={[styles.entryMeta, { color: c.mutedForeground }]}>
                        {isWeekly
                          ? `Every ${WEEKDAY_NAMES[bill.day_of_week ?? 0]} · ×${occCount} this month · ${bill.category}`
                          : `Due day ${effectiveDueDay}${customDay !== undefined ? " *" : ""} · ${bill.category}`}
                      </Text>
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

                  {/* Weekly breakdown chip */}
                  {isWeekly && (
                    <View style={[styles.weeklyChip, { backgroundColor: c.primary + "12" }]}>
                      <Feather name="repeat" size={10} color={c.primary} />
                      <Text style={[styles.weeklyChipText, { color: c.primary }]}>
                        ${perOccurrence.toFixed(2)}/wk × {occCount} = ${amount.toFixed(2)} total this month
                      </Text>
                    </View>
                  )}

                  <View style={styles.amtRow}>
                    <View style={styles.amtField}>
                      <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>{isWeekly ? "Per Week" : "Amount"}</Text>
                      <TextInput
                        style={[styles.fieldInput, { backgroundColor: c.muted, color: c.foreground }]}
                        value={showAmt}
                        onChangeText={v => setEditingAmounts(p => ({ ...p, [amtKey]: v }))}
                        onFocus={() => setEditingAmounts(p => ({ ...p, [amtKey]: editableAmt.toFixed(2) }))}
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

                  {bill.frequency === "monthly" && (
                    <View style={styles.dueDayRow}>
                      <Feather name="calendar" size={11} color={customDay !== undefined ? c.primary : c.mutedForeground} style={{ marginRight: 6 }} />
                      <Text style={[styles.fieldLabel, { color: customDay !== undefined ? c.primary : c.mutedForeground, marginBottom: 0, marginRight: 8 }]}>
                        {customDay !== undefined ? "Due day this month:" : "Due day (this month only):"}
                      </Text>
                      <TextInput
                        style={[
                          styles.dueDayInput,
                          {
                            backgroundColor: customDay !== undefined ? c.primary + "15" : c.muted,
                            color: customDay !== undefined ? c.primary : c.foreground,
                            borderColor: customDay !== undefined ? c.primary + "40" : "transparent",
                          },
                        ]}
                        value={showDay}
                        onChangeText={v => setEditingDueDays(p => ({ ...p, [dayKey]: v }))}
                        onFocus={() => setEditingDueDays(p => ({ ...p, [dayKey]: effectiveDueDay.toString() }))}
                        onBlur={() => handleDueDayBlur(bill.id, bill.due_day, dayKey)}
                        keyboardType="number-pad"
                        returnKeyType="done"
                        onSubmitEditing={Keyboard.dismiss}
                        maxLength={2}
                        selectTextOnFocus
                      />
                      {customDay !== undefined && (
                        <Pressable
                          onPress={() => { setCustomDueDay(bill.id, month, selectedYear, undefined); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, marginLeft: 6 })}
                          hitSlop={8}
                        >
                          <Feather name="x-circle" size={14} color={c.mutedForeground} />
                        </Pressable>
                      )}
                    </View>
                  )}

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
      ) : (
        <ScrollView contentContainerStyle={[styles.calScroll, { paddingBottom: insets.bottom + 100 }]}>
          <View style={{ paddingHorizontal: 16 }}>
            {/* Opening / Closing balance bar */}
            {dailyBalances.length > 0 && (() => {
              const opening = dailyBalances[0].balance - dailyBalances[0].net;
              const closing = dailyBalances[dailyBalances.length - 1].balance;
              return (
                <View style={[styles.balanceBar, { backgroundColor: c.card, borderRadius: colors.radius, marginBottom: 8 }]}>
                  <View style={styles.balanceBarItem}>
                    <Text style={[styles.balanceBarLabel, { color: c.mutedForeground }]}>Opens</Text>
                    <Text style={[styles.balanceBarValue, { color: opening >= 0 ? c.success : c.destructive }]}>
                      ${Math.abs(opening).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Text>
                  </View>
                  <View style={[styles.sep, { backgroundColor: c.border }]} />
                  <View style={styles.balanceBarItem}>
                    <Text style={[styles.balanceBarLabel, { color: c.mutedForeground }]}>Closes</Text>
                    <Text style={[styles.balanceBarValue, { color: closing >= 0 ? c.success : c.destructive }]}>
                      ${Math.abs(closing).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Text>
                  </View>
                </View>
              );
            })()}

            {/* Income / Spent / Net — includes both scheduled events and manual transactions */}
            {(() => {
              const schedIncome = dailyBalances.reduce((s, db) => s + db.scheduledIncome, 0);
              const schedBills  = dailyBalances.reduce((s, db) => s + db.bills, 0);
              const totalIncome = txIncome + schedIncome;
              const totalSpent  = txExpense + schedBills;
              const net = totalIncome - totalSpent;
              return (
                <View style={[styles.txSummary, { backgroundColor: c.card, borderRadius: colors.radius }]}>
                  {[
                    { label: "Income", val: `$${totalIncome.toFixed(0)}`, color: c.success },
                    { label: "Spent",  val: `$${totalSpent.toFixed(0)}`,  color: c.destructive },
                    { label: "Net",    val: `${net >= 0 ? "+" : "-"}$${Math.abs(net).toFixed(0)}`, color: net >= 0 ? c.success : c.destructive },
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
              );
            })()}

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
                {selectedDate
                  ? `${selectedDate}${scheduledBillsForDay.length + displayedTxs.length + goalsForSelectedDay.length > 0 ? ` · ${scheduledBillsForDay.length + displayedTxs.length + goalsForSelectedDay.length} item${scheduledBillsForDay.length + displayedTxs.length + goalsForSelectedDay.length !== 1 ? "s" : ""}` : ""}`
                  : `All Transactions (${txList.length})`}
              </Text>
              <Pressable
                onPress={() => { setEditTx(null); setTxModalVisible(true); }}
                style={({ pressed }) => [styles.iconBtn, { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}
              >
                <Feather name="plus" size={16} color={c.primaryForeground} />
              </Pressable>
            </View>

            {/* Scheduled bills & debts for the selected day */}
            {scheduledBillsForDay.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Scheduled</Text>
                {scheduledBillsForDay.map(b => {
                  const amt = getAmount(b, month, selectedYear);
                  const paid = getPaidAmount(b.id, month, selectedYear);
                  const isPaid = amt > 0 && paid >= amt;
                  const isDebt = b.is_debt;
                  const iconColor = isPaid ? c.success : isDebt ? c.destructive : c.warning;
                  const iconName = isDebt ? "credit-card" : "file-text";
                  const canReschedule = b.frequency === "monthly";
                  const hasCustomDay = getCustomDueDay(b.id, month, selectedYear) !== undefined;
                  return (
                    <Pressable
                      key={`sched-${b.id}`}
                      onPress={() => canReschedule && setDueDayPickerBill(b)}
                      style={({ pressed }) => [
                        styles.txRow,
                        { backgroundColor: c.card, borderRadius: colors.radius, opacity: pressed && canReschedule ? 0.75 : 1 },
                      ]}
                    >
                      <View style={styles.txMain}>
                        <View style={[styles.txIcon, { backgroundColor: iconColor + "20" }]}>
                          <Feather name={iconName} size={15} color={iconColor} />
                        </View>
                        <View style={styles.txBody}>
                          <Text style={[styles.txNote, { color: c.foreground }]}>{b.name}</Text>
                          <Text style={[styles.txDate, { color: c.mutedForeground }]}>
                            {isDebt ? "Debt" : "Bill"} · {b.category}
                            {b.frequency === "weekly" ? " · weekly" : ""}
                            {isPaid ? " · paid" : paid > 0 ? ` · $${paid.toFixed(2)} paid` : ""}
                            {hasCustomDay ? " · rescheduled" : ""}
                          </Text>
                          {canReschedule && (
                            <Text style={[styles.txRescheduleHint, { color: c.primary }]}>
                              Tap to change due day this month
                            </Text>
                          )}
                        </View>
                        <Text style={[styles.txAmt, { color: iconColor }]}>
                          -${amt.toFixed(2)}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </>
            )}

            {/* Goals due on selected day */}
            {goalsForSelectedDay.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Goals</Text>
                {goalsForSelectedDay.map(goal => (
                  <View
                    key={`goal-${goal.id}`}
                    style={[styles.txRow, { backgroundColor: c.card, borderRadius: colors.radius }]}
                  >
                    <View style={styles.txMain}>
                      <View style={[styles.txIcon, { backgroundColor: "#8b5cf620" }]}>
                        <Feather name="target" size={15} color="#8b5cf6" />
                      </View>
                      <View style={styles.txBody}>
                        <Text style={[styles.txNote, { color: c.foreground }]}>{goal.name}</Text>
                        <Text style={[styles.txDate, { color: c.mutedForeground }]}>Goal · target date</Text>
                      </View>
                      <Text style={[styles.txAmt, { color: "#8b5cf6" }]}>
                        -${goal.amount.toFixed(2)}
                      </Text>
                    </View>
                  </View>
                ))}
              </>
            )}

            {/* Manual transactions */}
            {displayedTxs.length === 0 && scheduledBillsForDay.length === 0 && goalsForSelectedDay.length === 0 ? (
              <EmptyState icon="credit-card" title="No Activity" message={selectedDate ? "Tap + to log a transaction for this day." : "Tap a day or use + to add transactions."} />
            ) : displayedTxs.length > 0 ? (
              <>
                {(scheduledBillsForDay.length > 0 || goalsForSelectedDay.length > 0) && (
                  <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Transactions</Text>
                )}
                {displayedTxs.map(tx => (
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
                ))}
              </>
            ) : null}
          </View>
        </ScrollView>
      )}

      {/* ── Due-day reschedule picker ── */}
      <Modal
        visible={dueDayPickerBill !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setDueDayPickerBill(null)}
      >
        <Pressable style={styles.pickerOverlay} onPress={() => setDueDayPickerBill(null)}>
          <Pressable style={[styles.pickerSheet, { backgroundColor: c.background }]} onPress={e => e.stopPropagation()}>
            {dueDayPickerBill && (() => {
              const daysInMonth = new Date(selectedYear, month + 1, 0).getDate();
              const customDay = getCustomDueDay(dueDayPickerBill.id, month, selectedYear);
              const effectiveDay = customDay ?? dueDayPickerBill.due_day;
              return (
                <>
                  <View style={styles.pickerHandle} />
                  <View style={styles.pickerHeader}>
                    <View>
                      <Text style={[styles.pickerTitle, { color: c.foreground }]}>{dueDayPickerBill.name}</Text>
                      <Text style={[styles.pickerSub, { color: c.mutedForeground }]}>
                        {MONTH_FULL[month]} {selectedYear} · Currently day {effectiveDay}
                        {customDay !== undefined ? " (custom)" : " (default)"}
                      </Text>
                    </View>
                    <Pressable onPress={() => setDueDayPickerBill(null)} hitSlop={8}>
                      <Feather name="x" size={20} color={c.mutedForeground} />
                    </Pressable>
                  </View>

                  <Text style={[styles.pickerLabel, { color: c.mutedForeground }]}>
                    Select the new due day for this month only
                  </Text>

                  <View style={styles.pickerDayGrid}>
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                      const isCurrent = day === effectiveDay;
                      const isOriginal = day === dueDayPickerBill.due_day && customDay === undefined;
                      return (
                        <Pressable
                          key={day}
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            if (day === dueDayPickerBill.due_day) {
                              setCustomDueDay(dueDayPickerBill.id, month, selectedYear, undefined);
                            } else {
                              setCustomDueDay(dueDayPickerBill.id, month, selectedYear, day);
                            }
                            setDueDayPickerBill(null);
                          }}
                          style={({ pressed }) => [
                            styles.pickerDayBtn,
                            {
                              backgroundColor: isCurrent ? c.primary : isOriginal ? c.primary + "25" : c.muted,
                              opacity: pressed ? 0.7 : 1,
                              borderRadius: 8,
                            },
                          ]}
                        >
                          <Text style={[
                            styles.pickerDayText,
                            { color: isCurrent ? c.primaryForeground : c.foreground },
                          ]}>
                            {day}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {customDay !== undefined && (
                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setCustomDueDay(dueDayPickerBill.id, month, selectedYear, undefined);
                        setDueDayPickerBill(null);
                      }}
                      style={({ pressed }) => [
                        styles.pickerResetBtn,
                        { backgroundColor: c.muted, opacity: pressed ? 0.7 : 1, borderRadius: colors.radius },
                      ]}
                    >
                      <Feather name="rotate-ccw" size={14} color={c.mutedForeground} />
                      <Text style={[styles.pickerResetText, { color: c.mutedForeground }]}>
                        Reset to default day {dueDayPickerBill.due_day}
                      </Text>
                    </Pressable>
                  )}
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>

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
  extraInput: { flex: 1, height: 36, borderRadius: 8, paddingHorizontal: 12, fontSize: 13, fontFamily: "Inter_400Regular" },
  applyBtn: { paddingHorizontal: 14, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  applyBtnText: { fontSize: 12, fontFamily: "Inter_700Bold" },
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
  dueDayRow: { flexDirection: "row", alignItems: "center", marginHorizontal: 12, marginBottom: 10 },
  dueDayInput: { width: 42, height: 30, borderRadius: 6, textAlign: "center", fontSize: 14, fontFamily: "Inter_600SemiBold", borderWidth: 1 },
  calScroll: { paddingTop: 8 },
  weeklyChip: { flexDirection: "row", alignItems: "center", gap: 5, marginHorizontal: 12, marginTop: 2, marginBottom: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  weeklyChipText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  balanceBar: { flexDirection: "row", padding: 12, marginBottom: 0 },
  balanceBarItem: { flex: 1, alignItems: "center" },
  balanceBarLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 },
  balanceBarValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  txSummary: { flexDirection: "row", padding: 12, marginBottom: 10 },
  txSumItem: { flex: 1, alignItems: "center" },
  txSumLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 },
  txSumValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  txListHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8, marginTop: 4 },
  txListTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sectionLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, marginHorizontal: 16, marginTop: 10, marginBottom: 4 },
  txRow: { flexDirection: "row", alignItems: "center", marginBottom: 7, overflow: "hidden" },
  txMain: { flex: 1, flexDirection: "row", alignItems: "center", padding: 11 },
  txIcon: { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center", marginRight: 10 },
  txBody: { flex: 1 },
  txNote: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  txDate: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  txRescheduleHint: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  txAmt: { fontSize: 14, fontFamily: "Inter_700Bold", marginLeft: 8 },
  txDelete: { paddingHorizontal: 14, paddingVertical: 11 },
  pickerOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.55)" },
  pickerSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
  pickerHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#555", alignSelf: "center", marginBottom: 16 },
  pickerHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  pickerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  pickerSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  pickerLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 12 },
  pickerDayGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  pickerDayBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  pickerDayText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  pickerResetBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14 },
  pickerResetText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  incomeCard: { paddingTop: 12, paddingBottom: 4, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  incomeHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, marginBottom: 10 },
  incomeTitle: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  incomeTotalText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  incomeRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 9 },
  incomeDayBadge: { width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  incomeDayNum: { fontSize: 14, fontFamily: "Inter_700Bold" },
  incomeName: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  incomeAmt: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
