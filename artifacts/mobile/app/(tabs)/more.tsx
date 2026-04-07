import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import React, { useCallback } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import colors from "@/constants/colors";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

export default function MoreScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { bills, transactions, monthlyEntries, importBills, settings, updateSettings } = useBudget();

  const handleExport = useCallback(async () => {
    if (bills.length === 0) { Alert.alert("No Data", "Add some bills first."); return; }
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const header = "Name,Amount,Category,Priority,IsDebt,Balance,InterestRate,DueDay,IsRecurring\n";
      const rows = bills.map(b =>
        `"${b.name}",${b.amount},"${b.category}",${b.priority},${b.is_debt},${b.balance},${b.interest_rate},${b.due_day},${b.is_recurring}`
      ).join("\n");
      const txHeader = "\n\nDate,Amount,Category,Note\n";
      const txRows = transactions.map(t => `"${t.date}",${t.amount},"${t.category}","${t.note}"`).join("\n");
      const csv = header + rows + txHeader + txRows;

      if (Platform.OS === "web") {
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "budget_export.csv"; a.click();
        URL.revokeObjectURL(url);
        Alert.alert("Exported", "Budget data downloaded.");
      } else {
        const uri = FileSystem.documentDirectory + "budget_export.csv";
        await FileSystem.writeAsStringAsync(uri, csv);
        await Sharing.shareAsync(uri, { mimeType: "text/csv" });
      }
    } catch { Alert.alert("Error", "Export failed."); }
  }, [bills, transactions]);

  const handleImport = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values"] });
      if (result.canceled || !result.assets?.length) return;
      const file = result.assets[0];
      let content: string;
      if (Platform.OS === "web") { const r = await fetch(file.uri); content = await r.text(); }
      else { content = await FileSystem.readAsStringAsync(file.uri); }

      const lines = content.split("\n").filter(l => l.trim() && !l.startsWith("Date"));
      const header = lines[0]?.toLowerCase();
      if (!header?.includes("name")) { Alert.alert("Invalid CSV", "Expected Name,Amount,Category,..."); return; }

      const imported: Parameters<typeof importBills>[0] = [];
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(",").map(p => p.replace(/"/g, "").trim());
        const amount = parseFloat(parts[1]);
        if (!isNaN(amount) && parts[0]) {
          imported.push({
            name: parts[0],
            amount,
            category: parts[2] || "Other",
            priority: parseInt(parts[3]) || i,
            is_debt: parts[4]?.toLowerCase() === "true",
            balance: parseFloat(parts[5]) || 0,
            interest_rate: parseFloat(parts[6]) || 0,
            due_day: parseInt(parts[7]) || 1,
            is_recurring: parts[8]?.toLowerCase() !== "false",
          });
        }
      }

      if (imported.length === 0) { Alert.alert("No Data", "No valid bills found."); return; }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      importBills(imported);
      Alert.alert("Imported", `${imported.length} bills imported successfully.`);
    } catch { Alert.alert("Error", "Import failed."); }
  }, [importBills]);

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: c.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 + webTopPad, paddingBottom: insets.bottom + 100 }]}
    >
      <Text style={[styles.title, { color: c.foreground }]}>More</Text>

      <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>Payment Engine</Text>
      <View style={[styles.settingsCard, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <View style={[styles.methodToggle, { backgroundColor: c.muted, borderRadius: 10 }]}>
          <Pressable
            onPress={() => updateSettings({ paymentMethod: "snowball" })}
            style={[styles.methodBtn, { backgroundColor: settings.paymentMethod === "snowball" ? c.primary : "transparent", borderRadius: 8 }]}
          >
            <Feather name="trending-down" size={14} color={settings.paymentMethod === "snowball" ? c.primaryForeground : c.mutedForeground} />
            <Text style={[styles.methodText, { color: settings.paymentMethod === "snowball" ? c.primaryForeground : c.mutedForeground }]}>Snowball</Text>
          </Pressable>
          <Pressable
            onPress={() => updateSettings({ paymentMethod: "avalanche" })}
            style={[styles.methodBtn, { backgroundColor: settings.paymentMethod === "avalanche" ? c.primary : "transparent", borderRadius: 8 }]}
          >
            <Feather name="percent" size={14} color={settings.paymentMethod === "avalanche" ? c.primaryForeground : c.mutedForeground} />
            <Text style={[styles.methodText, { color: settings.paymentMethod === "avalanche" ? c.primaryForeground : c.mutedForeground }]}>Avalanche</Text>
          </Pressable>
        </View>
        <Text style={[styles.methodDesc, { color: c.mutedForeground }]}>
          {settings.paymentMethod === "snowball"
            ? "Snowball: Pay smallest balances first for quick wins."
            : "Avalanche: Pay highest interest first to save the most money."}
        </Text>
      </View>

      <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>Budget Settings</Text>
      <View style={[styles.settingsCard, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <Text style={[styles.inputLabel, { color: c.mutedForeground }]}>Monthly Income ($)</Text>
        <TextInput
          style={[styles.settingsInput, { backgroundColor: c.muted, color: c.foreground, borderRadius: 8 }]}
          value={settings.monthly_income > 0 ? settings.monthly_income.toString() : ""}
          onChangeText={v => updateSettings({ monthly_income: parseFloat(v) || 0 })}
          placeholder="0.00"
          placeholderTextColor={c.mutedForeground}
          keyboardType="decimal-pad"
        />
        <Text style={[styles.inputLabel, { color: c.mutedForeground, marginTop: 12 }]}>Starting Balance ($)</Text>
        <TextInput
          style={[styles.settingsInput, { backgroundColor: c.muted, color: c.foreground, borderRadius: 8 }]}
          value={settings.starting_balance > 0 ? settings.starting_balance.toString() : ""}
          onChangeText={v => updateSettings({ starting_balance: parseFloat(v) || 0 })}
          placeholder="0.00"
          placeholderTextColor={c.mutedForeground}
          keyboardType="decimal-pad"
        />

        <View style={[styles.toggleRow, { marginTop: 12 }]}>
          <Text style={[styles.toggleLabel, { color: c.foreground }]}>Carryover Balances</Text>
          <Switch
            value={settings.carryover_balances}
            onValueChange={v => updateSettings({ carryover_balances: v })}
            trackColor={{ false: c.muted, true: c.primary }}
            thumbColor="#fff"
          />
        </View>
      </View>

      <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>Data</Text>
      <View style={[styles.settingsCard, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        {[
          { icon: "upload" as const, label: "Import Bills from CSV", desc: "Name, Amount, Category, Priority...", onPress: handleImport, color: c.primary },
          { icon: "download" as const, label: "Export All Data", desc: "Bills + Transactions to CSV", onPress: handleExport, color: "#6366f1" },
        ].map((item, i) => (
          <Pressable
            key={i}
            onPress={item.onPress}
            style={({ pressed }) => [styles.dataRow, { borderTopWidth: i > 0 ? 1 : 0, borderTopColor: c.border, opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={[styles.dataIcon, { backgroundColor: item.color + "15" }]}>
              <Feather name={item.icon} size={18} color={item.color} />
            </View>
            <View style={styles.dataInfo}>
              <Text style={[styles.dataLabel, { color: c.foreground }]}>{item.label}</Text>
              <Text style={[styles.dataDesc, { color: c.mutedForeground }]}>{item.desc}</Text>
            </View>
            <Feather name="chevron-right" size={16} color={c.mutedForeground} />
          </Pressable>
        ))}
      </View>

      <View style={[styles.statsCard, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <Text style={[styles.statsTitle, { color: c.mutedForeground }]}>Overview</Text>
        <View style={styles.statsGrid}>
          {[
            { label: "Bills", value: bills.length.toString() },
            { label: "Debts", value: bills.filter(b => b.is_debt).length.toString() },
            { label: "Transactions", value: transactions.length.toString() },
            { label: "Months", value: new Set(monthlyEntries.map(e => `${e.month}-${e.year}`)).size.toString() },
          ].map(s => (
            <View key={s.label} style={styles.statItem}>
              <Text style={[styles.statValue, { color: c.foreground }]}>{s.value}</Text>
              <Text style={[styles.statLabel, { color: c.mutedForeground }]}>{s.label}</Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 16 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", marginBottom: 20 },
  sectionTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10, marginTop: 4 },
  settingsCard: { padding: 16, marginBottom: 20, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 },
  methodToggle: { flexDirection: "row", padding: 4, gap: 4 },
  methodBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10 },
  methodText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  methodDesc: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 10 },
  inputLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 },
  settingsInput: { height: 44, paddingHorizontal: 12, fontSize: 16, fontFamily: "Inter_400Regular" },
  toggleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  toggleLabel: { fontSize: 15, fontFamily: "Inter_500Medium" },
  dataRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12 },
  dataIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: 12 },
  dataInfo: { flex: 1 },
  dataLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  dataDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  statsCard: { padding: 16, marginBottom: 8 },
  statsTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 },
  statsGrid: { flexDirection: "row", justifyContent: "space-around" },
  statItem: { alignItems: "center" },
  statValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
});
