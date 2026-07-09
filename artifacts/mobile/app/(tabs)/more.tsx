import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert, Modal, Platform, Pressable, ScrollView, StyleSheet,
  Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountModal } from "@/components/AccountModal";
import { AppText } from "@/components/AppText";
import { FloLogo } from "@/components/FloLogo";
import { IncomeModal } from "@/components/IncomeModal";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { PWA_INSTALL_EVENT } from "@/components/PwaInstallPrompt";
import colors from "@/constants/colors";
import type { Account, IncomeItem } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useAuth } from "@/context/AuthContext";
import { type AppFontStyle, type ThemeMode, useThemeMode } from "@/context/ThemeContext";
import { useColors } from "@/hooks/useColors";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { parseStatementCsv } from "@/lib/accounts";
import {
  ALGORITHM_CATALOG,
  type AlgorithmId,
} from "@/lib/algorithmCatalog";
import { loadDecisionHubSettings, readDecisionHubSettings, saveDecisionHubSettings, type DecisionHubSettings } from "@/lib/decisionHubSettings";
import { resetFloMemory } from "@/lib/flo";
import { startLearningTour } from "@/lib/learningTour";
import { confirmAction } from "@/lib/confirmAction";
import {
  type HouseholdInviteRole,
  householdAssignableRolesFor,
  householdInviteRolesFor,
  householdRoleLabel,
} from "@/lib/householdPermissions";
import { loadOnboardingPreferences, readOnboardingPreferences } from "@/lib/onboardingPreferences";
import { buildSetupPersonalization } from "@/lib/onboardingPersonalization";
import { clearStoredSetupStep } from "@/lib/setupProgress";
import { supabase } from "@/lib/supabase";
import {
  type AppFeedbackRow,
  type FeedbackStatus,
  type FeedbackType,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  canSubmitFeedback,
  feedbackStatusLabel,
  sanitizeFeedbackMessage,
} from "@/lib/feedback";
import {
  buildChildMoneySummary,
  buildGoalFundingPlans,
  buildReportsSummary,
  buildReviewQueue,
  buildSmartReminders,
  detectSubscriptions,
  evaluateForecastReadiness,
  evaluatePlaidConnectionStatus,
  type TransactionRule,
} from "@/lib/competitiveGrowth";

const FREQ_LABELS: Record<string, string> = { monthly: "Monthly", biweekly: "Biweekly", weekly: "Weekly" };

const THEME_OPTIONS: { label: string; value: ThemeMode; icon: string }[] = [
  { label: "Light", value: "light", icon: "sun" },
  { label: "Dark",  value: "dark",  icon: "moon" },
  { label: "Auto",  value: "auto",  icon: "smartphone" },
];

const FONT_OPTIONS: { label: string; value: AppFontStyle; icon: string; desc: string }[] = [
  { label: "Flow", value: "default", icon: "type", desc: "Clean and balanced for everyday planning." },
  { label: "Elegant", value: "elegant", icon: "feather", desc: "A softer, polished feel." },
  { label: "Bold", value: "bold", icon: "bold", desc: "Blocky and high-contrast." },
  { label: "Playful", value: "playful", icon: "smile", desc: "Friendly and fun." },
  { label: "Soft", value: "soft", icon: "heart", desc: "Gentle and rounded." },
];

const BACKUP_COMPLETE_KEY = "flowledger_backup_exported";
type AlgorithmCatalogItem = typeof ALGORITHM_CATALOG[number];
type SettingsSectionId =
  | "overview"
  | "setup"
  | "appearance"
  | "algorithms"
  | "accounts"
  | "money"
  | "review"
  | "subscriptions"
  | "reports"
  | "goals"
  | "plaid"
  | "children"
  | "help"
  | "backup"
  | "security"
  | "legal";

const SETTINGS_SECTIONS: Array<{
  id: Exclude<SettingsSectionId, "overview">;
  label: string;
  description: string;
  icon: string;
}> = [
  { id: "setup", label: "Setup walkthrough", description: "Restart Flo setup, learning mode, and onboarding help.", icon: "message-circle" },
  { id: "accounts", label: "Accounts", description: "Manage balances, reconcile accounts, and account health.", icon: "credit-card" },
  { id: "money", label: "Money plan", description: "Income, categories, forecast safety, and payoff method.", icon: "sliders" },
  { id: "review", label: "Review queue", description: "Unclear transactions, categorization rules, duplicates, and imports.", icon: "check-square" },
  { id: "subscriptions", label: "Subscriptions", description: "Find recurring charges, price increases, and cleanup options.", icon: "repeat" },
  { id: "reports", label: "Reports & insights", description: "Spending, debt, goals, cash flow, and what changed.", icon: "bar-chart-2" },
  { id: "goals", label: "Goal funding", description: "Turn goals into safe monthly funding plans.", icon: "target" },
  { id: "plaid", label: "Bank sync", description: "Plaid connection status and safe sync setup.", icon: "link" },
  { id: "algorithms", label: "Algorithm Suite", description: "Turn financial engines on or off and learn what each one does.", icon: "cpu" },
  { id: "appearance", label: "Appearance", description: "Light, dark, or automatic theme settings.", icon: "moon" },
  { id: "children", label: "Child money", description: "Starter child profiles, allowance, limits, and savings goals.", icon: "smile" },
  { id: "help", label: "Help & Feedback", description: "Send tester feedback and review the feedback inbox.", icon: "message-square" },
  { id: "backup", label: "Backup, import, and install", description: "CSV backup, statement import, app install, and Flo memory.", icon: "download" },
  { id: "security", label: "Security and profile", description: "View the signed-in account and sign out.", icon: "lock" },
  { id: "legal", label: "Legal", description: "Terms, privacy, and data-use notes.", icon: "file-text" },
];

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function formatMemberDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function formatActivityTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function humanizeEntityType(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function activitySentence(action: string, entityType: string, entityLabel?: string | null) {
  const item = entityLabel || humanizeEntityType(entityType);
  switch (action) {
    case "created": return `created ${item}`;
    case "updated": return `updated ${item}`;
    case "deleted": return `removed ${item}`;
    case "joined": return "joined the household";
    case "invited": return `created a ${item} invite`;
    case "changed_role": return `changed access for ${item}`;
    case "removed": return `removed ${item} from the household`;
    default: return `${action.replace(/_/g, " ")} ${item}`.trim();
  }
}

export default function MoreScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const routeParams = useLocalSearchParams<{ section?: string }>();
  const {
    themeMode,
    setThemeMode,
    fontStyle,
    setFontStyle,
    lightningFlashesEnabled,
    setLightningFlashesEnabled,
  } = useThemeMode();
  const { signOut, user } = useAuth();
  const {
    bills, transactions, overrides, incomes, goals, importBills, settings, updateSettings, accounts, forecastConfidence,
    addIncome, updateIncome, deleteIncome, getMonthlyIncome,
    categories, addCategory, updateCategory, deleteCategory,
    addAccount, updateAccount, reconcileAccount, archiveAccount, importStatementTransactions,
    households, householdMembers, householdActivity, activeHousehold, householdRole, canEditHousehold,
    refreshHouseholds, refreshHouseholdActivity, switchHousehold, createHouseholdInvite, acceptHouseholdInvite,
    updateHouseholdMemberRole, removeHouseholdMember,
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
  const [onboardingPreferences, setOnboardingPreferences] = useState(() => readOnboardingPreferences());
  const [selectedAlgorithm, setSelectedAlgorithm] = useState<AlgorithmCatalogItem | null>(null);
  useBackDismiss(Boolean(selectedAlgorithm), () => setSelectedAlgorithm(null));
  const [legalDoc, setLegalDoc] = useState<"terms" | "privacy" | null>(null);
  useBackDismiss(Boolean(legalDoc), () => setLegalDoc(null));
  const [showAlgorithmSuite, setShowAlgorithmSuite] = useState(false);
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>("overview");
  useBackDismiss(activeSettingsSection !== "overview", () => setActiveSettingsSection("overview"));
  const [householdInviteRole, setHouseholdInviteRole] = useState<HouseholdInviteRole>("editor");
  const [householdInviteCode, setHouseholdInviteCode] = useState("");
  const [householdJoinCode, setHouseholdJoinCode] = useState("");
  const [householdBusy, setHouseholdBusy] = useState(false);
  const [householdMessage, setHouseholdMessage] = useState<string | null>(null);
  const [feedbackType, setFeedbackType] = useState<FeedbackType>("bug");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackRating, setFeedbackRating] = useState<number | null>(null);
  const [feedbackCanContact, setFeedbackCanContact] = useState(true);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const [feedbackAdmin, setFeedbackAdmin] = useState(false);
  const [feedbackInbox, setFeedbackInbox] = useState<AppFeedbackRow[]>([]);
  const [feedbackInboxLoading, setFeedbackInboxLoading] = useState(false);
  const [feedbackStatusFilter, setFeedbackStatusFilter] = useState<FeedbackStatus | "all">("all");
  const [transactionRules, setTransactionRules] = useState<TransactionRule[]>([]);
  const [plaidServerStatus, setPlaidServerStatus] = useState<{
    configured: boolean;
    storageReady: boolean;
    message: string;
  } | null>(null);
  const [backupExported, setBackupExported] = useState(() => {
    try { return Platform.OS === "web" && globalThis.localStorage?.getItem(BACKUP_COMPLETE_KEY) === "true"; }
    catch { return false; }
  });
  const [signingOut, setSigningOut] = useState(false);
  const inviteRoles = useMemo(() => householdInviteRolesFor(activeHousehold?.role), [activeHousehold?.role]);
  const transactionRuleStorageKey = user?.id ? `flowledger_transaction_rules_${user.id}` : "flowledger_transaction_rules_guest";

  useEffect(() => {
    const requestedSection = Array.isArray(routeParams.section) ? routeParams.section[0] : routeParams.section;
    if (!requestedSection) return;
    if (SETTINGS_SECTIONS.some(section => section.id === requestedSection)) {
      setActiveSettingsSection(requestedSection as SettingsSectionId);
    }
  }, [routeParams.section]);

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

  useEffect(() => {
    let cancelled = false;
    void loadOnboardingPreferences(user?.id).then(next => {
      if (!cancelled) setOnboardingPreferences(next);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(transactionRuleStorageKey)
      .then(value => {
        if (cancelled) return;
        if (!value) {
          setTransactionRules([]);
          return;
        }
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) setTransactionRules(parsed);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [transactionRuleStorageKey]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    let cancelled = false;
    fetch("/api/plaid/status")
      .then(response => response.ok ? response.json() : null)
      .then(payload => {
        if (cancelled || !payload) return;
        setPlaidServerStatus({
          configured: Boolean(payload.configured),
          storageReady: Boolean(payload.storageReady),
          message: typeof payload.message === "string" ? payload.message : "Bank sync status loaded.",
        });
      })
      .catch(() => {
        if (!cancelled) {
          setPlaidServerStatus({
            configured: false,
            storageReady: false,
            message: "Bank sync endpoints are not reachable yet.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setFeedbackAdmin(false);
      setFeedbackInbox([]);
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      try {
        const { data } = await supabase
          .from("feedback_admins")
          .select("user_id")
          .eq("user_id", user.id)
          .maybeSingle();
        if (!cancelled) setFeedbackAdmin(Boolean(data));
      } catch {
        if (!cancelled) setFeedbackAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (inviteRoles.length > 0 && !inviteRoles.includes(householdInviteRole)) {
      setHouseholdInviteRole(inviteRoles[0]);
    }
  }, [householdInviteRole, inviteRoles]);

  const loadFeedbackInbox = async () => {
    if (!feedbackAdmin) return;
    setFeedbackInboxLoading(true);
    try {
      let query = supabase
        .from("app_feedback")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(75);
      if (feedbackStatusFilter !== "all") {
        query = query.eq("status", feedbackStatusFilter);
      }
      const { data, error } = await query;
      if (error) throw error;
      setFeedbackInbox((data ?? []) as AppFeedbackRow[]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load feedback.";
      setFeedbackNotice(message);
    } finally {
      setFeedbackInboxLoading(false);
    }
  };

  useEffect(() => {
    if (activeSettingsSection === "help" && feedbackAdmin) {
      void loadFeedbackInbox();
    }
  }, [activeSettingsSection, feedbackAdmin, feedbackStatusFilter]);

  const saveSafetySettings = () => {
    const floor = Math.max(0, parseFloat(safetyFloorText) || 0);
    const horizon = Math.min(24, Math.max(1, Math.round(parseFloat(forecastHorizonText) || 6)));
    setSafetyFloorText(floor.toString());
    setForecastHorizonText(horizon.toString());
    updateSettings({ safety_floor: floor, forecast_horizon_months: horizon });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleSubmitFeedback = async () => {
    if (!user?.id) {
      setFeedbackNotice("Sign in before sending feedback.");
      return;
    }
    const message = sanitizeFeedbackMessage(feedbackMessage);
    if (!canSubmitFeedback(message)) {
      setFeedbackNotice("Add a little more detail before sending.");
      return;
    }
    setFeedbackSubmitting(true);
    setFeedbackNotice(null);
    try {
      const userMeta = (user as any)?.user_metadata ?? {};
      const { error } = await supabase.from("app_feedback").insert({
        user_id: user.id,
        user_email: user.email ?? null,
        user_name: userMeta.full_name ?? userMeta.name ?? null,
        feedback_type: feedbackType,
        screen: "Settings / Help & Feedback",
        message,
        rating: feedbackRating,
        can_contact: feedbackCanContact,
        app_version: process.env.EXPO_PUBLIC_APP_VERSION ?? null,
        platform: Platform.OS,
      });
      if (error) throw error;
      setFeedbackMessage("");
      setFeedbackRating(null);
      setFeedbackType("bug");
      setFeedbackNotice("Thank you for your feedback. It’s appreciated and will be reviewed.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (feedbackAdmin) void loadFeedbackInbox();
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Could not send feedback.";
      setFeedbackNotice(messageText);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const handleFeedbackStatusChange = async (feedbackId: string, status: FeedbackStatus) => {
    setFeedbackNotice(null);
    try {
      const { error } = await supabase
        .from("app_feedback")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", feedbackId);
      if (error) throw error;
      setFeedbackInbox(items => items.map(item => item.id === feedbackId ? { ...item, status } : item));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Could not update feedback.";
      setFeedbackNotice(messageText);
    }
  };

  const buildCodexFeedbackPrompt = (item: AppFeedbackRow) => {
    const typeLabel = FEEDBACK_TYPES.find(type => type.id === item.feedback_type)?.label ?? "Feedback";
    return [
      "FlowLedger tester feedback to review:",
      "",
      `Type: ${typeLabel}`,
      `Status: ${feedbackStatusLabel(item.status)}`,
      `From: ${item.user_email ?? "Unknown user"}`,
      `Screen: ${item.screen ?? "Unknown screen"}`,
      item.rating ? `Rating: ${item.rating}/5` : null,
      "",
      "Feedback:",
      item.message,
      "",
      "Please help me turn this into a clear update plan for FlowLedger. Include likely cause, recommended fix, test steps, and rollout/rollback notes.",
    ].filter(Boolean).join("\n");
  };

  const handleCopyFeedbackForCodex = async (item: AppFeedbackRow) => {
    const prompt = buildCodexFeedbackPrompt(item);
    try {
      if (Platform.OS === "web" && globalThis.navigator?.clipboard) {
        await globalThis.navigator.clipboard.writeText(prompt);
        setFeedbackNotice("Codex plan prompt copied. Paste it here and we’ll turn it into an update plan.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      }
      setFeedbackNotice("Copy is not available on this device. Open this feedback and paste it into Codex manually.");
    } catch {
      setFeedbackNotice("Could not copy the Codex prompt. Try again.");
    }
  };

  const handleDeleteFeedback = (item: AppFeedbackRow) => {
    confirmAction({
      title: "Delete feedback?",
      message: "This removes the tester feedback from the admin inbox. This cannot be undone.",
      confirmText: "Delete",
      destructive: true,
      onConfirm: async () => {
        setFeedbackNotice(null);
        try {
          const { error } = await supabase
            .from("app_feedback")
            .delete()
            .eq("id", item.id);
          if (error) throw error;
          setFeedbackInbox(items => items.filter(feedback => feedback.id !== item.id));
          setFeedbackNotice("Feedback deleted.");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (error) {
          const messageText = error instanceof Error ? error.message : "Could not delete feedback.";
          setFeedbackNotice(messageText);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      },
    });
  };

  const handleCreateHouseholdInvite = async () => {
    setHouseholdBusy(true);
    setHouseholdMessage(null);
    try {
      const code = await createHouseholdInvite(householdInviteRole);
      setHouseholdInviteCode(code);
      setHouseholdMessage(`${householdRoleLabel(householdInviteRole)} invite created. Share this code with the person you want to add.`);
      if (Platform.OS === "web" && globalThis.navigator?.clipboard) {
        await globalThis.navigator.clipboard.writeText(code).catch(() => undefined);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn’t create invite code. Try again.";
      setHouseholdMessage(message);
      Alert.alert("Household invite", message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setHouseholdBusy(false);
    }
  };

  const handleJoinHousehold = async () => {
    const code = householdJoinCode.trim();
    if (!code) return;
    setHouseholdBusy(true);
    setHouseholdMessage(null);
    try {
      await acceptHouseholdInvite(code);
      await refreshHouseholds();
      setHouseholdJoinCode("");
      setHouseholdMessage("Household joined. FlowLedger is now showing that household plan.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn’t join that household. Try again.";
      setHouseholdMessage(message);
      Alert.alert("Join household", message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setHouseholdBusy(false);
    }
  };

  const handleUpdateHouseholdRole = async (memberUserId: string, role: HouseholdInviteRole) => {
    setHouseholdBusy(true);
    setHouseholdMessage(null);
    try {
      await updateHouseholdMemberRole(memberUserId, role);
      setHouseholdMessage(`${householdRoleLabel(role)} access saved.`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update member access.";
      setHouseholdMessage(message);
      Alert.alert("Household member", message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setHouseholdBusy(false);
    }
  };

  const handleRemoveHouseholdMember = (memberUserId: string, label: string) => {
    Alert.alert("Remove household member?", `${label} will no longer see this household plan.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setHouseholdBusy(true);
          setHouseholdMessage(null);
          try {
            await removeHouseholdMember(memberUserId);
            setHouseholdMessage(`${label} was removed from this household.`);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Could not remove that member.";
            setHouseholdMessage(message);
            Alert.alert("Household member", message);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          } finally {
            setHouseholdBusy(false);
          }
        },
      },
    ]);
  };

  const updateDecisionHubSetting = (next: Partial<DecisionHubSettings>) => {
    const merged = { ...decisionHubSettings, ...next };
    setDecisionHubSettings(merged);
    void saveDecisionHubSettings(user?.id, merged).catch(() => undefined);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };
  const updateAlgorithmToggle = (algorithmId: AlgorithmId, enabled: boolean) => {
    updateDecisionHubSetting({
      algorithmToggles: {
        ...decisionHubSettings.algorithmToggles,
        [algorithmId]: enabled,
      },
    });
  };

  const totalMonthlyIncome = getMonthlyIncome();
  const setupPersonalization = useMemo(
    () => buildSetupPersonalization(onboardingPreferences),
    [onboardingPreferences],
  );
  const hasSetupAnswers = onboardingPreferences.help.length > 0 || onboardingPreferences.goals.length > 0 || Boolean(onboardingPreferences.savingsGoal);
  const setupSteps = [
    { key: "account", label: "What account should I track first?", detail: "Tell me about your checking, savings, or cash account so I know where your money starts.", done: accounts.some(account => account.is_active), action: "Answer" },
    { key: "money", label: "How much money is in that account today?", detail: "Give me the current balance and date so my forecast starts from the right number.", done: accounts.some(account => account.is_active && Math.abs(account.current_balance) > 0), action: "Answer" },
    { key: "income", label: "When does money come in?", detail: "Add paychecks, side income, or recurring deposits so I can look ahead.", done: incomes.length > 0, action: "Answer" },
    { key: "bills", label: "Which bills need to be paid?", detail: "Add recurring bills and due days so I can protect the month before decisions.", done: bills.some(bill => bill.is_recurring && !bill.is_debt), action: "Answer" },
    { key: "debts", label: "What debts should I include?", detail: "Add balances, minimums, APRs, and snowball settings so payoff advice is accurate.", done: bills.some(bill => bill.is_debt), action: "Answer" },
    { key: "safety", label: "How much cushion should I protect?", detail: `Right now I protect $${settings.safety_floor.toFixed(0)} across ${settings.forecast_horizon_months} months.`, done: settings.safety_floor >= 0 && settings.forecast_horizon_months > 0, action: "Review" },
    { key: "reconcile", label: "Can we confirm the balance matches your bank?", detail: "Reconcile once so you can trust the forecast before making decisions.", done: forecastConfidence.level === "high" || accounts.some(account => account.last_reconciled_at), action: "Answer" },
    { key: "backup", label: "Want to save a backup before we move on?", detail: "Export a CSV backup after setup so your data has a safety net.", done: backupExported, action: "Export" },
  ];
  const setupComplete = setupSteps.filter(step => step.done).length;
  const currentSetupStep = setupSteps.find(step => !step.done) ?? setupSteps[setupSteps.length - 1];
  const setupIsComplete = settings.onboarding_completed || setupComplete >= setupSteps.length;
  const shouldShowFloSetup = !setupIsComplete;
  const currentMonthPrefix = new Date().toISOString().slice(0, 7);
  const accountMonthDeltas = useMemo(() => {
    const deltas = new Map<string, number>();
    transactions.forEach(transaction => {
      if (!transaction.account_id || !transaction.date.startsWith(currentMonthPrefix)) return;
      deltas.set(transaction.account_id, (deltas.get(transaction.account_id) ?? 0) + transaction.amount);
    });
    return deltas;
  }, [transactions, currentMonthPrefix]);
  const todayIso = new Date().toISOString().slice(0, 10);
  const activeAccounts = useMemo(() => accounts.filter(account => account.is_active), [accounts]);
  const growthTransactions = useMemo(() => transactions.map(transaction => ({
    id: transaction.id,
    date: transaction.date,
    amount: transaction.amount,
    description: transaction.note?.trim() || transaction.category || "Transaction",
    category: transaction.category,
    accountId: transaction.account_id,
    importHash: transaction.import_hash,
    source: transaction.import_hash ? "import" as const
      : transaction.debt_applied_bill_id ? "debt" as const
      : transaction.linked_bill_id ? "bill" as const
      : "manual" as const,
    linkedBillId: transaction.linked_bill_id ?? transaction.debt_applied_bill_id ?? null,
  })), [transactions]);
  const growthBills = useMemo(() => bills.map(bill => ({
    id: bill.id,
    name: bill.name,
    amount: bill.amount,
    category: bill.category,
    dueDay: bill.due_day,
    isDebt: bill.is_debt,
    isRecurring: bill.is_recurring,
    stopped: Boolean(bill.end_date && bill.end_date < todayIso),
  })), [bills, todayIso]);
  const growthDebts = useMemo(() => bills.filter(bill => bill.is_debt).map(bill => ({
    id: bill.id,
    name: bill.name,
    balance: Math.max(0, bill.balance),
    minimumPayment: Math.max(0, bill.amount),
    apr: bill.interest_rate,
    dueDay: bill.due_day,
    includeInSnowball: bill.include_in_snowball !== false,
  })), [bills]);
  const growthGoals = useMemo(() => goals.map(goal => ({
    id: goal.id,
    name: goal.name,
    targetAmount: goal.target_amount,
    currentAmount: goal.current_amount,
    targetDate: goal.target_date,
    type: goal.goal_type === "planned_expense" ? "other" as const : goal.goal_type,
  })), [goals]);
  const reviewQueue = useMemo(() => buildReviewQueue(growthTransactions, transactionRules), [growthTransactions, transactionRules]);
  const reviewTransactions = useMemo(() => {
    const byId = new Map(growthTransactions.map(transaction => [transaction.id, transaction]));
    return reviewQueue.map(item => ({ item, transaction: byId.get(item.transactionId) })).filter(entry => entry.transaction);
  }, [growthTransactions, reviewQueue]);
  const subscriptions = useMemo(() => detectSubscriptions(growthTransactions), [growthTransactions]);
  const monthlyRecurringBills = useMemo(
    () => bills.filter(bill => bill.is_recurring !== false && !bill.is_debt && !(bill.end_date && bill.end_date < todayIso)).reduce((sum, bill) => sum + Math.max(0, bill.amount), 0),
    [bills, todayIso],
  );
  const safeMonthlyGoalFunding = useMemo(
    () => Math.max(0, Math.round((totalMonthlyIncome - monthlyRecurringBills) * 0.1)),
    [monthlyRecurringBills, totalMonthlyIncome],
  );
  const goalFundingPlans = useMemo(
    () => buildGoalFundingPlans(growthGoals, safeMonthlyGoalFunding),
    [growthGoals, safeMonthlyGoalFunding],
  );
  const reportsSummary = useMemo(
    () => buildReportsSummary(growthTransactions, growthBills, growthDebts, growthGoals),
    [growthBills, growthDebts, growthGoals, growthTransactions],
  );
  const forecastReadiness = useMemo(() => {
    const wantsDebt = onboardingPreferences.goals.includes("pay_off_debt") || bills.some(bill => bill.is_debt);
    const wantsSavings = onboardingPreferences.goals.includes("grow_savings") || goals.length > 0;
    const recentlyReconciled = activeAccounts.some(account => {
      const reviewed = account.last_reconciled_at ?? account.balance_as_of;
      const age = Math.floor((Date.now() - new Date(reviewed).getTime()) / 86_400_000);
      return Number.isFinite(age) && age <= 31;
    });
    return evaluateForecastReadiness({
      accounts: activeAccounts.length,
      hasCurrentBalance: activeAccounts.some(account => Number.isFinite(account.current_balance)),
      incomes: incomes.length,
      recurringBills: bills.filter(bill => bill.is_recurring && !bill.is_debt).length,
      debts: growthDebts.length,
      goals: goals.length,
      debtPayoffSelected: wantsDebt,
      savingsSelected: wantsSavings,
      safetyFloorReviewed: settings.safety_floor >= 0,
      firstForecastViewed: true,
      reconciledRecently: recentlyReconciled,
    });
  }, [activeAccounts, bills, goals.length, growthDebts.length, incomes.length, onboardingPreferences.goals, settings.safety_floor]);
  const smartReminders = useMemo(() => buildSmartReminders({
    today: todayIso,
    bills: growthBills,
    reviewCount: reviewQueue.length,
    subscriptionIncreases: subscriptions.filter(subscription => subscription.priceIncrease).length,
    lowestBalance: null,
    safetyFloor: settings.safety_floor,
    goals: goalFundingPlans,
    needsReconcile: forecastReadiness.missing.includes("Reconcile an account"),
  }), [forecastReadiness.missing, goalFundingPlans, growthBills, reviewQueue.length, settings.safety_floor, subscriptions, todayIso]);
  const plaidStatus = useMemo(() => evaluatePlaidConnectionStatus({
    clientName: "FlowLedger Algo",
    hasServerTokenEndpoint: Boolean(plaidServerStatus?.configured),
    hasExchangeEndpoint: Boolean(plaidServerStatus?.configured),
    hasWebhookEndpoint: Boolean(plaidServerStatus?.storageReady),
  }), [plaidServerStatus?.configured, plaidServerStatus?.storageReady]);
  const childMoneySummary = useMemo(() => buildChildMoneySummary([]), []);

  const saveTransactionRules = async (next: TransactionRule[]) => {
    setTransactionRules(next);
    await AsyncStorage.setItem(transactionRuleStorageKey, JSON.stringify(next)).catch(() => undefined);
  };

  const handleCreateRuleFromReview = (transactionId: string) => {
    const transaction = growthTransactions.find(item => item.id === transactionId);
    if (!transaction) return;
    const merchant = (transaction.description || "Transaction").trim();
    const nextRule: TransactionRule = {
      id: `rule-${Date.now()}`,
      name: `Remember ${merchant.slice(0, 28)}`,
      matchType: "contains",
      matchValue: merchant,
      direction: transaction.amount >= 0 ? "income" : "expense",
      category: transaction.category && transaction.category !== "Other" ? transaction.category : "Other",
      priority: 10,
      isActive: true,
    };
    void saveTransactionRules([nextRule, ...transactionRules]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

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
    confirmAction({
      title: "Delete Income",
      message: `Remove "${item.name}"?`,
      confirmText: "Delete",
      destructive: true,
      onConfirm: doDelete,
    });
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
    const msg = inUse > 0
      ? `"${name}" is used by ${inUse} item(s). They will be reassigned to "Other".`
      : `Delete category "${name}"?`;
    confirmAction({
      title: "Delete Category",
      message: msg,
      confirmText: "Delete",
      destructive: true,
      onConfirm: doDelete,
    });
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

  const webTopPad = Platform.OS === "web" ? 4 : 0;
  const activeSettingsMeta = SETTINGS_SECTIONS.find(section => section.id === activeSettingsSection);

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <PremiumBackdrop variant="blue" />
      <ScrollView
        style={styles.scroller}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 + webTopPad, paddingBottom: insets.bottom + 100 }]}
      >
      {activeSettingsSection === "overview" ? (
        <>
          <Text style={[styles.pageTitle, { color: c.foreground }]}>Settings</Text>
          <View style={styles.settingsSectionList}>
            {SETTINGS_SECTIONS.map(section => (
              <Pressable
                key={section.id}
                onPress={() => {
                  if (section.id === "algorithms") setShowAlgorithmSuite(true);
                  setActiveSettingsSection(section.id);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                style={({ pressed }) => [
                  styles.settingsSectionCard,
                  { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.76 : 1 },
                ]}
              >
                <View style={[styles.settingsSectionIcon, { backgroundColor: c.primary + "16" }]}>
                  <Feather name={section.icon as any} size={20} color={c.primary} />
                </View>
                <View style={styles.settingsSectionCopy}>
                  <Text style={[styles.settingsSectionTitle, { color: c.foreground }]}>{section.label}</Text>
                  <Text style={[styles.settingsSectionDesc, { color: c.mutedForeground }]}>{section.description}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={c.mutedForeground} />
              </Pressable>
            ))}
          </View>
        </>
      ) : (
        <>
          <Pressable
            onPress={() => setActiveSettingsSection("overview")}
            style={({ pressed }) => [styles.settingsBackRow, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Feather name="chevron-left" size={22} color={c.primary} />
            <Text style={[styles.settingsBackText, { color: c.primary }]}>Settings</Text>
          </Pressable>
          <Text style={[styles.pageTitle, { color: c.foreground }]}>{activeSettingsMeta?.label ?? "Settings"}</Text>
          <Text style={[styles.pageSubtitle, { color: c.mutedForeground }]}>{activeSettingsMeta?.description}</Text>
        </>
      )}

      {activeSettingsSection === "setup" && shouldShowFloSetup && <>
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
            clearStoredSetupStep();
            void updateSettings({ onboarding_completed: false });
            router.push("/setup" as any);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
          style={({ pressed }) => [styles.setupRestartBtn, { borderColor: c.border, opacity: pressed ? 0.75 : 1 }]}
        >
          <Feather name="refresh-cw" size={14} color={c.primary} />
          <Text style={[styles.setupRestartText, { color: c.primary }]}>Restart setup walkthrough for testing</Text>
        </Pressable>
      </View>

      {/* ── Appearance ── */}
      </>}

      {activeSettingsSection === "setup" && !shouldShowFloSetup && (
        <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
          <View style={[styles.confidenceBox, { backgroundColor: c.success + "14" }]}>
            <Feather name="check-circle" size={16} color={c.success} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.accountName, { color: c.foreground }]}>Setup is complete</Text>
              <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>You can restart Flo setup or replay learning mode any time.</Text>
            </View>
          </View>
          <Pressable
            onPress={() => {
              clearStoredSetupStep();
              void updateSettings({ onboarding_completed: false });
              router.push("/setup" as any);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            style={({ pressed }) => [styles.addBtn, { backgroundColor: c.primary + "18", borderRadius: 10, opacity: pressed ? 0.7 : 1 }]}
          >
            <Feather name="refresh-cw" size={16} color={c.primary} />
            <Text style={[styles.addBtnText, { color: c.primary }]}>Restart setup walkthrough</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              startLearningTour();
              router.push("/(tabs)" as any);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            style={({ pressed }) => [styles.addBtn, { backgroundColor: c.muted, borderRadius: 10, opacity: pressed ? 0.7 : 1 }]}
          >
            <Feather name="compass" size={16} color={c.primary} />
            <Text style={[styles.addBtnText, { color: c.primary }]}>Replay learning mode</Text>
          </Pressable>
        </View>
      )}

      {activeSettingsSection === "appearance" && <>
      <SLabel c={c} text="Theme" />
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
      <SLabel c={c} text="Text style" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        {FONT_OPTIONS.map((opt, index) => {
          const active = fontStyle === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => {
                setFontStyle(opt.value);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              style={({ pressed }) => [
                styles.dataRow,
                { borderTopWidth: index ? 1 : 0, borderTopColor: c.border, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <View style={[styles.dataIcon, { backgroundColor: active ? c.primary + "24" : c.muted }]}>
                <Feather name={opt.icon as any} size={17} color={active ? c.primary : c.mutedForeground} />
              </View>
              <View style={styles.dataBody}>
                <AppText tone="title" fontStyleOverride={opt.value} style={[styles.dataLabel, { color: c.foreground }]}>{opt.label}</AppText>
                <AppText fontStyleOverride={opt.value} style={[styles.dataDesc, { color: c.mutedForeground }]}>{opt.desc}</AppText>
              </View>
              <Feather name={active ? "check-circle" : "circle"} size={18} color={active ? c.primary : c.mutedForeground} />
            </Pressable>
          );
        })}
      </View>
      <SLabel c={c} text="Motion & effects" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <Pressable
          onPress={() => {
            setLightningFlashesEnabled(!lightningFlashesEnabled);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
          style={({ pressed }) => [styles.decisionSettingRow, { opacity: pressed ? 0.75 : 1 }]}
        >
          <View style={[styles.dataIcon, { backgroundColor: c.primary + "18" }]}>
            <Feather name="zap" size={17} color={c.primary} />
          </View>
          <View style={styles.switchInfo}>
              <Text style={[styles.switchLabel, { color: c.foreground }]}>Flow shimmer</Text>
              <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>Turn this off if pulsing background motion is uncomfortable.</Text>
          </View>
          <View style={[styles.toggleTrack, { backgroundColor: lightningFlashesEnabled ? c.primary : c.muted }]}>
            <View style={[styles.toggleKnob, { backgroundColor: "#fff", alignSelf: lightningFlashesEnabled ? "flex-end" : "flex-start" }]} />
          </View>
        </Pressable>
      </View>
      </>}

      {activeSettingsSection === "algorithms" && <>
      <SLabel c={c} text="Algorithms" />
      <Pressable
        onPress={() => {
          setShowAlgorithmSuite(current => !current);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }}
        style={({ pressed }) => [styles.settingsLauncher, { backgroundColor: c.card, borderColor: showAlgorithmSuite ? c.primary + "70" : c.border, opacity: pressed ? 0.82 : 1 }]}
      >
        <View style={[styles.dataIcon, { backgroundColor: c.primary + "18" }]}>
          <Feather name="cpu" size={17} color={c.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.switchLabel, { color: c.foreground }]}>Algorithm Suite</Text>
          <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>Focused tools for debt payoff, safer spending, paycheck planning, and extra-money decisions.</Text>
        </View>
        <Feather name={showAlgorithmSuite ? "chevron-up" : "chevron-down"} size={20} color={c.mutedForeground} />
      </Pressable>

      {showAlgorithmSuite && <>
      <SLabel c={c} text="Algorithm Suite" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <Pressable
          onPress={() => updateDecisionHubSetting({ algorithmSuiteEnabled: !decisionHubSettings.algorithmSuiteEnabled })}
          style={({ pressed }) => [styles.decisionSettingRow, { opacity: pressed ? 0.75 : 1 }]}
        >
          <View style={[styles.dataIcon, { backgroundColor: c.primary + "18" }]}>
            <Feather name="cpu" size={17} color={c.primary} />
          </View>
          <View style={styles.switchInfo}>
            <Text style={[styles.switchLabel, { color: c.foreground }]}>FlowLedger Algo</Text>
            <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>
              Deterministic money guidance to protect your floor, route extra cash, and make better debt decisions.
            </Text>
          </View>
          <View style={[styles.toggleTrack, { backgroundColor: decisionHubSettings.algorithmSuiteEnabled ? c.primary : c.muted }]}>
            <View style={[styles.toggleKnob, { backgroundColor: "#fff", alignSelf: decisionHubSettings.algorithmSuiteEnabled ? "flex-end" : "flex-start" }]} />
          </View>
        </Pressable>

        {hasSetupAnswers ? (
          <View style={[styles.algorithmRecommendation, { borderColor: c.primary + "30", backgroundColor: c.primary + "10" }]}>
            <View style={styles.algorithmRecommendationHeader}>
              <Feather name="compass" size={14} color={c.primary} />
              <Text style={[styles.algorithmRecommendationTitle, { color: c.foreground }]}>
                Flo recommends for {setupPersonalization.title.toLowerCase()}
              </Text>
            </View>
            <Text style={[styles.algorithmRecommendationText, { color: c.mutedForeground }]}>
              {setupPersonalization.recommendedAlgorithms
                .map(id => ALGORITHM_CATALOG.find(algorithm => algorithm.id === id)?.name ?? id)
                .slice(0, 4)
                .join(" • ")}
            </Text>
          </View>
        ) : null}

        <View style={[styles.algorithmList, { borderTopColor: c.border }]}>
          {ALGORITHM_CATALOG.map(algorithm => {
            const enabled = decisionHubSettings.algorithmSuiteEnabled && decisionHubSettings.algorithmToggles[algorithm.id] !== false;
            return (
              <Pressable
                key={algorithm.id}
                onPress={() => {
                  setSelectedAlgorithm(algorithm);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                style={({ pressed }) => [styles.algorithmToggleRow, { borderTopColor: c.border, opacity: pressed ? 0.72 : 1 }]}
              >
                <View style={[styles.dataIcon, { backgroundColor: c.primary + "16" }]}>
                  <Feather name={algorithm.icon as any} size={16} color={c.primary} />
                </View>
                <View style={styles.switchInfo}>
                  <Text style={[styles.switchLabel, { color: c.foreground }]}>{algorithm.name}</Text>
                </View>
                <Pressable
                  onPress={(event) => {
                    event.stopPropagation();
                    updateAlgorithmToggle(algorithm.id, !enabled);
                  }}
                  style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                >
                  <View style={[styles.toggleTrack, { backgroundColor: enabled ? c.primary : c.muted }]}>
                    <View style={[styles.toggleKnob, { backgroundColor: "#fff", alignSelf: enabled ? "flex-end" : "flex-start" }]} />
                  </View>
                </Pressable>
              </Pressable>
            );
          })}
        </View>
      </View>
      </>}
      </>}

      {activeSettingsSection === "accounts" && <>
      <SLabel c={c} text="Household" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <View style={styles.householdHeader}>
          <View style={[styles.settingsSectionIcon, { backgroundColor: c.primary + "16" }]}>
            <Feather name="users" size={20} color={c.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.accountName, { color: c.foreground }]}>
              {activeHousehold?.name ?? "Personal household"}
            </Text>
            <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>
              {householdRole ? `${householdRoleLabel(householdRole)} access` : "Your private FlowLedger plan"}
              {canEditHousehold ? " • editing allowed" : " • view only"}
            </Text>
          </View>
        </View>

        {households.length > 1 && (
          <View style={styles.householdChipWrap}>
            {households.map(household => {
              const selected = activeHousehold?.householdId === household.householdId;
              return (
                <Pressable
                  key={household.householdId}
                  onPress={async () => {
                    if (selected || householdBusy) return;
                    setHouseholdBusy(true);
                    setHouseholdMessage(null);
                    try {
                      await switchHousehold(household.householdId);
                      setHouseholdMessage(`Switched to ${household.name}.`);
                    } catch (error) {
                      const message = error instanceof Error ? error.message : "Could not switch households.";
                      setHouseholdMessage(message);
                    } finally {
                      setHouseholdBusy(false);
                    }
                  }}
                  style={({ pressed }) => [
                    styles.householdChip,
                    {
                      backgroundColor: selected ? c.primary : c.muted,
                      borderColor: selected ? c.primary : c.border,
                      opacity: pressed ? 0.76 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.householdChipText, { color: selected ? c.primaryForeground : c.foreground }]}>
                    {household.isPersonal ? "Personal" : household.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={[styles.householdPanel, { backgroundColor: c.muted, borderColor: c.border }]}>
          <View style={styles.householdPanelHeader}>
            <View>
              <Text style={[styles.householdPanelTitle, { color: c.foreground }]}>Members</Text>
              <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>Everyone here sees the same household plan.</Text>
            </View>
            <Pressable onPress={refreshHouseholds} disabled={householdBusy} hitSlop={10} style={({ pressed }) => ({ opacity: pressed || householdBusy ? 0.6 : 1 })}>
              <Feather name="refresh-cw" size={16} color={c.primary} />
            </Pressable>
          </View>
          {householdMembers.length === 0 ? (
            <Text style={[styles.emptyText, { color: c.mutedForeground }]}>Members will show here after the household syncs.</Text>
          ) : householdMembers.map(member => {
            const label = member.displayName || member.email || `Member ${member.userId.slice(0, 6)}`;
            const assignableRoles = householdAssignableRolesFor(activeHousehold?.role, member.role, member.isCurrentUser);
            return (
              <View key={member.userId} style={[styles.memberRow, { borderTopColor: c.border }]}>
                <View style={[styles.memberAvatar, { backgroundColor: member.role === "owner" ? c.primary + "24" : c.card }]}>
                  <Feather name={member.role === "owner" ? "star" : "user"} size={15} color={member.role === "owner" ? c.primary : c.mutedForeground} />
                </View>
                <View style={styles.memberInfo}>
                  <Text style={[styles.memberName, { color: c.foreground }]} numberOfLines={1}>
                    {label}{member.isCurrentUser ? " (you)" : ""}
                  </Text>
                  <Text style={[styles.memberMeta, { color: c.mutedForeground }]}>
                    {householdRoleLabel(member.role)}
                    {member.joinedAt ? ` • joined ${formatMemberDate(member.joinedAt)}` : ""}
                  </Text>
                </View>
                {assignableRoles.length > 0 && (
                  <View style={styles.memberActions}>
                    {assignableRoles.map(role => (
                      <Pressable
                        key={role}
                        onPress={() => handleUpdateHouseholdRole(member.userId, role)}
                        disabled={householdBusy}
                        style={[styles.memberActionPill, { backgroundColor: c.primary + "16" }]}
                      >
                        <Text style={[styles.memberActionText, { color: c.primary }]}>{householdRoleLabel(role)}</Text>
                      </Pressable>
                    ))}
                    <Pressable onPress={() => handleRemoveHouseholdMember(member.userId, label)} disabled={householdBusy} hitSlop={8}>
                      <Feather name="x" size={17} color={c.destructive} />
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        <View style={[styles.householdPanel, { backgroundColor: c.muted, borderColor: c.border }]}>
          <Text style={[styles.householdPanelTitle, { color: c.foreground }]}>Share this household</Text>
          <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>
            Invite someone to the active household. They’ll only see this household’s plan, not code, keys, or admin tools.
          </Text>
          {inviteRoles.length > 0 ? (
            <>
              <View style={styles.roleRow}>
                {inviteRoles.map(role => {
                  const selected = householdInviteRole === role;
                  return (
                    <Pressable
                      key={role}
                      onPress={() => setHouseholdInviteRole(role)}
                      style={[
                        styles.roleButton,
                        { backgroundColor: selected ? c.primary : c.card, borderColor: selected ? c.primary : c.border },
                      ]}
                    >
                      <Text style={[styles.roleButtonText, { color: selected ? c.primaryForeground : c.foreground }]}>
                        {householdRoleLabel(role)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable
                onPress={handleCreateHouseholdInvite}
                disabled={householdBusy}
                style={({ pressed }) => [
                  styles.addBtn,
                  { backgroundColor: c.primary + "18", borderRadius: 10, opacity: pressed || householdBusy ? 0.65 : 1 },
                ]}
              >
                <Feather name="send" size={16} color={c.primary} />
                <Text style={[styles.addBtnText, { color: c.primary }]}>Create invite code</Text>
              </Pressable>
              {!!householdInviteCode && (
                <View style={[styles.inviteCodeBox, { backgroundColor: c.card, borderColor: c.border }]}>
                  <Text style={[styles.inviteCodeLabel, { color: c.mutedForeground }]}>Invite code</Text>
                  <Text selectable style={[styles.inviteCodeText, { color: c.foreground }]}>{householdInviteCode}</Text>
                </View>
              )}
            </>
          ) : (
            <Text style={[styles.emptyText, { color: c.mutedForeground }]}>Only household owners and managers can create invite codes.</Text>
          )}
        </View>

        <View style={[styles.householdPanel, { backgroundColor: c.muted, borderColor: c.border }]}>
          <Text style={[styles.householdPanelTitle, { color: c.foreground }]}>Join a household</Text>
          <View style={styles.joinRow}>
            <TextInput
              style={[styles.renameInput, styles.joinInput, { backgroundColor: c.card, color: c.foreground, borderColor: c.border }]}
              value={householdJoinCode}
              onChangeText={text => setHouseholdJoinCode(text.toUpperCase())}
              placeholder="Enter invite code"
              placeholderTextColor={c.mutedForeground}
              autoCapitalize="characters"
              returnKeyType="done"
              onSubmitEditing={handleJoinHousehold}
            />
            <Pressable
              onPress={handleJoinHousehold}
              disabled={householdBusy || !householdJoinCode.trim()}
              style={({ pressed }) => [
                styles.joinButton,
                { backgroundColor: c.primary, opacity: pressed || householdBusy || !householdJoinCode.trim() ? 0.55 : 1 },
              ]}
            >
              <Feather name="log-in" size={16} color={c.primaryForeground} />
            </Pressable>
          </View>
        </View>

        <View style={[styles.householdPanel, { backgroundColor: c.muted, borderColor: c.border }]}>
          <View style={styles.householdPanelHeader}>
            <View>
              <Text style={[styles.householdPanelTitle, { color: c.foreground }]}>Recent activity</Text>
              <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>See who changed what and when.</Text>
            </View>
            <Pressable onPress={refreshHouseholdActivity} disabled={householdBusy} hitSlop={10} style={({ pressed }) => ({ opacity: pressed || householdBusy ? 0.6 : 1 })}>
              <Feather name="refresh-cw" size={16} color={c.primary} />
            </Pressable>
          </View>
          {householdActivity.length === 0 ? (
            <Text style={[styles.emptyText, { color: c.mutedForeground }]}>Household edits will appear here after the activity table is available.</Text>
          ) : householdActivity.slice(0, 12).map(activity => {
            const actor = activity.actorName || activity.actorEmail || "A household member";
            return (
              <View key={activity.id} style={[styles.activityRow, { borderTopColor: c.border }]}>
                <View style={[styles.activityIcon, { backgroundColor: c.primary + "14" }]}>
                  <Feather name={activity.action === "deleted" || activity.action === "removed" ? "trash-2" : "clock"} size={14} color={activity.action === "deleted" || activity.action === "removed" ? c.destructive : c.primary} />
                </View>
                <View style={styles.activityInfo}>
                  <Text style={[styles.activityText, { color: c.foreground }]} numberOfLines={2}>
                    {actor} {activitySentence(activity.action, activity.entityType, activity.entityLabel)}
                  </Text>
                  <Text style={[styles.memberMeta, { color: c.mutedForeground }]}>{formatActivityTime(activity.createdAt)}</Text>
                </View>
              </View>
            );
          })}
        </View>

        {!!householdMessage && (
          <Text style={[styles.householdMessage, { color: /couldn|invalid|expired|required|only/i.test(householdMessage) ? c.destructive : c.success }]}>
            {householdMessage}
          </Text>
        )}
      </View>

      <SLabel c={c} text="Accounts & Balances" />
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
      </>}

      {activeSettingsSection === "money" && <>
      <SLabel c={c} text="Income" />
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
      <SLabel c={c} text="Budget Categories" />
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
      <SLabel c={c} text="Forecast Controls" />
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
      </>}

      {activeSettingsSection === "review" && <>
      <SLabel c={c} text="Forecast Readiness" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <View style={styles.growthHeaderRow}>
          <View style={[styles.growthScoreBubble, { backgroundColor: forecastReadiness.score >= 80 ? c.success + "18" : c.warning + "18" }]}>
            <Text style={[styles.growthScoreText, { color: forecastReadiness.score >= 80 ? c.success : c.warning }]}>{forecastReadiness.score}%</Text>
          </View>
          <View style={styles.growthHeaderCopy}>
            <Text style={[styles.switchLabel, { color: c.foreground }]}>{forecastReadiness.nextStep}</Text>
            <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>{forecastReadiness.whyItMatters}</Text>
          </View>
        </View>
        <View style={[styles.setupProgressTrack, { backgroundColor: c.muted, marginTop: 14 }]}>
          <View style={[styles.setupProgressFill, { backgroundColor: c.primary, width: `${forecastReadiness.score}%` as any }]} />
        </View>
        <Text style={[styles.dataDesc, { color: c.mutedForeground, marginTop: 10 }]}>
          Missing: {forecastReadiness.missing.length ? forecastReadiness.missing.join(", ") : "Nothing major — your forecast is ready."}
        </Text>
      </View>

      <SLabel c={c} text="Transaction Review Queue" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <View style={styles.growthMetricGrid}>
          <View style={[styles.growthMetric, { backgroundColor: c.muted }]}>
            <Text style={[styles.growthMetricValue, { color: c.primary }]}>{reviewQueue.length}</Text>
            <Text style={[styles.growthMetricLabel, { color: c.mutedForeground }]}>Needs review</Text>
          </View>
          <View style={[styles.growthMetric, { backgroundColor: c.muted }]}>
            <Text style={[styles.growthMetricValue, { color: c.success }]}>{transactionRules.length}</Text>
            <Text style={[styles.growthMetricLabel, { color: c.mutedForeground }]}>Rules saved</Text>
          </View>
        </View>
        {reviewTransactions.slice(0, 8).map(({ item, transaction }, index) => (
          <View key={item.transactionId} style={[styles.growthListRow, { borderTopWidth: index ? 1 : 0, borderTopColor: c.border }]}>
            <View style={[styles.dataIcon, { backgroundColor: item.priority === "high" ? c.destructive + "18" : c.primary + "18" }]}>
              <Feather name={item.priority === "high" ? "alert-triangle" : "check-square"} size={17} color={item.priority === "high" ? c.destructive : c.primary} />
            </View>
            <View style={styles.dataBody}>
              <Text style={[styles.dataLabel, { color: c.foreground }]} numberOfLines={1}>{transaction?.description ?? "Transaction"}</Text>
              <Text style={[styles.dataDesc, { color: c.mutedForeground }]}>{item.summary}</Text>
              <Text style={[styles.growthTinyText, { color: c.mutedForeground }]}>{item.reasons.map(reason => reason.replace(/_/g, " ")).join(" • ")}</Text>
            </View>
            <Pressable
              onPress={() => handleCreateRuleFromReview(item.transactionId)}
              style={({ pressed }) => [styles.growthSmallButton, { backgroundColor: c.primary + "18", opacity: pressed ? 0.72 : 1 }]}
            >
              <Text style={[styles.growthSmallButtonText, { color: c.primary }]}>Rule</Text>
            </Pressable>
          </View>
        ))}
        {!reviewTransactions.length && (
          <Text style={[styles.emptyText, { color: c.mutedForeground }]}>Nothing needs review right now. New imports, duplicates, unusual amounts, and unclear categories will show here.</Text>
        )}
      </View>
      </>}

      {activeSettingsSection === "subscriptions" && <>
      <SLabel c={c} text="Subscription Cleanup" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <View style={styles.growthMetricGrid}>
          <View style={[styles.growthMetric, { backgroundColor: c.muted }]}>
            <Text style={[styles.growthMetricValue, { color: c.primary }]}>${subscriptions.reduce((sum, item) => sum + item.monthlyEquivalent, 0).toFixed(0)}</Text>
            <Text style={[styles.growthMetricLabel, { color: c.mutedForeground }]}>Monthly</Text>
          </View>
          <View style={[styles.growthMetric, { backgroundColor: c.muted }]}>
            <Text style={[styles.growthMetricValue, { color: c.warning }]}>{subscriptions.filter(item => item.priceIncrease).length}</Text>
            <Text style={[styles.growthMetricLabel, { color: c.mutedForeground }]}>Price changes</Text>
          </View>
        </View>
        {subscriptions.slice(0, 10).map((subscription, index) => (
          <View key={subscription.merchant} style={[styles.growthListRow, { borderTopWidth: index ? 1 : 0, borderTopColor: c.border }]}>
            <View style={[styles.dataIcon, { backgroundColor: c.warning + "18" }]}>
              <Feather name="repeat" size={17} color={c.warning} />
            </View>
            <View style={styles.dataBody}>
              <Text style={[styles.dataLabel, { color: c.foreground, textTransform: "capitalize" }]} numberOfLines={1}>{subscription.merchant}</Text>
              <Text style={[styles.dataDesc, { color: c.mutedForeground }]}>
                ${subscription.monthlyEquivalent.toFixed(2)}/mo • {subscription.cadence} • {subscription.confidence} confidence
              </Text>
              <Text style={[styles.growthTinyText, { color: subscription.priceIncrease ? c.warning : c.mutedForeground }]}>
                {subscription.priceIncrease ? "Possible price increase. " : ""}{subscription.duplicateRisk ? "Similar service found. " : ""}Review before creating or stopping bills.
              </Text>
            </View>
          </View>
        ))}
        {!subscriptions.length && (
          <Text style={[styles.emptyText, { color: c.mutedForeground }]}>I have not found recurring subscription patterns yet. Repeated monthly or weekly charges will appear here for cleanup.</Text>
        )}
      </View>
      </>}

      {activeSettingsSection === "reports" && <>
      <SLabel c={c} text="Reports & Insights" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <View style={styles.growthMetricGrid}>
          <View style={[styles.growthMetric, { backgroundColor: c.muted }]}>
            <Text style={[styles.growthMetricValue, { color: c.success }]}>${reportsSummary.income.toFixed(0)}</Text>
            <Text style={[styles.growthMetricLabel, { color: c.mutedForeground }]}>Income</Text>
          </View>
          <View style={[styles.growthMetric, { backgroundColor: c.muted }]}>
            <Text style={[styles.growthMetricValue, { color: c.destructive }]}>${reportsSummary.spending.toFixed(0)}</Text>
            <Text style={[styles.growthMetricLabel, { color: c.mutedForeground }]}>Spending</Text>
          </View>
          <View style={[styles.growthMetric, { backgroundColor: c.muted }]}>
            <Text style={[styles.growthMetricValue, { color: reportsSummary.net >= 0 ? c.success : c.destructive }]}>${reportsSummary.net.toFixed(0)}</Text>
            <Text style={[styles.growthMetricLabel, { color: c.mutedForeground }]}>Net</Text>
          </View>
        </View>
        <View style={[styles.priorityNote, { backgroundColor: c.primary + "12", borderRadius: 10, marginTop: 12 }]}>
          <Feather name="bar-chart-2" size={13} color={c.primary} />
          <Text style={[styles.priorityNoteText, { color: c.mutedForeground }]}>{reportsSummary.insight}</Text>
        </View>
        {reportsSummary.categoryTotals.slice(0, 5).map((category, index) => (
          <View key={category.category} style={[styles.growthListRow, { borderTopWidth: index ? 1 : 0, borderTopColor: c.border }]}>
            <View style={styles.dataBody}>
              <Text style={[styles.dataLabel, { color: c.foreground }]}>{category.category}</Text>
              <Text style={[styles.dataDesc, { color: c.mutedForeground }]}>Flexible spending category</Text>
            </View>
            <Text style={[styles.incomeMonthly, { color: c.destructive }]}>${category.amount.toFixed(0)}</Text>
          </View>
        ))}
        <View style={[styles.growthListRow, { borderTopWidth: 1, borderTopColor: c.border }]}>
          <View style={styles.dataBody}>
            <Text style={[styles.dataLabel, { color: c.foreground }]}>Debt remaining</Text>
            <Text style={[styles.dataDesc, { color: c.mutedForeground }]}>Balances included in payoff reporting</Text>
          </View>
          <Text style={[styles.incomeMonthly, { color: c.destructive }]}>${reportsSummary.debtTotal.toFixed(0)}</Text>
        </View>
      </View>

      <SLabel c={c} text="Smart Reminders" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        {smartReminders.slice(0, 8).map((reminder, index) => (
          <View key={reminder.id} style={[styles.growthListRow, { borderTopWidth: index ? 1 : 0, borderTopColor: c.border }]}>
            <View style={[styles.dataIcon, { backgroundColor: reminder.severity === "risk" ? c.destructive + "18" : reminder.severity === "watch" ? c.warning + "18" : c.primary + "18" }]}>
              <Feather name={reminder.severity === "risk" ? "alert-triangle" : "bell"} size={17} color={reminder.severity === "risk" ? c.destructive : reminder.severity === "watch" ? c.warning : c.primary} />
            </View>
            <View style={styles.dataBody}>
              <Text style={[styles.dataLabel, { color: c.foreground }]}>{reminder.title}</Text>
              <Text style={[styles.dataDesc, { color: c.mutedForeground }]}>{reminder.message}</Text>
            </View>
          </View>
        ))}
        {!smartReminders.length && (
          <Text style={[styles.emptyText, { color: c.mutedForeground }]}>No reminders right now. I’ll surface bills, reviews, subscriptions, goals, and reconciliation items here.</Text>
        )}
      </View>
      </>}

      {activeSettingsSection === "goals" && <>
      <SLabel c={c} text="Goal Funding Plans" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        {goalFundingPlans.map((plan, index) => {
          const goal = goals.find(item => item.id === plan.goalId);
          return (
            <View key={plan.goalId} style={[styles.growthListRow, { borderTopWidth: index ? 1 : 0, borderTopColor: c.border }]}>
              <View style={[styles.dataIcon, { backgroundColor: plan.status === "on_track" ? c.success + "18" : c.warning + "18" }]}>
                <Feather name="target" size={17} color={plan.status === "on_track" ? c.success : c.warning} />
              </View>
              <View style={styles.dataBody}>
                <Text style={[styles.dataLabel, { color: c.foreground }]}>{goal?.name ?? "Goal"}</Text>
                <Text style={[styles.dataDesc, { color: c.mutedForeground }]}>{plan.message}</Text>
                <Text style={[styles.growthTinyText, { color: c.mutedForeground }]}>
                  Needed ${plan.monthlyNeeded.toFixed(0)}/mo • Safe ${plan.safeMonthlyContribution.toFixed(0)}/mo
                </Text>
              </View>
            </View>
          );
        })}
        {!goalFundingPlans.length && (
          <Text style={[styles.emptyText, { color: c.mutedForeground }]}>Add a goal from the plus button and I’ll turn it into a funding plan that respects your safety floor.</Text>
        )}
      </View>
      </>}

      {activeSettingsSection === "plaid" && <>
      <SLabel c={c} text="Bank Sync" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <View style={styles.growthHeaderRow}>
          <View style={[styles.growthScoreBubble, { backgroundColor: plaidStatus.canStartLink ? c.success + "18" : c.warning + "18" }]}>
            <Feather name="link" size={20} color={plaidStatus.canStartLink ? c.success : c.warning} />
          </View>
          <View style={styles.growthHeaderCopy}>
            <Text style={[styles.switchLabel, { color: c.foreground }]}>
              {plaidStatus.canStartLink ? "Plaid is ready" : "Plaid setup is staged"}
            </Text>
            <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>{plaidServerStatus?.message ?? plaidStatus.message}</Text>
          </View>
        </View>
        <View style={[styles.priorityNote, { backgroundColor: c.primary + "12", borderRadius: 10, marginTop: 12 }]}>
          <Feather name="shield" size={13} color={c.primary} />
          <Text style={[styles.priorityNoteText, { color: c.mutedForeground }]}>
            FlowLedger will keep Plaid access tokens server-side. The app will only receive safe account and transaction data after you approve a link.
          </Text>
        </View>
        <Pressable disabled style={[styles.balanceSaveFullBtn, { backgroundColor: plaidStatus.canStartLink ? c.primary : c.muted, marginTop: 14 }]}>
          <Feather name={plaidStatus.canStartLink ? "link" : "lock"} size={15} color={plaidStatus.canStartLink ? "#fff" : c.mutedForeground} />
          <Text style={[styles.balanceSaveBtnText, { color: plaidStatus.canStartLink ? "#fff" : c.mutedForeground }]}>
            {plaidStatus.canStartLink ? "Bank sync endpoints are ready" : "Connect bank account after Plaid env setup"}
          </Text>
        </Pressable>
      </View>
      </>}

      {activeSettingsSection === "children" && <>
      <SLabel c={c} text="Child Money Management" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <View style={styles.growthHeaderRow}>
          <View style={[styles.growthScoreBubble, { backgroundColor: c.primary + "18" }]}>
            <Feather name="smile" size={20} color={c.primary} />
          </View>
          <View style={styles.growthHeaderCopy}>
            <Text style={[styles.switchLabel, { color: c.foreground }]}>Family money skills</Text>
            <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>
              Child profiles will support allowance, savings goals, simple limits, and parent-safe learning prompts.
            </Text>
          </View>
        </View>
        {childMoneySummary.map(child => (
          <View key={child.id} style={[styles.growthListRow, { borderTopWidth: 1, borderTopColor: c.border }]}>
            <View style={styles.dataBody}>
              <Text style={[styles.dataLabel, { color: c.foreground }]}>{child.name}</Text>
              <Text style={[styles.dataDesc, { color: c.mutedForeground }]}>{child.message}</Text>
            </View>
            <Text style={[styles.incomeMonthly, { color: c.primary }]}>{child.progress}%</Text>
          </View>
        ))}
        {!childMoneySummary.length && (
          <Text style={[styles.emptyText, { color: c.mutedForeground }]}>No child profiles yet. The database foundation is ready so this can become a safe household expansion without exposing adult controls.</Text>
        )}
      </View>
      </>}

      {activeSettingsSection === "backup" && <>
      <SLabel c={c} text="Backup & Data" />
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
      </>}

      {activeSettingsSection === "help" && <>
      {!feedbackAdmin ? (
      <>
      <SLabel c={c} text="Tester Feedback" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <View style={styles.feedbackHero}>
          <View style={[styles.dataIcon, { backgroundColor: c.primary + "18" }]}>
            <Feather name="message-square" size={17} color={c.primary} />
          </View>
          <View style={styles.switchInfo}>
            <Text style={[styles.switchLabel, { color: c.foreground }]}>Send FlowLedger feedback</Text>
            <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>Tell me what felt broken, confusing, slow, or useful. This goes to the FlowLedger app inbox, not your household.</Text>
          </View>
        </View>
        <View style={styles.feedbackChipGrid}>
          {FEEDBACK_TYPES.map(type => {
            const active = feedbackType === type.id;
            return (
              <Pressable
                key={type.id}
                onPress={() => {
                  setFeedbackType(type.id);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                style={({ pressed }) => [
                  styles.feedbackChip,
                  {
                    backgroundColor: active ? c.primary : c.muted,
                    borderColor: active ? c.primary : c.border,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                <Feather name={type.icon as any} size={13} color={active ? c.primaryForeground : c.mutedForeground} />
                <Text style={[styles.feedbackChipText, { color: active ? c.primaryForeground : c.mutedForeground }]}>{type.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <TextInput
          value={feedbackMessage}
          onChangeText={setFeedbackMessage}
          multiline
          textAlignVertical="top"
          placeholder="Example: I tapped Save Account during setup and nothing happened..."
          placeholderTextColor={c.mutedForeground}
          style={[styles.feedbackInput, { backgroundColor: c.muted, borderColor: c.border, color: c.foreground }]}
        />
        <View style={styles.feedbackRatingRow}>
          <Text style={[styles.feedbackSmallLabel, { color: c.mutedForeground }]}>How was it?</Text>
          {[1, 2, 3, 4, 5].map(value => {
            const active = feedbackRating === value;
            return (
              <Pressable
                key={value}
                onPress={() => setFeedbackRating(active ? null : value)}
                style={({ pressed }) => [
                  styles.feedbackRatingButton,
                  { backgroundColor: active ? c.primary + "25" : c.muted, borderColor: active ? c.primary : c.border, opacity: pressed ? 0.75 : 1 },
                ]}
              >
                <Text style={[styles.feedbackRatingText, { color: active ? c.primary : c.mutedForeground }]}>{value}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPress={() => setFeedbackCanContact(value => !value)}
          style={({ pressed }) => [styles.feedbackContactRow, { opacity: pressed ? 0.75 : 1 }]}
        >
          <View style={[styles.feedbackCheck, { backgroundColor: feedbackCanContact ? c.success : c.muted, borderColor: feedbackCanContact ? c.success : c.border }]}>
            {feedbackCanContact ? <Feather name="check" size={12} color="#fff" /> : null}
          </View>
          <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>It’s okay to contact me about this feedback.</Text>
        </Pressable>
        {feedbackNotice ? <Text style={[styles.feedbackNotice, { color: /thank|copied|deleted/i.test(feedbackNotice) ? c.success : c.destructive }]}>{feedbackNotice}</Text> : null}
        <Pressable
          onPress={handleSubmitFeedback}
          disabled={feedbackSubmitting || !canSubmitFeedback(feedbackMessage)}
          style={({ pressed }) => [
            styles.balanceSaveFullBtn,
            {
              backgroundColor: canSubmitFeedback(feedbackMessage) ? c.primary : c.muted,
              opacity: pressed || feedbackSubmitting ? 0.75 : 1,
            },
          ]}
        >
          <Feather name="send" size={15} color={canSubmitFeedback(feedbackMessage) ? c.primaryForeground : c.mutedForeground} />
          <Text style={[styles.balanceSaveBtnText, { color: canSubmitFeedback(feedbackMessage) ? c.primaryForeground : c.mutedForeground }]}>
            {feedbackSubmitting ? "Sending..." : "Send Feedback"}
          </Text>
        </Pressable>
      </View>
      </>
      ) : null}

      {feedbackAdmin ? (
        <>
          <SLabel c={c} text="Feedback Inbox" />
          <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
            <View style={styles.feedbackInboxHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.switchLabel, { color: c.foreground }]}>App admin inbox</Text>
                <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>Tester notes across FlowLedger. This is separate from household permissions.</Text>
              </View>
              <Pressable
                onPress={() => void loadFeedbackInbox()}
                style={({ pressed }) => [styles.feedbackRefreshButton, { backgroundColor: c.muted, opacity: pressed ? 0.75 : 1 }]}
              >
                <Feather name="refresh-cw" size={15} color={c.primary} />
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.feedbackFilterRow}>
              {(["all", ...FEEDBACK_STATUSES.map(status => status.id)] as const).map(status => {
                const active = feedbackStatusFilter === status;
                return (
                  <Pressable
                    key={status}
                    onPress={() => setFeedbackStatusFilter(status)}
                    style={({ pressed }) => [
                      styles.feedbackStatusFilter,
                      { backgroundColor: active ? c.primary : c.muted, borderColor: active ? c.primary : c.border, opacity: pressed ? 0.75 : 1 },
                    ]}
                  >
                    <Text style={[styles.feedbackChipText, { color: active ? c.primaryForeground : c.mutedForeground }]}>
                      {status === "all" ? "All" : feedbackStatusLabel(status)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {feedbackNotice ? <Text style={[styles.feedbackNotice, { color: /thank|copied|deleted/i.test(feedbackNotice) ? c.success : c.destructive }]}>{feedbackNotice}</Text> : null}
            {feedbackInboxLoading ? (
              <Text style={[styles.switchDesc, { color: c.mutedForeground, marginTop: 10 }]}>Loading feedback...</Text>
            ) : feedbackInbox.length ? (
              feedbackInbox.map(item => (
                <View key={item.id} style={[styles.feedbackInboxItem, { borderColor: c.border, backgroundColor: c.muted }]}>
                  <View style={styles.feedbackInboxTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.feedbackInboxTitle, { color: c.foreground }]}>{FEEDBACK_TYPES.find(type => type.id === item.feedback_type)?.label ?? "Feedback"}</Text>
                      <Text style={[styles.feedbackInboxMeta, { color: c.mutedForeground }]} numberOfLines={1}>
                        {item.user_email ?? "Unknown user"} · {formatMemberDate(item.created_at)} · {item.platform ?? "app"}
                      </Text>
                    </View>
                    <View style={[styles.feedbackStatusPill, { backgroundColor: c.primary + "18" }]}>
                      <Text style={[styles.feedbackStatusText, { color: c.primary }]}>{feedbackStatusLabel(item.status)}</Text>
                    </View>
                  </View>
                  <Text style={[styles.feedbackInboxMessage, { color: c.foreground }]}>{item.message}</Text>
                  <View style={styles.feedbackInboxFooter}>
                    {item.rating ? <Text style={[styles.feedbackInboxMeta, { color: c.mutedForeground }]}>Rating: {item.rating}/5</Text> : <View />}
                    <View style={styles.feedbackAdminActions}>
                      <Pressable
                        onPress={() => void handleCopyFeedbackForCodex(item)}
                        style={({ pressed }) => [
                          styles.feedbackAdminActionButton,
                          { backgroundColor: c.primary + "18", borderColor: c.primary + "55", opacity: pressed ? 0.75 : 1 },
                        ]}
                      >
                        <Feather name="copy" size={13} color={c.primary} />
                        <Text style={[styles.feedbackAdminActionText, { color: c.primary }]}>Copy Codex Plan</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleDeleteFeedback(item)}
                        style={({ pressed }) => [
                          styles.feedbackAdminActionButton,
                          { backgroundColor: c.destructive + "14", borderColor: c.destructive + "45", opacity: pressed ? 0.75 : 1 },
                        ]}
                      >
                        <Feather name="trash-2" size={13} color={c.destructive} />
                        <Text style={[styles.feedbackAdminActionText, { color: c.destructive }]}>Delete</Text>
                      </Pressable>
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.feedbackStatusActions}>
                      {FEEDBACK_STATUSES.map(status => (
                        <Pressable
                          key={`${item.id}-${status.id}`}
                          onPress={() => void handleFeedbackStatusChange(item.id, status.id)}
                          style={({ pressed }) => [
                            styles.feedbackStatusAction,
                            { backgroundColor: item.status === status.id ? c.primary : c.card, borderColor: c.border, opacity: pressed ? 0.75 : 1 },
                          ]}
                        >
                          <Text style={[styles.feedbackStatusText, { color: item.status === status.id ? c.primaryForeground : c.mutedForeground }]}>{status.label}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                </View>
              ))
            ) : (
              <Text style={[styles.switchDesc, { color: c.mutedForeground, marginTop: 10 }]}>No feedback in this filter yet.</Text>
            )}
          </View>
        </>
      ) : null}
      </>}

      {activeSettingsSection === "legal" && <>
      <SLabel c={c} text="Legal" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        {[
          { id: "terms" as const, title: "Terms & Conditions", desc: "How FlowLedger Algo should be used and what users are responsible for.", icon: "file-text" },
          { id: "privacy" as const, title: "Privacy Policy", desc: "What data FlowLedger uses to run forecasts, households, and Flo guidance.", icon: "shield" },
        ].map((item, index) => (
          <Pressable
            key={item.id}
            onPress={() => {
              setLegalDoc(item.id);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            style={({ pressed }) => [
              styles.dataRow,
              { borderTopWidth: index ? 1 : 0, borderTopColor: c.border, opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <View style={[styles.dataIcon, { backgroundColor: c.primary + "18" }]}>
              <Feather name={item.icon as any} size={17} color={c.primary} />
            </View>
            <View style={styles.dataBody}>
              <Text style={[styles.dataLabel, { color: c.foreground }]}>{item.title}</Text>
              <Text style={[styles.dataDesc, { color: c.mutedForeground }]}>{item.desc}</Text>
            </View>
            <Feather name="chevron-right" size={16} color={c.mutedForeground} />
          </Pressable>
        ))}
      </View>
      </>}

      {activeSettingsSection === "security" && <>
      <View style={{ marginTop: 8, marginBottom: 8 }}>
        <SLabel c={c} text="Security & Profile" />
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
      </>}

      <Modal
        visible={Boolean(selectedAlgorithm)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedAlgorithm(null)}
      >
        <Pressable style={styles.infoOverlay} onPress={() => setSelectedAlgorithm(null)}>
          <Pressable style={[styles.infoSheet, { backgroundColor: c.card, borderColor: c.border }]} onPress={() => undefined}>
            {selectedAlgorithm && (
              <>
                <View style={styles.infoSheetHeader}>
                  <View style={[styles.infoSheetIcon, { backgroundColor: c.primary + "18" }]}>
                    <Feather name={selectedAlgorithm.icon as any} size={20} color={c.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.infoSheetEyebrow, { color: c.primary }]}>Algorithm</Text>
                    <Text style={[styles.infoSheetTitle, { color: c.foreground }]}>{selectedAlgorithm.name}</Text>
                  </View>
                  <Pressable onPress={() => setSelectedAlgorithm(null)} style={[styles.infoCloseButton, { backgroundColor: c.muted }]}>
                    <Feather name="x" size={18} color={c.mutedForeground} />
                  </Pressable>
                </View>
                <Text style={[styles.infoSheetDesc, { color: c.mutedForeground }]}>{selectedAlgorithm.desc}</Text>
                <Pressable
                  onPress={() => setSelectedAlgorithm(null)}
                  style={({ pressed }) => [styles.infoDoneButton, { backgroundColor: c.primary, opacity: pressed ? 0.82 : 1 }]}
                >
                  <Text style={[styles.infoDoneText, { color: c.primaryForeground }]}>Got it</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={Boolean(legalDoc)}
        transparent
        animationType="fade"
        onRequestClose={() => setLegalDoc(null)}
      >
        <Pressable style={styles.infoOverlay} onPress={() => setLegalDoc(null)}>
          <Pressable style={[styles.infoSheet, { backgroundColor: c.card, borderColor: c.border, maxHeight: "78%" }]} onPress={() => undefined}>
            <View style={styles.infoSheetHeader}>
              <View style={[styles.infoSheetIcon, { backgroundColor: c.primary + "18" }]}>
                <Feather name={legalDoc === "privacy" ? "shield" : "file-text"} size={20} color={c.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.infoSheetEyebrow, { color: c.primary }]}>FlowLedger Algo</Text>
                <Text style={[styles.infoSheetTitle, { color: c.foreground }]}>
                  {legalDoc === "privacy" ? "Privacy Policy" : "Terms & Conditions"}
                </Text>
              </View>
              <Pressable onPress={() => setLegalDoc(null)} style={[styles.infoCloseButton, { backgroundColor: c.muted }]}>
                <Feather name="x" size={18} color={c.mutedForeground} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={[styles.legalText, { color: c.mutedForeground }]}>
                {legalDoc === "privacy"
                  ? "FlowLedger uses your accounts, bills, income, transactions, goals, household roles, and setup preferences to calculate forecasts, display alerts, and help Flo explain your plan. Household sharing only exposes the active household plan to invited members based on their role. FlowLedger should never ask users for admin keys, code access, or private service credentials. Diagnostic and setup information should stay limited to what is needed to operate the app and improve reliability."
                  : "FlowLedger Algo is a budgeting, planning, and forecasting tool. Its algorithms are designed to help you understand cash flow, bills, debt payoff, savings, and spending decisions, but they are not financial, tax, legal, or investment advice. You are responsible for confirming amounts, dates, balances, and real-world payments before making money decisions. Forecasts can change when income, bills, transactions, debt balances, or account balances change."}
              </Text>
            </ScrollView>
            <Pressable
              onPress={() => setLegalDoc(null)}
              style={({ pressed }) => [styles.infoDoneButton, { backgroundColor: c.primary, opacity: pressed ? 0.82 : 1 }]}
            >
              <Text style={[styles.infoDoneText, { color: c.primaryForeground }]}>Got it</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

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
    </View>
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
  scroller: { flex: 1 },
  content: { paddingHorizontal: 16 },
  pageTitle:    { fontSize: 34, fontFamily: "Inter_800ExtraBold", letterSpacing: -1.1, marginBottom: 14 },
  pageSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 20 },
  settingsSectionList: { gap: 10, marginBottom: 20 },
  settingsSectionCard: { minHeight: 82, borderWidth: 1, borderRadius: 22, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.14, shadowRadius: 18, elevation: 4 },
  settingsSectionIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  settingsSectionCopy: { flex: 1, gap: 3 },
  settingsSectionTitle: { fontSize: 16, fontFamily: "Inter_800ExtraBold" },
  settingsSectionDesc: { fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 17 },
  settingsBackRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10, alignSelf: "flex-start" },
  settingsBackText: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  settingsLauncher: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 20, padding: 14, marginBottom: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.16, shadowRadius: 18, elevation: 4 },
  card: { padding: 16, marginBottom: 20, borderWidth: 1, borderColor: "rgba(148,163,184,0.12)", shadowColor: "#000", shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.18, shadowRadius: 22, elevation: 5 },
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
  householdHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  householdChipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  householdChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  householdChipText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  householdPanel: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 10 },
  householdPanelHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  householdPanelTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold", marginBottom: 4 },
  memberRow: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, paddingTop: 10, marginTop: 10 },
  memberAvatar: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  memberInfo: { flex: 1, minWidth: 0 },
  memberName: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  memberMeta: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },
  memberActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  memberActionPill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 },
  memberActionText: { fontSize: 10, fontFamily: "Inter_800ExtraBold" },
  activityRow: { flexDirection: "row", alignItems: "flex-start", gap: 9, borderTopWidth: 1, paddingTop: 10, marginTop: 10 },
  activityIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  activityInfo: { flex: 1, minWidth: 0 },
  activityText: { fontSize: 12, fontFamily: "Inter_700Bold", lineHeight: 17 },
  roleRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  roleButton: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  roleButtonText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  inviteCodeBox: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 10 },
  inviteCodeLabel: { fontSize: 10, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },
  inviteCodeText: { fontSize: 22, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.8 },
  joinRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  joinInput: { flex: 1, borderWidth: 1, height: 44 },
  joinButton: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  householdMessage: { fontSize: 12, fontFamily: "Inter_700Bold", lineHeight: 17, marginTop: 10 },
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

  growthHeaderRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  growthScoreBubble: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  growthScoreText: { fontSize: 16, fontFamily: "Inter_800ExtraBold" },
  growthHeaderCopy: { flex: 1, gap: 4 },
  growthMetricGrid: { flexDirection: "row", gap: 10, marginBottom: 12 },
  growthMetric: { flex: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 11 },
  growthMetricValue: { fontSize: 18, fontFamily: "Inter_800ExtraBold" },
  growthMetricLabel: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.7, marginTop: 2, textTransform: "uppercase" },
  growthListRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  growthTinyText: { fontSize: 11, fontFamily: "Inter_500Medium", lineHeight: 15, marginTop: 3 },
  growthSmallButton: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
  growthSmallButtonText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },

  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  switchInfo: { flex: 1, marginRight: 12 },
  switchLabel: { fontSize: 15, fontFamily: "Inter_500Medium" },
  switchDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  decisionSettingRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  algorithmRecommendation: { borderWidth: 1, borderRadius: 16, padding: 12, marginTop: 14 },
  algorithmRecommendationHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  algorithmRecommendationTitle: { flex: 1, fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  algorithmRecommendationText: { fontSize: 12, fontFamily: "Inter_600SemiBold", lineHeight: 17, marginTop: 7 },
  toggleTrack: { width: 48, height: 28, borderRadius: 999, padding: 3, justifyContent: "center" },
  toggleKnob: { width: 22, height: 22, borderRadius: 11 },
  algorithmList: { borderTopWidth: 1, marginTop: 14, paddingTop: 2 },
  algorithmToggleRow: { flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: 1, paddingTop: 12, marginTop: 12 },
  infoOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end", padding: 16 },
  infoSheet: { borderWidth: 1, borderRadius: 24, padding: 18, marginBottom: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.22, shadowRadius: 24, elevation: 12 },
  infoSheetHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  infoSheetIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  infoSheetEyebrow: { fontSize: 10, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 2 },
  infoSheetTitle: { fontSize: 21, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },
  infoCloseButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  infoSheetDesc: { fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 20 },
  legalText: { fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 22 },
  infoDoneButton: { alignItems: "center", justifyContent: "center", minHeight: 46, borderRadius: 14, marginTop: 16 },
  infoDoneText: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
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
  feedbackHero: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12 },
  feedbackChipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  feedbackChip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8 },
  feedbackChipText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  feedbackInput: { minHeight: 112, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 20 },
  feedbackRatingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  feedbackSmallLabel: { fontSize: 11, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase", letterSpacing: 0.6, marginRight: 2 },
  feedbackRatingButton: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  feedbackRatingText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  feedbackContactRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  feedbackCheck: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  feedbackNotice: { fontSize: 12, fontFamily: "Inter_800ExtraBold", lineHeight: 17, marginTop: 10 },
  feedbackInboxHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  feedbackRefreshButton: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  feedbackFilterRow: { gap: 8, paddingTop: 12, paddingBottom: 4 },
  feedbackStatusFilter: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  feedbackInboxItem: { borderWidth: 1, borderRadius: 16, padding: 12, marginTop: 12 },
  feedbackInboxTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  feedbackInboxTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  feedbackInboxMeta: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginTop: 3 },
  feedbackStatusPill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  feedbackStatusText: { fontSize: 10, fontFamily: "Inter_800ExtraBold" },
  feedbackInboxMessage: { fontSize: 13, fontFamily: "Inter_600SemiBold", lineHeight: 19, marginTop: 10 },
  feedbackInboxFooter: { marginTop: 12, gap: 8 },
  feedbackAdminActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  feedbackAdminActionButton: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 8 },
  feedbackAdminActionText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  feedbackStatusActions: { gap: 8, paddingRight: 4 },
  feedbackStatusAction: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },

  summaryCard: { flexDirection: "row", justifyContent: "space-around", padding: 16, marginBottom: 8 },
  summaryItem: { alignItems: "center" },
  summaryNum: { fontSize: 24, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },

});


