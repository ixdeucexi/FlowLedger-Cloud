import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountModal } from "@/components/AccountModal";
import { AddBillModal } from "@/components/AddBillModal";
import { FloLogo } from "@/components/FloLogo";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { GoalModal } from "@/components/GoalModal";
import { IncomeModal } from "@/components/IncomeModal";
import { useAuth } from "@/context/AuthContext";
import { BudgetProvider, useBudget, type Account, type Bill, type Goal, type IncomeItem } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import {
  acceptHouseholdInviteCode,
  createHouseholdInviteCode,
  loadHouseholdMemberships,
  type HouseholdInviteRole,
  type HouseholdMembership,
} from "@/lib/households";
import {
  buildSetupCompletionMessage,
  buildPersonalizedSetupKeys,
  DEFAULT_ONBOARDING_PREFERENCES,
  describeSetupPlan,
  getSetupPathItem,
  shouldAskSavingsGoal,
  type MoneySetupKey,
  type OnboardingPreferences,
  type SavingsGoalOption,
  type SetupGoalOption,
  type SetupHelpOption,
  type SetupStartingPoint,
} from "@/lib/onboarding";
import { loadOnboardingPreferences, saveOnboardingPreferences } from "@/lib/onboardingPreferences";
import { LEARNING_TOUR_STEPS, writeLearningTourState } from "@/lib/learningTour";
import { readStoredSetupStep, writeStoredSetupStep, type SetupStepKey } from "@/lib/setupProgress";

interface SetupStep {
  key: SetupStepKey;
  done: boolean;
  title: string;
  ask: string;
  body: string;
  button: string;
  kind: "intro" | "household" | "multi" | "single" | "plan" | "action";
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
  { id: "debt_payoff", label: "Pay off debt", icon: "dollar-sign" },
  { id: "something_else", label: "Something else", icon: "more-horizontal" },
];

const STARTING_POINT_OPTIONS: {
  id: SetupStartingPoint;
  label: string;
  description: string;
  icon: React.ComponentProps<typeof Feather>["name"];
}[] = [
  { id: "first_budget", label: "This is my first budget", description: "Guide me through the essentials and explain the numbers.", icon: "book-open" },
  { id: "switching_apps", label: "I'm switching from another app", description: "Help me confirm what I already have without starting over.", icon: "refresh-cw" },
  { id: "catching_up", label: "I need to catch up", description: "Put urgent bills and low-balance days first.", icon: "alert-circle" },
  { id: "paycheck_to_paycheck", label: "I keep running out before payday", description: "Help me reach the next paycheck safely and build breathing room.", icon: "calendar" },
  { id: "building_room", label: "I want to get further ahead", description: "Help me turn extra room into a stability reserve.", icon: "trending-up" },
];

function moneyKeyToStepKey(key: MoneySetupKey): SetupStepKey {
  return key === "goals" ? "goal_setup" : key;
}

function isPreferenceStep(key: SetupStepKey) {
  return ["welcome", "intro", "starting_point", "household", "help", "goals", "savings_goal", "plan"].includes(key);
}

function toggleArrayValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter(item => item !== value) : [...values, value];
}

const TRUST_CARDS: { icon: React.ComponentProps<typeof Feather>["name"]; title: string; text: string }[] = [
  { icon: "shield", title: "Your real data stays safe", text: "Setup questions personalize the path. They do not create or overwrite money records." },
  { icon: "compass", title: "Your path follows your goals", text: "Debt, savings, bills, and spending goals can each move to the front of setup." },
  { icon: "zap", title: "Built for decisions", text: "The goal is a forecast you can trust before purchases, bill moves, and debt payments." },
];

const FINISH_CARDS: { icon: React.ComponentProps<typeof Feather>["name"]; title: string; text: string }[] = [
  { icon: "shield", title: "Know what is protected", text: "See what remains after required bills and your safety floor are covered." },
  { icon: "calendar", title: "Reach payday safely", text: "See tight dates early and get one clear next action." },
  { icon: "trending-up", title: "Build protected days", text: "Track progress from the next paycheck toward a one-month stability reserve." },
];

function SetupWizard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const colors = useColors();
  const {
    accounts, incomes, bills, goals, settings,
    addAccount, updateAccount, reconcileAccount,
    addIncome, updateIncome, deleteIncome,
    addBill, updateBill, deleteBillMistake,
    addGoal, updateSettings,
  } = useBudget();

  const [preferences, setPreferences] = useState<OnboardingPreferences>(DEFAULT_ONBOARDING_PREFERENCES);
  const [index, setIndex] = useState(0);
  const [accountModalVisible, setAccountModalVisible] = useState(false);
  const [accountMode, setAccountMode] = useState<"add" | "edit" | "reconcile">("add");
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [incomeModalVisible, setIncomeModalVisible] = useState(false);
  const [billModalVisible, setBillModalVisible] = useState(false);
  const [debtModalVisible, setDebtModalVisible] = useState(false);
  const [editIncome, setEditIncome] = useState<IncomeItem | null>(null);
  const [editBill, setEditBill] = useState<Bill | null>(null);
  const [editDebt, setEditDebt] = useState<Bill | null>(null);
  const [goalModalVisible, setGoalModalVisible] = useState(false);
  const [safetyFloorText, setSafetyFloorText] = useState(String(settings.safety_floor));
  const [horizonText, setHorizonText] = useState(String(settings.forecast_horizon_months));
  const [floConfirmation, setFloConfirmation] = useState("");
  const [restoredProgress, setRestoredProgress] = useState(false);
  const [coachVisible, setCoachVisible] = useState(false);
  const [households, setHouseholds] = useState<HouseholdMembership[]>([]);
  const [householdRole, setHouseholdRole] = useState<HouseholdInviteRole>("editor");
  const [householdCode, setHouseholdCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [householdMessage, setHouseholdMessage] = useState("");
  const [householdBusy, setHouseholdBusy] = useState(false);
  const stepOpacity = useRef(new Animated.Value(1)).current;
  const stepTranslate = useRef(new Animated.Value(0)).current;

  const activeAccount = accounts.find(account => account.is_active) ?? null;
  const householdForInvite = useMemo(
    () => households.find(item => item.role === "owner" || item.role === "manager") ?? households[0] ?? null,
    [households],
  );

  const reloadHouseholds = async () => {
    const next = await loadHouseholdMemberships(user?.id);
    setHouseholds(next);
    return next;
  };

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
        ask: "Let's anchor your forecast.",
        body: "Tell me what your account shows today. I'll use that number as the starting point for balances, bills, and decisions.",
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
        body: "Rent, utilities, subscriptions, insurance, and transfers all shape your forecast. I'll use those dates to spot tight weeks before they happen.",
        button: billsDone ? "Add Another Bill" : "Add Bill",
      },
      debts: {
        done: debtsDone,
        title: "What debts should I know about?",
        ask: "If you're paying down debt, add it here.",
        body: "Balances, minimums, due dates, and APRs help me show what is safe to send extra toward without hurting the rest of your month.",
        button: debtsDone ? "Add Another Debt" : "Add Debt",
      },
      goals: {
        done: goalsDone,
        title: "What are you saving toward?",
        ask: "Let's give your extra money a purpose.",
        body: "Add a savings goal so I can protect it in your forecast and help you decide when money can safely move there.",
        button: goalsDone ? "Add Another Goal" : "Add Goal",
      },
      safety: {
        done: true,
        title: "What safety floor should I protect?",
        ask: "Let's choose your comfort zone.",
        body: "This is the minimum balance your forecast should protect. The default is $200, but you can choose the amount that helps you feel secure.",
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
        title: "Your first stability plan is ready.",
        ask: "Start with what is protected and one clear next action.",
        body: buildSetupCompletionMessage(preferences),
        button: "Open My Stability Plan",
      },
    };

    const introSteps: SetupStep[] = [
      {
        key: "welcome",
        done: false,
        title: "Welcome to FlowLedger Algo",
        ask: "Let's build your money command center.",
        body: "I'm Flo. I'll learn what you want help with, keep your real data safe, and walk you through the setup steps that match your goals.",
        button: "Get Started",
        kind: "intro",
      },
      {
        key: "starting_point",
        done: Boolean(preferences.startingPoint),
        title: "Where are you starting from?",
        ask: "Choose the answer that feels closest.",
        body: "I'll adjust the guidance and setup pace without taking away useful details or control.",
        button: "Continue",
        kind: "single",
      },
      {
        key: "household",
        done: true,
        title: "Will anyone share this plan?",
        ask: "Invite or join a household before we talk finances.",
        body: "If your money is shared with a spouse or partner, I can help connect the household first. This does not create, reset, or change any money records.",
        button: "Continue",
        kind: "household",
      },
      {
        key: "help",
        done: preferences.help.length > 0,
        title: "How can I help?",
        ask: "Choose as many options as you'd like.",
        body: "Your answers help me decide which setup steps should come first.",
        button: "Continue",
        kind: "multi",
      },
      {
        key: "goals",
        done: preferences.goals.length > 0,
        title: "What are your top financial goals?",
        ask: "Pick the goals that matter most right now.",
        body: "I'll use this to make FlowLedger feel less like a form and more like a plan.",
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
      title: "Here's the setup path I'll use.",
      ask: "I've got the plan.",
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
  const setupPathItems = useMemo(
    () => buildPersonalizedSetupKeys(preferences).map(getSetupPathItem),
    [preferences],
  );
  const currentPathItem = setupPathItems.find(item => moneyKeyToStepKey(item.key) === current.key) ?? null;
  const completedSetupPathCount = setupPathItems.filter(item => {
    const key = moneyKeyToStepKey(item.key);
    return steps.find(step => step.key === key)?.done;
  }).length;
  const preferenceChoiceCount = preferences.help.length + preferences.goals.length + (preferences.savingsGoal ? 1 : 0) + (preferences.startingPoint ? 1 : 0);
  const savePreferences = (next = preferences) => saveOnboardingPreferences(user?.id, next).catch(() => undefined);

  useEffect(() => {
    let active = true;
    loadOnboardingPreferences(user?.id)
      .then(next => {
        if (active) setPreferences(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    let active = true;
    loadHouseholdMemberships(user?.id)
      .then(next => {
        if (active) setHouseholds(next);
      })
      .catch(() => {
        if (active) setHouseholds([]);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

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

  useEffect(() => {
    stepOpacity.setValue(0);
    stepTranslate.setValue(30);
    Animated.parallel([
      Animated.timing(stepOpacity, {
        toValue: 1,
        duration: 460,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(stepTranslate, {
        toValue: 0,
        duration: 460,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [current.key, stepOpacity, stepTranslate]);

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
    if (current.key === "starting_point") return Boolean(preferences.startingPoint);
    if (current.key === "help") return preferences.help.length > 0;
    if (current.key === "goals") return preferences.goals.length > 0;
    if (current.key === "savings_goal") return Boolean(preferences.savingsGoal);
    return true;
  }, [current.key, preferences]);

  const finish = async () => {
    writeStoredSetupStep(null);
    await updateSettings({ onboarding_completed: true });
    writeLearningTourState(true, 0);
    router.replace(LEARNING_TOUR_STEPS[0].path as any);
  };

  const createInvite = async () => {
    if (!householdForInvite) {
      setHouseholdMessage("No household is ready yet. You can invite someone later from More.");
      return;
    }
    setHouseholdBusy(true);
    setHouseholdMessage("");
    try {
      const code = await createHouseholdInviteCode(householdForInvite.householdId, householdRole);
      setHouseholdCode(code);
      setHouseholdMessage("Invite code created. Share it with the person joining your household.");
    } catch (error) {
      setHouseholdMessage(error instanceof Error ? error.message : "Couldn't create an invite code. Try again.");
    } finally {
      setHouseholdBusy(false);
    }
  };

  const joinHousehold = async () => {
    const code = joinCode.trim();
    if (!code) {
      setHouseholdMessage("Enter an invite code first.");
      return;
    }
    setHouseholdBusy(true);
    setHouseholdMessage("");
    try {
      await acceptHouseholdInviteCode(code);
      setJoinCode("");
      setHouseholdCode("");
      await reloadHouseholds();
      setHouseholdMessage("Household joined. I'll use that shared plan once setup continues.");
    } catch (error) {
      setHouseholdMessage(error instanceof Error ? error.message : "Couldn't join that household. Try again.");
    } finally {
      setHouseholdBusy(false);
    }
  };

  const runAction = async () => {
    switch (current.key) {
      case "welcome":
      case "intro":
        setFloConfirmation("");
        goNext();
        return;
      case "household":
        setFloConfirmation(householdCode ? "Invite code is ready. You can continue setup while they join." : "No problem — household setup can wait until More.");
        goNext();
        return;
      case "starting_point":
      case "help":
      case "goals":
      case "savings_goal":
        await savePreferences();
        goNext();
        return;
      case "plan":
        await savePreferences();
        setFloConfirmation("Great. I'll only ask for real money details from here.");
        goNext();
        return;
      case "account":
      case "money":
        setSelectedAccount(activeAccount);
        setAccountMode(activeAccount ? "edit" : "add");
        setAccountModalVisible(true);
        return;
      case "income":
        setEditIncome(null);
        setIncomeModalVisible(true);
        return;
      case "bills":
        setEditBill(null);
        setBillModalVisible(true);
        return;
      case "debts":
        setEditDebt(null);
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
        confirmAndNext(`Got it — I'll protect a $${floor.toFixed(0)} safety floor across ${horizon} month${horizon === 1 ? "" : "s"}.`);
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

  const updateStartingPoint = (startingPoint: SetupStartingPoint) => {
    const next = { ...preferences, startingPoint };
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
    if (current.key === "starting_point") {
      return STARTING_POINT_OPTIONS.map(option => (
        <OptionCard
          key={option.id}
          icon={option.icon}
          label={option.label}
          description={option.description}
          selected={preferences.startingPoint === option.id}
          onPress={() => updateStartingPoint(option.id)}
        />
      ));
    }
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

  const renderHouseholdStep = () => {
    if (current.key !== "household") return null;
    const roleOptions: { role: HouseholdInviteRole; label: string }[] = [
      { role: "editor", label: "Can edit" },
      { role: "viewer", label: "View only" },
    ];
    return (
      <View style={styles.householdPanel}>
        <View style={styles.householdSection}>
          <View style={styles.householdTitleRow}>
            <Feather name="users" size={18} color="#c084fc" />
            <Text style={styles.householdTitle}>Share this household</Text>
          </View>
          <Text style={styles.householdText}>
            Create a code for your spouse, partner, or household member. They only join this money plan.
          </Text>
          <View style={styles.householdRoleRow}>
            {roleOptions.map(option => (
              <Pressable
                key={option.role}
                onPress={() => setHouseholdRole(option.role)}
                style={[styles.householdRoleChip, householdRole === option.role && styles.householdRoleChipActive]}
              >
                <Text style={[styles.householdRoleText, householdRole === option.role && styles.householdRoleTextActive]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            disabled={householdBusy}
            onPress={() => void createInvite()}
            style={[styles.householdButton, householdBusy && styles.disabledButton]}
          >
            <Feather name="send" size={16} color="#f8fafc" />
            <Text style={styles.householdButtonText}>{householdCode ? "Create New Code" : "Create Invite Code"}</Text>
          </Pressable>
          {householdCode ? <Text style={styles.householdCode}>{householdCode}</Text> : null}
        </View>

        <View style={styles.householdDivider} />

        <View style={styles.householdSection}>
          <View style={styles.householdTitleRow}>
            <Feather name="log-in" size={18} color="#38bdf8" />
            <Text style={styles.householdTitle}>Join a household</Text>
          </View>
          <View style={styles.householdJoinRow}>
            <TextInput
              value={joinCode}
              onChangeText={setJoinCode}
              autoCapitalize="characters"
              placeholder="Enter invite code"
              placeholderTextColor="#64748b"
              style={styles.householdJoinInput}
            />
            <Pressable
              disabled={householdBusy}
              onPress={() => void joinHousehold()}
              style={[styles.householdJoinButton, householdBusy && styles.disabledButton]}
            >
              <Feather name="arrow-right" size={20} color="#f8fafc" />
            </Pressable>
          </View>
        </View>

        {householdMessage ? <Text style={styles.householdMessage}>{householdMessage}</Text> : null}
        <Text style={styles.householdFootnote}>You can skip this and invite people later from More → Accounts & household.</Text>
      </View>
    );
  };

  const renderPlanCards = () => {
    if (current.key !== "plan") return null;
    return setupPathItems.map((item, planIndex) => {
      return (
        <View key={item.key} style={styles.planRow}>
          <View style={styles.planNumber}>
            <Text style={styles.planNumberText}>{planIndex + 1}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.planText}>{item.title}</Text>
            <Text style={styles.planDetail}>{item.detail}</Text>
          </View>
        </View>
      );
    });
  };

  const renderTrustCards = () => {
    if (current.kind !== "intro") return null;
    return TRUST_CARDS.map(card => (
      <View key={card.title} style={styles.trustCard}>
        <View style={styles.trustIcon}>
          <Feather name={card.icon} size={16} color="#38bdf8" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.trustTitle}>{card.title}</Text>
          <Text style={styles.trustText}>{card.text}</Text>
        </View>
      </View>
    ));
  };

  const renderActionPathCard = () => {
    if (current.kind !== "action" || !currentPathItem) return null;
    return (
      <View style={styles.pathCard}>
        <View style={styles.pathCardHeader}>
          <Text style={styles.pathEyebrow}>Flo's setup path</Text>
          <Text style={styles.pathCount}>{completedSetupPathCount}/{setupPathItems.length}</Text>
        </View>
        <View style={styles.pathCurrentRow}>
          <View style={styles.pathCurrentIcon}>
            <Feather name="target" size={17} color="#c084fc" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.pathCurrentTitle}>{currentPathItem.title}</Text>
            <Text style={styles.pathCurrentText}>{currentPathItem.detail}</Text>
          </View>
        </View>
        <View style={styles.pathPills}>
          {setupPathItems.slice(0, 6).map(item => {
            const step = steps.find(candidate => candidate.key === moneyKeyToStepKey(item.key));
            const active = item.key === currentPathItem.key;
            const done = Boolean(step?.done);
            return (
              <View key={item.key} style={[styles.pathPill, active && styles.pathPillActive, done && styles.pathPillDone]}>
                <Text style={[styles.pathPillText, active && styles.pathPillTextActive, done && styles.pathPillTextDone]}>
                  {item.shortLabel}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  const renderExistingMoneyItems = () => {
    const items = current.key === "income"
      ? incomes.map(item => ({
          id: item.id,
          title: item.name,
          detail: `$${Number(item.amount).toFixed(2)} · ${item.frequency}`,
          onPress: () => { setEditIncome(item); setIncomeModalVisible(true); },
        }))
      : current.key === "bills"
        ? bills.filter(item => !item.is_debt).map(item => ({
            id: item.id,
            title: item.name,
            detail: `$${Number(item.amount).toFixed(2)} · ${item.is_recurring ? item.frequency : "one-time"}`,
            onPress: () => { setEditBill(item); setBillModalVisible(true); },
          }))
        : current.key === "debts"
          ? bills.filter(item => item.is_debt).map(item => ({
              id: item.id,
              title: item.name,
              detail: `$${Number(item.amount).toFixed(2)} minimum · $${Number(item.balance ?? 0).toFixed(2)} balance`,
              onPress: () => { setEditDebt(item); setDebtModalVisible(true); },
            }))
          : [];

    if (items.length === 0) return null;
    return (
      <View style={styles.setupItemsCard}>
        <View style={styles.setupItemsHeader}>
          <Text style={styles.setupItemsTitle}>Added during setup</Text>
          <Text style={styles.setupItemsHint}>Tap one to edit</Text>
        </View>
        {items.map(item => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${item.title}`}
            onPress={item.onPress}
            style={({ pressed }) => [styles.setupItemRow, { opacity: pressed ? 0.72 : 1 }]}
          >
            <View style={styles.setupItemIcon}>
              <Feather name="edit-2" size={15} color="#c084fc" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.setupItemTitle}>{item.title}</Text>
              <Text style={styles.setupItemDetail}>{item.detail}</Text>
            </View>
            <Feather name="chevron-right" size={18} color="#64748b" />
          </Pressable>
        ))}
      </View>
    );
  };

  const renderFinishCards = () => {
    if (current.key !== "finish") return null;
    return FINISH_CARDS.map(card => (
      <View key={card.title} style={styles.finishCard}>
        <View style={styles.finishIcon}>
          <Feather name={card.icon} size={16} color="#c084fc" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.finishTitle}>{card.title}</Text>
          <Text style={styles.finishText}>{card.text}</Text>
        </View>
      </View>
    ));
  };

  return (
    <LinearGradient colors={colors.isDark ? ["#050711", "#0a0d1a", "#111827"] : ["#f8fafc", "#eef2ff", "#f8fafc"]} style={styles.root}>
      <PremiumBackdrop variant="purple" />
      <View style={[styles.fixedProgress, { top: insets.top + 22 }]}>
        <View style={styles.progressRow}>
          {steps.map((step, stepIndex) => (
            <View
              key={`${step.key}-${stepIndex}`}
              style={[
                styles.progressBar,
                { backgroundColor: stepIndex <= index ? "#9f5cff" : "rgba(148,163,184,0.24)" },
              ]}
            />
          ))}
        </View>
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 70, paddingBottom: insets.bottom + 134 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: stepOpacity, transform: [{ translateY: stepTranslate }] }}>
          <View style={styles.hero}>
            <FloLogo size={current.kind === "intro" ? 112 : 76} />
            <Text style={styles.stepCount}>{progressIndex} of {steps.length}</Text>
            <Text style={styles.title}>{current.title}</Text>
            <View style={styles.bubble}>
              <View style={styles.bubbleHeader}>
                <Text style={styles.bubbleLabel}>Flo asks</Text>
                {(current.kind === "multi" || current.kind === "single") && preferenceChoiceCount > 0 ? (
                  <View style={styles.choicePill}>
                    <Text style={styles.choicePillText}>{preferenceChoiceCount} selected</Text>
                  </View>
                ) : null}
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
            {renderTrustCards()}
            {renderActionPathCard()}
            {renderExistingMoneyItems()}
            {renderHouseholdStep()}
            {renderOptions()}
            {renderPlanCards()}
            {renderFinishCards()}
            {(current.kind === "multi" || current.kind === "single") ? (
              <View style={styles.safeNote}>
                <Feather name="lock" size={13} color="#38bdf8" />
                <Text style={styles.safeNoteText}>These choices personalize Flo only. Your account balances, bills, debts, and goals stay unchanged.</Text>
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
        </Animated.View>
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
              <Text style={styles.navText}>{current.done ? "Done adding" : "Skip for now"}</Text>
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
          confirmAndNext("Got it — I'll use that account as part of your forecast.");
        }}
        onReconcile={async (balance, date) => {
          if (selectedAccount) await reconcileAccount(selectedAccount.id, balance, date);
          setAccountModalVisible(false);
          confirmAndNext(`Perfect — I'll trust $${balance.toFixed(2)} as of ${date}.`);
        }}
      />
      <IncomeModal
        visible={incomeModalVisible}
        editItem={editIncome}
        onClose={() => { setIncomeModalVisible(false); setEditIncome(null); }}
        onDelete={async id => {
          await deleteIncome(id);
          setEditIncome(null);
          setFloConfirmation("Income removed. Add the correct one when you're ready.");
        }}
        onSave={async data => {
          if (editIncome) await updateIncome(data as IncomeItem);
          else await addIncome(data as Omit<IncomeItem, "id">);
          setIncomeModalVisible(false);
          setEditIncome(null);
          setFloConfirmation(editIncome ? "Income updated. You can review it again or keep adding." : "Income added. Add another one, or tap Done adding.");
        }}
      />
      <AddBillModal
        visible={billModalVisible}
        editBill={editBill}
        onClose={() => { setBillModalVisible(false); setEditBill(null); }}
        onDelete={async id => {
          await deleteBillMistake(id);
          setEditBill(null);
          setFloConfirmation("Bill removed. Add the correct one when you're ready.");
        }}
        onSave={async data => {
          if (editBill) await updateBill(data as Bill);
          else await addBill(data as Omit<Bill, "id" | "created_at">);
          setBillModalVisible(false);
          setEditBill(null);
          setFloConfirmation(editBill ? "Bill updated. Check it again or keep adding." : "Bill added. Add another one, or tap Done adding.");
        }}
      />
      <AddBillModal
        visible={debtModalVisible}
        editBill={editDebt}
        onClose={() => { setDebtModalVisible(false); setEditDebt(null); }}
        forceDebt
        onDelete={async id => {
          await deleteBillMistake(id);
          setEditDebt(null);
          setFloConfirmation("Debt removed. Add the correct one when you're ready.");
        }}
        onSave={async data => {
          if (editDebt) await updateBill(data as Bill);
          else await addBill(data as Omit<Bill, "id" | "created_at">);
          setDebtModalVisible(false);
          setEditDebt(null);
          setFloConfirmation(editDebt ? "Debt updated. Check it again or keep adding." : "Debt added. Add another one, or tap Done adding.");
        }}
      />
      <GoalModal
        visible={goalModalVisible}
        onClose={() => setGoalModalVisible(false)}
        onSave={async data => {
          await addGoal(data as Omit<Goal, "id" | "created_at">);
          setGoalModalVisible(false);
          confirmAndNext("Goal added — I'll protect it when I look ahead.");
        }}
      />
    </LinearGradient>
  );
}

function OptionCard({ icon, label, description, selected, onPress }: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
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
      <View style={styles.optionCopy}>
        <Text style={styles.optionText}>{label}</Text>
        {description ? <Text style={styles.optionDescription}>{description}</Text> : null}
      </View>
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
  fixedProgress: { position: "absolute", left: 28, right: 28, zIndex: 20 },
  progressRow: { flexDirection: "row", gap: 6 },
  progressBar: { flex: 1, height: 4, borderRadius: 999 },
  hero: { alignItems: "center" },
  stepCount: { color: "#38bdf8", fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1, marginTop: 14, textTransform: "uppercase" },
  title: { color: "#f8fafc", fontSize: 30, lineHeight: 37, textAlign: "center", fontFamily: "Inter_800ExtraBold", marginTop: 12 },
  bubble: { alignSelf: "stretch", backgroundColor: "rgba(15,23,42,0.9)", borderWidth: 1, borderColor: "rgba(139,92,246,0.35)", borderRadius: 24, padding: 18, marginTop: 22 },
  bubbleHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  bubbleLabel: { color: "#a78bfa", fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1, textTransform: "uppercase" },
  choicePill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: "rgba(56,189,248,0.12)", borderWidth: 1, borderColor: "rgba(56,189,248,0.22)", marginLeft: "auto", marginRight: 10 },
  choicePillText: { color: "#bae6fd", fontSize: 10, fontFamily: "Inter_800ExtraBold" },
  ask: { color: "#f8fafc", fontSize: 20, lineHeight: 27, fontFamily: "Inter_800ExtraBold", textAlign: "center" },
  body: { color: "#94a3b8", fontSize: 15, lineHeight: 22, fontFamily: "Inter_500Medium", textAlign: "center", marginTop: 10 },
  confirmation: { alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: "rgba(34,197,94,0.12)", borderWidth: 1, borderColor: "rgba(34,197,94,0.28)", borderRadius: 16, padding: 12, marginTop: 14 },
  confirmationText: { flex: 1, color: "#bbf7d0", fontSize: 13, lineHeight: 18, fontFamily: "Inter_700Bold" },
  optionStack: { gap: 12, marginTop: 22 },
  trustCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, borderWidth: 1, borderColor: "rgba(56,189,248,0.18)", backgroundColor: "rgba(15,23,42,0.74)", padding: 14 },
  trustIcon: { width: 38, height: 38, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(56,189,248,0.12)" },
  trustTitle: { color: "#f8fafc", fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  trustText: { color: "#94a3b8", fontSize: 12, lineHeight: 17, fontFamily: "Inter_500Medium", marginTop: 3 },
  safeNote: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 16, borderWidth: 1, borderColor: "rgba(56,189,248,0.16)", backgroundColor: "rgba(2,132,199,0.10)", padding: 12 },
  safeNoteText: { flex: 1, color: "#bae6fd", fontSize: 12, lineHeight: 17, fontFamily: "Inter_600SemiBold" },
  householdPanel: { gap: 16, marginTop: 8 },
  householdSection: { borderRadius: 24, borderWidth: 1, borderColor: "rgba(148, 163, 184, 0.18)", backgroundColor: "rgba(15, 23, 42, 0.72)", padding: 16, gap: 12 },
  householdTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  householdTitle: { color: "#f8fafc", fontSize: 18, fontFamily: "Inter_800ExtraBold" },
  householdText: { color: "#94a3b8", fontSize: 14, lineHeight: 20, fontFamily: "Inter_500Medium" },
  householdRoleRow: { flexDirection: "row", gap: 10 },
  householdRoleChip: { flex: 1, borderRadius: 16, borderWidth: 1, borderColor: "rgba(148, 163, 184, 0.2)", paddingVertical: 12, alignItems: "center", backgroundColor: "rgba(15, 23, 42, 0.6)" },
  householdRoleChipActive: { backgroundColor: "rgba(147, 51, 234, 0.95)", borderColor: "rgba(216, 180, 254, 0.65)" },
  householdRoleText: { color: "#94a3b8", fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  householdRoleTextActive: { color: "#fff" },
  householdButton: { borderRadius: 18, minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#7c3aed" },
  householdButtonText: { color: "#f8fafc", fontSize: 16, fontFamily: "Inter_800ExtraBold" },
  householdCode: { borderRadius: 16, borderWidth: 1, borderColor: "rgba(56, 189, 248, 0.35)", backgroundColor: "rgba(14, 165, 233, 0.12)", color: "#bae6fd", fontSize: 22, fontFamily: "Inter_800ExtraBold", textAlign: "center", letterSpacing: 3, paddingVertical: 12 },
  householdDivider: { height: 1, backgroundColor: "rgba(148, 163, 184, 0.14)" },
  householdJoinRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  householdJoinInput: { flex: 1, minHeight: 54, borderRadius: 18, borderWidth: 1, borderColor: "rgba(148, 163, 184, 0.22)", backgroundColor: "rgba(2, 6, 23, 0.55)", color: "#f8fafc", paddingHorizontal: 16, fontSize: 16, fontFamily: "Inter_700Bold" },
  householdJoinButton: { width: 56, height: 54, borderRadius: 18, backgroundColor: "#7c3aed", alignItems: "center", justifyContent: "center" },
  householdMessage: { color: "#86efac", fontSize: 13, fontFamily: "Inter_800ExtraBold", textAlign: "center" },
  householdFootnote: { color: "#64748b", fontSize: 12, lineHeight: 18, fontFamily: "Inter_500Medium", textAlign: "center" },
  disabledButton: { opacity: 0.6 },
  optionCard: { minHeight: 58, borderRadius: 18, borderWidth: 1, borderColor: "rgba(148,163,184,0.2)", backgroundColor: "rgba(15,23,42,0.82)", paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 14 },
  optionCardSelected: { borderColor: "rgba(139,92,246,0.8)", backgroundColor: "rgba(88,28,135,0.45)" },
  optionIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: "rgba(148,163,184,0.12)", alignItems: "center", justifyContent: "center" },
  optionIconSelected: { backgroundColor: "rgba(139,92,246,0.55)" },
  optionCopy: { flex: 1, paddingVertical: 10 },
  optionText: { color: "#f8fafc", fontSize: 16, lineHeight: 21, fontFamily: "Inter_700Bold" },
  optionDescription: { color: "#94a3b8", fontSize: 12, lineHeight: 17, fontFamily: "Inter_500Medium", marginTop: 3 },
  planRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: 1, borderColor: "rgba(56,189,248,0.2)", backgroundColor: "rgba(15,23,42,0.72)", padding: 12 },
  planNumber: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(56,189,248,0.2)" },
  planNumberText: { color: "#38bdf8", fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  planText: { color: "#e2e8f0", fontSize: 15, fontFamily: "Inter_700Bold" },
  planDetail: { color: "#94a3b8", fontSize: 12, lineHeight: 17, fontFamily: "Inter_500Medium", marginTop: 3 },
  pathCard: { borderRadius: 22, borderWidth: 1, borderColor: "rgba(139,92,246,0.28)", backgroundColor: "rgba(15,23,42,0.82)", padding: 15 },
  pathCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  pathEyebrow: { color: "#a78bfa", fontSize: 10, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase", letterSpacing: 1 },
  pathCount: { color: "#c4b5fd", fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  pathCurrentRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  pathCurrentIcon: { width: 40, height: 40, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(139,92,246,0.16)" },
  pathCurrentTitle: { color: "#f8fafc", fontSize: 16, fontFamily: "Inter_800ExtraBold" },
  pathCurrentText: { color: "#94a3b8", fontSize: 12, lineHeight: 17, fontFamily: "Inter_500Medium", marginTop: 3 },
  pathPills: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 13 },
  pathPill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: "rgba(148,163,184,0.10)", borderWidth: 1, borderColor: "rgba(148,163,184,0.15)" },
  pathPillActive: { backgroundColor: "rgba(139,92,246,0.22)", borderColor: "rgba(139,92,246,0.45)" },
  pathPillDone: { backgroundColor: "rgba(34,197,94,0.12)", borderColor: "rgba(34,197,94,0.25)" },
  pathPillText: { color: "#94a3b8", fontSize: 10, fontFamily: "Inter_800ExtraBold" },
  pathPillTextActive: { color: "#ddd6fe" },
  pathPillTextDone: { color: "#bbf7d0" },
  setupItemsCard: { borderRadius: 20, borderWidth: 1, borderColor: "rgba(192,132,252,0.26)", backgroundColor: "rgba(15,23,42,0.78)", padding: 12, gap: 8 },
  setupItemsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 2, paddingBottom: 2 },
  setupItemsTitle: { color: "#f8fafc", fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  setupItemsHint: { color: "#94a3b8", fontSize: 10, fontFamily: "Inter_700Bold" },
  setupItemRow: { minHeight: 58, borderRadius: 15, borderWidth: 1, borderColor: "rgba(148,163,184,0.14)", backgroundColor: "rgba(2,6,23,0.42)", padding: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  setupItemIcon: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(168,85,247,0.14)" },
  setupItemTitle: { color: "#f8fafc", fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  setupItemDetail: { color: "#94a3b8", fontSize: 11, lineHeight: 16, fontFamily: "Inter_500Medium", marginTop: 2, textTransform: "capitalize" },
  finishCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, borderWidth: 1, borderColor: "rgba(192,132,252,0.22)", backgroundColor: "rgba(30,27,75,0.45)", padding: 14 },
  finishIcon: { width: 38, height: 38, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(139,92,246,0.18)" },
  finishTitle: { color: "#f8fafc", fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  finishText: { color: "#cbd5e1", fontSize: 12, lineHeight: 17, fontFamily: "Inter_500Medium", marginTop: 3 },
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
