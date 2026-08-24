import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Speech from "expo-speech";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountModal } from "@/components/AccountModal";
import { AddBillModal } from "@/components/AddBillModal";
import { AppLoadingIntro } from "@/components/AppLoadingIntro";
import { FloLogo } from "@/components/FloLogo";
import { GoalModal } from "@/components/GoalModal";
import { IncomeModal } from "@/components/IncomeModal";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { useAuth } from "@/context/AuthContext";
import { useBudget, type Account, type Bill, type Goal, type IncomeItem } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { createHouseholdInviteCode, type HouseholdInviteRole } from "@/lib/households";
import { startLearningTour } from "@/lib/learningTour";
import { confirmAction } from "@/lib/confirmAction";
import {
  DEFAULT_ONBOARDING_PREFERENCES,
  normalizeOnboardingPreferences,
  setupScopeProgress,
  withSetupScopeProgress,
  type OnboardingPreferences,
  type SavingsGoalOption,
  type SetupGoalOption,
  type SetupHelpOption,
  type SetupScopeProgress,
  type SetupStageId,
  type SetupStartingPoint,
} from "@/lib/onboarding";
import { loadOnboardingPreferences, saveOnboardingPreferences } from "@/lib/onboardingPreferences";
import {
  SETUP_STAGE_ORDER,
  buildSetupReadiness,
  canonicalResumeStage,
  hasSetupConfirmation,
  setupScopeKey,
  setupStageIndex,
  withSetupConfirmation,
} from "@/lib/setupReadiness";

const HELP_OPTIONS: { id: SetupHelpOption; label: string; icon: React.ComponentProps<typeof Feather>["name"] }[] = [
  { id: "track_spending", label: "Track spending", icon: "bar-chart-2" },
  { id: "pay_off_debt", label: "Pay off debt", icon: "trending-down" },
  { id: "grow_savings", label: "Grow savings", icon: "shield" },
  { id: "create_budget", label: "Create a budget", icon: "grid" },
  { id: "stay_organized", label: "Stay organized", icon: "check-circle" },
];

const STARTING_POINT_OPTIONS: {
  id: SetupStartingPoint;
  label: string;
  description: string;
  icon: React.ComponentProps<typeof Feather>["name"];
}[] = [
  { id: "first_budget", label: "This is my first budget", description: "Explain the essentials as we build the plan.", icon: "book-open" },
  { id: "switching_apps", label: "I'm switching apps", description: "Help me confirm what I already know.", icon: "refresh-cw" },
  { id: "catching_up", label: "I need to catch up", description: "Protect urgent bills first and start building breathing room.", icon: "trending-up" },
  { id: "paycheck_to_paycheck", label: "I run out before payday", description: "Focus on reaching the next paycheck safely.", icon: "calendar" },
  { id: "building_room", label: "I want to get further ahead", description: "Build protected days and breathing room.", icon: "trending-up" },
];

const SAVINGS_OPTIONS: { id: SavingsGoalOption; label: string }[] = [
  { id: "emergency_fund", label: "Emergency fund" },
  { id: "house", label: "House" },
  { id: "car", label: "Car" },
  { id: "debt_payoff", label: "Debt payoff" },
  { id: "something_else", label: "Something else" },
];

const STAGE_ICON: Record<SetupStageId, React.ComponentProps<typeof Feather>["name"]> = {
  priorities: "compass",
  starting_money: "credit-card",
  cashflow: "repeat",
  debt_savings: "trending-up",
  review: "check-circle",
};

type SaveState = "idle" | "saving" | "saved" | "error";

function toggleValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter(item => item !== value) : [...values, value];
}

function goalsForHelp(help: SetupHelpOption[]): SetupGoalOption[] {
  const goals = new Set<SetupGoalOption>();
  if (help.includes("track_spending")) goals.add("reduce_spending");
  if (help.includes("pay_off_debt")) goals.add("pay_off_debt");
  if (help.includes("grow_savings")) goals.add("grow_savings");
  if (help.includes("create_budget") || help.includes("stay_organized")) goals.add("stay_on_top");
  return Array.from(goals);
}

function SetupWizard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const colors = useColors();
  const isDesktop = useDesktopExperience();
  const reduceMotion = useReducedMotion();
  const {
    activeHousehold,
    accounts,
    incomes,
    bills,
    goals,
    settings,
    addAccount,
    updateAccount,
    addIncome,
    updateIncome,
    deleteIncome,
    addBill,
    updateBill,
    deleteBillMistake,
    addGoal,
    updateSettings,
  } = useBudget();

  const scopeKey = setupScopeKey(user?.id, activeHousehold?.householdId);
  const [preferences, setPreferences] = useState<OnboardingPreferences>(DEFAULT_ONBOARDING_PREFERENCES);
  const [stage, setStage] = useState<SetupStageId>("priorities");
  const [loadedPreferences, setLoadedPreferences] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [accountModalVisible, setAccountModalVisible] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [incomeModalVisible, setIncomeModalVisible] = useState(false);
  const [billModalVisible, setBillModalVisible] = useState(false);
  const [debtModalVisible, setDebtModalVisible] = useState(false);
  const [goalModalVisible, setGoalModalVisible] = useState(false);
  const [editIncome, setEditIncome] = useState<IncomeItem | null>(null);
  const [editBill, setEditBill] = useState<Bill | null>(null);
  const [editDebt, setEditDebt] = useState<Bill | null>(null);
  const [safetyFloorText, setSafetyFloorText] = useState(String(settings.safety_floor));
  const [horizonText, setHorizonText] = useState(String(settings.forecast_horizon_months));
  const [showInvite, setShowInvite] = useState(false);
  const [inviteRole, setInviteRole] = useState<HouseholdInviteRole>("editor");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMessage, setInviteMessage] = useState("");
  const scrollRef = useRef<ScrollView>(null);
  const stageOpacity = useRef(new Animated.Value(1)).current;
  const stageTranslate = useRef(new Animated.Value(0)).current;

  const progress = useMemo(
    () => setupScopeProgress(preferences, scopeKey),
    [preferences, scopeKey],
  );
  const readiness = useMemo(() => buildSetupReadiness({
    preferences,
    progress,
    accounts,
    incomeCount: incomes.length,
    bills,
    goalCount: goals.filter(goal => goal.goal_type === "savings" && !goal.closed_at).length,
    safetyFloor: settings.safety_floor,
    forecastMonths: settings.forecast_horizon_months,
  }), [accounts, bills, goals, incomes.length, preferences, progress, settings.forecast_horizon_months, settings.safety_floor]);
  const activeAccount = accounts.find(account => account.is_active) ?? null;
  const recurringBills = bills.filter(item => !item.is_debt && item.is_recurring !== false);
  const debts = bills.filter(item => item.is_debt);
  const savingsGoals = goals.filter(goal => goal.goal_type === "savings" && !goal.closed_at);
  const stageStatus = readiness.stages.find(item => item.id === stage) ?? readiness.stages[0];
  const stageIndex = setupStageIndex(stage);

  useEffect(() => {
    let active = true;
    setLoadedPreferences(false);
    void loadOnboardingPreferences(user?.id)
      .then(next => {
        if (!active) return;
        const normalized = normalizeOnboardingPreferences(next);
        const nextProgress = setupScopeProgress(normalized, scopeKey);
        const nextReadiness = buildSetupReadiness({
          preferences: normalized,
          progress: nextProgress,
          accounts,
          incomeCount: incomes.length,
          bills,
          goalCount: savingsGoals.length,
          safetyFloor: settings.safety_floor,
          forecastMonths: settings.forecast_horizon_months,
        });
        setPreferences(normalized);
        setStage(settings.onboarding_completed ? "review" : canonicalResumeStage(nextReadiness, nextProgress));
        setLoadedPreferences(true);
      })
      .catch(() => {
        if (!active) return;
        setSaveState("error");
        setSaveMessage("Setup could not restore. Your money was not changed.");
        setLoadedPreferences(true);
      });
    return () => { active = false; };
  }, [scopeKey, settings.onboarding_completed, user?.id]);

  useEffect(() => {
    setSafetyFloorText(String(settings.safety_floor));
    setHorizonText(String(settings.forecast_horizon_months));
  }, [settings.forecast_horizon_months, settings.safety_floor]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    void Speech.stop();
    setSpeaking(false);
    if (reduceMotion) {
      stageOpacity.setValue(1);
      stageTranslate.setValue(0);
      return;
    }
    stageOpacity.setValue(0);
    stageTranslate.setValue(18);
    Animated.parallel([
      Animated.timing(stageOpacity, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== "web" }),
      Animated.timing(stageTranslate, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== "web" }),
    ]).start();
  }, [reduceMotion, stage, stageOpacity, stageTranslate]);

  useEffect(() => () => { void Speech.stop(); }, []);

  const persist = async (
    nextPreferences: OnboardingPreferences,
    nextProgress: SetupScopeProgress,
    successMessage = "Setup saved",
  ) => {
    const combined = withSetupScopeProgress(nextPreferences, scopeKey, nextProgress);
    setPreferences(combined);
    setSaveState("saving");
    setSaveMessage("Saving your place…");
    try {
      await saveOnboardingPreferences(user?.id, combined);
      setSaveState("saved");
      setSaveMessage(successMessage);
      return combined;
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error instanceof Error ? error.message : "Could not save setup. Try again.");
      throw error;
    }
  };

  const advanceTo = async (nextStage: SetupStageId) => {
    const nextProgress = { ...progress, currentStage: nextStage, updatedAt: new Date().toISOString() };
    await persist(preferences, nextProgress);
    setStage(nextStage);
  };

  const setConfirmation = async (id: Parameters<typeof withSetupConfirmation>[1], enabled: boolean) => {
    const next = withSetupConfirmation(progress, id, enabled);
    await persist(preferences, next, enabled ? "Answer saved" : "Answer cleared");
  };

  const toggleHelp = (id: SetupHelpOption) => {
    const help = toggleValue(preferences.help, id);
    setPreferences({
      ...preferences,
      help,
      goals: goalsForHelp(help),
      savingsGoal: help.includes("grow_savings") ? preferences.savingsGoal : null,
    });
    setSaveState("idle");
    setSaveMessage("Tap Continue to save these choices.");
  };

  const toggleVoice = async () => {
    if (speaking) {
      await Speech.stop();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    Speech.speak(`${stageStatus.label}. ${stageStatus.detail}`, {
      rate: 0.94,
      onDone: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  };

  const finishSetup = async (guidedTour: boolean) => {
    const floor = Number(safetyFloorText);
    const months = Math.round(Number(horizonText));
    if (!Number.isFinite(floor) || floor < 0 || !Number.isFinite(months) || months < 1 || months > 24) {
      setSaveState("error");
      setSaveMessage("Enter a safety cushion of $0 or more and 1–24 forecast months.");
      return;
    }
    const reviewed = withSetupConfirmation(progress, "safety_reviewed", true);
    const finishedProgress: SetupScopeProgress = {
      ...reviewed,
      currentStage: "review",
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const finalReadiness = buildSetupReadiness({
      preferences,
      progress: finishedProgress,
      accounts,
      incomeCount: incomes.length,
      bills,
      goalCount: savingsGoals.length,
      safetyFloor: floor,
      forecastMonths: months,
    });
    if (!finalReadiness.isComplete) {
      setStage(finalReadiness.firstIncompleteStage);
      setSaveState("error");
      setSaveMessage("Finish or explicitly skip this required section before opening the plan.");
      return;
    }
    setSaveState("saving");
    setSaveMessage("Opening your plan…");
    try {
      await persist(preferences, finishedProgress, "Setup complete");
      await updateSettings({ safety_floor: floor, forecast_horizon_months: months, onboarding_completed: true });
      if (guidedTour) startLearningTour();
      router.replace("/(tabs)" as any);
    } catch {
      // Persist/update handlers already expose a safe retry message.
    }
  };

  const primaryAction = async () => {
    if (stage === "priorities") {
      if (!preferences.startingPoint || preferences.help.length === 0) return;
      await advanceTo("starting_money");
      return;
    }
    if (stage === "starting_money") {
      if (!activeAccount?.balance_as_of) {
        setSelectedAccount(activeAccount);
        setAccountModalVisible(true);
        return;
      }
      await advanceTo("cashflow");
      return;
    }
    if (stage === "cashflow") {
      if (!stageStatus.complete) return;
      await advanceTo("debt_savings");
      return;
    }
    if (stage === "debt_savings") {
      if (!stageStatus.complete) return;
      await advanceTo("review");
      return;
    }
    if (settings.onboarding_completed) {
      router.replace("/(tabs)" as any);
      return;
    }
    await finishSetup(false);
  };

  const leaveSetup = () => {
    confirmAction({
      title: "Save and leave setup?",
      message: "Your completed answers and current stage will be saved for this household.",
      confirmText: "Save and leave",
      cancelText: "Keep setting up",
      onConfirm: async () => {
        const resumeStage = stageStatus.complete ? readiness.firstIncompleteStage : stage;
        await persist(preferences, { ...progress, currentStage: resumeStage, updatedAt: new Date().toISOString() });
        router.replace("/(tabs)" as any);
      },
    });
  };

  const primaryDisabled = saveState === "saving" || (
    stage === "priorities" ? !preferences.startingPoint || preferences.help.length === 0 :
    stage === "cashflow" || stage === "debt_savings" ? !stageStatus.complete : false
  );
  const primaryLabel = stage === "starting_money" && !activeAccount?.balance_as_of
    ? "Add starting account"
    : stage === "review" ? (settings.onboarding_completed ? "Back to Dashboard" : "Open Dashboard") : "Continue";

  const createInvite = async () => {
    if (!activeHousehold || !["owner", "manager"].includes(activeHousehold.role)) {
      setInviteMessage("Only a household owner or manager can create an invite.");
      return;
    }
    setInviteBusy(true);
    setInviteMessage("");
    try {
      const code = await createHouseholdInviteCode(activeHousehold.householdId, inviteRole);
      setInviteCode(code);
      setInviteMessage("Invite ready. Share this code with the person joining your plan.");
    } catch (error) {
      setInviteMessage(error instanceof Error ? error.message : "Could not create the invite.");
    } finally {
      setInviteBusy(false);
    }
  };

  const renderPriorities = () => (
    <>
      <SectionCard title="Where are you starting?" subtitle="Choose the answer that feels closest.">
        {STARTING_POINT_OPTIONS.map(option => (
          <OptionCard
            key={option.id}
            icon={option.icon}
            label={option.label}
            description={option.description}
            selected={preferences.startingPoint === option.id}
            onPress={() => setPreferences({ ...preferences, startingPoint: option.id })}
          />
        ))}
      </SectionCard>
      <SectionCard title="What should Flo help with first?" subtitle="Choose every option that fits.">
        <View style={styles.chipGrid}>
          {HELP_OPTIONS.map(option => (
            <ChoiceChip key={option.id} icon={option.icon} label={option.label} selected={preferences.help.includes(option.id)} onPress={() => toggleHelp(option.id)} />
          ))}
        </View>
        {preferences.help.includes("grow_savings") ? (
          <View style={styles.subChoiceWrap}>
            <Text style={styles.subChoiceLabel}>Top savings goal</Text>
            <View style={styles.chipGrid}>
              {SAVINGS_OPTIONS.map(option => (
                <ChoiceChip
                  key={option.id}
                  label={option.label}
                  selected={preferences.savingsGoal === option.id}
                  onPress={() => setPreferences({ ...preferences, savingsGoal: option.id })}
                />
              ))}
            </View>
          </View>
        ) : null}
      </SectionCard>
    </>
  );

  const renderStartingMoney = () => (
    <SectionCard title="Your everyday account" subtitle="The account, balance, and balance date become the trusted starting point for Forecast.">
      {activeAccount ? (
        <DataRow
          icon="credit-card"
          title={activeAccount.name}
          detail={`${activeAccount.account_type} · balance confirmed ${activeAccount.balance_as_of || "date missing"}`}
          value={`$${Number(activeAccount.current_balance).toFixed(2)}`}
          action="Review"
          onPress={() => { setSelectedAccount(activeAccount); setAccountModalVisible(true); }}
        />
      ) : (
        <EmptyState icon="credit-card" text="Add the checking or cash account you use for everyday money. A confirmed $0 balance is valid." />
      )}
      <ActionButton
        icon={activeAccount ? "edit-2" : "plus"}
        label={activeAccount ? "Review starting account" : "Add starting account"}
        onPress={() => { setSelectedAccount(activeAccount); setAccountModalVisible(true); }}
      />
    </SectionCard>
  );

  const renderCashflow = () => (
    <>
      <SectionCard title="Income" subtitle="Add paychecks, deposits, or recurring income.">
        {incomes.map(item => (
          <DataRow key={item.id} icon="arrow-down-left" title={item.name} detail={item.frequency} value={`$${Number(item.amount).toFixed(2)}`} action="Edit" onPress={() => { setEditIncome(item); setIncomeModalVisible(true); }} />
        ))}
        {incomes.length === 0 ? <EmptyState icon="arrow-down-left" text="No income has been added yet." /> : null}
        <View style={styles.inlineActions}>
          <ActionButton compact icon="plus" label={incomes.length ? "Add another" : "Add income"} onPress={() => { setEditIncome(null); setIncomeModalVisible(true); }} />
          <NoneButton label="I don't have income" selected={hasSetupConfirmation(progress, "income_none")} onPress={() => void setConfirmation("income_none", !hasSetupConfirmation(progress, "income_none"))} />
        </View>
      </SectionCard>
      <SectionCard title="Bills" subtitle="Add recurring obligations so Forecast can show where to build more room.">
        {recurringBills.map(item => (
          <DataRow key={item.id} icon="file-text" title={item.name} detail={item.frequency} value={`$${Number(item.amount).toFixed(2)}`} action="Edit" onPress={() => { setEditBill(item); setBillModalVisible(true); }} />
        ))}
        {recurringBills.length === 0 ? <EmptyState icon="file-text" text="No recurring bills have been added yet." /> : null}
        <View style={styles.inlineActions}>
          <ActionButton compact icon="plus" label={recurringBills.length ? "Add another" : "Add bill"} onPress={() => { setEditBill(null); setBillModalVisible(true); }} />
          <NoneButton label="I don't have recurring bills" selected={hasSetupConfirmation(progress, "bills_none")} onPress={() => void setConfirmation("bills_none", !hasSetupConfirmation(progress, "bills_none"))} />
        </View>
      </SectionCard>
    </>
  );

  const renderDebtSavings = () => (
    <>
      <SectionCard title="Debt payoff" subtitle="Add balances, minimums, due dates, and APRs so payoff guidance is honest.">
        {debts.map(item => (
          <DataRow key={item.id} icon="trending-down" title={item.name} detail={`$${Number(item.amount).toFixed(2)} minimum`} value={`$${Number(item.balance ?? 0).toFixed(2)}`} action="Edit" onPress={() => { setEditDebt(item); setDebtModalVisible(true); }} />
        ))}
        {debts.length === 0 ? <EmptyState icon="trending-down" text="No debts have been added yet." /> : null}
        <View style={styles.inlineActions}>
          <ActionButton compact icon="plus" label={debts.length ? "Add another" : "Add debt"} onPress={() => { setEditDebt(null); setDebtModalVisible(true); }} />
          <NoneButton label="I don't have debt" selected={hasSetupConfirmation(progress, "debts_none")} onPress={() => void setConfirmation("debts_none", !hasSetupConfirmation(progress, "debts_none"))} />
        </View>
      </SectionCard>
      <SectionCard title="Savings goals" subtitle={readiness.wantsSavings ? "Add the savings target Flo should protect first." : "Optional — add a goal now or later."}>
        {savingsGoals.map(item => (
          <DataRow key={item.id} icon="target" title={item.name} detail={`$${Number(item.current_amount).toFixed(2)} funded`} value={`$${Number(item.target_amount).toFixed(2)}`} />
        ))}
        {savingsGoals.length === 0 ? <EmptyState icon="target" text="No savings goal has been added yet." /> : null}
        <View style={styles.inlineActions}>
          <ActionButton compact icon="plus" label="Add savings goal" onPress={() => setGoalModalVisible(true)} />
          {readiness.wantsSavings ? <NoneButton label="Not ready to name a goal" selected={hasSetupConfirmation(progress, "goals_none")} onPress={() => void setConfirmation("goals_none", !hasSetupConfirmation(progress, "goals_none"))} /> : null}
        </View>
      </SectionCard>
    </>
  );

  const renderReview = () => (
    <>
      <SectionCard title="Safety settings" subtitle="Choose the cushion and Forecast range you want FlowLedger to protect.">
        <View style={[styles.fieldRow, !isDesktop && styles.fieldRowMobile]}>
          <View style={styles.fieldWrap}>
            <Text style={styles.fieldLabel}>Safety cushion</Text>
            <TextInput accessibilityLabel="Safety cushion" value={safetyFloorText} onChangeText={setSafetyFloorText} keyboardType="decimal-pad" style={styles.input} placeholder="200" placeholderTextColor="#64748b" />
          </View>
          <View style={styles.fieldWrap}>
            <Text style={styles.fieldLabel}>Forecast months</Text>
            <TextInput accessibilityLabel="Forecast months" value={horizonText} onChangeText={setHorizonText} keyboardType="number-pad" style={styles.input} placeholder="6" placeholderTextColor="#64748b" />
          </View>
        </View>
      </SectionCard>
      <SectionCard title="Plan check" subtitle="These are the facts FlowLedger will use. Nothing is estimated as complete.">
        <ReviewRow label="Starting account" value={activeAccount ? `${activeAccount.name} · $${Number(activeAccount.current_balance).toFixed(2)}` : "Missing"} complete={Boolean(activeAccount?.balance_as_of)} />
        <ReviewRow label="Income" value={incomes.length ? `${incomes.length} source${incomes.length === 1 ? "" : "s"}` : "Confirmed none"} complete={incomes.length > 0 || hasSetupConfirmation(progress, "income_none")} />
        <ReviewRow label="Recurring bills" value={recurringBills.length ? `${recurringBills.length} added` : "Confirmed none"} complete={recurringBills.length > 0 || hasSetupConfirmation(progress, "bills_none")} />
        <ReviewRow label="Debt" value={debts.length ? `${debts.length} added` : "Confirmed none"} complete={debts.length > 0 || hasSetupConfirmation(progress, "debts_none")} />
        <ReviewRow label="Savings goals" value={savingsGoals.length ? `${savingsGoals.length} added` : readiness.wantsSavings ? "Not named yet" : "Optional"} complete={!readiness.wantsSavings || savingsGoals.length > 0 || hasSetupConfirmation(progress, "goals_none")} />
      </SectionCard>
      <SectionCard title="After setup" subtitle="Open the Dashboard now, or let Flo point out the four main parts of your real plan.">
        <ActionButton
          icon="compass"
          label="Open Guided Tour"
          onPress={() => {
            if (settings.onboarding_completed) {
              startLearningTour();
              router.replace("/(tabs)" as any);
              return;
            }
            void finishSetup(true);
          }}
        />
        <Pressable accessibilityRole="button" onPress={() => setShowInvite(value => !value)} style={styles.secondaryLink}>
          <Feather name="users" size={17} color="#c4b5fd" />
          <Text style={styles.secondaryLinkText}>{showInvite ? "Hide household invite" : "Invite a household member"}</Text>
        </Pressable>
        {showInvite ? (
          <View style={styles.inviteBox}>
            <Text style={styles.inviteCopy}>Invite someone after your plan is ready. They will join this household—not your entire account.</Text>
            <View style={styles.chipGrid}>
              <ChoiceChip label="Can edit" selected={inviteRole === "editor"} onPress={() => setInviteRole("editor")} />
              <ChoiceChip label="View only" selected={inviteRole === "viewer"} onPress={() => setInviteRole("viewer")} />
            </View>
            <ActionButton compact icon="send" label={inviteBusy ? "Creating…" : inviteCode ? "Create new code" : "Create invite code"} disabled={inviteBusy} onPress={() => void createInvite()} />
            {inviteCode ? <Text selectable style={styles.inviteCode}>{inviteCode}</Text> : null}
            {inviteMessage ? <Text style={styles.inviteMessage}>{inviteMessage}</Text> : null}
          </View>
        ) : null}
      </SectionCard>
    </>
  );

  const renderStage = () => {
    if (stage === "priorities") return renderPriorities();
    if (stage === "starting_money") return renderStartingMoney();
    if (stage === "cashflow") return renderCashflow();
    if (stage === "debt_savings") return renderDebtSavings();
    return renderReview();
  };

  if (!loadedPreferences) {
    return <AppLoadingIntro phase="setup" accessibilityLabel="FlowLedger is preparing your setup" />;
  }

  return (
    <LinearGradient colors={colors.isDark ? ["#050711", "#0a0d1a", "#111827"] : ["#f8fafc", "#eef2ff", "#f8fafc"]} style={styles.root}>
      <PremiumBackdrop variant="purple" />
      <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
        <View style={styles.topBarInner}>
          <View style={styles.topIdentity}>
            <FloLogo size={36} />
            <View>
              <Text style={styles.topEyebrow}>FLOWLEDGER SETUP</Text>
              <Text style={styles.topTitle}>Stage {stageIndex + 1} of {SETUP_STAGE_ORDER.length}</Text>
            </View>
          </View>
          <SaveIndicator state={saveState} message={saveMessage} />
        </View>
        <View style={styles.progressTrack} accessibilityRole="progressbar" accessibilityLabel={`Setup stage ${stageIndex + 1} of ${SETUP_STAGE_ORDER.length}`}>
          <View style={[styles.progressFill, { width: `${((stageIndex + 1) / SETUP_STAGE_ORDER.length) * 100}%` as `${number}%` }]} />
        </View>
      </View>

      <View style={[styles.shell, isDesktop && styles.shellDesktop]}>
        {isDesktop ? (
          <View style={styles.sidebar}>
            <Text style={styles.sidebarTitle}>Your setup path</Text>
            <Text style={styles.sidebarText}>Five stages. Your place is saved for this household.</Text>
            {readiness.stages.map((item, itemIndex) => {
              const active = item.id === stage;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setStage(item.id)}
                  style={[styles.stageNav, active && styles.stageNavActive]}
                >
                  <View style={[styles.stageNumber, item.complete && styles.stageNumberDone]}>
                    {item.complete ? <Feather name="check" size={15} color="#bbf7d0" /> : <Text style={styles.stageNumberText}>{itemIndex + 1}</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.stageNavTitle, active && styles.stageNavTitleActive]}>{item.shortLabel}</Text>
                    <Text style={styles.stageNavDetail}>{item.complete ? "Complete" : item.detail}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <ScrollView
          ref={scrollRef}
          style={[styles.scroll, isDesktop && styles.scrollDesktop]}
          contentContainerStyle={[styles.content, isDesktop && styles.contentDesktop, { paddingBottom: insets.bottom + 150 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View style={{ opacity: stageOpacity, transform: [{ translateY: stageTranslate }] }}>
            <View style={[styles.hero, isDesktop && styles.heroDesktop]}>
              <View style={styles.heroIcon}><Feather name={STAGE_ICON[stage]} size={26} color="#c4b5fd" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroEyebrow}>{stageStatus.shortLabel}</Text>
                <Text style={[styles.heroTitle, isDesktop && styles.heroTitleDesktop]}>{stageStatus.label}</Text>
                <Text style={styles.heroText}>{stageStatus.detail}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={speaking ? "Stop Flo speaking" : "Hear Flo explain this stage"} onPress={() => void toggleVoice()} style={styles.voiceButton}>
                <Feather name={speaking ? "volume-x" : "volume-2"} size={20} color="#c084fc" />
              </Pressable>
            </View>
            <View style={styles.stageBody}>{renderStage()}</View>
          </Animated.View>
        </ScrollView>
      </View>

      <View style={[styles.footer, isDesktop && styles.footerDesktop, { paddingBottom: insets.bottom + 14 }]}>
        <View style={[styles.footerInner, isDesktop && styles.footerInnerDesktop]}>
          <Pressable accessibilityRole="button" disabled={stageIndex === 0 || saveState === "saving"} onPress={() => setStage(SETUP_STAGE_ORDER[Math.max(0, stageIndex - 1)] ?? "priorities")} style={[styles.backButton, (stageIndex === 0 || saveState === "saving") && styles.disabled]}>
            <Feather name="arrow-left" size={18} color="#cbd5e1" />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={primaryDisabled} onPress={() => void primaryAction()} style={[styles.primaryButton, primaryDisabled && styles.disabled]}>
            {saveState === "saving" ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{primaryLabel}</Text>}
            {saveState !== "saving" ? <Feather name={stage === "review" ? "home" : "arrow-right"} size={18} color="#fff" /> : null}
          </Pressable>
          <Pressable accessibilityRole="button" onPress={leaveSetup} disabled={saveState === "saving"} style={styles.leaveButton}>
            <Text style={styles.leaveText}>Save & leave</Text>
          </Pressable>
        </View>
      </View>

      <AccountModal
        visible={accountModalVisible}
        account={selectedAccount}
        mode={selectedAccount ? "edit" : "add"}
        onClose={() => setAccountModalVisible(false)}
        onReconcile={() => undefined}
        onSave={async value => {
          if (selectedAccount) await updateAccount({ ...selectedAccount, ...value });
          else await addAccount({ ...value, is_active: true });
          setAccountModalVisible(false);
          setSaveState("saved");
          setSaveMessage("Starting account saved");
        }}
      />
      <IncomeModal
        visible={incomeModalVisible}
        editItem={editIncome}
        onClose={() => { setIncomeModalVisible(false); setEditIncome(null); }}
        onDelete={async id => { await deleteIncome(id); setEditIncome(null); }}
        onSave={async data => {
          if (editIncome) await updateIncome(data as IncomeItem);
          else await addIncome(data as Omit<IncomeItem, "id">);
          setIncomeModalVisible(false);
          setEditIncome(null);
          if (hasSetupConfirmation(progress, "income_none")) await setConfirmation("income_none", false);
        }}
      />
      <AddBillModal
        visible={billModalVisible}
        editBill={editBill}
        onClose={() => { setBillModalVisible(false); setEditBill(null); }}
        onDelete={async id => { await deleteBillMistake(id); setEditBill(null); }}
        onSave={async data => {
          if (editBill) await updateBill(data as Bill);
          else await addBill(data as Omit<Bill, "id" | "created_at">);
          setBillModalVisible(false);
          setEditBill(null);
          if (hasSetupConfirmation(progress, "bills_none")) await setConfirmation("bills_none", false);
        }}
      />
      <AddBillModal
        visible={debtModalVisible}
        editBill={editDebt}
        forceDebt
        onClose={() => { setDebtModalVisible(false); setEditDebt(null); }}
        onDelete={async id => { await deleteBillMistake(id); setEditDebt(null); }}
        onSave={async data => {
          if (editDebt) await updateBill(data as Bill);
          else await addBill(data as Omit<Bill, "id" | "created_at">);
          setDebtModalVisible(false);
          setEditDebt(null);
          if (hasSetupConfirmation(progress, "debts_none")) await setConfirmation("debts_none", false);
        }}
      />
      <GoalModal
        visible={goalModalVisible}
        onClose={() => setGoalModalVisible(false)}
        onSave={async data => {
          await addGoal(data as Omit<Goal, "id" | "created_at">);
          setGoalModalVisible(false);
          if (hasSetupConfirmation(progress, "goals_none")) await setConfirmation("goals_none", false);
        }}
      />
    </LinearGradient>
  );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionSubtitle}>{subtitle}</Text>
      <View style={styles.sectionContent}>{children}</View>
    </View>
  );
}

function OptionCard({ icon, label, description, selected, onPress }: { icon: React.ComponentProps<typeof Feather>["name"]; label: string; description: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.optionCard, selected && styles.optionCardSelected]}>
      <View style={[styles.optionIcon, selected && styles.optionIconSelected]}><Feather name={icon} size={18} color={selected ? "#fff" : "#94a3b8"} /></View>
      <View style={{ flex: 1 }}><Text style={styles.optionTitle}>{label}</Text><Text style={styles.optionDescription}>{description}</Text></View>
      <Feather name={selected ? "check-circle" : "circle"} size={20} color={selected ? "#c4b5fd" : "#475569"} />
    </Pressable>
  );
}

function ChoiceChip({ icon, label, selected, onPress }: { icon?: React.ComponentProps<typeof Feather>["name"]; label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.choiceChip, selected && styles.choiceChipSelected]}>
      {icon ? <Feather name={icon} size={15} color={selected ? "#fff" : "#94a3b8"} /> : null}
      <Text style={[styles.choiceChipText, selected && styles.choiceChipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function DataRow({ icon, title, detail, value, action, onPress }: { icon: React.ComponentProps<typeof Feather>["name"]; title: string; detail: string; value?: string; action?: string; onPress?: () => void }) {
  const content = (
    <>
      <View style={styles.dataIcon}><Feather name={icon} size={17} color="#c084fc" /></View>
      <View style={{ flex: 1 }}><Text style={styles.dataTitle}>{title}</Text><Text style={styles.dataDetail}>{detail}</Text></View>
      {value ? <Text style={styles.dataValue}>{value}</Text> : null}
      {action ? <Text style={styles.dataAction}>{action}</Text> : null}
    </>
  );
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`${action ?? "Open"} ${title}`} onPress={onPress} style={styles.dataRow}>{content}</Pressable> : <View style={styles.dataRow}>{content}</View>;
}

function EmptyState({ icon, text }: { icon: React.ComponentProps<typeof Feather>["name"]; text: string }) {
  return <View style={styles.emptyState}><Feather name={icon} size={19} color="#64748b" /><Text style={styles.emptyText}>{text}</Text></View>;
}

function ActionButton({ icon, label, onPress, compact, disabled }: { icon: React.ComponentProps<typeof Feather>["name"]; label: string; onPress: () => void; compact?: boolean; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.actionButton, compact && styles.actionButtonCompact, disabled && styles.disabled]}>
      <Feather name={icon} size={17} color="#fff" /><Text style={styles.actionButtonText}>{label}</Text>
    </Pressable>
  );
}

function NoneButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={onPress} style={[styles.noneButton, selected && styles.noneButtonSelected]}>
      <Feather name={selected ? "check-square" : "square"} size={16} color={selected ? "#86efac" : "#94a3b8"} /><Text style={[styles.noneText, selected && styles.noneTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function ReviewRow({ label, value, complete }: { label: string; value: string; complete: boolean }) {
  return <View style={styles.reviewRow}><Feather name={complete ? "check-circle" : "alert-circle"} size={18} color={complete ? "#22c55e" : "#f59e0b"} /><Text style={styles.reviewLabel}>{label}</Text><Text style={styles.reviewValue}>{value}</Text></View>;
}

function SaveIndicator({ state, message }: { state: SaveState; message: string }) {
  if (state === "idle" && !message) return null;
  const icon = state === "saving" ? "loader" : state === "error" ? "alert-circle" : "check-circle";
  const color = state === "error" ? "#fca5a5" : state === "saved" ? "#86efac" : "#cbd5e1";
  return <View style={styles.saveIndicator}><Feather name={icon} size={14} color={color} /><Text numberOfLines={2} style={[styles.saveIndicatorText, { color }]}>{message}</Text></View>;
}

export default function SetupScreen() {
  return <SetupWizard />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#050711" },
  topBar: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 30, backgroundColor: "rgba(5,7,17,0.97)", borderBottomWidth: 1, borderBottomColor: "rgba(148,163,184,0.14)", paddingHorizontal: 18, paddingBottom: 10 },
  topBarInner: { width: "100%", maxWidth: 1120, alignSelf: "center", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 },
  topIdentity: { flexDirection: "row", alignItems: "center", gap: 10 },
  topEyebrow: { color: "#a78bfa", fontSize: 9, letterSpacing: 1.2, fontFamily: "Inter_800ExtraBold" },
  topTitle: { color: "#f8fafc", fontSize: 13, fontFamily: "Inter_700Bold", marginTop: 2 },
  saveIndicator: { maxWidth: 210, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6 },
  saveIndicatorText: { textAlign: "right", fontSize: 11, lineHeight: 15, fontFamily: "Inter_700Bold" },
  progressTrack: { height: 4, marginTop: 10, borderRadius: 99, backgroundColor: "rgba(148,163,184,0.18)", overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 99, backgroundColor: "#8b5cf6" },
  shell: { flex: 1, paddingTop: 88 },
  shellDesktop: { width: "100%", maxWidth: 1120, alignSelf: "center", flexDirection: "row", gap: 22, paddingHorizontal: 22, paddingTop: 92 },
  scroll: { flex: 1 },
  scrollDesktop: { minWidth: 0 },
  sidebar: { width: 300, alignSelf: "stretch", borderWidth: 1, borderColor: "rgba(148,163,184,0.16)", borderRadius: 24, backgroundColor: "rgba(15,23,42,0.82)", padding: 18, marginBottom: 112 },
  sidebarTitle: { color: "#f8fafc", fontSize: 20, fontFamily: "Inter_800ExtraBold" },
  sidebarText: { color: "#94a3b8", fontSize: 12, lineHeight: 18, marginTop: 5, marginBottom: 14, fontFamily: "Inter_500Medium" },
  stageNav: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 16, marginTop: 6 },
  stageNavActive: { backgroundColor: "rgba(139,92,246,0.16)", borderWidth: 1, borderColor: "rgba(139,92,246,0.32)" },
  stageNumber: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(148,163,184,0.12)" },
  stageNumberDone: { backgroundColor: "rgba(34,197,94,0.15)" },
  stageNumberText: { color: "#94a3b8", fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  stageNavTitle: { color: "#cbd5e1", fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  stageNavTitleActive: { color: "#ede9fe" },
  stageNavDetail: { color: "#64748b", fontSize: 10, lineHeight: 14, marginTop: 2, fontFamily: "Inter_500Medium" },
  content: { paddingHorizontal: 18, paddingTop: 22 },
  contentDesktop: { flexGrow: 1, width: "100%", paddingHorizontal: 0, paddingTop: 0 },
  hero: { flexDirection: "row", alignItems: "flex-start", gap: 13, marginBottom: 18 },
  heroDesktop: { borderWidth: 1, borderColor: "rgba(139,92,246,0.2)", backgroundColor: "rgba(15,23,42,0.68)", borderRadius: 24, padding: 20 },
  heroIcon: { width: 52, height: 52, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(139,92,246,0.16)" },
  heroEyebrow: { color: "#a78bfa", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", fontFamily: "Inter_800ExtraBold" },
  heroTitle: { color: "#f8fafc", fontSize: 27, lineHeight: 33, fontFamily: "Inter_800ExtraBold", marginTop: 4 },
  heroTitleDesktop: { fontSize: 32, lineHeight: 39 },
  heroText: { color: "#94a3b8", fontSize: 14, lineHeight: 20, fontFamily: "Inter_500Medium", marginTop: 5 },
  voiceButton: { minWidth: 44, minHeight: 44, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(192,132,252,0.12)" },
  stageBody: { gap: 14 },
  sectionCard: { borderWidth: 1, borderColor: "rgba(148,163,184,0.17)", borderRadius: 22, backgroundColor: "rgba(15,23,42,0.82)", padding: 16 },
  sectionTitle: { color: "#f8fafc", fontSize: 18, fontFamily: "Inter_800ExtraBold" },
  sectionSubtitle: { color: "#94a3b8", fontSize: 13, lineHeight: 19, marginTop: 4, fontFamily: "Inter_500Medium" },
  sectionContent: { gap: 10, marginTop: 14 },
  optionCard: { minHeight: 68, borderWidth: 1, borderColor: "rgba(148,163,184,0.16)", borderRadius: 17, backgroundColor: "rgba(2,6,23,0.38)", flexDirection: "row", alignItems: "center", gap: 11, padding: 12 },
  optionCardSelected: { borderColor: "rgba(139,92,246,0.7)", backgroundColor: "rgba(88,28,135,0.34)" },
  optionIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: "rgba(148,163,184,0.10)", alignItems: "center", justifyContent: "center" },
  optionIconSelected: { backgroundColor: "rgba(139,92,246,0.72)" },
  optionTitle: { color: "#f8fafc", fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  optionDescription: { color: "#94a3b8", fontSize: 11, lineHeight: 16, marginTop: 2, fontFamily: "Inter_500Medium" },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  choiceChip: { minHeight: 44, borderRadius: 15, borderWidth: 1, borderColor: "rgba(148,163,184,0.19)", backgroundColor: "rgba(2,6,23,0.38)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 13, paddingVertical: 9 },
  choiceChipSelected: { backgroundColor: "#7c3aed", borderColor: "#c4b5fd" },
  choiceChipText: { color: "#cbd5e1", fontSize: 12, fontFamily: "Inter_700Bold" },
  choiceChipTextSelected: { color: "#fff" },
  subChoiceWrap: { borderTopWidth: 1, borderTopColor: "rgba(148,163,184,0.14)", marginTop: 4, paddingTop: 13 },
  subChoiceLabel: { color: "#cbd5e1", fontSize: 12, fontFamily: "Inter_800ExtraBold", marginBottom: 9 },
  dataRow: { minHeight: 60, borderWidth: 1, borderColor: "rgba(148,163,184,0.14)", borderRadius: 16, backgroundColor: "rgba(2,6,23,0.34)", flexDirection: "row", alignItems: "center", gap: 10, padding: 10 },
  dataIcon: { width: 36, height: 36, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(192,132,252,0.12)" },
  dataTitle: { color: "#f8fafc", fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  dataDetail: { color: "#94a3b8", fontSize: 11, marginTop: 2, textTransform: "capitalize", fontFamily: "Inter_500Medium" },
  dataValue: { color: "#f8fafc", fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  dataAction: { color: "#c4b5fd", fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  emptyState: { minHeight: 60, borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(148,163,184,0.2)", flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  emptyText: { flex: 1, color: "#94a3b8", fontSize: 12, lineHeight: 17, fontFamily: "Inter_500Medium" },
  inlineActions: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 2 },
  actionButton: { minHeight: 50, borderRadius: 16, backgroundColor: "#7c3aed", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 16 },
  actionButtonCompact: { minHeight: 44 },
  actionButtonText: { color: "#fff", fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  noneButton: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 15, borderWidth: 1, borderColor: "rgba(148,163,184,0.18)", paddingHorizontal: 12 },
  noneButtonSelected: { borderColor: "rgba(34,197,94,0.35)", backgroundColor: "rgba(34,197,94,0.10)" },
  noneText: { color: "#94a3b8", fontSize: 11, fontFamily: "Inter_700Bold" },
  noneTextSelected: { color: "#bbf7d0" },
  fieldRow: { flexDirection: "row", gap: 12 },
  fieldRowMobile: { flexDirection: "column" },
  fieldWrap: { flex: 1 },
  fieldLabel: { color: "#94a3b8", fontSize: 10, letterSpacing: 0.6, textTransform: "uppercase", fontFamily: "Inter_800ExtraBold", marginBottom: 6 },
  input: { minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: "#1e293b", backgroundColor: "#020617", color: "#f8fafc", paddingHorizontal: 13, fontSize: 16, fontFamily: "Inter_700Bold" },
  reviewRow: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 9, borderBottomWidth: 1, borderBottomColor: "rgba(148,163,184,0.10)" },
  reviewLabel: { flex: 1, color: "#cbd5e1", fontSize: 12, fontFamily: "Inter_700Bold" },
  reviewValue: { color: "#f8fafc", fontSize: 12, textAlign: "right", fontFamily: "Inter_800ExtraBold" },
  secondaryLink: { minHeight: 44, borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: "rgba(196,181,253,0.22)" },
  secondaryLinkText: { color: "#c4b5fd", fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  inviteBox: { borderRadius: 16, padding: 12, gap: 10, backgroundColor: "rgba(2,6,23,0.4)" },
  inviteCopy: { color: "#94a3b8", fontSize: 12, lineHeight: 17, fontFamily: "Inter_500Medium" },
  inviteCode: { color: "#bae6fd", fontSize: 21, letterSpacing: 3, textAlign: "center", fontFamily: "Inter_800ExtraBold" },
  inviteMessage: { color: "#cbd5e1", fontSize: 11, lineHeight: 16, textAlign: "center", fontFamily: "Inter_600SemiBold" },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 40, borderTopWidth: 1, borderTopColor: "rgba(148,163,184,0.14)", backgroundColor: "rgba(5,7,17,0.97)", paddingHorizontal: 14, paddingTop: 12 },
  footerDesktop: { paddingHorizontal: 22 },
  footerInner: { width: "100%", flexDirection: "row", alignItems: "center", gap: 9 },
  footerInnerDesktop: { maxWidth: 1120, alignSelf: "center", paddingLeft: 322 },
  backButton: { minWidth: 88, minHeight: 48, borderRadius: 16, borderWidth: 1, borderColor: "rgba(148,163,184,0.20)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  backText: { color: "#cbd5e1", fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  primaryButton: { flex: 1, minHeight: 50, borderRadius: 17, backgroundColor: "#8b5cf6", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryText: { color: "#fff", fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  leaveButton: { minHeight: 48, minWidth: 84, alignItems: "center", justifyContent: "center" },
  leaveText: { color: "#38bdf8", fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  disabled: { opacity: 0.42 },
});
