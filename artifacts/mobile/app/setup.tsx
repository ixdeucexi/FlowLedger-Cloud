import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountModal } from "@/components/AccountModal";
import { AddBillModal } from "@/components/AddBillModal";
import { FloLogo } from "@/components/FloLogo";
import { IncomeModal } from "@/components/IncomeModal";
import { BudgetProvider, useBudget, type Account, type Bill, type IncomeItem } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { readStoredSetupStep, writeStoredSetupStep, type SetupStepKey } from "@/lib/setupProgress";

function SetupWizard() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    accounts, incomes, bills, settings,
    addAccount, updateAccount, reconcileAccount,
    addIncome, addBill, updateSettings,
  } = useBudget();
  const [index, setIndex] = useState(0);
  const [accountModalVisible, setAccountModalVisible] = useState(false);
  const [accountMode, setAccountMode] = useState<"add" | "edit" | "reconcile">("add");
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [incomeModalVisible, setIncomeModalVisible] = useState(false);
  const [billModalVisible, setBillModalVisible] = useState(false);
  const [debtModalVisible, setDebtModalVisible] = useState(false);
  const [safetyFloorText, setSafetyFloorText] = useState(String(settings.safety_floor));
  const [horizonText, setHorizonText] = useState(String(settings.forecast_horizon_months));
  const [floConfirmation, setFloConfirmation] = useState("");
  const [restoredProgress, setRestoredProgress] = useState(false);

  const activeAccount = accounts.find(account => account.is_active) ?? null;
  const steps = useMemo(() => {
    const accountDone = accounts.some(account => account.is_active);
    const moneyDone = accounts.some(account => account.is_active && Math.abs(account.current_balance) > 0);
    const incomeDone = incomes.length > 0;
    const billsDone = bills.some(bill => bill.is_recurring && !bill.is_debt);
    const debtsDone = bills.some(bill => bill.is_debt);
    const reconcileDone = accounts.some(account => account.last_reconciled_at);
    return [
      {
        key: "welcome" as const,
        done: false,
        title: "Welcome to FlowLedger",
        ask: "Let’s get started.",
        body: "I’m Flo. I’ll ask a few simple questions, then I’ll use your answers to help FlowLedger forecast your cash and guide money decisions.",
        button: "Get Started",
      },
      {
        key: "account" as const,
        done: accountDone,
        title: "First, what account should I track?",
        ask: "Where does your everyday money live?",
        body: "Most people start with their main checking account. Once I know that account, I can anchor your plan to real money instead of guesses.",
        button: accountDone ? "Review Account" : "Add Account",
      },
      {
        key: "money" as const,
        done: moneyDone,
        title: "How much money is in it today?",
        ask: "Let’s anchor your forecast.",
        body: "What does your account show today? I’ll use that number as the starting point for every balance, bill, and decision.",
        button: moneyDone ? "Review Balance" : "Add Starting Money",
      },
      {
        key: "income" as const,
        done: incomeDone,
        title: "When does money come in?",
        ask: "Now tell me when money shows up.",
        body: "Add paychecks, side income, or recurring deposits. This helps me see what’s safe before payday and what might get tight.",
        button: incomeDone ? "Add Another Income" : "Add Income",
      },
      {
        key: "bills" as const,
        done: billsDone,
        title: "What bills have to be paid?",
        ask: "Next, tell me what bills usually hit your account.",
        body: "Rent, utilities, subscriptions, insurance, and transfers all shape your forecast. I’ll use those dates to spot tight weeks before they happen.",
        button: billsDone ? "Add Another Bill" : "Add Bill",
      },
      {
        key: "debts" as const,
        done: debtsDone,
        title: "What debts should I know about?",
        ask: "If you’re paying down debt, add it here.",
        body: "Balances, minimums, due dates, and APRs help me show what’s safe to send extra toward without hurting the rest of your month.",
        button: debtsDone ? "Add Another Debt" : "Add Debt",
      },
      {
        key: "safety" as const,
        done: true,
        title: "How much cushion should I protect?",
        ask: "Let’s choose your comfort zone.",
        body: "This is the floor I try not to let your forecast cross. The default is $200 over six months, but you can set the cushion that feels right.",
        button: "Save Safety Settings",
      },
      {
        key: "reconcile" as const,
        done: reconcileDone,
        title: "Can we confirm your bank balance?",
        ask: "One quick check makes the plan more trustworthy.",
        body: "Enter the balance your bank shows now. That keeps FlowLedger and reality lined up before you ask me if something is affordable.",
        button: reconcileDone ? "Review Reconciliation" : "Reconcile Account",
      },
      {
        key: "finish" as const,
        done: false,
        title: "You’re ready to use Flo.",
        ask: "Now ask me before money decisions.",
        body: "Let’s try one together. I’ll use the setup you just built to answer a real affordability question.",
        button: "Ask Flo if I can afford $100",
      },
    ];
  }, [accounts, bills, incomes]);

  const current = steps[index];
  const progressIndex = Math.min(index + 1, steps.length);
  useEffect(() => {
    if (restoredProgress) return;
    const storedKey = readStoredSetupStep();
    const storedIndex = storedKey ? steps.findIndex(step => step.key === storedKey) : -1;
    const resumeIndex = storedIndex > 0 ? storedIndex : 0;
    setIndex(Math.max(0, resumeIndex));
    if (storedIndex > 0 && steps[storedIndex]?.key !== "finish") {
      setFloConfirmation("Welcome back — we can pick up where we left off.");
    }
    setRestoredProgress(true);
  }, [restoredProgress, steps]);

  useEffect(() => {
    if (!restoredProgress) return;
    writeStoredSetupStep(current.key === "finish" ? null : current.key);
  }, [current.key, restoredProgress]);

  const goNext = () => setIndex(value => {
    const next = steps.findIndex((step, stepIndex) => stepIndex > value && (step.key === "finish" || !step.done));
    return next >= 0 ? next : steps.length - 1;
  });
  const goBack = () => setIndex(value => Math.max(0, value - 1));
  const confirmAndNext = (message: string) => {
    setFloConfirmation(message);
    goNext();
  };

  const finish = async () => {
    writeStoredSetupStep(null);
    await updateSettings({ onboarding_completed: true });
    router.replace({ pathname: "/(tabs)/flo", params: { prompt: "Can I afford $100?" } } as any);
  };

  const runAction = async () => {
    switch (current.key) {
      case "welcome":
        setFloConfirmation("");
        goNext();
        return;
      case "account":
        setSelectedAccount(activeAccount);
        setAccountMode(activeAccount ? "edit" : "add");
        setAccountModalVisible(true);
        return;
      case "money":
        setSelectedAccount(activeAccount);
        setAccountMode(activeAccount ? "edit" : "add");
        setAccountModalVisible(true);
        return;
      case "income":
        setIncomeModalVisible(true);
        return;
      case "bills":
        setBillModalVisible(true);
        return;
      case "debts":
        setDebtModalVisible(true);
        return;
      case "safety": {
        const floor = Math.max(0, Number(safetyFloorText) || 0);
        const horizon = Math.max(1, Math.min(24, Math.round(Number(horizonText) || 6)));
        setSafetyFloorText(String(floor));
        setHorizonText(String(horizon));
        await updateSettings({ safety_floor: floor, forecast_horizon_months: horizon });
        confirmAndNext(`Got it — I’ll protect a $${floor.toFixed(0)} cushion across ${horizon} month${horizon === 1 ? "" : "s"}.`);
        return;
      }
      case "reconcile":
        setSelectedAccount(activeAccount);
        setAccountMode(activeAccount ? "reconcile" : "add");
        setAccountModalVisible(true);
        return;
      case "finish":
        await finish();
        return;
    }
  };

  return (
    <LinearGradient colors={["#070b16", "#0f172a"]} style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.progressRow}>
          {steps.map((step, stepIndex) => (
            <View
              key={step.key}
              style={[
                styles.progressBar,
                { backgroundColor: stepIndex <= index ? "#22c55e" : "rgba(148,163,184,0.22)" },
              ]}
            />
          ))}
        </View>

        <View style={styles.hero}>
          <FloLogo size={92} />
          <Text style={styles.stepCount}>{progressIndex} of {steps.length}</Text>
          <Text style={styles.title}>{current.title}</Text>
          <View style={styles.bubble}>
            <Text style={styles.bubbleLabel}>Flo</Text>
            <Text style={styles.ask}>{current.ask}</Text>
            <Text style={styles.body}>{current.body}</Text>
          </View>
          {floConfirmation ? (
            <View style={styles.confirmation}>
              <Feather name="check-circle" size={16} color="#22c55e" />
              <Text style={styles.confirmationText}>{floConfirmation}</Text>
            </View>
          ) : null}
        </View>

        {current.key === "safety" && (
          <View style={styles.safetyCard}>
            <View style={styles.inputWrap}>
              <Text style={styles.inputLabel}>Safety cushion</Text>
              <TextInput
                value={safetyFloorText}
                onChangeText={setSafetyFloorText}
                keyboardType="decimal-pad"
                style={styles.input}
                placeholder="200"
                placeholderTextColor="#64748b"
              />
            </View>
            <View style={styles.inputWrap}>
              <Text style={styles.inputLabel}>Forecast months</Text>
              <TextInput
                value={horizonText}
                onChangeText={setHorizonText}
                keyboardType="number-pad"
                style={styles.input}
                placeholder="6"
                placeholderTextColor="#64748b"
              />
            </View>
          </View>
        )}

        <Pressable onPress={() => void runAction()} style={({ pressed }) => [styles.primary, { opacity: pressed ? 0.82 : 1 }]}>
          <Text style={styles.primaryText}>{current.button}</Text>
        </Pressable>

        <View style={styles.navRow}>
          <Pressable onPress={goBack} disabled={index === 0} style={{ opacity: index === 0 ? 0.35 : 1 }}>
            <Text style={styles.navText}>Back</Text>
          </Pressable>
          {current.key !== "finish" && current.key !== "welcome" ? (
            <Pressable onPress={goNext}>
              <Text style={styles.navText}>Skip for now</Text>
            </Pressable>
          ) : <View />}
        </View>
      </ScrollView>

      <AccountModal
        visible={accountModalVisible}
        account={selectedAccount}
        mode={accountMode}
        onClose={() => setAccountModalVisible(false)}
        onSave={async value => {
          if (selectedAccount) await updateAccount({ ...selectedAccount, ...value });
          else await addAccount({ ...value, is_active: true });
          setAccountModalVisible(false);
          confirmAndNext("Got it — I’ll use that account as part of your forecast.");
        }}
        onReconcile={async (balance, date) => {
          if (selectedAccount) await reconcileAccount(selectedAccount.id, balance, date);
          setAccountModalVisible(false);
          confirmAndNext(`Perfect — I’ll trust $${balance.toFixed(2)} as of ${date}.`);
        }}
      />
      <IncomeModal
        visible={incomeModalVisible}
        onClose={() => setIncomeModalVisible(false)}
        onSave={async data => {
          await addIncome(data as Omit<IncomeItem, "id">);
          setIncomeModalVisible(false);
          confirmAndNext("Nice — I’ll include that income when I check future cash flow.");
        }}
      />
      <AddBillModal
        visible={billModalVisible}
        onClose={() => setBillModalVisible(false)}
        onSave={async data => {
          await addBill(data as Omit<Bill, "id" | "created_at">);
          setBillModalVisible(false);
          confirmAndNext("Got it — I’ll watch that bill date when I forecast your month.");
        }}
      />
      <AddBillModal
        visible={debtModalVisible}
        onClose={() => setDebtModalVisible(false)}
        forceDebt
        onSave={async data => {
          await addBill(data as Omit<Bill, "id" | "created_at">);
          setDebtModalVisible(false);
          confirmAndNext("Debt added — I’ll use it for payoff and extra-payment decisions.");
        }}
      />
    </LinearGradient>
  );
}

export default function SetupScreen() {
  return (
    <BudgetProvider>
      <SetupWizard />
    </BudgetProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 28 },
  progressRow: { flexDirection: "row", gap: 6, marginBottom: 42 },
  progressBar: { flex: 1, height: 4, borderRadius: 999 },
  hero: { alignItems: "center" },
  stepCount: { color: "#38bdf8", fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1, marginTop: 18, textTransform: "uppercase" },
  title: { color: "#f8fafc", fontSize: 31, lineHeight: 38, textAlign: "center", fontFamily: "Inter_800ExtraBold", marginTop: 14 },
  bubble: { alignSelf: "stretch", backgroundColor: "rgba(15,23,42,0.88)", borderWidth: 1, borderColor: "rgba(56,189,248,0.28)", borderRadius: 24, padding: 20, marginTop: 24 },
  bubbleLabel: { color: "#22c55e", fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 },
  ask: { color: "#f8fafc", fontSize: 21, lineHeight: 28, fontFamily: "Inter_800ExtraBold", textAlign: "center" },
  body: { color: "#94a3b8", fontSize: 15, lineHeight: 23, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 12 },
  confirmation: { alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: "rgba(34,197,94,0.12)", borderWidth: 1, borderColor: "rgba(34,197,94,0.28)", borderRadius: 16, padding: 12, marginTop: 14 },
  confirmationText: { flex: 1, color: "#bbf7d0", fontSize: 13, lineHeight: 18, fontFamily: "Inter_700Bold" },
  safetyCard: { flexDirection: "row", gap: 10, marginTop: 20 },
  inputWrap: { flex: 1 },
  inputLabel: { color: "#94a3b8", fontSize: 11, fontFamily: "Inter_800ExtraBold", marginBottom: 6, textTransform: "uppercase" },
  input: { height: 52, borderRadius: 14, paddingHorizontal: 14, backgroundColor: "#111827", borderWidth: 1, borderColor: "#1e293b", color: "#f8fafc", fontSize: 17, fontFamily: "Inter_700Bold" },
  primary: { height: 58, borderRadius: 16, backgroundColor: "#22c55e", alignItems: "center", justifyContent: "center", marginTop: 30, shadowColor: "#22c55e", shadowOpacity: 0.28, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  primaryText: { color: "#f8fafc", fontSize: 18, fontFamily: "Inter_800ExtraBold", textAlign: "center", paddingHorizontal: 12 },
  navRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 18 },
  navText: { color: "#94a3b8", fontSize: 14, fontFamily: "Inter_700Bold" },
});
