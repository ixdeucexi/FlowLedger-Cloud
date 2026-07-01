import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountModal } from "@/components/AccountModal";
import { AddBillModal } from "@/components/AddBillModal";
import { FloLogo } from "@/components/FloLogo";
import { IncomeModal } from "@/components/IncomeModal";
import { BudgetProvider, useBudget, type Account, type Bill, type IncomeItem } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

type SetupStepKey = "welcome" | "account" | "money" | "income" | "bills" | "debts" | "safety" | "reconcile" | "finish";

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
        body: "I’m Flo. I’ll walk you through the money pieces I need so FlowLedger can forecast your cash and answer decisions.",
        button: "Get Started",
      },
      {
        key: "account" as const,
        done: accountDone,
        title: "First, what account should I track?",
        ask: "Tell me where your spending money lives.",
        body: "Most people start with their main checking account. You can add savings or cash too.",
        button: accountDone ? "Review Account" : "Add Account",
      },
      {
        key: "money" as const,
        done: moneyDone,
        title: "How much money is in it today?",
        ask: "This becomes the starting point for your forecast.",
        body: "Use the current balance from your bank and the date it is accurate as of.",
        button: moneyDone ? "Review Balance" : "Add Starting Money",
      },
      {
        key: "income" as const,
        done: incomeDone,
        title: "When does money come in?",
        ask: "Add your paychecks or recurring deposits.",
        body: "Weekly, biweekly, and monthly income helps me predict what is safe before payday.",
        button: incomeDone ? "Add Another Income" : "Add Income",
      },
      {
        key: "bills" as const,
        done: billsDone,
        title: "What bills have to be paid?",
        ask: "Add recurring bills and due dates.",
        body: "Rent, utilities, subscriptions, insurance, and transfers all shape the forecast.",
        button: billsDone ? "Add Another Bill" : "Add Bill",
      },
      {
        key: "debts" as const,
        done: debtsDone,
        title: "What debts should I know about?",
        ask: "Add balances, minimums, due dates, and APRs.",
        body: "This powers debt payoff, snowball targets, and safer extra-payment decisions.",
        button: debtsDone ? "Add Another Debt" : "Add Debt",
      },
      {
        key: "safety" as const,
        done: true,
        title: "How much cushion should I protect?",
        ask: "This is the floor I try not to let your forecast cross.",
        body: "The default is $200 over six months. You can change it now or leave it alone.",
        button: "Save Safety Settings",
      },
      {
        key: "reconcile" as const,
        done: reconcileDone,
        title: "Can we confirm your bank balance?",
        ask: "One reconciliation makes the forecast more trustworthy.",
        body: "Enter the current bank balance so FlowLedger and reality match before decisions.",
        button: reconcileDone ? "Review Reconciliation" : "Reconcile Account",
      },
      {
        key: "finish" as const,
        done: false,
        title: "You’re ready to use Flo.",
        ask: "Now ask me before money decisions.",
        body: "Try: “Can I afford $500?” or “Why is next week tight?” I’ll use the setup you just built.",
        button: "Finish Setup",
      },
    ];
  }, [accounts, bills, incomes]);

  const current = steps[index];
  const progressIndex = Math.min(index + 1, steps.length);

  const goNext = () => setIndex(value => Math.min(steps.length - 1, value + 1));
  const goBack = () => setIndex(value => Math.max(0, value - 1));

  const finish = async () => {
    await updateSettings({ onboarding_completed: true });
    router.replace("/(tabs)" as any);
  };

  const runAction = async () => {
    switch (current.key) {
      case "welcome":
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
        goNext();
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
          goNext();
        }}
        onReconcile={async (balance, date) => {
          if (selectedAccount) await reconcileAccount(selectedAccount.id, balance, date);
          setAccountModalVisible(false);
          goNext();
        }}
      />
      <IncomeModal
        visible={incomeModalVisible}
        onClose={() => setIncomeModalVisible(false)}
        onSave={async data => {
          await addIncome(data as Omit<IncomeItem, "id">);
          setIncomeModalVisible(false);
          goNext();
        }}
      />
      <AddBillModal
        visible={billModalVisible}
        onClose={() => setBillModalVisible(false)}
        onSave={async data => {
          await addBill(data as Omit<Bill, "id" | "created_at">);
          setBillModalVisible(false);
          goNext();
        }}
      />
      <AddBillModal
        visible={debtModalVisible}
        onClose={() => setDebtModalVisible(false)}
        forceDebt
        onSave={async data => {
          await addBill(data as Omit<Bill, "id" | "created_at">);
          setDebtModalVisible(false);
          goNext();
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
  safetyCard: { flexDirection: "row", gap: 10, marginTop: 20 },
  inputWrap: { flex: 1 },
  inputLabel: { color: "#94a3b8", fontSize: 11, fontFamily: "Inter_800ExtraBold", marginBottom: 6, textTransform: "uppercase" },
  input: { height: 52, borderRadius: 14, paddingHorizontal: 14, backgroundColor: "#111827", borderWidth: 1, borderColor: "#1e293b", color: "#f8fafc", fontSize: 17, fontFamily: "Inter_700Bold" },
  primary: { height: 58, borderRadius: 16, backgroundColor: "#22c55e", alignItems: "center", justifyContent: "center", marginTop: 30, shadowColor: "#22c55e", shadowOpacity: 0.28, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  primaryText: { color: "#f8fafc", fontSize: 18, fontFamily: "Inter_800ExtraBold" },
  navRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 18 },
  navText: { color: "#94a3b8", fontSize: 14, fontFamily: "Inter_700Bold" },
});
