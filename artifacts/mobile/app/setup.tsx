import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountModal } from "@/components/AccountModal";
import { AddBillModal } from "@/components/AddBillModal";
import { FlowWaveBackground } from "@/components/FlowWaveBackground";
import { FloLogo } from "@/components/FloLogo";
import { GoalModal } from "@/components/GoalModal";
import { IncomeModal } from "@/components/IncomeModal";
import { useAuth } from "@/context/AuthContext";
import { BudgetProvider, useBudget, type Account, type Bill, type Goal, type IncomeItem } from "@/context/BudgetContext";
import {
  buildPersonalizedSetupKeys,
  describeSetupPlan,
  shouldAskSavingsGoal,
  type MoneySetupKey,
  type OnboardingPreferences,
  type SavingsGoalOption,
  type SetupGoalOption,
  type SetupHelpOption,
} from "@/lib/onboarding";
import { loadOnboardingPreferences, readOnboardingPreferences, saveOnboardingPreferences } from "@/lib/onboardingPreferences";
import { readStoredSetupStep, writeStoredSetupStep, type SetupStepKey } from "@/lib/setupProgress";

interface SetupStep {
  key: SetupStepKey;
  done: boolean;
  title: string;
  ask: string;
  body: string;
  button: string;
  kind: "intro" | "multi" | "single" | "plan" | "action";
}

const HELP_OPTIONS: { id: SetupHelpOption; label: string; icon: React.ComponentProps<typeof Feather>["name"] }[] = [
  { id: "track_spending", label: "Track my spending", icon: "bar-chart-2" },
  { id: "lower_bills", label: "Lower my bills", icon: "file-text" },
  { id: "pay_off_debt", label: "Pay off my debt", icon: "trending-down" },
  { id: "grow_savings", label: "Grow my savings", icon: "shield" },
  { id: "create_budget", label: "Create a budget", icon: "grid" },
  { id: "stay_organized", label: "Stay organized", icon: "check-circle" },
];

const GOAL_OPTIONS: { id: SetupGoalOption; label: string; icon: React.ComponentProps<typeof Feather>["name"] }[] = [
  { id: "reduce_spending", label: "Reduce my spending", icon: "credit-card" },
  { id: "pay_off_debt", label: "Pay off my debt", icon: "dollar-sign" },
  { id: "grow_savings", label: "Grow my savings", icon: "trending-up" },
  { id: "stay_on_top", label: "Stay on top of my finances", icon: "pie-chart" },
  { id: "something_else", label: "Something else", icon: "more-horizontal" },
];

const SAVINGS_OPTIONS: { id: SavingsGoalOption; label: string; icon: React.ComponentProps<typeof Feather>["name"] }[] = [
  { id: "emergency_fund", label: "An emergency fund", icon: "umbrella" },
  { id: "house", label: "A house", icon: "home" },
  { id: "car", label: "A car", icon: "truck" },
  { id: "debt_payoff", label: "To pay off debt", icon: "dollar-sign" },
  { id: "something_else", label: "Something else", icon: "more-horizontal" },
];

function moneyKeyToStepKey(key: MoneySetupKey): SetupStepKey {
  return key === "goals" ? "goal_setup" : key;
}

function isPreferenceStep(key: SetupStepKey) {
  return ["welcome", "intro", "help", "goals", "savings_goal", "plan"].includes(key);
}

function toggleArrayValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter(item => item !== value) : [...values, value];
}

function SetupWizard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const {
    accounts, incomes, bills, goals, settings,
    addAccount, updateAccount, reconcileAccount,
    addIncome, addBill, addGoal, updateSettings,
  } = useBudget();

  const [preferences, setPreferences] = useState<OnboardingPreferences>(() => readOnboardingPreferences());
  const [index, setIndex] = useState(0);
  const [accountModalVisible, setAccountModalVisible] = useState(false);
  const [accountMode, setAccountMode] = useState<"add" | "edit" | "reconcile">("add");
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [incomeModalVisible, setIncomeModalVisible] = useState(false);
  const [billModalVisible, setBillModalVisible] = useState(false);
  const [debtModalVisible, setDebtModalVisible] = useState(false);
  const [goalModalVisible, setGoalModalVisible] = useState(false);
  const [safetyFloorText, setSafetyFloorText] = useState(String(settings.safety_floor));
  const [horizonText, setHorizonText] = useState(String(settings.forecast_horizon_months));
  const [floConfirmation, setFloConfirmation] = useState("");
  const [restoredProgress, setRestoredProgress] = useState(false);
  const [coachVisible, setCoachVisible] = useState(false);

  const activeAccount = accounts.find(account => account.is_active) ?? null;

  useEffect(() => {
    let cancelled = false;
    void loadOnboardingPreferences(user?.id).then(next => {
      if (!cancelled) setPreferences(next);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const steps = useMemo<SetupStep[]>(() => {
    const accountDone = accounts.some(account => account.is_active);
    const moneyDone = accounts.some(account => account.is_active && Math.abs(account.current_balance) > 0);
    const incomeDone = incomes.length > 0;
    const billsDone = bills.some(bill => bill.is_recurring && !bill.is_debt);
    const debtsDone = bills.some(bill => bill.is_debt);
    const goalsDone = goals.some(goal => goal.goal_type === "savings");
    const reconcileDone = accounts.some(account => account.last_reconciled_at);

    const moneyStepState: Record<MoneySetupKey, Omit<SetupStep, "key" | "kind">> = {
      account: {
        done: accountDone,
        title: "First, what account should I track?",
        ask: "Where does your everyday money live?",
        body: "Most people start with their main checking account. Once I know that account, I can anchor your plan to real money instead of guesses.",
        button: accountDone ? "Review Account" : "Add Account",
      },
      money: {
        done: moneyDone,
        title: "How much money is in it today?",
        ask: "Let’s anchor your forecast.",
        body: "Tell me what your account shows today. I’ll use that number as the starting point for balances, bills, and decisions.",
        button: moneyDone ? "Review Balance" : "Add Starting Money",
      },
      income: {
        done: incomeDone,
        title: "When does money come in?",
        ask: "Now tell me when money shows up.",
        body: "Add paychecks, side income, or recurring deposits so I can see what is safe before payday and what might get tight.",
        button: incomeDone ? "Add Another Income" : "Add Income",
      },
      bills: {
        done: billsDone,
        title: "Which bills need to be paid?",
        ask: "Next, tell me what bills usually hit your account.",
        body: "Rent, utilities, subscriptions, insurance, and transfers all shape your forecast. I’ll use those dates to spot tight weeks before they happen.",
        button: billsDone ? "Add Another Bill" : "Add Bill",
      },
      debts: {
        done: debtsDone,
        title: "What debts should I know about?",
        ask: "If you’re paying down debt, add it here.",
        body: "Balances, minimums, due dates, and APRs help me show what is safe to send extra toward without hurting the rest of your month.",
        button: debtsDone ? "Add Another Debt" : "Add Debt",
      },
      goals: {
        done: goalsDone,
        title: "What are you saving toward?",
        ask: "Let’s give your extra money a purpose.",
        body: "Add a savings goal so I can protect it in your forecast and help you decide when money can safely move there.",
        button: goalsDone ? "Add Another Goal" : "Add Goal",
      },
      safety: {
        done: true,
        title: "How much cushion should I protect?",
        ask: "Let’s choose your comfort zone.",
        body: "This is the floor I try not to let your forecast cross. The default is $200, but you can set the cushion that feels right.",
        button: "Save Safety Settings",
      },
      reconcile: {
        done: reconcileDone,
        title: "Can we confirm your bank balance?",
        ask: "One quick check makes the plan more trustworthy.",
        body: "Enter the balance your bank shows now. That keeps FlowLedger and reality lined up before you ask me if something is affordable.",
        button: reconcileDone ? "Review Reconciliation" : "Reconcile Account",
      },
      finish: {
        done: false,
        title: "You’re ready to use Flo.",
        ask: "Now ask me before money decisions.",
        body: "Let’s try one together. I’ll use the setup you just built to answer a real affordability question.",
        button: "Ask Flo if I can afford $100",
      },
    };

    const introSteps: SetupStep[] = [
      {
        key: "welcome",
        done: false,
        title: "Welcome to FlowLedger Algo",
        ask: "Let’s build your money command center.",
        body: "I’m Flo. I’ll learn what you want help with first, then I’ll walk you through the exact setup steps that match your goals.",
        button: "Get Started",
        kind: "intro",
      },
      {
        key: "intro",
        done: false,
        title: "Together, we’ll build your forecast.",
        ask: "You bring the real numbers. I’ll keep the path clear.",
        body: "I will never create fake money records or change your existing bills, debts, or transactions from these setup questions.",
        button: "I’m Ready",
        kind: "intro",
      },
      {
        key: "help",
        done: preferences.help.length > 0,
        title: "How can I help?",
        ask: "Choose as many options as you’d like.",
        body: "Your answers help me decide which setup steps should come first.",
        button: "Continue",
        kind: "multi",
      },
      {
        key: "goals",
        done: preferences.goals.length > 0,
        title: "What are your top financial goals?",
        ask: "Pick the goals that matter most right now.",
        body: "I’ll use this to make FlowLedger feel less like a form and more like a plan.",
        button: "Continue",
        kind: "multi",
      },
    ];

    if (shouldAskSavingsGoal(preferences)) {
      introSteps.push({
        key: "savings_goal",
        done: Boolean(preferences.savingsGoal),
        title: "Are you saving for something specific?",
        ask: "Choose your top savings goal.",
        body: "This helps me name the first goal you may want to create later.",
        button: "Continue",
        kind: "single",
      });
    }

    introSteps.push({
      key: "plan",
      done: true,
      title: "Here’s the setup path I’ll use.",
      ask: "I’ve got the plan.",
      body: describeSetupPlan(preferences),
      button: "Build My Forecast",
      kind: "plan",
    });

    const moneySteps = buildPersonalizedSetupKeys(preferences).map(key => {
      const mapped = moneyKeyToStepKey(key);
      return { ...moneyStepState[key], key: mapped, kind: "action" as const };
    });

    return [...introSteps, ...moneySteps];
  }, [accounts, bills, goals, incomes, preferences]);

  const current = steps[Math.min(index, steps.length - 1)] ?? steps[0];
  const progressIndex = Math.min(index + 1, steps.length);
  const savePreferences = (next = preferences) => saveOnboardingPreferences(user?.id, next).catch(() => undefined);

  useEffect(() => {
    if (restoredProgress) return;
    const storedKey = readStoredSetupStep();
    const storedIndex = storedKey ? steps.findIndex(step => step.key === storedKey) : -1;
    setIndex(Math.max(0, storedIndex));
    if (storedIndex > 0 && steps[storedIndex]?.key !== "finish") {
      setFloConfirmation("Welcome back — we can pick up where we left off.");
    }
    setRestoredProgress(true);
  }, [restoredProgress, steps]);

  useEffect(() => {
    if (!restoredProgress || !current) return;
    writeStoredSetupStep(current.key === "finish" ? null : current.key);
  }, [current, restoredProgress]);

  const goNext = () => setIndex(value => {
    for (let i = value + 1; i < steps.length; i += 1) {
      const step = steps[i];
      if (isPreferenceStep(step.key) || step.key === "finish" || !step.done) return i;
    }
    return steps.length - 1;
  });
  const goBack = () => setIndex(value => Math.max(0, value - 1));
  const confirmAndNext = (message: string) => {
    setFloConfirmation(message);
    goNext();
  };

  const canContinue = useMemo(() => {
    if (current.key === "help") return preferences.help.length > 0;
    if (current.key === "goals") return preferences.goals.length > 0;
    if (current.key === "savings_goal") return Boolean(preferences.savingsGoal);
    return true;
  }, [current.key, preferences]);

  const finish = async () => {
    writeStoredSetupStep(null);
    await updateSettings({ onboarding_completed: true });
    router.replace({ pathname: "/(tabs)/flo", params: { prompt: "Can I afford $100?" } } as any);
  };

  const runAction = async () => {
    switch (current.key) {
      case "welcome":
      case "intro":
        setFloConfirmation("");
        goNext();
        return;
      case "help":
      case "goals":
      case "savings_goal":
        await savePreferences();
        goNext();
        return;
      case "plan":
        await savePreferences();
        setFloConfirmation("Great. I’ll only ask for real money details from here.");
        goNext();
        return;
      case "account":
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
      case "goal_setup":
        setGoalModalVisible(true);
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

  const updateHelp = (id: SetupHelpOption) => {
    const next = { ...preferences, help: toggleArrayValue(preferences.help, id) };
    if (!shouldAskSavingsGoal(next)) next.savingsGoal = null;
    setPreferences(next);
    void savePreferences(next);
  };

  const updateGoal = (id: SetupGoalOption) => {
    const next = { ...preferences, goals: toggleArrayValue(preferences.goals, id) };
    if (!shouldAskSavingsGoal(next)) next.savingsGoal = null;
    setPreferences(next);
    void savePreferences(next);
  };

  const updateSavingsGoal = (id: SavingsGoalOption) => {
    const next = { ...preferences, savingsGoal: preferences.savingsGoal === id ? null : id };
    setPreferences(next);
    void savePreferences(next);
  };

  const renderOptions = () => {
    if (current.key === "help") {
      return HELP_OPTIONS.map(option => (
        <OptionCard
          key={option.id}
          icon={option.icon}
          label={option.label}
          selected={preferences.help.includes(option.id)}
          onPress={() => updateHelp(option.id)}
        />
      ));
    }
    if (current.key === "goals") {
      return GOAL_OPTIONS.map(option => (
        <OptionCard
          key={option.id}
          icon={option.icon}
          label={option.label}
          selected={preferences.goals.includes(option.id)}
          onPress={() => updateGoal(option.id)}
        />
      ));
    }
    if (current.key === "savings_goal") {
      return SAVINGS_OPTIONS.map(option => (
        <OptionCard
          key={option.id}
          icon={option.icon}
          label={option.label}
          selected={preferences.savingsGoal === option.id}
          onPress={() => updateSavingsGoal(option.id)}
        />
      ));
    }
    return null;
  };

  const renderPlanCards = () => {
    if (current.key !== "plan") return null;
    return buildPersonalizedSetupKeys(preferences).map((key, planIndex) => {
      const label: Record<MoneySetupKey, string> = {
        account: "Add an account",
        money: "Add today’s balance",
        income: "Add income",
        bills: "Add recurring bills",
        debts: "Add debts",
        goals: "Add a savings goal",
        safety: "Choose safety cushion",
        reconcile: "Confirm balance",
        finish: "Ask Flo a decision",
      };
      return (
        <View key={key} style={styles.planRow}>
          <View style={styles.planNumber}>
            <Text style={styles.planNumberText}>{planIndex + 1}</Text>
          </View>
          <Text style={styles.planText}>{label[key]}</Text>
        </View>
      );
    });
  };

  return (
    <LinearGradient colors={["#050711", "#0a0d1a", "#111827"]} style={styles.root}>
      <FlowWaveBackground variant="purple" intensity="soft" />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 134 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.progressRow}>
          {steps.map((step, stepIndex) => (
            <View
              key={`${step.key}-${stepIndex}`}
              style={[
                styles.progressBar,
                { backgroundColor: stepIndex <= index ? "#8b5cf6" : "rgba(148,163,184,0.22)" },
              ]}
            />
          ))}
        </View>

        <View style={styles.hero}>
          <FloLogo size={current.kind === "intro" ? 112 : 76} />
          <Text style={styles.stepCount}>{progressIndex} of {steps.length}</Text>
          <Text style={styles.title}>{current.title}</Text>
          <View style={styles.bubble}>
            <View style={styles.bubbleHeader}>
              <Text style={styles.bubbleLabel}>Flo asks</Text>
              {current.kind !== "intro" && (
                <Pressable onPress={() => setCoachVisible(true)} hitSlop={10}>
                  <Feather name="help-circle" size={17} color="#38bdf8" />
                </Pressable>
              )}
            </View>
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

        <View style={styles.optionStack}>
          {renderOptions()}
          {renderPlanCards()}
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
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 18 }]}>
        <Pressable
          disabled={!canContinue}
          onPress={() => void runAction()}
          style={({ pressed }) => [
            styles.primary,
            { opacity: !canContinue ? 0.45 : pressed ? 0.82 : 1 },
          ]}
        >
          <Text style={styles.primaryText}>{current.button}</Text>
        </Pressable>
        <View style={styles.navRow}>
          <Pressable onPress={goBack} disabled={index === 0} style={{ opacity: index === 0 ? 0.35 : 1 }}>
            <Text style={styles.navText}>Back</Text>
          </Pressable>
          {!isPreferenceStep(current.key) && current.key !== "finish" ? (
            <Pressable onPress={goNext}>
              <Text style={styles.navText}>Skip for now</Text>
            </Pressable>
          ) : <View />}
        </View>
      </View>

      <FloCoachOverlay
        visible={coachVisible}
        onClose={() => setCoachVisible(false)}
        title="Flo is personalizing setup"
        message="These answers do not change your money. They only help me decide whether to start with debt, savings, bills, spending, or the full forecast path."
      />

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
      <GoalModal
        visible={goalModalVisible}
        onClose={() => setGoalModalVisible(false)}
        onSave={async data => {
          await addGoal(data as Omit<Goal, "id" | "created_at">);
          setGoalModalVisible(false);
          confirmAndNext("Goal added — I’ll protect it when I look ahead.");
        }}
      />
    </LinearGradient>
  );
}

function OptionCard({ icon, label, selected, onPress }: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionCard,
        selected && styles.optionCardSelected,
        { opacity: pressed ? 0.82 : 1 },
      ]}
    >
      <View style={[styles.optionIcon, selected && styles.optionIconSelected]}>
        <Feather name={icon} size={18} color={selected ? "#f8fafc" : "#cbd5e1"} />
      </View>
      <Text style={styles.optionText}>{label}</Text>
      {selected ? <Feather name="check-circle" size={18} color="#22c55e" /> : null}
    </Pressable>
  );
}

function FloCoachOverlay({ visible, title, message, onClose }: {
  visible: boolean;
  title: string;
  message: string;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.coachOverlay} onPress={onClose}>
        <Pressable style={styles.coachSheet} onPress={() => undefined}>
          <View style={styles.coachSpotlight}>
            <FloLogo size={70} />
          </View>
          <Text style={styles.coachTitle}>{title}</Text>
          <Text style={styles.coachMessage}>{message}</Text>
          <Pressable onPress={onClose} style={styles.coachButton}>
            <Text style={styles.coachButtonText}>Got it</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
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
  progressRow: { flexDirection: "row", gap: 6, marginBottom: 30 },
  progressBar: { flex: 1, height: 4, borderRadius: 999 },
  hero: { alignItems: "center" },
  stepCount: { color: "#38bdf8", fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1, marginTop: 14, textTransform: "uppercase" },
  title: { color: "#f8fafc", fontSize: 30, lineHeight: 37, textAlign: "center", fontFamily: "Inter_800ExtraBold", marginTop: 12 },
  bubble: { alignSelf: "stretch", backgroundColor: "rgba(15,23,42,0.9)", borderWidth: 1, borderColor: "rgba(139,92,246,0.35)", borderRadius: 24, padding: 18, marginTop: 22 },
  bubbleHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  bubbleLabel: { color: "#a78bfa", fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1, textTransform: "uppercase" },
  ask: { color: "#f8fafc", fontSize: 20, lineHeight: 27, fontFamily: "Inter_800ExtraBold", textAlign: "center" },
  body: { color: "#94a3b8", fontSize: 15, lineHeight: 22, fontFamily: "Inter_500Medium", textAlign: "center", marginTop: 10 },
  confirmation: { alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: "rgba(34,197,94,0.12)", borderWidth: 1, borderColor: "rgba(34,197,94,0.28)", borderRadius: 16, padding: 12, marginTop: 14 },
  confirmationText: { flex: 1, color: "#bbf7d0", fontSize: 13, lineHeight: 18, fontFamily: "Inter_700Bold" },
  optionStack: { gap: 12, marginTop: 22 },
  optionCard: { minHeight: 58, borderRadius: 18, borderWidth: 1, borderColor: "rgba(148,163,184,0.2)", backgroundColor: "rgba(15,23,42,0.82)", paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 14 },
  optionCardSelected: { borderColor: "rgba(139,92,246,0.8)", backgroundColor: "rgba(88,28,135,0.45)" },
  optionIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: "rgba(148,163,184,0.12)", alignItems: "center", justifyContent: "center" },
  optionIconSelected: { backgroundColor: "rgba(139,92,246,0.55)" },
  optionText: { flex: 1, color: "#f8fafc", fontSize: 16, lineHeight: 21, fontFamily: "Inter_700Bold" },
  planRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: 1, borderColor: "rgba(56,189,248,0.2)", backgroundColor: "rgba(15,23,42,0.72)", padding: 12 },
  planNumber: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(56,189,248,0.2)" },
  planNumberText: { color: "#38bdf8", fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  planText: { color: "#e2e8f0", fontSize: 15, fontFamily: "Inter_700Bold" },
  safetyCard: { flexDirection: "row", gap: 10, marginTop: 20 },
  inputWrap: { flex: 1 },
  inputLabel: { color: "#94a3b8", fontSize: 11, fontFamily: "Inter_800ExtraBold", marginBottom: 6, textTransform: "uppercase" },
  input: { height: 52, borderRadius: 14, paddingHorizontal: 14, backgroundColor: "#111827", borderWidth: 1, borderColor: "#1e293b", color: "#f8fafc", fontSize: 17, fontFamily: "Inter_700Bold" },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 28, paddingTop: 14, backgroundColor: "rgba(5,7,17,0.94)", borderTopWidth: 1, borderTopColor: "rgba(148,163,184,0.16)" },
  primary: { height: 58, borderRadius: 28, backgroundColor: "#8b5cf6", alignItems: "center", justifyContent: "center", shadowColor: "#8b5cf6", shadowOpacity: 0.28, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  primaryText: { color: "#f8fafc", fontSize: 17, fontFamily: "Inter_800ExtraBold", textAlign: "center", paddingHorizontal: 12 },
  navRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 12 },
  navText: { color: "#94a3b8", fontSize: 14, fontFamily: "Inter_700Bold" },
  coachOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", alignItems: "center", justifyContent: "center", padding: 24 },
  coachSheet: { width: "100%", maxWidth: 420, borderRadius: 28, borderWidth: 1, borderColor: "rgba(139,92,246,0.45)", backgroundColor: "#0f172a", padding: 22, alignItems: "center" },
  coachSpotlight: { width: 108, height: 108, borderRadius: 54, backgroundColor: "rgba(139,92,246,0.16)", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  coachTitle: { color: "#f8fafc", fontSize: 22, fontFamily: "Inter_800ExtraBold", textAlign: "center" },
  coachMessage: { color: "#cbd5e1", fontSize: 15, lineHeight: 22, fontFamily: "Inter_500Medium", textAlign: "center", marginTop: 10 },
  coachButton: { alignSelf: "stretch", height: 50, borderRadius: 16, backgroundColor: "#8b5cf6", alignItems: "center", justifyContent: "center", marginTop: 18 },
  coachButtonText: { color: "#fff", fontSize: 15, fontFamily: "Inter_800ExtraBold" },
});
