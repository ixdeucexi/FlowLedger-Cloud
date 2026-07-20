"use client";

import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Modal, Platform, Pressable, ScrollView, StyleSheet,
  Text, TextInput, useWindowDimensions, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountModal } from "@/components/AccountModal";
import { AppText } from "@/components/AppText";
import { FloLogo } from "@/components/FloLogo";
import { IncomeModal } from "@/components/IncomeModal";
import { MembershipPanel } from "@/components/MembershipPanel";
import { NotificationSettings } from "@/components/NotificationSettings";
import { MoreHub } from "@/components/settings/MoreHub";
import { SettingsSectionHeader } from "@/components/settings/SettingsSectionHeader";
import { PlanFeatureGate } from "@/components/PlanFeatureGate";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { ReviewCenter } from "@/components/ReviewCenter";
import { PWA_INSTALL_EVENT } from "@/components/PwaInstallPrompt";
import { PlaidLinkButton } from "@/components/PlaidLinkButton";
import { RecentlyDeletedTransactions } from "@/components/RecentlyDeletedTransactions";
import colors from "@/constants/colors";
import type { Account, IncomeItem } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useMembership } from "@/context/MembershipContext";
import { useAuth } from "@/context/AuthContext";
import { type AppFontStyle, type ThemeMode, useThemeMode } from "@/context/ThemeContext";
import { useColors } from "@/hooks/useColors";
import { isCashFlowTransaction } from "@/lib/billMatching";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { localDateString } from "@/lib/dateLabels";
import { parseStatementCsv } from "@/lib/accounts";
import { resetFloMemory } from "@/lib/flo";
import { startLearningTour } from "@/lib/learningTour";
import { confirmAction } from "@/lib/confirmAction";
import {
  type HouseholdInviteRole,
  canRemoveHouseholdMember,
  householdAssignableRolesFor,
  householdInviteRolesFor,
  householdRoleLabel,
} from "@/lib/householdPermissions";
import { loadOnboardingPreferences, readOnboardingPreferences } from "@/lib/onboardingPreferences";
import { clearStoredSetupStep } from "@/lib/setupProgress";
import {
  SETTINGS_SECTIONS,
  attentionCountStatus,
  formatCountStatus,
  settingsGroupById,
  settingsGroupForSection,
  type SettingsDestinationId,
  type SettingsGroup,
  type SettingsSectionId,
  type SettingsStatus,
} from "@/lib/settingsHub";
import { supabase } from "@/lib/supabase";
import { transactionCategoryParts } from "@/lib/reviewCenter";
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
  buildSmartReminders,
  detectSubscriptions,
  evaluateForecastReadiness,
  type ChildProfile,
  type SubscriptionCandidate,
} from "@/lib/competitiveGrowth";

const FREQ_LABELS: Record<string, string> = { monthly: "Monthly", biweekly: "Biweekly", weekly: "Weekly" };

const THEME_OPTIONS: { label: string; value: ThemeMode; icon: string }[] = [
  { label: "Light", value: "light", icon: "sun" },
  { label: "Dark",  value: "dark",  icon: "moon" },
  { label: "Auto",  value: "auto",  icon: "smartphone" },
];

const FONT_OPTIONS: { label: string; value: AppFontStyle; icon: string; desc: string }[] = [
  { label: "Flow", value: "default", icon: "type", desc: "Clear and balanced for everyday planning." },
  { label: "Classic", value: "elegant", icon: "feather", desc: "A highly readable serif style." },
  { label: "Strong", value: "bold", icon: "bold", desc: "Heavier text with clear contrast." },
  { label: "Friendly", value: "playful", icon: "smile", desc: "Open, relaxed, and easy to scan." },
  { label: "Comfort", value: "soft", icon: "heart", desc: "A calm, familiar reading style." },
];

const BACKUP_COMPLETE_KEY = "flowledger_backup_exported";
type SubscriptionDecision = "keep" | "not_subscription" | "cancelled" | "bill_created";

type SubscriptionDecisionRow = {
  merchant: string;
  status: "review" | "keep" | "cancel_manually" | "convert_to_bill" | "not_subscription";
};

type ChildProfileRow = {
  id: string;
  name: string;
  allowance_amount: number | null;
  allowance_frequency: ChildProfile["allowanceFrequency"] | null;
  savings_goal: number | null;
  current_savings: number | null;
  spending_limit: number | null;
  is_active: boolean | null;
};

function normalizeStorageMap<T extends string>(value: unknown): Record<string, T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, T>>((acc, [key, val]) => {
    if (typeof val === "string") acc[key] = val as T;
    return acc;
  }, {});
}

function subscriptionKey(subscription: SubscriptionCandidate) {
  return subscription.merchant.toLowerCase().trim();
}

function newestTransactionDate(ids: string[], transactions: Array<{ id: string; date: string }>) {
  return transactions
    .filter(transaction => ids.includes(transaction.id))
    .map(transaction => transaction.date)
    .sort()
    .at(-1);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function stableUuidFromString(seed: string) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const chunks = Array.from({ length: 4 }, (_, index) => {
    hash ^= index + seed.length;
    hash = Math.imul(hash, 16777619);
    return (hash >>> 0).toString(16).padStart(8, "0");
  }).join("");
  return `${chunks.slice(0, 8)}-${chunks.slice(8, 12)}-4${chunks.slice(13, 16)}-a${chunks.slice(17, 20)}-${chunks.slice(20, 32)}`;
}

function makeClientUuid(label: string) {
  return stableUuidFromString(`${label}-${Date.now()}-${Math.random()}`);
}

function numberOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeChildProfileIds(profiles: ChildProfile[]) {
  return profiles.map(profile => ({
    ...profile,
    id: isUuid(profile.id) ? profile.id : stableUuidFromString(`child-profile:${profile.id}:${profile.name}`),
  }));
}

function subscriptionStatusToDecision(status: SubscriptionDecisionRow["status"]): SubscriptionDecision | null {
  if (status === "keep") return "keep";
  if (status === "cancel_manually") return "cancelled";
  if (status === "convert_to_bill") return "bill_created";
  if (status === "not_subscription") return "not_subscription";
  return null;
}

function subscriptionDecisionToStatus(decision: SubscriptionDecision): SubscriptionDecisionRow["status"] {
  if (decision === "cancelled") return "cancel_manually";
  if (decision === "bill_created") return "convert_to_bill";
  return decision;
}

function mapChildRow(row: ChildProfileRow): ChildProfile {
  return {
    id: row.id,
    name: row.name,
    allowanceAmount: numberOrNull(row.allowance_amount),
    allowanceFrequency: row.allowance_frequency,
    savingsGoal: numberOrNull(row.savings_goal),
    currentSavings: numberOrNull(row.current_savings) ?? 0,
    spendingLimit: numberOrNull(row.spending_limit),
  };
}

function mapChildForSupabase(profile: ChildProfile, userId: string, householdId: string) {
  const id = isUuid(profile.id) ? profile.id : stableUuidFromString(`child-profile:${profile.id}:${profile.name}`);
  return {
    id,
    household_id: householdId,
    owner_user_id: userId,
    name: profile.name,
    allowance_amount: profile.allowanceAmount ?? null,
    allowance_frequency: profile.allowanceFrequency ?? null,
    savings_goal: profile.savingsGoal ?? null,
    current_savings: profile.currentSavings ?? 0,
    spending_limit: profile.spendingLimit ?? null,
    is_active: true,
    updated_at: new Date().toISOString(),
  };
}

const VISIBLE_SETTINGS_SECTIONS = SETTINGS_SECTIONS;
const ACTIVE_SETTINGS_SECTION_KEY = "flowledger_active_settings_section";

function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return value === "overview" || VISIBLE_SETTINGS_SECTIONS.some(section => section.id === value);
}

function readStoredSettingsSection(): SettingsSectionId {
  if (Platform.OS !== "web" || typeof window === "undefined") return "overview";
  try {
    const stored = window.sessionStorage?.getItem(ACTIVE_SETTINGS_SECTION_KEY);
    return isSettingsSectionId(stored) ? stored : "overview";
  } catch {
    return "overview";
  }
}

function writeStoredSettingsSection(sectionId: SettingsSectionId) {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  try {
    if (sectionId === "overview") {
      window.sessionStorage?.removeItem(ACTIVE_SETTINGS_SECTION_KEY);
    } else {
      window.sessionStorage?.setItem(ACTIVE_SETTINGS_SECTION_KEY, sectionId);
    }
  } catch {}
}

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

function formatReviewDate(value?: string | null) {
  if (!value) return "No date";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function formatSignedMoney(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function reviewMoneyLabel(value: number) {
  if (value > 0) return "Money in";
  if (value < 0) return "Money out";
  return "No money impact";
}

const SUBSCRIPTION_BILL_WORDS = [
  "subscription",
  "netflix",
  "hulu",
  "spotify",
  "disney",
  "apple",
  "google",
  "youtube",
  "prime",
  "peacock",
  "paramount",
  "max",
  "hbo",
  "chatgpt",
  "gym",
  "fitness",
  "membership",
  "streaming",
];

function isSubscriptionStyleBill(bill: { name: string; category?: string | null; is_recurring?: boolean; is_debt?: boolean; end_date?: string | null }) {
  if (bill.is_recurring === false || bill.is_debt) return false;
  const text = `${bill.name} ${bill.category ?? ""}`.toLowerCase();
  return SUBSCRIPTION_BILL_WORDS.some(word => text.includes(word));
}

function recurringBillCadenceLabel(frequency?: string | null) {
  if (frequency === "weekly") return "weekly";
  if (frequency === "biweekly") return "biweekly";
  return "monthly";
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
  const { width: viewportWidth } = useWindowDimensions();
  const useStackedSettingsFields = viewportWidth < 480;
  const router = useRouter();
  const routeParams = useLocalSearchParams<{ section?: string }>();
  const {
    themeMode,
    setThemeMode,
    fontStyle,
    setFontStyle,
  } = useThemeMode();
  const { signOut, user, session, loading: authLoading } = useAuth();
  const {
    effectiveTier,
    isAdmin: feedbackAdmin,
    loading: membershipLoading,
    previewTier,
  } = useMembership();
  const {
    bills, transactions, deletedTransactions, overrides, incomes, goals, importBills, settings, updateSettings, accounts, forecastConfidence,
    addBill, updateBill,
    addTransaction, updateTransaction, deleteTransaction,
    addGoal, updateGoal,
    addIncome, updateIncome, deleteIncome, getMonthlyIncome,
    categories, addCategory, updateCategory, deleteCategory,
    addAccount, updateAccount, reconcileAccount, archiveAccount, importStatementTransactions,
    households, householdMembers, householdActivity, activeHousehold, householdRole, canEditHousehold,
    refreshHouseholds, refreshHouseholdActivity, switchHousehold, createHouseholdInvite, acceptHouseholdInvite,
    updateHouseholdMemberRole, removeHouseholdMember,
    refreshBankData,
  } = useBudget();

  const [incomeModalVisible, setIncomeModalVisible] = useState(false);
  const [zeroBudgetIntroVisible, setZeroBudgetIntroVisible] = useState(false);
  const [accountModalVisible, setAccountModalVisible] = useState(false);
  const [accountMode, setAccountMode] = useState<"add" | "edit" | "reconcile">("add");
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [editIncome, setEditIncome] = useState<IncomeItem | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [safetyFloorText, setSafetyFloorText] = useState(settings.safety_floor.toString());
  const [forecastHorizonText, setForecastHorizonText] = useState(settings.forecast_horizon_months.toString());
  const [onboardingPreferences, setOnboardingPreferences] = useState(() => readOnboardingPreferences());
  const [legalDoc, setLegalDoc] = useState<"terms" | "privacy" | null>(null);
  useBackDismiss(Boolean(legalDoc), () => setLegalDoc(null));
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>(() => readStoredSettingsSection());
  const [activeSettingsGroup, setActiveSettingsGroup] = useState<SettingsGroup["id"] | null>(() => {
    const storedSection = readStoredSettingsSection();
    return storedSection === "overview" ? null : settingsGroupForSection(storedSection).id;
  });
  const openSettingsSection = useCallback((sectionId: SettingsSectionId) => {
    const safeSectionId = sectionId;
    if (safeSectionId !== "overview") {
      setActiveSettingsGroup(settingsGroupForSection(safeSectionId).id);
    }
    setActiveSettingsSection(safeSectionId);
    writeStoredSettingsSection(safeSectionId);
  }, []);
  useBackDismiss(activeSettingsSection !== "overview", () => openSettingsSection("overview"));
  useBackDismiss(activeSettingsSection === "overview" && activeSettingsGroup !== null, () => setActiveSettingsGroup(null));
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
  const [feedbackInbox, setFeedbackInbox] = useState<AppFeedbackRow[]>([]);
  const [feedbackInboxLoading, setFeedbackInboxLoading] = useState(false);
  const [feedbackStatusFilter, setFeedbackStatusFilter] = useState<FeedbackStatus | "all">("all");
  const [subscriptionDecisions, setSubscriptionDecisions] = useState<Record<string, SubscriptionDecision>>({});
  const [growthNotice, setGrowthNotice] = useState<string | null>(null);
  const [childProfiles, setChildProfiles] = useState<ChildProfile[]>([]);
  const [childName, setChildName] = useState("");
  const [childAllowanceText, setChildAllowanceText] = useState("");
  const [childGoalText, setChildGoalText] = useState("");
  const [backupExported, setBackupExported] = useState(() => {
    try { return Platform.OS === "web" && globalThis.localStorage?.getItem(BACKUP_COMPLETE_KEY) === "true"; }
    catch { return false; }
  });
  const [signingOut, setSigningOut] = useState(false);
  const inviteRoles = useMemo(() => householdInviteRolesFor(activeHousehold?.role), [activeHousehold?.role]);
  const subscriptionDecisionStorageKey = user?.id ? `flowledger_subscription_decisions_${user.id}` : "flowledger_subscription_decisions_guest";
  const childProfileStorageKey = activeHousehold?.householdId
    ? `flowledger_child_profiles_${activeHousehold.householdId}`
    : user?.id ? `flowledger_child_profiles_${user.id}` : "flowledger_child_profiles_guest";
  const childMoneySummary = useMemo(() => buildChildMoneySummary(childProfiles), [childProfiles]);

  useEffect(() => {
    const requestedSectionParam = Array.isArray(routeParams.section) ? routeParams.section[0] : routeParams.section;
    let requestedSection = requestedSectionParam;
    if (!requestedSection && Platform.OS === "web" && typeof window !== "undefined") {
      try {
        requestedSection = new URLSearchParams(window.location.search).get("section") ?? undefined;
      } catch {
        requestedSection = undefined;
      }
    }
    if (isSettingsSectionId(requestedSection)) {
      const safeSection = requestedSection as SettingsSectionId;
      setActiveSettingsSection(safeSection);
      setActiveSettingsGroup(safeSection === "overview" ? null : settingsGroupForSection(safeSection).id);
      writeStoredSettingsSection(safeSection);
      return;
    }
    const storedSection = readStoredSettingsSection();
    if (storedSection !== "overview") {
      setActiveSettingsSection(storedSection);
      setActiveSettingsGroup(settingsGroupForSection(storedSection).id);
    }
  }, [routeParams.section]);

  useEffect(() => {
    setSafetyFloorText(settings.safety_floor.toString());
    setForecastHorizonText(settings.forecast_horizon_months.toString());
  }, [settings.safety_floor, settings.forecast_horizon_months]);

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
    void (async () => {
      const value = await AsyncStorage.getItem(subscriptionDecisionStorageKey).catch(() => null);
      if (!cancelled) setSubscriptionDecisions(value ? normalizeStorageMap<SubscriptionDecision>(JSON.parse(value)) : {});
      if (!user?.id || !activeHousehold?.householdId) return;
      const { data, error } = await supabase
        .from("subscription_candidates")
        .select("merchant,status")
        .eq("household_id", activeHousehold.householdId)
        .neq("status", "review");
      if (cancelled || error || !data) return;
      const mapped = (data as SubscriptionDecisionRow[]).reduce<Record<string, SubscriptionDecision>>((acc, row) => {
        const decision = subscriptionStatusToDecision(row.status);
        if (decision) acc[row.merchant.toLowerCase().trim()] = decision;
        return acc;
      }, {});
      setSubscriptionDecisions(mapped);
      await AsyncStorage.setItem(subscriptionDecisionStorageKey, JSON.stringify(mapped)).catch(() => undefined);
    })().catch(() => {
      if (!cancelled) setSubscriptionDecisions({});
    });
    return () => {
      cancelled = true;
    };
  }, [activeHousehold?.householdId, subscriptionDecisionStorageKey, user?.id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const value = await AsyncStorage.getItem(childProfileStorageKey).catch(() => null);
      if (!cancelled) {
        const parsed = value ? JSON.parse(value) : [];
        setChildProfiles(Array.isArray(parsed) ? normalizeChildProfileIds(parsed) : []);
      }
      if (!user?.id || !activeHousehold?.householdId) return;
      const { data, error } = await supabase
        .from("child_profiles")
        .select("id,name,allowance_amount,allowance_frequency,savings_goal,current_savings,spending_limit,is_active")
        .eq("household_id", activeHousehold.householdId)
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (cancelled || error || !data) return;
      const mapped = (data as ChildProfileRow[]).map(mapChildRow);
      setChildProfiles(mapped);
      await AsyncStorage.setItem(childProfileStorageKey, JSON.stringify(mapped)).catch(() => undefined);
    })().catch(() => {
      if (!cancelled) setChildProfiles([]);
    });
    return () => {
      cancelled = true;
    };
  }, [activeHousehold?.householdId, childProfileStorageKey, user?.id]);

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

  const totalMonthlyIncome = getMonthlyIncome();
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
  const todayIso = localDateString();
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
  const growthReportTransactions = useMemo(() => growthTransactions.flatMap(transaction => {
    const source = transactions.find(item => item.id === transaction.id);
    if (!source) return [transaction];
    if (!isCashFlowTransaction(source)) return [];
    const parts = transactionCategoryParts(source);
    if (parts.length === 0) return source.amount > 0 ? [transaction] : [];
    return parts.map((part, index) => ({
      ...transaction,
      id: `${transaction.id}:${index}`,
      amount: part.amount,
      description: part.label,
      category: part.category,
    }));
  }), [growthTransactions, transactions]);
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
  const reviewTransactionCount = useMemo(() => transactions.filter(transaction =>
    transaction.source === "plaid"
    && transaction.review_status === "needs_review"
    && transaction.date.startsWith(todayIso.slice(0, 7)),
  ).length, [todayIso, transactions]);
  const subscriptions = useMemo(
    () => detectSubscriptions(growthTransactions).filter(item => subscriptionDecisions[subscriptionKey(item)] !== "not_subscription"),
    [growthTransactions, subscriptionDecisions],
  );
  const subscriptionBillHints = useMemo(
    () => bills
      .filter(bill => !(bill.end_date && bill.end_date < todayIso))
      .filter(isSubscriptionStyleBill)
      .sort((a, b) => a.due_day - b.due_day || a.name.localeCompare(b.name)),
    [bills, todayIso],
  );
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
    () => buildReportsSummary(growthReportTransactions, growthBills, growthDebts, growthGoals),
    [growthBills, growthDebts, growthGoals, growthReportTransactions],
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
    reviewCount: reviewTransactionCount,
    subscriptionIncreases: subscriptions.filter(subscription => subscription.priceIncrease).length,
    lowestBalance: null,
    safetyFloor: settings.safety_floor,
    goals: goalFundingPlans,
    needsReconcile: forecastReadiness.missing.includes("Reconcile an account"),
  }), [forecastReadiness.missing, goalFundingPlans, growthBills, reviewTransactionCount, settings.safety_floor, subscriptions, todayIso]);
  const membershipStatusLabel = membershipLoading
    ? "Loading"
    : `${effectiveTier === "pro" ? "Pro" : "Basic"}${previewTier ? " preview" : ""}`;
  const hubStatuses = useMemo<Partial<Record<SettingsDestinationId, SettingsStatus>>>(() => ({
    accounts: { label: formatCountStatus(activeAccounts.length, "account") },
    goals: { label: formatCountStatus(goals.length, "goal") },
    children: { label: formatCountStatus(childProfiles.length, "profile") },
    review: attentionCountStatus(reviewTransactionCount, "Clear", "to review", "to review"),
    subscriptions: { label: `${subscriptions.length} found` },
    reports: { label: formatCountStatus(smartReminders.length, "reminder") },
    setup: setupIsComplete
      ? { label: "Complete" }
      : { label: `${setupComplete}/${setupSteps.length} complete`, tone: "attention" },
    appearance: { label: themeMode === "auto" ? "Auto" : themeMode === "dark" ? "Dark" : "Light" },
    backup: backupExported ? { label: "Backup saved" } : { label: "Not backed up", tone: "attention" },
    deleted: { label: deletedTransactions.length ? formatCountStatus(deletedTransactions.length, "item") : "Empty" },
    membership: { label: membershipStatusLabel },
  }), [
    activeAccounts.length,
    backupExported,
    childProfiles.length,
    deletedTransactions.length,
    goals.length,
    membershipStatusLabel,
    reviewTransactionCount,
    setupComplete,
    setupIsComplete,
    setupSteps.length,
    smartReminders.length,
    subscriptions.length,
    themeMode,
  ]);

  const saveSubscriptionDecisions = async (next: Record<string, SubscriptionDecision>) => {
    setSubscriptionDecisions(next);
    await AsyncStorage.setItem(subscriptionDecisionStorageKey, JSON.stringify(next)).catch(() => undefined);
  };

  const markSubscriptionDecision = async (subscription: SubscriptionCandidate, decision: SubscriptionDecision) => {
    await saveSubscriptionDecisions({ ...subscriptionDecisions, [subscriptionKey(subscription)]: decision });
    if (!user?.id || !activeHousehold?.householdId || !canEditHousehold) return;
    const { error } = await supabase.from("subscription_candidates").upsert({
      id: stableUuidFromString(`subscription:${activeHousehold.householdId}:${subscriptionKey(subscription)}`),
      user_id: user.id,
      household_id: activeHousehold.householdId,
      merchant: subscription.merchant,
      cadence: subscription.cadence,
      average_amount: subscription.averageAmount,
      monthly_equivalent: subscription.monthlyEquivalent,
      yearly_equivalent: subscription.yearlyEquivalent,
      confidence: subscription.confidence,
      status: subscriptionDecisionToStatus(decision),
      source_transaction_ids: subscription.transactionIds.filter(isUuid),
      last_reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) return;
  };

  const saveChildProfiles = async (next: ChildProfile[]) => {
    const normalized = normalizeChildProfileIds(next);
    setChildProfiles(normalized);
    await AsyncStorage.setItem(childProfileStorageKey, JSON.stringify(normalized)).catch(() => undefined);
    if (!user?.id || !activeHousehold?.householdId || !canEditHousehold) return;
    const rows = normalized.map(profile => mapChildForSupabase(profile, user.id, activeHousehold.householdId));
    if (!rows.length) return;
    const { error } = await supabase.from("child_profiles").upsert(rows);
    if (error) return;
  };

  const handleCreateBillFromSubscription = async (subscription: SubscriptionCandidate) => {
    const amount = Math.max(0, subscription.cadence === "annual" ? subscription.yearlyEquivalent / 12 : subscription.averageAmount || subscription.lastAmount);
    const latestDate = newestTransactionDate(subscription.transactionIds, growthTransactions) ?? todayIso;
    const dueDay = Math.min(28, Math.max(1, Number(latestDate.slice(8, 10)) || 1));
    confirmAction({
      title: "Create subscription bill?",
      message: `I’ll add ${subscription.merchant} as a recurring bill for about $${amount.toFixed(2)} due around the ${dueDay}.`,
      confirmText: "Create bill",
      onConfirm: async () => {
        try {
          await addBill({
            name: subscription.merchant.replace(/\b\w/g, letter => letter.toUpperCase()),
            amount,
            category: "Subscriptions",
            priority: bills.length + 1,
            is_debt: false,
            balance: 0,
            interest_rate: 0,
            due_day: dueDay,
            start_date: latestDate,
            is_recurring: true,
            frequency: subscription.cadence === "weekly" ? "weekly" : "monthly",
          });
          await markSubscriptionDecision(subscription, "bill_created");
          setGrowthNotice("Subscription bill created.");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (error) {
          Alert.alert("Couldn’t create bill", error instanceof Error ? error.message : "Try again.");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      },
    });
  };

  const handleMarkSubscription = (subscription: SubscriptionCandidate, decision: SubscriptionDecision) => {
    void markSubscriptionDecision(subscription, decision);
    setGrowthNotice(
      decision === "keep" ? "Subscription kept on the review list." :
      decision === "cancelled" ? "Marked as cancelled. Stop future bills if this is already scheduled." :
      "Marked as not a subscription.",
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleAddSafeGoalContribution = (goalId: string) => {
    const plan = goalFundingPlans.find(item => item.goalId === goalId);
    const goal = goals.find(item => item.id === goalId);
    if (!plan || !goal) return;
    const contribution = Math.max(0, Math.min(plan.safeMonthlyContribution, goal.target_amount - goal.current_amount));
    if (contribution <= 0) {
      Alert.alert("Goal funding", "I don’t see a safe contribution for this goal yet.");
      return;
    }
    confirmAction({
      title: "Add safe goal contribution?",
      message: `I’ll add $${contribution.toFixed(2)} toward ${goal.name} today and keep it inside the current safe funding plan.`,
      confirmText: "Add contribution",
      onConfirm: async () => {
        try {
          await addTransaction({
            date: todayIso,
            amount: -contribution,
            category: "Savings",
            note: `Goal funding: ${goal.name}`,
            account_id: activeAccounts[0]?.id,
          });
          await updateGoal({
            ...goal,
            current_amount: Math.min(goal.target_amount, goal.current_amount + contribution),
          });
          setGrowthNotice("Goal contribution added.");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (error) {
          Alert.alert("Couldn’t fund goal", error instanceof Error ? error.message : "Try again.");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      },
    });
  };

  const handleAddChildProfile = async () => {
    const name = childName.trim();
    if (!name) {
      Alert.alert("Child profile", "Add a child name first.");
      return;
    }
    const allowanceAmount = Math.max(0, parseFloat(childAllowanceText) || 0);
    const savingsGoal = Math.max(0, parseFloat(childGoalText) || 0);
    const next: ChildProfile = {
      id: makeClientUuid("child-profile"),
      name,
      allowanceAmount: allowanceAmount || null,
      allowanceFrequency: allowanceAmount ? "weekly" : null,
      savingsGoal: savingsGoal || null,
      currentSavings: 0,
      spendingLimit: null,
    };
    await saveChildProfiles([next, ...childProfiles]);
    setChildName("");
    setChildAllowanceText("");
    setChildGoalText("");
    setGrowthNotice("Child profile added for starter tracking.");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleRemoveChildProfile = (profile: ChildProfile) => {
    confirmAction({
      title: "Remove child profile?",
      message: `This removes ${profile.name} from local child money tracking.`,
      confirmText: "Remove",
      destructive: true,
      onConfirm: async () => {
        await saveChildProfiles(childProfiles.filter(item => item.id !== profile.id));
        if (user?.id && activeHousehold?.householdId && canEditHousehold && isUuid(profile.id)) {
          const { error } = await supabase
            .from("child_profiles")
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq("id", profile.id)
            .eq("household_id", activeHousehold.householdId);
          if (error) return;
        }
        setGrowthNotice("Child profile removed.");
      },
    });
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

  const openAccount = (mode: "add" | "edit" | "reconcile", account: Account | null = null) => {
    setSelectedAccount(account);
    setAccountMode(mode);
    setAccountModalVisible(true);
  };

  const handleExport = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const accountHeader = "Id,Name,Type,CurrentBalance,BalanceAsOf,LastReconciledAt,IsActive";
      const accountRows = accounts.map(account => [
        account.id,
        account.name,
        account.account_type,
        account.current_balance,
        account.balance_as_of,
        account.last_reconciled_at ?? "",
        account.is_active,
      ].map(csvCell).join(",")).join("\n");

      const incomeHeader = "Name,Amount,Frequency,StartDate,NextPaymentDate,LastReviewedAt";
      const incomeRows = incomes.map(income => [
        income.name,
        income.amount,
        income.frequency,
        income.start_date ?? "",
        income.next_payment_date ?? "",
        income.last_reviewed_at ?? "",
      ].map(csvCell).join(",")).join("\n");

      const billHeader = "Name,Amount,Category,Priority,IsDebt,Balance,InterestRate,DueDay,IsRecurring,Frequency";
      const billRows = bills.map(b => [
        b.name,
        b.amount,
        b.category,
        b.priority,
        b.is_debt,
        b.balance,
        b.interest_rate,
        b.due_day,
        b.is_recurring,
        b.frequency ?? "monthly",
      ].map(csvCell).join(",")).join("\n");

      const txHeader = "Date,Amount,Category,Note,AccountId,LinkedBillId,TransferGroupId,ImportHash";
      const txRows = transactions.map(t => [
        t.date,
        t.amount,
        t.category,
        t.note,
        t.account_id ?? "",
        t.linked_bill_id ?? "",
        t.transfer_group_id ?? "",
        t.import_hash ?? "",
      ].map(csvCell).join(",")).join("\n");

      const ovrHeader = "BillId,Month,Year,CustomAmount,PaidAmount";
      const ovrRows = overrides.map(o => [
        o.bill_id,
        o.month,
        o.year,
        o.custom_amount ?? "",
        o.paid_amount,
      ].map(csvCell).join(",")).join("\n");

      const goalHeader = "Name,TargetAmount,CurrentAmount,TargetDate,Type";
      const goalRows = goals.map(goal => [
        goal.name,
        goal.target_amount,
        goal.current_amount,
        goal.target_date ?? "",
        goal.goal_type ?? "",
      ].map(csvCell).join(",")).join("\n");

      const csv = [
        "=== ACCOUNTS ===",
        accountHeader,
        accountRows,
        "",
        "=== INCOME ===",
        incomeHeader,
        incomeRows,
        "",
        "=== BILLS ===",
        billHeader,
        billRows,
        "",
        "=== TRANSACTIONS ===",
        txHeader,
        txRows,
        "",
        "=== MONTHLY OVERRIDES ===",
        ovrHeader,
        ovrRows,
        "",
        "=== GOALS ===",
        goalHeader,
        goalRows,
      ].join("\n");
      const filename = `flowledger-backup-${Date.now()}.csv`;

      if (Platform.OS === "web") {
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const fileUri = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(fileUri, csv);
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(fileUri);
      }

      setBackupExported(true);
      try {
        if (Platform.OS === "web") globalThis.localStorage?.setItem(BACKUP_COMPLETE_KEY, "true");
      } catch {}
    } catch {
      Alert.alert("Error", "Export failed.");
    }
  };

  const handleImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "*/*"],
      });
      if (result.canceled || !result.assets?.length) return;

      const file = result.assets[0];
      let content: string;
      if (Platform.OS === "web") {
        const response = await fetch(file.uri);
        content = await response.text();
      } else {
        content = await FileSystem.readAsStringAsync(file.uri);
      }

      const lines = content.split("\n").filter(line => line.trim() && !line.startsWith("="));
      const headerIdx = lines.findIndex(line => line.toLowerCase().includes("name") && line.toLowerCase().includes("amount"));
      if (headerIdx === -1) {
        Alert.alert("Invalid CSV", "Could not find Name,Amount header.");
        return;
      }

      const imported: Parameters<typeof importBills>[0] = [];
      for (let i = headerIdx + 1; i < lines.length; i++) {
        const parts = lines[i].split(",").map(part => part.replace(/"/g, "").trim());
        const amount = parseFloat(parts[1]);
        if (!parts[0] || Number.isNaN(amount)) continue;
        imported.push({
          name: parts[0],
          amount,
          category: parts[2] || "Other",
          priority: parseInt(parts[3], 10) || i,
          is_debt: parts[4]?.toLowerCase() === "true",
          balance: parseFloat(parts[5]) || 0,
          interest_rate: parseFloat(parts[6]) || 0,
          due_day: parseInt(parts[7], 10) || 1,
          is_recurring: parts[8]?.toLowerCase() !== "false",
          frequency: parts[9] === "weekly" ? "weekly" : "monthly",
        });
      }

      if (!imported.length) {
        Alert.alert("No Data", "No valid bill rows found.");
        return;
      }

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      importBills(imported);
      Alert.alert("Imported", `${imported.length} bills added.`);
    } catch {
      Alert.alert("Error", "Import failed.");
    }
  };

  const readPickedFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["text/csv", "text/comma-separated-values", "*/*"],
    });
    if (result.canceled || !result.assets?.length) return null;
    const file = result.assets[0];
    if (Platform.OS === "web") {
      const response = await fetch(file.uri);
      return response.text();
    }
    return FileSystem.readAsStringAsync(file.uri);
  };

  const importStatementFor = async (account: Account) => {
    try {
      const content = await readPickedFile();
      if (!content) return;
      const rows = parseStatementCsv(content, account.id);
      if (!rows.length) {
        Alert.alert("No transactions found", "Use a CSV with Date, Description, and Amount columns (or separate Debit and Credit columns).");
        return;
      }
      const result = await importStatementTransactions(account.id, rows);
      Alert.alert(
        "Statement imported",
        `${result.imported} new transaction${result.imported === 1 ? "" : "s"} added.${result.duplicates ? ` ${result.duplicates} duplicate${result.duplicates === 1 ? " was" : "s were"} skipped.` : ""}`,
      );
    } catch {
      Alert.alert("Import failed", "The statement could not be imported. Your existing transactions were not changed.");
    }
  };

  const handleStatementImport = () => {
    const active = accounts.filter(account => account.is_active);
    if (!active.length) {
      Alert.alert("Add an account first", "Transactions need an account so FlowLedger can detect duplicate statement rows.");
      return;
    }
    if (active.length === 1) {
      void importStatementFor(active[0]);
      return;
    }
    Alert.alert("Choose account", "Which account is this statement for?", [
      ...active.slice(0, 4).map(account => ({
        text: account.name,
        onPress: () => void importStatementFor(account),
      })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  };

  const handleResetFlo = () => {
    if (!user) return;
    Alert.alert(
      "Reset Flo Memory",
      "Remove Flo's saved preference and context summary? Your financial data will not be changed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: () => void resetFloMemory(user.id).then(() => Alert.alert("Flo Memory Reset", "Flo's rolling summary was removed.")),
        },
      ],
    );
  };

  const handleShowInstallPrompt = () => {
    if (Platform.OS === "web") {
      globalThis.dispatchEvent?.(new Event(PWA_INSTALL_EVENT));
      return;
    }
    Alert.alert("Install FlowLedger", "Open FlowLedger in your phone browser, then use Add to Home Screen.");
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
  const activeSettingsMeta = VISIBLE_SETTINGS_SECTIONS.find(section => section.id === activeSettingsSection);
  const activeSettingsGroupMeta = activeSettingsGroup ? settingsGroupById(activeSettingsGroup) : null;

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <PremiumBackdrop variant="blue" />
      <ScrollView
        style={styles.scroller}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 + webTopPad, paddingBottom: insets.bottom + 100 }]}
      >
      {activeSettingsSection === "overview" ? (
        <MoreHub
          householdName={activeHousehold?.name ?? "Personal household"}
          householdRole={householdRole ? `${householdRoleLabel(householdRole)} access` : "Private plan"}
          identity={user?.email ?? "Signed in"}
          membershipLabel={membershipStatusLabel}
          statuses={hubStatuses}
          activeGroupId={activeSettingsGroup}
          onOpenGroup={groupId => {
            setActiveSettingsGroup(groupId);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
          onBackToGroups={() => setActiveSettingsGroup(null)}
          onOpenSection={sectionId => {
            openSettingsSection(sectionId);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
        />
      ) : (
        activeSettingsMeta ? (
          <SettingsSectionHeader
            section={activeSettingsMeta}
            backLabel={activeSettingsGroupMeta?.label ?? "More"}
            onBack={() => openSettingsSection("overview")}
          />
        ) : null
      )}

      {activeSettingsSection === "membership" && <MembershipPanel />}

      {activeSettingsSection === "setup" && shouldShowFloSetup && <>
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
              <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>You can restart Flo setup or replay the Demo any time.</Text>
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
            <Text style={[styles.addBtnText, { color: c.primary }]}>Replay Demo</Text>
          </Pressable>
        </View>
      )}

      {activeSettingsSection === "plaid" && <>
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <PlanFeatureGate feature="plaid_sync" compact>
        <PlaidLinkButton colors={c} onConnected={refreshBankData} />
        </PlanFeatureGate>
        <Pressable
          onPress={handleStatementImport}
          style={({ pressed }) => [styles.balanceSaveFullBtn, { backgroundColor: c.primary, opacity: pressed ? 0.78 : 1 }]}
        >
          <Feather name="upload" size={15} color={c.primaryForeground} />
          <Text style={[styles.balanceSaveBtnText, { color: c.primaryForeground }]}>Import a bank statement</Text>
        </Pressable>
      </View>
      </>}

      {activeSettingsSection === "notifications" && <>
      <SLabel c={c} text="Phone notifications" />
      <NotificationSettings />
      </>}

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
            const canRemove = canRemoveHouseholdMember(activeHousehold?.role, member.role, member.isCurrentUser);
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
                {(assignableRoles.length > 0 || canRemove) && (
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
                    {canRemove ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${label} from household`}
                        onPress={() => handleRemoveHouseholdMember(member.userId, label)}
                        disabled={householdBusy}
                        style={[styles.memberRemoveButton, { borderColor: c.destructive + "66" }]}
                      >
                        <Feather name="user-minus" size={13} color={c.destructive} />
                        <Text style={[styles.memberActionText, { color: c.destructive }]}>Remove</Text>
                      </Pressable>
                    ) : null}
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
      <SLabel c={c} text="Planning Tools" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <Text style={[styles.planningModeIntro, { color: c.mutedForeground }]}>Turn either tool on or off. You can use zero-based budgeting with Snowball or Avalanche, and switching tools never removes saved data.</Text>
        <View style={styles.planningModeList}>
          <PlanningToolToggle
            c={c}
            icon="pie-chart"
            label="Zero-Based Budget"
            description="Give every dollar a job across spending, savings, and debt."
            enabled={settings.zeroBasedBudgetEnabled}
            disabled={!canEditHousehold}
            onPress={() => {
              if (settings.zeroBasedBudgetEnabled) void updateSettings({ zeroBasedBudgetEnabled: false });
              else setZeroBudgetIntroVisible(true);
            }}
          />
          <PlanningToolToggle
            c={c}
            icon="trending-down"
            label="Debt Payoff Plan"
            description="Show Snowball or Avalanche recommendations and safe extra payments."
            enabled={settings.debtPayoffEnabled}
            disabled={!canEditHousehold}
            onPress={() => void updateSettings({ debtPayoffEnabled: !settings.debtPayoffEnabled })}
          />
        </View>
        <Text style={[styles.planningModeDescription, { color: c.mutedForeground }]}>
          {settings.zeroBasedBudgetEnabled && settings.debtPayoffEnabled
            ? "Balanced view: category assignments first, followed by your debt payoff plan."
            : settings.zeroBasedBudgetEnabled
              ? "Budget view: focus on income, assignments, and category availability."
              : settings.debtPayoffEnabled
                ? "Debt view: keep cash-flow tracking with payoff recommendations."
                : "Tracking view: focus on balances, bills, transactions, and forecasts."}
        </Text>
      </View>

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
      <SLabel c={c} text={settings.zeroBasedBudgetEnabled ? "Budget Categories" : "Spending Categories"} />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        {settings.zeroBasedBudgetEnabled && <Pressable
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
        </Pressable>}
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
      {settings.debtPayoffEnabled && <>
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
      </>}
      <SLabel c={c} text="Forecast Controls" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <View>
          <Text style={[styles.switchLabel, { color: c.foreground, marginBottom: 2 }]}>Forecast Safety</Text>
          <Text style={[styles.switchDesc, { color: c.mutedForeground, marginBottom: 10 }]}>Protect this minimum balance across your selected forecast window.</Text>
          <View style={[styles.safetyFields, useStackedSettingsFields && styles.formRowStacked]}>
            <View style={[styles.safetyField, useStackedSettingsFields && styles.formFieldStacked]}>
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
            <View style={[styles.safetyField, useStackedSettingsFields && styles.formFieldStacked]}>
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
      <SLabel c={c} text="Transaction Reconciliation" />
      <PlanFeatureGate feature="transaction_matching" compact>
        <ReviewCenter key={activeHousehold?.householdId ?? activeHousehold?.budgetId ?? "personal"} />
      </PlanFeatureGate>
      {/* Legacy rules-based Review Center removed. Data remains in Supabase for rollback.
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
      </>}

      <PlanFeatureGate feature="connected_insights" compact>
      <SLabel c={c} text="Transaction Review Queue" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <View style={[styles.priorityNote, { backgroundColor: c.primary + "12", borderRadius: 10, marginTop: 0, marginBottom: 12 }]}>
          <Feather name="inbox" size={14} color={c.primary} />
          <Text style={[styles.priorityNoteText, { color: c.mutedForeground }]}>
            This is your money inbox. I’ll put transactions here when I should not guess — duplicates, imports, unusual amounts, unclear categories, possible bills, or household edits.
          </Text>
        </View>
        {growthNotice ? <Text style={[styles.feedbackNotice, { color: c.success }]}>{growthNotice}</Text> : null}
        <View style={styles.growthMetricGrid}>
          <View style={[styles.growthMetric, { backgroundColor: c.muted }]}>
            <Text style={[styles.growthMetricValue, { color: c.primary }]}>{reviewTransactions.length}</Text>
            <Text style={[styles.growthMetricLabel, { color: c.mutedForeground }]}>Items to check</Text>
          </View>
          <View style={[styles.growthMetric, { backgroundColor: c.muted }]}>
            <Text style={[styles.growthMetricValue, { color: c.destructive }]}>${reviewImpactSummary.moneyOut.toFixed(0)}</Text>
            <Text style={[styles.growthMetricLabel, { color: c.mutedForeground }]}>Money out</Text>
          </View>
          <View style={[styles.growthMetric, { backgroundColor: c.muted }]}>
            <Text style={[styles.growthMetricValue, { color: c.success }]}>${reviewImpactSummary.moneyIn.toFixed(0)}</Text>
            <Text style={[styles.growthMetricLabel, { color: c.mutedForeground }]}>Money in</Text>
          </View>
        </View>
        <Text style={[styles.reviewSummaryLine, { color: c.mutedForeground }]}>
          Net impact: <Text style={{ color: reviewImpactSummary.net >= 0 ? c.success : c.destructive }}>{formatSignedMoney(reviewImpactSummary.net)}</Text>
          {"  •  "}
          {transactionRules.length} saved {transactionRules.length === 1 ? "rule" : "rules"}
        </Text>
        {transactionRules.length ? (
          <Pressable
            onPress={() => void handleApplySavedRules()}
            style={({ pressed }) => [styles.balanceSaveFullBtn, { backgroundColor: c.primary, opacity: pressed ? 0.78 : 1, marginTop: 12 }]}
          >
            <Feather name="zap" size={15} color={c.primaryForeground} />
            <Text style={[styles.balanceSaveBtnText, { color: c.primaryForeground }]}>Apply Saved Rules</Text>
          </Pressable>
        ) : null}
        {reviewTransactions.slice(0, 8).map(({ item, transaction }, index) => (
          <View key={item.transactionId} style={[styles.growthListRow, { borderTopWidth: index ? 1 : 0, borderTopColor: c.border }]}>
            <View style={[styles.dataIcon, { backgroundColor: item.priority === "high" ? c.destructive + "18" : c.primary + "18" }]}>
              <Feather name={item.priority === "high" ? "alert-triangle" : "check-square"} size={17} color={item.priority === "high" ? c.destructive : c.primary} />
            </View>
            <View style={styles.dataBody}>
              <View style={styles.reviewItemTitleRow}>
                <Text style={[styles.dataLabel, { color: c.foreground, flex: 1 }]} numberOfLines={1}>{transaction?.description ?? "Transaction"}</Text>
                <Text style={[styles.reviewItemAmount, { color: (transaction?.amount ?? 0) >= 0 ? c.success : c.destructive }]}>
                  {formatSignedMoney(transaction?.amount ?? 0)}
                </Text>
              </View>
              <Text style={[styles.reviewItemMeta, { color: c.mutedForeground }]}>
                {formatReviewDate(transaction?.date)} • {reviewMoneyLabel(transaction?.amount ?? 0)} • {transaction?.category || "Uncategorized"}
              </Text>
              <Text style={[styles.dataDesc, { color: c.mutedForeground }]}>{item.summary}</Text>
              <Text style={[styles.growthTinyText, { color: c.mutedForeground }]}>{item.reasons.map(reason => reason.replace(/_/g, " ")).join(" • ")}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.growthActionRow}>
                {categories.slice(0, 5).map(category => (
                  <Pressable
                    key={`${item.transactionId}-${category}`}
                    onPress={() => void handleCategorizeReview(item.transactionId, category)}
                    style={({ pressed }) => [styles.growthPillButton, { backgroundColor: c.muted, borderColor: c.border, opacity: pressed ? 0.72 : 1 }]}
                  >
                    <Text style={[styles.growthPillButtonText, { color: c.mutedForeground }]}>{category}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
            <View style={styles.reviewActionStack}>
              <Pressable
                onPress={() => handleApproveReview(item.transactionId)}
                style={({ pressed }) => [styles.growthSmallButton, { backgroundColor: c.success + "18", opacity: pressed ? 0.72 : 1 }]}
              >
                <Text style={[styles.growthSmallButtonText, { color: c.success }]}>Approve</Text>
              </Pressable>
              <Pressable
                onPress={() => handleCreateRuleFromReview(item.transactionId)}
                style={({ pressed }) => [styles.growthSmallButton, { backgroundColor: c.primary + "18", opacity: pressed ? 0.72 : 1 }]}
              >
                <Text style={[styles.growthSmallButtonText, { color: c.primary }]}>Rule</Text>
              </Pressable>
              <Pressable
                onPress={() => handleIgnoreReview(item.transactionId)}
                style={({ pressed }) => [styles.growthSmallButton, { backgroundColor: c.muted, opacity: pressed ? 0.72 : 1 }]}
              >
                <Text style={[styles.growthSmallButtonText, { color: c.mutedForeground }]}>Ignore</Text>
              </Pressable>
              <Pressable
                onPress={() => handleDeleteReviewTransaction(item.transactionId, transaction?.description ?? "Transaction")}
                style={({ pressed }) => [styles.growthSmallButton, { backgroundColor: c.destructive + "14", opacity: pressed ? 0.72 : 1 }]}
              >
                <Text style={[styles.growthSmallButtonText, { color: c.destructive }]}>Delete</Text>
              </Pressable>
            </View>
          </View>
        ))}
        {!reviewTransactions.length && (
          <View style={[styles.priorityNote, { backgroundColor: c.success + "12", borderRadius: 10, marginTop: 12 }]}>
            <Feather name="check-circle" size={14} color={c.success} />
            <Text style={[styles.priorityNoteText, { color: c.mutedForeground }]}>
              You’re caught up. When FlowLedger sees a transaction that needs your decision, it will show here with approve, categorize, rule, ignore, or delete options.
            </Text>
          </View>
        )}
      </View>
      </PlanFeatureGate>
      */}
      </>}

      {activeSettingsSection === "subscriptions" && <>
      <PlanFeatureGate feature="connected_insights" compact>
      <SLabel c={c} text="Subscription Cleanup" />
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <View style={[styles.priorityNote, { backgroundColor: c.warning + "12", borderRadius: 10, marginTop: 0, marginBottom: 12 }]}>
          <Feather name="repeat" size={14} color={c.warning} />
          <Text style={[styles.priorityNoteText, { color: c.mutedForeground }]}>
            I use this screen for recurring charges that need cleanup. Detected Activity patterns show first; subscription-style bills already in your Bills tab are shown below so you know they are being tracked.
          </Text>
        </View>
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
              <View style={styles.subscriptionActionRow}>
                <Pressable
                  onPress={() => handleMarkSubscription(subscription, "keep")}
                  style={({ pressed }) => [styles.growthPillButton, { backgroundColor: c.success + "14", borderColor: c.success + "44", opacity: pressed ? 0.72 : 1 }]}
                >
                  <Text style={[styles.growthPillButtonText, { color: c.success }]}>Keep</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handleCreateBillFromSubscription(subscription)}
                  style={({ pressed }) => [styles.growthPillButton, { backgroundColor: c.primary + "18", borderColor: c.primary + "44", opacity: pressed ? 0.72 : 1 }]}
                >
                  <Text style={[styles.growthPillButtonText, { color: c.primary }]}>Create bill</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleMarkSubscription(subscription, "not_subscription")}
                  style={({ pressed }) => [styles.growthPillButton, { backgroundColor: c.muted, borderColor: c.border, opacity: pressed ? 0.72 : 1 }]}
                >
                  <Text style={[styles.growthPillButtonText, { color: c.mutedForeground }]}>Not subscription</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleMarkSubscription(subscription, "cancelled")}
                  style={({ pressed }) => [styles.growthPillButton, { backgroundColor: c.destructive + "14", borderColor: c.destructive + "44", opacity: pressed ? 0.72 : 1 }]}
                >
                  <Text style={[styles.growthPillButtonText, { color: c.destructive }]}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ))}
        {subscriptionBillHints.length ? (
          <View style={{ marginTop: subscriptions.length ? 14 : 4 }}>
            <Text style={[styles.dataLabel, { color: c.foreground, marginBottom: 6 }]}>Already scheduled as bills</Text>
            {subscriptionBillHints.slice(0, 8).map((bill, index) => (
              <View key={bill.id} style={[styles.growthListRow, { borderTopWidth: index ? 1 : 0, borderTopColor: c.border }]}>
                <View style={[styles.dataIcon, { backgroundColor: c.primary + "18" }]}>
                  <Feather name="calendar" size={17} color={c.primary} />
                </View>
                <View style={styles.dataBody}>
                  <Text style={[styles.dataLabel, { color: c.foreground }]} numberOfLines={1}>{bill.name}</Text>
                  <Text style={[styles.dataDesc, { color: c.mutedForeground }]}>
                    ${Math.max(0, bill.amount).toFixed(2)} • {recurringBillCadenceLabel(bill.frequency)} • due day {bill.due_day}
                  </Text>
                  <Text style={[styles.growthTinyText, { color: c.mutedForeground }]}>
                    This is already in Bills, so I won’t ask you to create it again.
                  </Text>
                </View>
              </View>
            ))}
            <Pressable
              onPress={() => router.push("/(tabs)/bills")}
              style={({ pressed }) => [styles.balanceSaveFullBtn, { backgroundColor: c.primary, opacity: pressed ? 0.78 : 1, marginTop: 10 }]}
            >
              <Feather name="file-text" size={15} color={c.primaryForeground} />
              <Text style={[styles.balanceSaveBtnText, { color: c.primaryForeground }]}>Open Bills</Text>
            </Pressable>
          </View>
        ) : null}
        {!subscriptions.length && !subscriptionBillHints.length && (
          <View style={[styles.priorityNote, { backgroundColor: c.muted, borderRadius: 10, marginTop: 12 }]}>
            <Feather name="search" size={14} color={c.mutedForeground} />
            <Text style={[styles.priorityNoteText, { color: c.mutedForeground }]}>
              I have not found subscription patterns yet. Repeated monthly or weekly Activity entries will appear here, and subscription-style recurring bills will show here once you add them.
            </Text>
          </View>
        )}
      </View>
      </PlanFeatureGate>
      </>}

      {activeSettingsSection === "reports" && <>
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
                {plan.safeMonthlyContribution > 0 ? (
                  <Pressable
                    onPress={() => handleAddSafeGoalContribution(plan.goalId)}
                    style={({ pressed }) => [styles.growthInlineButton, { backgroundColor: c.primary + "18", borderColor: c.primary + "44", opacity: pressed ? 0.72 : 1 }]}
                  >
                    <Feather name="plus-circle" size={13} color={c.primary} />
                    <Text style={[styles.growthSmallButtonText, { color: c.primary }]}>Add safe contribution</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        })}
        {!goalFundingPlans.length && (
          <Text style={[styles.emptyText, { color: c.mutedForeground }]}>Add a goal from the plus button and I’ll turn it into a funding plan that respects your safety floor.</Text>
        )}
      </View>
      </>}

      {activeSettingsSection === "children" && <>
      <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        {growthNotice ? <Text style={[styles.feedbackNotice, { color: c.success }]}>{growthNotice}</Text> : null}
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
        <View style={[styles.childForm, { borderColor: c.border, backgroundColor: c.muted }]}>
          <TextInput
            value={childName}
            onChangeText={setChildName}
            placeholder="Child name"
            placeholderTextColor={c.mutedForeground}
            style={[styles.childInput, { color: c.foreground, borderColor: c.border, backgroundColor: c.card }]}
          />
          <View style={[styles.childFormRow, useStackedSettingsFields && styles.formRowStacked]}>
            <TextInput
              value={childAllowanceText}
              onChangeText={setChildAllowanceText}
              placeholder="Weekly allowance"
              placeholderTextColor={c.mutedForeground}
              keyboardType="decimal-pad"
              style={[styles.childHalfInput, useStackedSettingsFields && styles.formInputStacked, { color: c.foreground, borderColor: c.border, backgroundColor: c.card }]}
            />
            <TextInput
              value={childGoalText}
              onChangeText={setChildGoalText}
              placeholder="Savings goal"
              placeholderTextColor={c.mutedForeground}
              keyboardType="decimal-pad"
              style={[styles.childHalfInput, useStackedSettingsFields && styles.formInputStacked, { color: c.foreground, borderColor: c.border, backgroundColor: c.card }]}
            />
          </View>
          <Pressable
            onPress={() => void handleAddChildProfile()}
            style={({ pressed }) => [styles.balanceSaveFullBtn, { backgroundColor: c.primary, opacity: pressed ? 0.75 : 1 }]}
          >
            <Feather name="plus" size={15} color={c.primaryForeground} />
            <Text style={[styles.balanceSaveBtnText, { color: c.primaryForeground }]}>Add Child Profile</Text>
          </Pressable>
        </View>
        {childMoneySummary.map(child => (
          <View key={child.id} style={[styles.growthListRow, { borderTopWidth: 1, borderTopColor: c.border }]}>
            <View style={styles.dataBody}>
              <Text style={[styles.dataLabel, { color: c.foreground }]}>{child.name}</Text>
              <Text style={[styles.dataDesc, { color: c.mutedForeground }]}>{child.message}</Text>
            </View>
            <Text style={[styles.incomeMonthly, { color: c.primary }]}>{child.progress}%</Text>
            <Pressable
              onPress={() => {
                const profile = childProfiles.find(item => item.id === child.id);
                if (profile) handleRemoveChildProfile(profile);
              }}
              hitSlop={10}
            >
              <Feather name="trash-2" size={15} color={c.destructive} />
            </Pressable>
          </View>
        ))}
        {!childMoneySummary.length && (
          <Text style={[styles.emptyText, { color: c.mutedForeground }]}>No child profiles yet. Add one to start testing allowance, savings goals, and kid-safe money coaching without exposing adult controls.</Text>
        )}
      </View>
      </>}

      {activeSettingsSection === "backup" && <>
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

      {activeSettingsSection === "deleted" && <RecentlyDeletedTransactions />}

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
        visible={zeroBudgetIntroVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setZeroBudgetIntroVisible(false)}
      >
        <Pressable style={styles.infoOverlay} onPress={() => setZeroBudgetIntroVisible(false)}>
          <Pressable style={[styles.infoSheet, { backgroundColor: c.card, borderColor: c.border }]} onPress={() => undefined}>
            <View style={styles.infoSheetHeader}>
              <View style={[styles.infoSheetIcon, { backgroundColor: c.primary + "18" }]}>
                <Feather name="pie-chart" size={20} color={c.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.infoSheetEyebrow, { color: c.primary }]}>Planning tool</Text>
                <Text style={[styles.infoSheetTitle, { color: c.foreground }]}>Use Zero-Based Budget</Text>
              </View>
            </View>
            <Text style={[styles.infoSheetDesc, { color: c.mutedForeground }]}>FlowLedger will use planned take-home income, bills, savings, and debt to help you give every dollar a job. This does not turn off your debt payoff plan.</Text>
            <View style={styles.zeroBudgetIntroSteps}>
              {["Confirm monthly income", "Review suggested assignments", "Reach $0 left to assign"].map((step, index) => (
                <View key={step} style={styles.zeroBudgetIntroStep}>
                  <View style={[styles.zeroBudgetIntroNumber, { backgroundColor: c.primary + "18" }]}><Text style={[styles.zeroBudgetIntroNumberText, { color: c.primary }]}>{index + 1}</Text></View>
                  <Text style={[styles.switchLabel, { color: c.foreground, flex: 1 }]}>{step}</Text>
                </View>
              ))}
            </View>
            <Pressable
              onPress={async () => {
                await updateSettings({ zeroBasedBudgetEnabled: true });
                setZeroBudgetIntroVisible(false);
                router.push("/(tabs)/category-budget" as any);
              }}
              style={({ pressed }) => [styles.infoDoneButton, { backgroundColor: c.primary, opacity: pressed ? 0.82 : 1 }]}
            >
              <Text style={[styles.infoDoneText, { color: c.primaryForeground }]}>Turn on and set up this month</Text>
            </Pressable>
            <Pressable onPress={() => setZeroBudgetIntroVisible(false)} style={styles.zeroBudgetIntroLater}>
              <Text style={[styles.switchDesc, { color: c.mutedForeground }]}>Not now</Text>
            </Pressable>
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

function PlanningToolToggle({ c, icon, label, description, enabled, disabled, onPress }: {
  c: any;
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  description: string;
  enabled: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: enabled, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.planningModeOption,
        {
          backgroundColor: enabled ? c.primary + "16" : c.muted,
          borderColor: enabled ? c.primary : c.border,
          opacity: disabled ? 0.55 : pressed ? 0.78 : 1,
        },
      ]}
    >
      <View style={[styles.planningModeIcon, { backgroundColor: enabled ? c.primary : c.card }]}>
        <Feather name={icon} size={17} color={enabled ? c.primaryForeground : c.mutedForeground} />
      </View>
      <View style={styles.planningModeCopy}>
        <Text style={[styles.planningModeTitle, { color: c.foreground }]}>{label}</Text>
        <Text style={[styles.planningModeShort, { color: c.mutedForeground }]}>{description}</Text>
      </View>
      <View style={[styles.planningToolSwitch, { backgroundColor: enabled ? c.primary : c.border }]}>
        <View style={[styles.planningToolThumb, { backgroundColor: c.primaryForeground, transform: [{ translateX: enabled ? 18 : 0 }] }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroller: { flex: 1 },
  content: { width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: 16 },
  settingsSectionIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  card: { padding: 16, marginBottom: 20, borderWidth: 1, borderColor: "rgba(148,163,184,0.12)", shadowColor: "#000", shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.18, shadowRadius: 22, elevation: 5 },
  planningModeIntro: { fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 18, marginBottom: 12 },
  planningModeList: { gap: 9 },
  planningModeOption: { minHeight: 66, borderWidth: 1, borderRadius: 16, padding: 11, flexDirection: "row", alignItems: "center", gap: 11 },
  planningModeIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  planningModeCopy: { flex: 1 },
  planningModeTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  planningModeShort: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },
  planningModeDescription: { fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 18, marginTop: 12 },
  planningToolSwitch: { width: 44, height: 26, borderRadius: 13, padding: 3, justifyContent: "center" },
  planningToolThumb: { width: 20, height: 20, borderRadius: 10 },
  zeroBudgetIntroSteps: { gap: 10, marginTop: 16, marginBottom: 4 },
  zeroBudgetIntroStep: { flexDirection: "row", alignItems: "center", gap: 10 },
  zeroBudgetIntroNumber: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  zeroBudgetIntroNumberText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  zeroBudgetIntroLater: { minHeight: 42, alignItems: "center", justifyContent: "center" },
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
  memberRemoveButton: { minHeight: 30, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 5 },
  activityRow: { flexDirection: "row", alignItems: "flex-start", gap: 9, borderTopWidth: 1, paddingTop: 10, marginTop: 10 },
  activityIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  activityInfo: { flex: 1, minWidth: 0 },
  activityText: { fontSize: 12, fontFamily: "Inter_700Bold", lineHeight: 17 },
  roleRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  roleButton: { flex: 1, minWidth: 88, borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  roleButtonText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  inviteCodeBox: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 10 },
  inviteCodeLabel: { fontSize: 10, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },
  inviteCodeText: { fontSize: 22, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.8 },
  joinRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  joinInput: { flex: 1, minWidth: 0, borderWidth: 1, height: 44 },
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
  reviewSummaryLine: { fontSize: 12, fontFamily: "Inter_700Bold", lineHeight: 17, marginTop: -2, marginBottom: 8 },
  growthListRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  growthTinyText: { fontSize: 11, fontFamily: "Inter_500Medium", lineHeight: 15, marginTop: 3 },
  growthSmallButton: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
  growthSmallButtonText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  growthActionRow: { paddingTop: 8, paddingRight: 8, gap: 8 },
  growthPillButton: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  growthPillButtonText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  reviewItemTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  reviewItemAmount: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  reviewItemMeta: { fontSize: 11, fontFamily: "Inter_700Bold", lineHeight: 15, marginTop: 2 },
  reviewActionStack: { alignItems: "flex-end", gap: 6, marginLeft: 8 },
  subscriptionActionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  growthInlineButton: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7, marginTop: 8 },
  childForm: { borderWidth: 1, borderRadius: 16, padding: 12, marginTop: 14, gap: 10 },
  childFormRow: { width: "100%", flexDirection: "row", gap: 10 },
  childInput: { width: "100%", minWidth: 0, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, fontFamily: "Inter_500Medium" },
  childHalfInput: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 13, fontFamily: "Inter_500Medium" },
  formRowStacked: { flexDirection: "column" },
  formFieldStacked: { flex: 0, width: "100%" },
  formInputStacked: { flex: 0, width: "100%" },

  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  switchInfo: { flex: 1, marginRight: 12 },
  switchLabel: { fontSize: 15, fontFamily: "Inter_500Medium" },
  switchDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
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
  safetyFields: { width: "100%", flexDirection: "row", gap: 10 },
  safetyField: { flex: 1, minWidth: 0 },

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

