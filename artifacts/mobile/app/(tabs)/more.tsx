import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Alert, Platform, Pressable, ScrollView, StyleSheet,
  Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountModal } from "@/components/AccountModal";
import { IncomeModal } from "@/components/IncomeModal";
import colors from "@/constants/colors";
import type { Account, IncomeItem } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useAuth } from "@/context/AuthContext";
import { type ThemeMode, useThemeMode } from "@/context/ThemeContext";
import { useColors } from "@/hooks/useColors";
import { parseStatementCsv } from "@/lib/accounts";
import { readDecisionHubSettings, writeDecisionHubSettings, type DecisionHubSettings } from "@/lib/decisionHubSettings";
import { resetFloMemory } from "@/lib/flo";

const FREQ_LABELS: Record<string, string> = { monthly: "Monthly", biweekly: "Biweekly", weekly: "Weekly" };

const THEME_OPTIONS: { label: string; value: ThemeMode; icon: string }[] = [
  { label: "Light", value: "light", icon: "sun" },
  { label: "Dark",  value: "dark",  icon: "moon" },
  { label: "Auto",  value: "auto",  icon: "smartphone" },
];

export default function MoreScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { themeMode, setThemeMode } = useThemeMode();
  const { signOut, user } = useAuth();
  const {
    bills, transactions, overrides, incomes, goals, importBills, settings, updateSettings, accounts, forecastConfidence,
    addIncome, updateIncome, deleteIncome, getMonthlyIncome,
    categories, addCategory, updateCategory, deleteCategory,
    addAccount, updateAccount, reconcileAccount, archiveAccount, importStatementTransactions,
  } = useBudget();

  const [incomeModalVisible, setIncomeModalVisible] = useState(false);
  const [accountModalVisible, setAccountModalVisible] = useState(false);
  const [accountMode, setAccountMode] = useState<"add" | "edit" | "reconcile">("add");
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [editIncome, setEditIncome] = useState<IncomeItem | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [safetyFloorText, setSafetyFloorText] = useState(settings.safety_floor.toString());
  const [forecastHorizonText, setForecastHorizonText] = useState(settings.forecast_horizon_months.toString());
  const [decisionHubSettings, setDecisionHubSettings] = useState<DecisionHubSettings>(() => readDecisionHubSettings());
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    setSafetyFloorText(settings.safety_floor.toString());
    setForecastHorizonText(settings.forecast_horizon_months.toString());
  }, [settings.safety_floor, settings.forecast_horizon_months]);

  const saveSafetySettings = () => {
    const floor = Math.max(0, parseFloat(safetyFloorText) || 0);
    const horizon = Math.min(24, Math.max(1, Math.round(parseFloat(forecastHorizonText) || 6)));
    setSafetyFloorText(floor.toString());
    setForecastHorizonText(horizon.toString());
    updateSettings({ safety_floor: floor, forecast_horizon_months: horizon });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const updateDecisionHubSetting = (next: Partial<DecisionHubSettings>) => {
    const merged = { ...decisionHubSettings, ...next };
    setDecisionHubSettings(merged);
    writeDecisionHubSettings(merged);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const totalMonthlyIncome = getMonthlyIncome();

  const handleExport = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const billHeader = "Name,Amount,Category,Priority,IsDebt,Balance,InterestRate,DueDay,IsRecurring,Frequency";
      const billRows = bills.map(b =>
        `"${b.name}",${b.amount},"${b.category}",${b.priority},${b.is_debt},${b.balance},${b.interest_rate},${b.due_day},${b.is_recurring},${b.frequency ?? "monthly"}`
      ).join("\n");
      const txHeader = "Date,Amount,Category,Note";
      const txRows = transactions.map(t => `"${t.date}",${t.amount},"${t.category}","${t.note}"`).join("\n");
      const ovrHeader = "BillId,Month,Year,CustomAmount,PaidAmount";
      const ovrRows = overrides.map(o => `"${o.bill_id}",${o.month},${o.year},${o.custom_amount ?? ""},${o.paid_amount}`).join("\n");
      const csv = [
        "=== BILLS ===", billHeader, billRows,
        "", "=== TRANSACTIONS ===", txHeader, txRows,
        "", "=== MONTHLY OVERRIDES ===", ovrHeader, ovrRows,
      ].join("\n");

      if (Platform.OS === "web") {
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = "budget_export.csv"; a.click();
        URL.revokeObjectURL(url);
      } else {
        const uri = (FileSystem.cacheDirectory ?? FileSystem.documentDirectory) + "budget_export.csv";
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
        imported.push({
          name: parts[0], amount, category: parts[2] || "Other",
          priority: parseInt(parts[3]) || i, is_debt: parts[4]?.toLowerCase() === "true",
          balance: parseFloat(parts[5]) || 0, interest_rate: parseFloat(parts[6]) || 0,
          due_day: parseInt(parts[7]) || 1, is_recurring: parts[8]?.toLowerCase() !== "false",
          frequency: (parts[9] === "weekly" ? "weekly" : "monthly"),
        });
      }
      if (!imported.length) { Alert.alert("No Data", "No valid bill rows found."); return; }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      importBills(imported);
      Alert.alert("Imported", `${imported.length} bills added.`);
    } catch { Alert.alert("Error", "Import failed."); }
  };

  const openAccount = (mode: "add" | "edit" | "reconcile", account: Account | null = null) => {
    setSelectedAccount(account); setAccountMode(mode); setAccountModalVisible(true);
  };

  const readPickedFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "*/*"] });
    if (result.canceled || !result.assets?.length) return null;
    const file = result.assets[0];
    if (Platform.OS === "web") { const response = await fetch(file.uri); return response.text(); }
    return FileSystem.readAsStringAsync(file.uri);
  };

  const importStatementFor = async (account: Account) => {
    try {
      const content = await readPickedFile();
      if (!content) return;
      const rows = parseStatementCsv(content, account.id);
      if (!rows.length) { Alert.alert("No transactions found", "Use a CSV with Date, Description, and Amount columns (or separate Debit and Credit columns)."); return; }
      const result = await importStatementTransactions(account.id, rows);
      Alert.alert("Statement imported", `${result.imported} new transaction${result.imported === 1 ? "" : "s"} added.${result.duplicates ? ` ${result.duplicates} duplicate${result.duplicates === 1 ? " was" : "s were"} skipped.` : ""}`);
    } catch { Alert.alert("Import failed", "The statement could not be imported. Your existing transactions were not changed."); }
  };

  const handleStatementImport = () => {
    const active = accounts.filter(account => account.is_active);
    if (!active.length) { Alert.alert("Add an account first", "Transactions need an account so FlowLedger can detect duplicate statement rows."); return; }
    if (active.length === 1) { void importStatementFor(active[0]); return; }
    Alert.alert("Choose account", "Which account is this statement for?", [
      ...active.slice(0, 4).map(account => ({ text: account.name, onPress: () => void importStatementFor(account) })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  };
  const handleResetFlo = () => {
    if (!user) return;
    Alert.alert("Reset Flo Memory", "Remove Flo's saved preference and context summary? Your financial data will not be changed.", [
      { text: "Cancel", style: "cancel" },
      { text: "Reset", style: "destructive", onPress: () => void resetFloMemory(user.id).then(() => Alert.alert("Flo Memory Reset", "Flo's rolling summary was removed.")) },
    ]);
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.location.assign("/login");
        return;
      }
      router.replace("/login");
      setSigningOut(false);
    }
  };


  const handleDeleteIncome = (item: IncomeItem) => {
    const doDelete = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); deleteIncome(item.id); };
    if (Platform.OS === "web") { doDelete(); return; }
    Alert.alert("Delete Income", `Remove "${item.name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: doDelete },
    ]);
  };

  const handleAddCategory = () => {
    const trimmed = newCategory.trim();
    if (!trimmed) return;
    addCategory(trimmed);
    setNewCategory("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleRenameCategory = (oldName: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === oldName) { setRenamingCategory(null); return; }
    updateCategory(oldName, trimmed);
    setRenamingCategory(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleDeleteCategory = (name: string) => {
    const inUse = bills.filter(b => b.category === name).length + transactions.filter(t => t.category === name).length;
    const doDelete = () => {
      deleteCategory(name);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    };
    if (Platform.OS === "web") { doDelete(); return; }
    const msg = inUse > 0
      ? `"${name}" is used by ${inUse} item(s). They will be reassigned to "Other".`
      : `Delete category "${name}"?`;
    Alert.alert("Delete Category", msg, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: doDelete },
    ]);
  };

  const webTopPad = Platform.OS === "web" ? 4 : 0;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: c.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 + webTopPad, paddingBottom: insets.bottom + 100 }]}
    >
      <Text style={[styles.pageTitle, { color: c.foreground }]}>Settings</Text>

      {/* ── Appearance ── */}
      <SLabel c={c} text="Appearance" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <View style={[styles.themeRow, { backgroundColor: c.muted, borderRadius: 10 }]}>
          {THEME_OPTIONS.map(opt => {
            const active = themeMode === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => { setThemeMode(opt.value); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                style={[styles.themeBtn, { backgroundColor: active ? c.primary : "transparent", borderRadius: 8 }]}
              >
                <Feather name={opt.icon as any} size={14} color={active ? "#fff" : c.mutedForeground} />
                <Text style={[styles.themeBtnText, { color: active ? "#fff" : c.mutedForeground }]}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* ── Accounts and reconciliation ── */}
      <SLabel c={c} text="Decision Hub" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <Pressable
          onPress={() => updateDecisionHubSetting({ categoryRolloverEnabled: !decisionHubSettings.categoryRolloverEnabled })}
          style={({ pressed }) => [styles.decisionSettingRow, { opacity: pressed ? 0.75 : 1 }]}
        >
          <View style={[styles.dataIcon, { backgroundColor: c.primary + "18" }]}>
            <Feather name="repeat" size={17} color={c.primary} />
          </View>
          <View style={styles.switchInfo}>
            <Text style={[styles.switchLabel, { color: c.foreground }]}>Category rollover</Text>
            <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>
              Carry last month's leftover or overage into this month's Category Plan.
            </Text>
          </View>
          <View style={[styles.toggleTrack, { backgroundColor: decisionHubSettings.categoryRolloverEnabled ? c.primary : c.muted }]}>
            <View style={[styles.toggleKnob, { backgroundColor: "#fff", alignSelf: decisionHubSettings.categoryRolloverEnabled ? "flex-end" : "flex-start" }]} />
          </View>
        </Pressable>
        <Pressable
          onPress={() => updateDecisionHubSetting({ paycheckPlanningEnabled: !decisionHubSettings.paycheckPlanningEnabled })}
          style={({ pressed }) => [styles.decisionSettingRow, { borderTopWidth: 1, borderTopColor: c.border, marginTop: 14, paddingTop: 14, opacity: pressed ? 0.75 : 1 }]}
        >
          <View style={[styles.dataIcon, { backgroundColor: c.success + "18" }]}>
            <Feather name="calendar" size={17} color={c.success} />
          </View>
          <View style={styles.switchInfo}>
            <Text style={[styles.switchLabel, { color: c.foreground }]}>Paycheck planning</Text>
            <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>
              Show bills due and safe-to-spend before your next paycheck on Dashboard.
            </Text>
          </View>
          <View style={[styles.toggleTrack, { backgroundColor: decisionHubSettings.paycheckPlanningEnabled ? c.primary : c.muted }]}>
            <View style={[styles.toggleKnob, { backgroundColor: "#fff", alignSelf: decisionHubSettings.paycheckPlanningEnabled ? "flex-end" : "flex-start" }]} />
          </View>
        </Pressable>
        <View style={[styles.priorityNote, { backgroundColor: decisionHubSettings.categoryRolloverEnabled ? c.success + "12" : c.muted, borderRadius: 8 }]}>
          <Feather name="info" size={12} color={decisionHubSettings.categoryRolloverEnabled ? c.success : c.mutedForeground} />
          <Text style={[styles.priorityNoteText, { color: c.mutedForeground }]}>
            {decisionHubSettings.paycheckPlanningEnabled
              ? "Paycheck planning is on. Dashboard will show what is due before the next payday."
              : decisionHubSettings.categoryRolloverEnabled
                ? "Rollover is on. Positive balances build up; negative balances reduce next month."
                : "Decision Hub extras are optional. Turn on the planning tools you want to see."}
          </Text>
        </View>
      </View>

      <SLabel c={c} text="Accounts" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <View style={[styles.confidenceBox, { backgroundColor: forecastConfidence.level === "high" ? c.success + "14" : forecastConfidence.level === "medium" ? "#f59e0b18" : c.destructive + "12" }]}>
          <Feather name={forecastConfidence.level === "high" ? "check-circle" : "alert-circle"} size={16} color={forecastConfidence.level === "high" ? c.success : forecastConfidence.level === "medium" ? "#d97706" : c.destructive} />
          <View style={{ flex: 1 }}><Text style={[styles.accountName, { color: c.foreground }]}>Forecast confidence: {forecastConfidence.label}</Text><Text style={[styles.switchDesc, { color: c.mutedForeground }]}>{forecastConfidence.reasons[0]}</Text></View>
        </View>
        {accounts.filter(account => account.is_active).map((account, index) => {
          const reviewed = account.last_reconciled_at ?? account.balance_as_of;
          const age = Math.max(0, Math.floor((Date.now() - new Date(reviewed).getTime()) / 86_400_000));
          return <View key={account.id} style={[styles.accountRow, { borderTopWidth: index ? 1 : 0, borderTopColor: c.border }]}>
            <View style={[styles.incomeIcon, { backgroundColor: c.primary + "16" }]}><Feather name={account.account_type === "savings" ? "heart" : "dollar-sign"} size={17} color={c.primary} /></View>
            <Pressable style={{ flex: 1 }} onPress={() => openAccount("edit", account)}><Text style={[styles.accountName, { color: c.foreground }]}>{account.name}</Text><Text style={[styles.incomeFreq, { color: age > 30 ? c.destructive : c.mutedForeground }]}>{account.account_type.replace("_", " ")} · {age === 0 ? "reconciled today" : `${age} days since review`}</Text></Pressable>
            <View style={styles.accountRight}><Text style={[styles.incomeMonthly, { color: c.foreground }]}>${account.current_balance.toFixed(2)}</Text><Pressable onPress={() => openAccount("reconcile", account)}><Text style={[styles.reconcileText, { color: c.primary }]}>Reconcile</Text></Pressable></View>
          </View>;
        })}
        {!accounts.some(account => account.is_active) && <Text style={[styles.emptyText, { color: c.mutedForeground }]}>Add checking, savings, or cash accounts that fund your budget.</Text>}
        <Pressable onPress={() => openAccount("add")} style={[styles.addBtn, { backgroundColor: c.primary + "12", borderRadius: 10 }]}><Feather name="plus" size={16} color={c.primary} /><Text style={[styles.addBtnText, { color: c.primary }]}>Add Account</Text></Pressable>
      </View>

      {/* ── Income Sources ── */}
      <SLabel c={c} text="Income Sources" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        {incomes.length === 0 ? (
          <Text style={[styles.emptyText, { color: c.mutedForeground }]}>No income sources added yet.</Text>
        ) : (
          incomes.map((item, i) => {
            const monthly = item.frequency === "weekly" ? item.amount * 4
              : item.frequency === "biweekly" ? item.amount * 2 : item.amount;
            return (
              <View key={item.id} style={[styles.incomeRow, { borderTopWidth: i > 0 ? 1 : 0, borderTopColor: c.border }]}>
                <View style={[styles.incomeIcon, { backgroundColor: c.success + "20" }]}>
                  <Feather name="trending-up" size={16} color={c.success} />
                </View>
                <Pressable onPress={() => { setEditIncome(item); setIncomeModalVisible(true); }} style={styles.incomeInfo}>
                  <Text style={[styles.incomeName, { color: c.foreground }]}>{item.name}</Text>
                  <Text style={[styles.incomeFreq, { color: c.mutedForeground }]}>
                    ${item.amount.toLocaleString()} · {FREQ_LABELS[item.frequency]}
                    {item.start_date ? ` · from ${item.start_date}` : ""}
                  </Text>
                </Pressable>
                <View style={styles.incomeRight}>
                  <Text style={[styles.incomeMonthly, { color: c.success }]}>
                    ${monthly.toFixed(0)}
                    <Text style={[styles.incomeMonthlyUnit, { color: c.mutedForeground }]}>/mo</Text>
                  </Text>
                  <Pressable onPress={() => handleDeleteIncome(item)} hitSlop={12} style={styles.deleteIcon}>
                    <Feather name="trash-2" size={15} color={c.destructive} />
                  </Pressable>
                </View>
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
          style={({ pressed }) => [styles.addBtn, { backgroundColor: c.primary + "18", borderRadius: 10, opacity: pressed ? 0.7 : 1 }]}
        >
          <Feather name="plus" size={16} color={c.primary} />
          <Text style={[styles.addBtnText, { color: c.primary }]}>Add Income Source</Text>
        </Pressable>
      </View>

      {/* ── Categories ── */}
      <SLabel c={c} text="Categories" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        {categories.map((cat, i) => (
          <View
            key={cat}
            style={[styles.categoryRow, { borderTopWidth: i > 0 ? 1 : 0, borderTopColor: c.border }]}
          >
            {renamingCategory === cat ? (
              <View style={styles.renameRow}>
                <TextInput
                  style={[styles.renameInput, { backgroundColor: c.muted, color: c.foreground }]}
                  value={renameValue}
                  onChangeText={setRenameValue}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={() => handleRenameCategory(cat)}
                  onBlur={() => handleRenameCategory(cat)}
                />
                <Pressable
                  onPress={() => handleRenameCategory(cat)}
                  style={[styles.renameConfirm, { backgroundColor: c.primary }]}
                >
                  <Feather name="check" size={14} color={c.primaryForeground} />
                </Pressable>
                <Pressable
                  onPress={() => setRenamingCategory(null)}
                  hitSlop={8}
                >
                  <Feather name="x" size={16} color={c.mutedForeground} />
                </Pressable>
              </View>
            ) : (
              <>
                <View style={[styles.catDot, { backgroundColor: c.primary + "60" }]} />
                <Text style={[styles.catName, { color: c.foreground }]}>{cat}</Text>
                <View style={styles.catActions}>
                  <Pressable
                    onPress={() => { setRenamingCategory(cat); setRenameValue(cat); }}
                    hitSlop={8}
                    style={styles.catActionBtn}
                  >
                    <Feather name="edit-2" size={14} color={c.mutedForeground} />
                  </Pressable>
                  <Pressable
                    onPress={() => handleDeleteCategory(cat)}
                    hitSlop={8}
                    style={styles.catActionBtn}
                  >
                    <Feather name="trash-2" size={14} color={c.destructive} />
                  </Pressable>
                </View>
              </>
            )}
          </View>
        ))}

        <View style={[styles.addCatRow, { borderTopWidth: categories.length > 0 ? 1 : 0, borderTopColor: c.border }]}>
          <TextInput
            style={[styles.addCatInput, { backgroundColor: c.muted, color: c.foreground }]}
            value={newCategory}
            onChangeText={setNewCategory}
            placeholder="New category name..."
            placeholderTextColor={c.mutedForeground}
            returnKeyType="done"
            onSubmitEditing={handleAddCategory}
          />
          <Pressable
            onPress={handleAddCategory}
            style={({ pressed }) => [styles.addCatBtn, { backgroundColor: c.primary, opacity: pressed ? 0.75 : 1 }]}
          >
            <Feather name="plus" size={16} color={c.primaryForeground} />
          </Pressable>
        </View>
      </View>

      {/* ── Debt Payoff Strategy ── */}
      <SLabel c={c} text="Debt Payoff Strategy" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <View style={[styles.methodRow, { backgroundColor: c.muted, borderRadius: 10 }]}>
          {(["snowball", "avalanche"] as const).map(m => (
            <Pressable
              key={m}
              onPress={() => updateSettings({ paymentMethod: m })}
              style={[styles.methodBtn, { backgroundColor: settings.paymentMethod === m ? c.primary : "transparent", borderRadius: 8 }]}
            >
              <Feather name={m === "snowball" ? "trending-down" : "percent"} size={13} color={settings.paymentMethod === m ? c.primaryForeground : c.mutedForeground} />
              <Text style={[styles.methodText, { color: settings.paymentMethod === m ? c.primaryForeground : c.mutedForeground }]}>
                {m === "snowball" ? "Snowball" : "Avalanche"}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.methodDesc, { color: c.mutedForeground }]}>
          {settings.paymentMethod === "snowball"
            ? "Pay smallest balances first. Freed-up minimums roll into the next debt (cascade effect)."
            : "Pay highest-interest debts first to minimize total interest paid."}
        </Text>
        <View style={[styles.priorityNote, { backgroundColor: c.primary + "12", borderRadius: 8 }]}>
          <Feather name="info" size={12} color={c.primary} />
          <Text style={[styles.priorityNoteText, { color: c.mutedForeground }]}>
            Debt priorities are auto-assigned by balance (lowest balance = priority #1).
          </Text>
        </View>
      </View>

      {/* ── Behavior ── */}
      <SLabel c={c} text="Behavior" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <View>
          <Text style={[styles.switchLabel, { color: c.foreground, marginBottom: 2 }]}>Forecast Safety</Text>
          <Text style={[styles.switchDesc, { color: c.mutedForeground, marginBottom: 10 }]}>Protect this minimum balance across your selected forecast window.</Text>
          <View style={styles.safetyFields}>
            <View style={styles.safetyField}>
              <Text style={[styles.balanceFieldLabel, { color: c.mutedForeground }]}>Safety floor ($)</Text>
              <TextInput
                style={[styles.balanceFullInput, { backgroundColor: c.muted, color: c.foreground }]}
                value={safetyFloorText}
                onChangeText={setSafetyFloorText}
                keyboardType="decimal-pad"
                placeholder="200"
                placeholderTextColor={c.mutedForeground}
              />
            </View>
            <View style={styles.safetyField}>
              <Text style={[styles.balanceFieldLabel, { color: c.mutedForeground }]}>Months (1–24)</Text>
              <TextInput
                style={[styles.balanceFullInput, { backgroundColor: c.muted, color: c.foreground }]}
                value={forecastHorizonText}
                onChangeText={setForecastHorizonText}
                keyboardType="number-pad"
                placeholder="6"
                placeholderTextColor={c.mutedForeground}
              />
            </View>
          </View>
          <Pressable
            onPress={saveSafetySettings}
            style={({ pressed }) => [styles.balanceSaveFullBtn, { backgroundColor: c.primary, opacity: pressed ? 0.8 : 1 }]}
          >
            <Feather name="shield" size={15} color={c.primaryForeground} />
            <Text style={[styles.balanceSaveBtnText, { color: c.primaryForeground }]}>Save Forecast Safety</Text>
          </Pressable>
        </View>
        <View style={[styles.balanceDivider, { borderTopColor: c.border }]}>
          <Text style={[styles.switchLabel, { color: c.foreground, marginBottom: 2 }]}>Forecast balance source</Text>
          <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>Your active accounts now supply the dated starting balance. Reconcile an account above whenever the bank and FlowLedger differ.</Text>
        </View>
      </View>

      {/* ── Data ── */}
      <SLabel c={c} text="Data" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        {[
          { icon: "upload" as const,   label: "Import Bills from CSV", desc: "Name, Amount, Category, Balance, Interest Rate…", onPress: handleImport, color: c.primary },
          { icon: "file-text" as const, label: "Import Bank Statement", desc: "Transactions CSV with automatic duplicate detection", onPress: handleStatementImport, color: c.success },
          { icon: "download" as const, label: "Export Bills (CSV)",    desc: "Bills, transactions, monthly overrides",           onPress: handleExport, color: "#6366f1" },
          { icon: "refresh-cw" as const, label: "Reset Flo Memory", desc: "Remove Flo's rolling preference summary", onPress: handleResetFlo, color: "#3b82f6" },
        ].map((item, i) => (
          <Pressable
            key={item.label}
            onPress={item.onPress}
            style={({ pressed }) => [styles.dataRow, { borderTopWidth: i > 0 ? 1 : 0, borderTopColor: c.border, opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={[styles.dataIcon, { backgroundColor: item.color + "18" }]}>
              <Feather name={item.icon} size={17} color={item.color} />
            </View>
            <View style={styles.dataBody}>
              <Text style={[styles.dataLabel, { color: c.foreground }]}>{item.label}</Text>
              <Text style={[styles.dataDesc, { color: c.mutedForeground }]}>{item.desc}</Text>
            </View>
            <Feather name="chevron-right" size={15} color={c.mutedForeground} />
          </Pressable>
        ))}
      </View>

      {/* ── Summary ── */}
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

      {/* ── Account section ── */}
      <View style={{ marginTop: 8, marginBottom: 8 }}>
        <SLabel c={c} text="Account" />
        <View style={[styles.card, { borderRadius: 14, backgroundColor: c.card }]}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingBottom: 12, marginBottom: 12, borderBottomWidth: 1, borderBottomColor: c.border }}>
            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c.primary + "22", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
              <Feather name="user" size={18} color={c.primary} />
            </View>
            <Text style={{ flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: c.mutedForeground }} numberOfLines={1}>{user?.email}</Text>
          </View>
          <Pressable
            onPress={() => {
              if (Platform.OS === "web") {
                void handleSignOut();
                return;
              }
              Alert.alert("Sign Out", "Sign out of FlowLedger?", [
                { text: "Cancel", style: "cancel" },
                { text: "Sign Out", style: "destructive", onPress: () => void handleSignOut() },
              ]);
            }}
            disabled={signingOut}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, opacity: pressed || signingOut ? 0.7 : 1 })}
          >
            <Feather name="log-out" size={18} color={c.destructive} />
            <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: c.destructive }}>{signingOut ? "Signing Out…" : "Sign Out"}</Text>
          </Pressable>
        </View>
      </View>

      <IncomeModal
        visible={incomeModalVisible}
        onClose={() => { setIncomeModalVisible(false); setEditIncome(null); }}
        onSave={(data) => {
          if ("id" in data) return updateIncome(data as IncomeItem);
          return addIncome(data);
        }}
        editItem={editIncome}
      />
      <AccountModal
        visible={accountModalVisible}
        account={selectedAccount}
        mode={accountMode}
        onClose={() => setAccountModalVisible(false)}
        onSave={value => {
          if (selectedAccount) return updateAccount({
            ...selectedAccount,
            name: value.name,
            account_type: value.account_type,
            current_balance: value.current_balance,
            balance_as_of: value.balance_as_of,
          });
          return addAccount({ ...value, is_active: true });
        }}
        onReconcile={(balance, date) => selectedAccount ? reconcileAccount(selectedAccount.id, balance, date) : Promise.resolve()}
      />
    </ScrollView>
  );
}

function SLabel({ c, text }: { c: any; text: string }) {
  return (
    <Text style={{ color: c.mutedForeground, fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8, marginTop: 4 }}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 16 },
  pageTitle:    { fontSize: 28, fontFamily: "Inter_700Bold", marginBottom: 20 },
  pageSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 20 },
  card: { padding: 16, marginBottom: 20, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 8 },

  incomeRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: 10 },
  incomeIcon: { width: 36, height: 36, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  incomeInfo: { flex: 1 },
  incomeName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  incomeFreq: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  incomeRight: { alignItems: "flex-end", gap: 4 },
  incomeMonthly: { fontSize: 15, fontFamily: "Inter_700Bold" },
  incomeMonthlyUnit: { fontSize: 11, fontFamily: "Inter_400Regular" },
  deleteIcon: { padding: 4 },
  incomeTotal: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 10, borderTopWidth: 1, marginTop: 4 },
  incomeTotalLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  incomeTotalValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, marginTop: 10 },
  addBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  confidenceBox: { flexDirection: "row", alignItems: "flex-start", gap: 9, padding: 11, borderRadius: 10, marginBottom: 8 },
  accountRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  accountName: { fontSize: 14, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  accountRight: { alignItems: "flex-end", gap: 3 },
  reconcileText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  categoryRow: { flexDirection: "row", alignItems: "center", paddingVertical: 11 },
  catDot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  catName: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  catActions: { flexDirection: "row", gap: 14 },
  catActionBtn: { padding: 2 },
  renameRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  renameInput: { flex: 1, height: 36, borderRadius: 8, paddingHorizontal: 10, fontSize: 14, fontFamily: "Inter_400Regular" },
  renameConfirm: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  addCatRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, paddingTop: 10 },
  addCatInput: { flex: 1, height: 40, borderRadius: 10, paddingHorizontal: 12, fontSize: 14, fontFamily: "Inter_400Regular" },
  addCatBtn: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },

  methodRow: { flexDirection: "row", padding: 4, gap: 4 },
  methodBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10 },
  themeRow:  { flexDirection: "row", padding: 4, gap: 4 },
  themeBtn:  { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10 },
  themeBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  methodText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  methodDesc: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, marginTop: 10 },
  priorityNote: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, marginTop: 10 },
  priorityNoteText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },

  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  switchInfo: { flex: 1, marginRight: 12 },
  switchLabel: { fontSize: 15, fontFamily: "Inter_500Medium" },
  switchDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  decisionSettingRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  toggleTrack: { width: 48, height: 28, borderRadius: 999, padding: 3, justifyContent: "center" },
  toggleKnob: { width: 22, height: 22, borderRadius: 11 },
  balanceDivider: { borderTopWidth: 1, marginTop: 14, paddingTop: 14 },
  balanceHeader: { marginBottom: 10 },
  balanceFieldLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 },
  balanceFullInput: { height: 44, borderRadius: 10, paddingHorizontal: 14, fontSize: 16, fontFamily: "Inter_400Regular" },
  balanceSaveFullBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 44, borderRadius: 10, marginTop: 12 },
  balanceSaveBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  balanceNote: { flexDirection: "row", alignItems: "flex-start", gap: 6, padding: 9, borderRadius: 8, marginTop: 10 },
  safetyFields: { flexDirection: "row", gap: 10 },
  safetyField: { flex: 1 },

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

