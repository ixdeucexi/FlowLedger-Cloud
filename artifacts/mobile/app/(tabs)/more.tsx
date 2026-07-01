import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert, Platform, Pressable, ScrollView, StyleSheet,
  Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountModal } from "@/components/AccountModal";
import { FloLogo } from "@/components/FloLogo";
import { IncomeModal } from "@/components/IncomeModal";
import { PWA_INSTALL_EVENT } from "@/components/PwaInstallPrompt";
import colors from "@/constants/colors";
import type { Account, IncomeItem } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useAuth } from "@/context/AuthContext";
import { type ThemeMode, useThemeMode } from "@/context/ThemeContext";
import { useColors } from "@/hooks/useColors";
import { parseStatementCsv } from "@/lib/accounts";
import { buildDataIntegrityIssues } from "@/lib/dataIntegrity";
import { loadDecisionHubSettings, readDecisionHubSettings, saveDecisionHubSettings, type DecisionHubSettings } from "@/lib/decisionHubSettings";
import { resetFloMemory } from "@/lib/flo";

const FREQ_LABELS: Record<string, string> = { monthly: "Monthly", biweekly: "Biweekly", weekly: "Weekly" };

const THEME_OPTIONS: { label: string; value: ThemeMode; icon: string }[] = [
  { label: "Light", value: "light", icon: "sun" },
  { label: "Dark",  value: "dark",  icon: "moon" },
  { label: "Auto",  value: "auto",  icon: "smartphone" },
];
const ALERT_SENSITIVITY_OPTIONS: { label: string; value: DecisionHubSettings["alertSensitivity"]; desc: string }[] = [
  { label: "Conservative", value: "conservative", desc: "Warn earlier with more cushion." },
  { label: "Balanced", value: "balanced", desc: "Default alert level." },
  { label: "Quiet", value: "quiet", desc: "Only warn when the floor is crossed." },
];
const BACKUP_COMPLETE_KEY = "flowledger_backup_exported";

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export default function MoreScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { themeMode, setThemeMode } = useThemeMode();
  const { signOut, user, startDemoMode } = useAuth();
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
  const [backupExported, setBackupExported] = useState(() => {
    try { return Platform.OS === "web" && globalThis.localStorage?.getItem(BACKUP_COMPLETE_KEY) === "true"; }
    catch { return false; }
  });
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    setSafetyFloorText(settings.safety_floor.toString());
    setForecastHorizonText(settings.forecast_horizon_months.toString());
  }, [settings.safety_floor, settings.forecast_horizon_months]);

  useEffect(() => {
    let cancelled = false;
    setDecisionHubSettings(readDecisionHubSettings());
    void loadDecisionHubSettings(user?.id).then(next => {
      if (!cancelled) setDecisionHubSettings(next);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

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
    void saveDecisionHubSettings(user?.id, merged).catch(() => undefined);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const totalMonthlyIncome = getMonthlyIncome();
  const dataIntegrityIssues = useMemo(
    () => buildDataIntegrityIssues({ accounts, bills, incomes, transactions }),
    [accounts, bills, incomes, transactions],
  );
  const setupSteps = [
    { key: "account", label: "What account should I track first?", detail: "Tell me about your checking, savings, or cash account so I know where your money starts.", done: accounts.some(account => account.is_active), action: "Answer" },
    { key: "money", label: "How much money is in that account today?", detail: "Give me the current balance and date so my forecast starts from the right number.", done: accounts.some(account => account.is_active && Math.abs(account.current_balance) > 0), action: "Answer" },
    { key: "income", label: "When does money come in?", detail: "Add paychecks, side income, or recurring deposits so I can look ahead.", done: incomes.length > 0, action: "Answer" },
    { key: "bills", label: "What bills have to be paid?", detail: "Add recurring bills and due days so I can protect the month before decisions.", done: bills.some(bill => bill.is_recurring && !bill.is_debt), action: "Answer" },
    { key: "debts", label: "What debts should I include?", detail: "Add balances, minimums, APRs, and snowball settings so payoff advice is accurate.", done: bills.some(bill => bill.is_debt), action: "Answer" },
    { key: "safety", label: "How much cushion should I protect?", detail: `Right now I protect $${settings.safety_floor.toFixed(0)} across ${settings.forecast_horizon_months} months.`, done: settings.safety_floor >= 0 && settings.forecast_horizon_months > 0, action: "Review" },
    { key: "reconcile", label: "Can we confirm the balance matches your bank?", detail: "Reconcile once so you can trust the forecast before making decisions.", done: forecastConfidence.level === "high" || accounts.some(account => account.last_reconciled_at), action: "Answer" },
    { key: "backup", label: "Want to save a backup before we move on?", detail: "Export a CSV backup after setup so your data has a safety net.", done: backupExported, action: "Export" },
  ];
  const setupComplete = setupSteps.filter(step => step.done).length;
  const currentSetupStep = setupSteps.find(step => !step.done) ?? setupSteps[setupSteps.length - 1];
  const currentMonthPrefix = new Date().toISOString().slice(0, 7);
  const accountMonthDeltas = useMemo(() => {
    const deltas = new Map<string, number>();
    transactions.forEach(transaction => {
      if (!transaction.account_id || !transaction.date.startsWith(currentMonthPrefix)) return;
      deltas.set(transaction.account_id, (deltas.get(transaction.account_id) ?? 0) + transaction.amount);
    });
    return deltas;
  }, [transactions, currentMonthPrefix]);

  const handleExport = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const accountHeader = "Id,Name,Type,CurrentBalance,BalanceAsOf,LastReconciledAt,IsActive";
      const accountRows = accounts.map(account => [
        account.id, account.name, account.account_type, account.current_balance,
        account.balance_as_of, account.last_reconciled_at ?? "", account.is_active,
      ].map(csvCell).join(",")).join("\n");
      const incomeHeader = "Name,Amount,Frequency,StartDate,NextPaymentDate,LastReviewedAt";
      const incomeRows = incomes.map(income => [
        income.name, income.amount, income.frequency, income.start_date ?? "",
        income.next_payment_date ?? "", income.last_reviewed_at ?? "",
      ].map(csvCell).join(",")).join("\n");
      const billHeader = "Name,Amount,Category,Priority,IsDebt,Balance,InterestRate,DueDay,IsRecurring,Frequency";
      const billRows = bills.map(b =>
        [b.name, b.amount, b.category, b.priority, b.is_debt, b.balance, b.interest_rate, b.due_day, b.is_recurring, b.frequency ?? "monthly"].map(csvCell).join(",")
      ).join("\n");
      const txHeader = "Date,Amount,Category,Note,AccountId,LinkedBillId,TransferGroupId,ImportHash";
      const txRows = transactions.map(t => [
        t.date, t.amount, t.category, t.note, t.account_id ?? "", t.linked_bill_id ?? "", t.transfer_group_id ?? "", t.import_hash ?? "",
      ].map(csvCell).join(",")).join("\n");
      const ovrHeader = "BillId,Month,Year,CustomAmount,PaidAmount";
      const ovrRows = overrides.map(o => [o.bill_id, o.month, o.year, o.custom_amount ?? "", o.paid_amount].map(csvCell).join(",")).join("\n");
      const goalHeader = "Name,TargetAmount,CurrentAmount,TargetDate,Type";
      const goalRows = goals.map(goal => [goal.name, goal.target_amount, goal.current_amount, goal.target_date ?? "", goal.goal_type ?? ""].map(csvCell).join(",")).join("\n");
      const csv = [
        "=== ACCOUNTS ===", accountHeader, accountRows,
        "", "=== INCOME ===", incomeHeader, incomeRows,
        "", "=== BILLS ===", billHeader, billRows,
        "", "=== TRANSACTIONS ===", txHeader, txRows,
        "", "=== MONTHLY OVERRIDES ===", ovrHeader, ovrRows,
        "", "=== GOALS ===", goalHeader, goalRows,
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
      setBackupExported(true);
      try { if (Platform.OS === "web") globalThis.localStorage?.setItem(BACKUP_COMPLETE_KEY, "true"); } catch {}
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
  const handleShowInstallPrompt = () => {
    if (Platform.OS === "web") {
      globalThis.dispatchEvent?.(new Event(PWA_INSTALL_EVENT));
      return;
    }
    Alert.alert("Install FlowLedger", "Open FlowLedger in your phone browser, then use Add to Home Screen.");
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

  const handleSetupStep = (key: string) => {
    switch (key) {
      case "account":
        openAccount("add");
        break;
      case "money":
      case "reconcile": {
        const firstActive = accounts.find(account => account.is_active) ?? null;
        if (firstActive) openAccount(key === "money" ? "edit" : "reconcile", firstActive);
        else openAccount("add");
        break;
      }
      case "income":
        setEditIncome(null);
        setIncomeModalVisible(true);
        break;
      case "bills":
      case "debts":
        router.push("/(tabs)/bills" as any);
        break;
      case "backup":
        void handleExport();
        break;
      case "safety":
      default:
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
    }
  };

  const handleTrySampleBudget = () => {
    startDemoMode();
    router.replace("/(tabs)" as any);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const webTopPad = Platform.OS === "web" ? 4 : 0;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: c.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 + webTopPad, paddingBottom: insets.bottom + 100 }]}
    >
      <Text style={[styles.pageTitle, { color: c.foreground }]}>Settings</Text>

      <SLabel c={c} text="Flo Setup" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <View style={[styles.floSetupHero, { backgroundColor: c.primary + "10", borderColor: c.primary + "30" }]}>
          <FloLogo size={54} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.floSetupTitle, { color: c.foreground }]}>Hi, I&apos;m Flo. Let&apos;s set up your money.</Text>
            <Text style={[styles.floSetupDesc, { color: c.mutedForeground }]}>
              I&apos;ll ask one question at a time, then FlowLedger will use your answers for forecasts and decisions.
            </Text>
          </View>
        </View>
        <View style={[styles.floQuestionCard, { backgroundColor: c.muted, borderColor: c.border }]}>
          <Text style={[styles.floQuestionEyebrow, { color: c.primary }]}>Flo asks</Text>
          <Text style={[styles.floQuestionText, { color: c.foreground }]}>{currentSetupStep.label}</Text>
          <Text style={[styles.floQuestionHelp, { color: c.mutedForeground }]}>{currentSetupStep.detail}</Text>
          <Pressable
            onPress={() => handleSetupStep(currentSetupStep.key)}
            style={({ pressed }) => [styles.floQuestionButton, { backgroundColor: c.primary, opacity: pressed ? 0.8 : 1 }]}
          >
            <Text style={[styles.floQuestionButtonText, { color: c.primaryForeground }]}>
              {currentSetupStep.done ? "Review this with Flo" : currentSetupStep.action}
            </Text>
          </Pressable>
        </View>
        <View style={[styles.setupProgressTrack, { backgroundColor: c.muted }]}>
          <View
            style={[
              styles.setupProgressFill,
              { backgroundColor: c.primary, width: `${Math.round((setupComplete / setupSteps.length) * 100)}%` as any },
            ]}
          />
        </View>
        <Text style={[styles.setupProgressText, { color: c.mutedForeground }]}>
          {setupComplete} of {setupSteps.length} setup steps complete
        </Text>
        {setupSteps.map((step, index) => (
          <View key={step.key} style={[styles.floSetupStep, { borderTopWidth: index ? 1 : 0, borderTopColor: c.border }]}>
            <View style={[styles.floSetupNumber, { backgroundColor: step.done ? c.success + "18" : c.muted }]}>
              {step.done
                ? <Feather name="check" size={15} color={c.success} />
                : <Text style={[styles.floSetupNumberText, { color: c.mutedForeground }]}>{index + 1}</Text>
              }
            </View>
            <View style={styles.floSetupBody}>
              <Text style={[styles.dataLabel, { color: c.foreground }]}>{step.label}</Text>
              <Text style={[styles.dataDesc, { color: c.mutedForeground }]}>{step.detail}</Text>
            </View>
            <Pressable
              onPress={() => handleSetupStep(step.key)}
              style={({ pressed }) => [
                styles.floSetupAction,
                {
                  backgroundColor: step.done ? c.muted : c.primary + "18",
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <Text style={[styles.floSetupActionText, { color: step.done ? c.mutedForeground : c.primary }]}>
                {step.done ? "Review" : step.action}
              </Text>
            </Pressable>
          </View>
        ))}
        <View style={[styles.priorityNote, { backgroundColor: c.primary + "12", borderRadius: 8, marginTop: 10 }]}>
          <Feather name="message-circle" size={12} color={c.primary} />
          <Text style={[styles.priorityNoteText, { color: c.mutedForeground }]}>
            Once these are done, ask Flo things like “Can I afford $500?” or “Why is next week tight?” and she&apos;ll use your real setup.
          </Text>
        </View>
        <Pressable
          onPress={() => {
            void updateSettings({ onboarding_completed: false });
            router.push("/setup" as any);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
          style={({ pressed }) => [styles.setupRestartBtn, { borderColor: c.border, opacity: pressed ? 0.75 : 1 }]}
        >
          <Feather name="refresh-cw" size={14} color={c.primary} />
          <Text style={[styles.setupRestartText, { color: c.primary }]}>Restart setup walkthrough for testing</Text>
        </Pressable>
        <Pressable
          onPress={handleTrySampleBudget}
          style={({ pressed }) => [styles.setupRestartBtn, { borderColor: c.primary + "55", backgroundColor: c.primary + "12", opacity: pressed ? 0.75 : 1 }]}
        >
          <Feather name="play-circle" size={14} color={c.primary} />
          <Text style={[styles.setupRestartText, { color: c.primary }]}>Start live sample tour</Text>
        </Pressable>
      </View>

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
      <SLabel c={c} text="Flo Decision Center" />
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
          onPress={() => updateDecisionHubSetting({ categoryDecisionAlertsEnabled: !decisionHubSettings.categoryDecisionAlertsEnabled })}
          style={({ pressed }) => [styles.decisionSettingRow, { borderTopWidth: 1, borderTopColor: c.border, marginTop: 14, paddingTop: 14, opacity: pressed ? 0.75 : 1 }]}
        >
          <View style={[styles.dataIcon, { backgroundColor: c.warning + "18" }]}>
            <Feather name="tag" size={17} color={c.warning} />
          </View>
          <View style={styles.switchInfo}>
            <Text style={[styles.switchLabel, { color: c.foreground }]}>Category decision help</Text>
            <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>
              Show category warnings and let Flo suggest money moves between categories.
            </Text>
          </View>
          <View style={[styles.toggleTrack, { backgroundColor: decisionHubSettings.categoryDecisionAlertsEnabled ? c.primary : c.muted }]}>
            <View style={[styles.toggleKnob, { backgroundColor: "#fff", alignSelf: decisionHubSettings.categoryDecisionAlertsEnabled ? "flex-end" : "flex-start" }]} />
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
        {[
          {
            key: "lowBalanceAlertsEnabled" as const,
            icon: "alert-triangle",
            color: c.warning,
            label: "Low balance alerts",
            desc: "Show Dashboard and calendar alerts when the forecast gets tight.",
          },
          {
            key: "billBeforePaydayAlertsEnabled" as const,
            icon: "zap",
            color: c.warning,
            label: "Bill-before-payday prompts",
            desc: "Show Bills tab prompts when moving a bill may help the paycheck window.",
          },
          {
            key: "plannedDecisionReviewAlertsEnabled" as const,
            icon: "clock",
            color: c.primary,
            label: "Planned decision review",
            desc: "Count risky or overdue planned decisions in Flo alerts.",
          },
          {
            key: "floTabBadgeEnabled" as const,
            icon: "message-circle",
            color: c.primary,
            label: "Flo tab badge",
            desc: "Show a small badge when Flo has items needing attention.",
          },
        ].map(item => {
          const enabled = Boolean(decisionHubSettings[item.key]);
          return (
            <Pressable
              key={item.key}
              onPress={() => updateDecisionHubSetting({ [item.key]: !enabled })}
              style={({ pressed }) => [styles.decisionSettingRow, { borderTopWidth: 1, borderTopColor: c.border, marginTop: 14, paddingTop: 14, opacity: pressed ? 0.75 : 1 }]}
            >
              <View style={[styles.dataIcon, { backgroundColor: item.color + "18" }]}>
                <Feather name={item.icon as any} size={17} color={item.color} />
              </View>
              <View style={styles.switchInfo}>
                <Text style={[styles.switchLabel, { color: c.foreground }]}>{item.label}</Text>
                <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>{item.desc}</Text>
              </View>
              <View style={[styles.toggleTrack, { backgroundColor: enabled ? c.primary : c.muted }]}>
                <View style={[styles.toggleKnob, { backgroundColor: "#fff", alignSelf: enabled ? "flex-end" : "flex-start" }]} />
              </View>
            </Pressable>
          );
        })}
        <View style={[styles.alertSensitivityBox, { borderTopColor: c.border }]}>
          <Text style={[styles.switchLabel, { color: c.foreground }]}>Alert sensitivity</Text>
          <Text style={[styles.switchDesc, { color: c.mutedForeground, marginBottom: 10 }]}>Control how early FlowLedger warns you before a low balance.</Text>
          <View style={[styles.themeRow, { backgroundColor: c.muted, borderRadius: 10 }]}>
            {ALERT_SENSITIVITY_OPTIONS.map(opt => {
              const active = decisionHubSettings.alertSensitivity === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => updateDecisionHubSetting({ alertSensitivity: opt.value })}
                  style={[styles.themeBtn, { backgroundColor: active ? c.primary : "transparent", borderRadius: 8 }]}
                >
                  <Text style={[styles.themeBtnText, { color: active ? "#fff" : c.mutedForeground }]}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.switchDesc, { color: c.mutedForeground, marginTop: 8 }]}>
            {ALERT_SENSITIVITY_OPTIONS.find(opt => opt.value === decisionHubSettings.alertSensitivity)?.desc}
          </Text>
        </View>
        <View style={[styles.priorityNote, { backgroundColor: decisionHubSettings.categoryRolloverEnabled ? c.success + "12" : c.muted, borderRadius: 8 }]}>
          <Feather name="info" size={12} color={decisionHubSettings.categoryRolloverEnabled ? c.success : c.mutedForeground} />
          <Text style={[styles.priorityNoteText, { color: c.mutedForeground }]}>
            {decisionHubSettings.paycheckPlanningEnabled
              ? "Paycheck planning is on. Dashboard will show what is due before the next payday."
              : decisionHubSettings.categoryRolloverEnabled
                ? "Rollover is on. Positive balances build up; negative balances reduce next month."
                : "Flo decision extras are optional. Turn on the planning tools you want to see."}
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
          const monthDelta = accountMonthDeltas.get(account.id) ?? 0;
          const projected = account.current_balance + monthDelta;
          return <View key={account.id} style={[styles.accountRow, { borderTopWidth: index ? 1 : 0, borderTopColor: c.border }]}>
            <View style={[styles.incomeIcon, { backgroundColor: c.primary + "16" }]}><Feather name={account.account_type === "savings" ? "heart" : "dollar-sign"} size={17} color={c.primary} /></View>
            <Pressable style={{ flex: 1 }} onPress={() => openAccount("edit", account)}><Text style={[styles.accountName, { color: c.foreground }]}>{account.name}</Text><Text style={[styles.incomeFreq, { color: age > 30 ? c.destructive : c.mutedForeground }]}>{account.account_type.replace("_", " ")} · {age === 0 ? "reconciled today" : `${age} days since review`}</Text></Pressable>
            <View style={styles.accountRight}><Text style={[styles.incomeMonthly, { color: c.foreground }]}>${account.current_balance.toFixed(2)}</Text><Text style={[styles.reconcileText, { color: c.mutedForeground }]}>Proj ${projected.toFixed(2)}</Text><Pressable onPress={() => openAccount("reconcile", account)}><Text style={[styles.reconcileText, { color: c.primary }]}>Reconcile</Text></Pressable></View>
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
        <Pressable
          onPress={() => router.push("/(tabs)/category-budget" as any)}
          style={({ pressed }) => [styles.categoryBudgetLink, { backgroundColor: c.primary + "18", borderColor: c.primary + "30", opacity: pressed ? 0.75 : 1 }]}
        >
          <View style={[styles.dataIcon, { backgroundColor: c.primary + "18" }]}>
            <Feather name="grid" size={16} color={c.primary} />
          </View>
          <View style={styles.switchInfo}>
            <Text style={[styles.switchLabel, { color: c.foreground }]}>Open Category Budget</Text>
            <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>Edit budgets, move money, and ask Flo by category.</Text>
          </View>
          <Feather name="chevron-right" size={18} color={c.primary} />
        </Pressable>
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
          { icon: "download" as const, label: "Export Full Backup (CSV)",    desc: "Accounts, income, bills, transactions, goals, and overrides",           onPress: handleExport, color: "#6366f1" },
          { icon: "smartphone" as const, label: "Install FlowLedger App", desc: "Show Apple and Android install instructions", onPress: handleShowInstallPrompt, color: "#22c55e" },
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
      <SLabel c={c} text="Data Health" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <View style={[styles.confidenceBox, { backgroundColor: dataIntegrityIssues.length ? c.warning + "12" : c.success + "14" }]}>
          <Feather name={dataIntegrityIssues.length ? "alert-triangle" : "check-circle"} size={16} color={dataIntegrityIssues.length ? c.warning : c.success} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.accountName, { color: c.foreground }]}>{dataIntegrityIssues.length ? `${dataIntegrityIssues.length} item${dataIntegrityIssues.length === 1 ? "" : "s"} to review` : "No data issues found"}</Text>
            <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>Checks accounts, bills, income, duplicate-looking bills, and unlinked transactions.</Text>
          </View>
        </View>
        {dataIntegrityIssues.slice(0, 4).map((issue, index) => (
          <View key={`${issue.title}-${index}`} style={[styles.dataHealthRow, { borderTopWidth: index ? 1 : 0, borderTopColor: c.border }]}>
            <Feather name={issue.severity === "error" ? "x-circle" : issue.severity === "warning" ? "alert-circle" : "info"} size={15} color={issue.severity === "error" ? c.destructive : issue.severity === "warning" ? c.warning : c.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.dataLabel, { color: c.foreground }]}>{issue.title}</Text>
              <Text style={[styles.dataDesc, { color: c.mutedForeground }]}>{issue.detail}</Text>
            </View>
          </View>
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
  setupHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  setupStep: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 5 },
  floSetupHero: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 16, padding: 12, marginBottom: 12 },
  floSetupTitle: { fontSize: 17, fontFamily: "Inter_800ExtraBold" },
  floSetupDesc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, marginTop: 3 },
  floQuestionCard: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12 },
  floQuestionEyebrow: { fontSize: 10, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 5 },
  floQuestionText: { fontSize: 18, fontFamily: "Inter_800ExtraBold", lineHeight: 23 },
  floQuestionHelp: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 6 },
  floQuestionButton: { alignItems: "center", justifyContent: "center", borderRadius: 12, paddingVertical: 12, marginTop: 12 },
  floQuestionButtonText: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  setupRestartBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingVertical: 11, marginTop: 12 },
  setupRestartText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  setupProgressTrack: { height: 6, borderRadius: 999, overflow: "hidden", marginBottom: 6 },
  setupProgressFill: { height: 6, borderRadius: 999 },
  setupProgressText: { fontSize: 11, fontFamily: "Inter_700Bold", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  floSetupStep: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  floSetupNumber: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  floSetupNumberText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  floSetupBody: { flex: 1 },
  floSetupAction: { minWidth: 76, alignItems: "center", justifyContent: "center", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 8 },
  floSetupActionText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },

  categoryBudgetLink: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 10 },
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
  alertSensitivityBox: { borderTopWidth: 1, marginTop: 14, paddingTop: 14 },
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
  dataHealthRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 11 },

  summaryCard: { flexDirection: "row", justifyContent: "space-around", padding: 16, marginBottom: 8 },
  summaryItem: { alignItems: "center" },
  summaryNum: { fontSize: 24, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },

});


