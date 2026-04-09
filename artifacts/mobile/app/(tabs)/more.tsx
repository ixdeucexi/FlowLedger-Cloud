import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import React, { useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IncomeModal } from "@/components/IncomeModal";
import colors from "@/constants/colors";
import type { IncomeItem } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

const FREQ_LABELS: Record<string, string> = { monthly: "/mo", biweekly: "/2wk", weekly: "/wk" };

export default function MoreScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { bills, transactions, overrides, incomes, goals, importBills, settings, updateSettings,
    addIncome, updateIncome, deleteIncome, getMonthlyIncome } = useBudget();

  const [incomeModalVisible, setIncomeModalVisible] = useState(false);
  const [editIncome, setEditIncome] = useState<IncomeItem | null>(null);

  const totalMonthlyIncome = getMonthlyIncome();

  const handleExport = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const billHeader = "Name,Amount,Category,Priority,IsDebt,Balance,InterestRate,DueDay,IsRecurring";
      const billRows = bills.map(b => `"${b.name}",${b.amount},"${b.category}",${b.priority},${b.is_debt},${b.balance},${b.interest_rate},${b.due_day},${b.is_recurring}`).join("\n");
      const txHeader = "Date,Amount,Category,Note";
      const txRows = transactions.map(t => `"${t.date}",${t.amount},"${t.category}","${t.note}"`).join("\n");
      const ovrHeader = "BillId,Month,Year,CustomAmount,PaidAmount";
      const ovrRows = overrides.map(o => `"${o.bill_id}",${o.month},${o.year},${o.custom_amount ?? ""},${o.paid_amount}`).join("\n");
      const csv = ["=== BILLS ===", billHeader, billRows, "", "=== TRANSACTIONS ===", txHeader, txRows, "", "=== MONTHLY OVERRIDES ===", ovrHeader, ovrRows].join("\n");

      if (Platform.OS === "web") {
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = "budget_export.csv"; a.click();
        URL.revokeObjectURL(url);
        Alert.alert("Exported", "Budget data downloaded.");
      } else {
        const uri = FileSystem.documentDirectory + "budget_export.csv";
        await FileSystem.writeAsStringAsync(uri, csv);
        await Sharing.shareAsync(uri, { mimeType: "text/csv" });
      }
    } catch { Alert.alert("Error", "Export failed."); }
  };

  const handleImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "*/*"] });
      if (result.canceled || !result.assets?.length) return;
      const file = result.assets[0];
      let content: string;
      if (Platform.OS === "web") { const r = await fetch(file.uri); content = await r.text(); }
      else { content = await FileSystem.readAsStringAsync(file.uri); }

      const lines = content.split("\n").filter(l => l.trim() && !l.startsWith("="));
      const headerIdx = lines.findIndex(l => l.toLowerCase().includes("name") && l.toLowerCase().includes("amount"));
      if (headerIdx === -1) { Alert.alert("Invalid CSV", "Could not find Name,Amount header."); return; }

      const imported: Parameters<typeof importBills>[0] = [];
      for (let i = headerIdx + 1; i < lines.length; i++) {
        const parts = lines[i].split(",").map(p => p.replace(/"/g, "").trim());
        const amount = parseFloat(parts[1]);
        if (!parts[0] || isNaN(amount)) continue;
        imported.push({ name: parts[0], amount, category: parts[2] || "Other", priority: parseInt(parts[3]) || i, is_debt: parts[4]?.toLowerCase() === "true", balance: parseFloat(parts[5]) || 0, interest_rate: parseFloat(parts[6]) || 0, due_day: parseInt(parts[7]) || 1, is_recurring: parts[8]?.toLowerCase() !== "false" });
      }
      if (!imported.length) { Alert.alert("No Data", "No valid bill rows found."); return; }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      importBills(imported);
      Alert.alert("Imported", `${imported.length} bills added.`);
    } catch { Alert.alert("Error", "Import failed."); }
  };

  const handleDeleteIncome = (item: IncomeItem) => {
    Alert.alert("Delete Income", `Remove "${item.name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); deleteIncome(item.id); } },
    ]);
  };

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: c.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 + webTopPad, paddingBottom: insets.bottom + 100 }]}
    >
      <Text style={[styles.pageTitle, { color: c.foreground }]}>Settings</Text>

      <SLabel c={c} text="Income Sources" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        {incomes.length === 0 ? (
          <Text style={[styles.emptyText, { color: c.mutedForeground }]}>No income sources added yet.</Text>
        ) : (
          incomes.map((item, i) => {
            const monthly = item.frequency === "weekly" ? item.amount * 4.33 : item.frequency === "biweekly" ? item.amount * 2.17 : item.amount;
            return (
              <View key={item.id} style={[styles.incomeRow, { borderTopWidth: i > 0 ? 1 : 0, borderTopColor: c.border }]}>
                <View style={[styles.incomeIcon, { backgroundColor: c.success + "20" }]}>
                  <Feather name="trending-up" size={16} color={c.success} />
                </View>
                <Pressable onPress={() => { setEditIncome(item); setIncomeModalVisible(true); }} style={styles.incomeInfo}>
                  <Text style={[styles.incomeName, { color: c.foreground }]}>{item.name}</Text>
                  <Text style={[styles.incomeFreq, { color: c.mutedForeground }]}>
                    ${item.amount.toFixed(0)}{FREQ_LABELS[item.frequency]} → ${monthly.toFixed(0)}/mo
                  </Text>
                </Pressable>
                <Pressable onPress={() => handleDeleteIncome(item)} hitSlop={8}>
                  <Feather name="trash-2" size={15} color={c.destructive} />
                </Pressable>
              </View>
            );
          })
        )}
        {incomes.length > 0 && (
          <View style={[styles.incomeTotal, { borderTopColor: c.border }]}>
            <Text style={[styles.incomeTotalLabel, { color: c.mutedForeground }]}>Total Monthly Income</Text>
            <Text style={[styles.incomeTotalValue, { color: c.success }]}>${totalMonthlyIncome.toFixed(0)}/mo</Text>
          </View>
        )}
        <Pressable
          onPress={() => { setEditIncome(null); setIncomeModalVisible(true); }}
          style={({ pressed }) => [styles.addIncomeBtn, { backgroundColor: c.primary + "18", borderRadius: 10, opacity: pressed ? 0.7 : 1 }]}
        >
          <Feather name="plus" size={16} color={c.primary} />
          <Text style={[styles.addIncomeBtnText, { color: c.primary }]}>Add Income Source</Text>
        </Pressable>
      </View>

      <SLabel c={c} text="Debt Payoff Strategy" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <View style={[styles.methodRow, { backgroundColor: c.muted, borderRadius: 10 }]}>
          {(["snowball", "avalanche"] as const).map(m => (
            <Pressable key={m} onPress={() => updateSettings({ paymentMethod: m })} style={[styles.methodBtn, { backgroundColor: settings.paymentMethod === m ? c.primary : "transparent", borderRadius: 8 }]}>
              <Feather name={m === "snowball" ? "trending-down" : "percent"} size={13} color={settings.paymentMethod === m ? c.primaryForeground : c.mutedForeground} />
              <Text style={[styles.methodText, { color: settings.paymentMethod === m ? c.primaryForeground : c.mutedForeground }]}>{m === "snowball" ? "Snowball" : "Avalanche"}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.methodDesc, { color: c.mutedForeground }]}>
          {settings.paymentMethod === "snowball"
            ? "Pay smallest balances first for quick wins. Freed-up minimums roll into the next debt (cascade)."
            : "Pay highest-interest debts first to minimize total interest paid over time."}
        </Text>
      </View>

      <SLabel c={c} text="Behavior" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <View style={styles.switchRow}>
          <View style={styles.switchInfo}>
            <Text style={[styles.switchLabel, { color: c.foreground }]}>Carryover Balances</Text>
            <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>Unpaid amounts roll forward monthly</Text>
          </View>
          <Switch value={settings.carryover_balances} onValueChange={v => updateSettings({ carryover_balances: v })} trackColor={{ false: c.muted, true: c.primary }} thumbColor="#fff" />
        </View>
      </View>

      <SLabel c={c} text="Data" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        {[
          { icon: "upload" as const, label: "Import Bills from CSV", desc: "Name, Amount, Category, Balance, Interest Rate...", onPress: handleImport, color: c.primary },
          { icon: "download" as const, label: "Export All Data", desc: "Bills, transactions, monthly overrides", onPress: handleExport, color: "#6366f1" },
        ].map((item, i) => (
          <Pressable key={item.label} onPress={item.onPress} style={({ pressed }) => [styles.dataRow, { borderTopWidth: i > 0 ? 1 : 0, borderTopColor: c.border, opacity: pressed ? 0.7 : 1 }]}>
            <View style={[styles.dataIcon, { backgroundColor: item.color + "18" }]}><Feather name={item.icon} size={17} color={item.color} /></View>
            <View style={styles.dataBody}><Text style={[styles.dataLabel, { color: c.foreground }]}>{item.label}</Text><Text style={[styles.dataDesc, { color: c.mutedForeground }]}>{item.desc}</Text></View>
            <Feather name="chevron-right" size={15} color={c.mutedForeground} />
          </Pressable>
        ))}
      </View>

      <SLabel c={c} text="Summary" />
      <View style={[styles.summaryCard, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        {[
          { label: "Bills", val: bills.length },
          { label: "Debts", val: bills.filter(b => b.is_debt).length },
          { label: "Goals", val: goals.length },
          { label: "Transactions", val: transactions.length },
        ].map(s => (
          <View key={s.label} style={styles.summaryItem}>
            <Text style={[styles.summaryNum, { color: c.foreground }]}>{s.val}</Text>
            <Text style={[styles.summaryLabel, { color: c.mutedForeground }]}>{s.label}</Text>
          </View>
        ))}
      </View>

      <IncomeModal
        visible={incomeModalVisible}
        onClose={() => { setIncomeModalVisible(false); setEditIncome(null); }}
        onSave={(data) => {
          if ("id" in data) updateIncome(data as IncomeItem);
          else addIncome(data);
        }}
        editItem={editIncome}
      />
    </ScrollView>
  );
}

function SLabel({ c, text }: { c: any; text: string }) {
  return <Text style={{ color: c.mutedForeground, fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8, marginTop: 4 }}>{text}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 16 },
  pageTitle: { fontSize: 28, fontFamily: "Inter_700Bold", marginBottom: 20 },
  card: { padding: 16, marginBottom: 20, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 8 },
  incomeRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: 12 },
  incomeIcon: { width: 36, height: 36, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  incomeInfo: { flex: 1 },
  incomeName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  incomeFreq: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  incomeTotal: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 10, borderTopWidth: 1, marginTop: 4 },
  incomeTotalLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  incomeTotalValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  addIncomeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, marginTop: 10 },
  addIncomeBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  methodRow: { flexDirection: "row", padding: 4, gap: 4 },
  methodBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10 },
  methodText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  methodDesc: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, marginTop: 10 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  switchInfo: { flex: 1, marginRight: 12 },
  switchLabel: { fontSize: 15, fontFamily: "Inter_500Medium" },
  switchDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  dataRow: { flexDirection: "row", alignItems: "center", paddingVertical: 13 },
  dataIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: 12 },
  dataBody: { flex: 1 },
  dataLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  dataDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  summaryCard: { flexDirection: "row", justifyContent: "space-around", padding: 16, marginBottom: 8 },
  summaryItem: { alignItems: "center" },
  summaryNum: { fontSize: 24, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },
});
