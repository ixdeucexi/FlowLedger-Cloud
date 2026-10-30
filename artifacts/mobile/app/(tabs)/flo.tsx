import { useMoneyPrivacy } from "@/context/MoneyPrivacyContext";
import { MoneyPrivacyToggle } from "@/components/privacy/MoneyPrivacyControls";
import { PrivacyPressable as Pressable, PrivacyText as Text, PrivacyTextInput as TextInput, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import Feather from "@expo/vector-icons/Feather";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Share, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useMembership } from "@/context/MembershipContext";
import { useBudget } from "@/context/BudgetContext";
import { BasicFlo } from "@/components/BasicFlo";
import { FloCreationForm } from "@/components/FloCreationForm";
import { FLO_FORM_TITLES } from "@/lib/floCreationForm";
import { FloCreationCard } from "@/components/FloCreationCard";
import { FloSafetyStopModal } from "@/components/FloSafetyStopModal";
import { buildBucketSafetyStop, type SafetyStopWarning } from "@/lib/safetyStop";
import { commitFloCreation, readFloCreationReceipt, parseFloCreationResult, type FloCreationResult, type FloCreationDraft, type FloCreationFormInput } from "@/lib/floCreation";
import { FloConversationBar } from "@/components/FloConversationBar";
import { FloGroundedAnswer } from "@/components/FloGroundedAnswer";
import { FloLogo } from "@/components/FloLogo";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { useColors } from "@/hooks/useColors";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import { isCashFlowTransaction } from "@/lib/billMatching";
import { isBillEligibleForUpcomingPlan } from "@/lib/billEligibility";
import { type FloFacts } from "@/lib/flo";
import { createFloAiConsent, floAiConsentStorageKey, parseFloAiConsent } from "@/lib/floAiConsent";
import { humanizeFloText } from "@/lib/floLanguage";
import { exportFloHistoryText, floConversationContext, floConversationForRequest, floPreferencesReadyForScope, floProposalMatchesAuthoritative, isFloRequestGenerationCurrent, nextFloRequestGeneration, type FloReviewProposal } from "@/lib/floExperience";
import { DEFAULT_FLO_PREFERENCES, readFloPreferences, saveFloPreferences, type FloPreferences } from "@/lib/floPreferences";
import {
  createFloConversation,
  createFloId,
  confirmFloRecurringBillProposal,
  deleteAllFloConversations,
  deleteFloConversation,
  listAllFloMessages,
  listFloConversations,
  listFloMessages,
  readFloHouseholdMemory,
  readAuthoritativeFloProposal,
  renameFloConversation,
  searchFloConversationContent,
  streamFloChat,
  updateFloHouseholdMemory,
  type FloConversation,
  type FloStoredMessage,
  type FloSource,
} from "@/lib/floChat";
import {
  reduceFloChat,
  type FloChatState,
} from "@/lib/floPolicy";
import { floFailureDisplay, type FloVerifiedFallback } from "@/lib/floStream";
import { useFloVolatileSession } from "@/context/FloVolatileSessionContext";
import type { FloVolatileLease, FloVolatileSnapshot } from "@/lib/floVolatileSession";
import { floV4PreviewEnabled } from "@/lib/floV4Preview";
import { summarizeMonthlyBills } from "@/lib/monthlySummary";
import { buildDecisionHistory } from "@/lib/decisionHistory";
import { buildDecisionRiskAlerts } from "@/lib/decisionRisk";
import { buildCategoryPlan } from "@/lib/categoryPlanning";
import { categoryBudgetStorageKey, loadCategoryBudgets, readCategoryBudgetCache, subscribeCategoryBudgets } from "@/lib/categoryBudgetStore";
import { DEFAULT_DECISION_HUB_SETTINGS } from "@/lib/decisionHubSettings";
import { localDateString } from "@/lib/dateLabels";
import { buildPaydayReviewPlan } from "@/lib/paydayReview";
import { buildAlgorithmSuite } from "@/lib/algorithmSuite";
import { calendarVisibleForecastEvents, groupForecastEvents } from "@/lib/forecastDisplay";

const initialChat: FloChatState = { messages: [], sending: false };
const storeCaptureChat: FloChatState = {
  sending: false,
  messages: [
    {
      id: "store-capture-question",
      role: "user",
      text: "Can I afford an extra $100 toward Harbor Card?",
    },
    {
      id: "store-capture-answer",
      role: "flo",
      text: "Yes. Your plan stays positive through the next payday after reserving upcoming bills. Adding $100 to Harbor Card would leave $2,630 safe to spend this month.",
    },
  ],
};

function moneyValue(value: unknown): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString(undefined, { style: "currency", currency: "USD" }) : "Unavailable";
}

/** History can check an existing command, but it never executes one. */
async function readHistoryCreationReceipts(messages: FloStoredMessage[], householdId: string, budgetId: string | null | undefined): Promise<Record<string, FloCreationResult>> {
  if (!budgetId) return {};
  const rows = await Promise.all(messages.filter(message => message.role === "flo" && message.creation && (message.creation.status === "ready" || message.creation.status === "saved")).map(async message => {
    const commandId = message.creation?.commandId ?? message.creation?.receipt?.commandId;
    if (!commandId) return null;
    const saved = await readFloCreationReceipt(commandId, householdId, budgetId).catch(() => null);
    return saved?.status === "saved" ? [message.id, saved] as const : null;
  }));
  return Object.fromEntries(rows.filter((row): row is readonly [string, FloCreationResult] => row !== null));
}

export default function FloScreen() {
  const moneyPrivacy = useMoneyPrivacy();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ prompt?: string; promptId?: string; sourceRoute?: string; entityType?: string; entityId?: string; date?: string; label?: string }>();
  const router = useRouter();
  const isDesktop = useDesktopExperience();
  const { user } = useAuth();
  const { isFeatureLocked, previewTier, isAdmin } = useMembership();
  const { activeHousehold, bills, billDateMoves, transactions, decisions, settings, forecastConfidence, retryBudgetLoad, getDailyBalances, getCashFlow, getMonthlyBills, getBillMonthlyTotal, getBillOccurrencesInMonth, getDebtMonthSettlements, getIncomeOccurrencesInMonth, getPaidAmount, getTransactionsForMonth, categories, incomes, goals, demoMode, canEditHousehold, accounts, previewTransactionSafetyStop } = useBudget();
  const categoryBudgetScope = useMemo(() => ({
    userId: user?.id,
    householdId: activeHousehold?.householdId,
    budgetId: activeHousehold?.budgetId,
  }), [activeHousehold?.budgetId, activeHousehold?.householdId, user?.id]);
  const floProLocked = isFeatureLocked("flo_account_chat");
  const floV4Preview = floV4PreviewEnabled(isAdmin);
  const floAccessLocked = floProLocked && !floV4Preview;
  const volatileSession = useFloVolatileSession();
  const volatileStore = volatileSession.store;
  const [chat, dispatch] = useReducer(reduceFloChat, demoMode ? storeCaptureChat : initialChat);
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, number>>({});
  const decisionHubSettings = DEFAULT_DECISION_HUB_SETTINGS;
  const [input, setInput] = useState("");
  const [conversations, setConversations] = useState<FloConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [olderMessageCursor, setOlderMessageCursor] = useState<string | null>(null);
  const [sourcesByMessageId, setSourcesByMessageId] = useState<Record<string, FloSource[]>>({});
  const [followUpsByMessageId, setFollowUpsByMessageId] = useState<Record<string, string[]>>({});
  const [proposalByMessageId, setProposalByMessageId] = useState<Record<string, FloReviewProposal | null>>({});
  const [creationFormSession, setCreationFormSession] = useState<{ id: string; revision: number; owner: string; conversationId: string | null; creation: FloCreationResult; open: boolean } | null>(null);
  const formFeedbackRevisionRef = useRef(0);
  const [creationFormBusy, setCreationFormBusy] = useState(false);
  const creationFormRef = useRef(creationFormSession);
  creationFormRef.current = creationFormSession;
  const formSubmitRef = useRef<{ owner: string; id: string } | null>(null);
  const [creationSaving, setCreationSaving] = useState(false);
  const [creationByMessageId, setCreationByMessageId] = useState<Record<string, FloCreationResult>>({});
  const retryCreationRef = useRef<{ owner: string; creation: FloCreationResult; expectedBudgetId: string; text: string; userMessageId: string; assistantMessageId: string } | null>(null);
  const activeCreationDraftRef = useRef<{ scope: string; draft: FloCreationDraft } | null>(null);
  const creationOperationRef = useRef<{ commandId: string; generation: number; scope: string; submitted: boolean; settled: boolean; saved?: FloCreationResult } | null>(null);
  const [creationSafety, setCreationSafety] = useState<{ warning: SafetyStopWarning; proceed: () => void; cancel: () => void } | null>(null);
  const [confirmedProposalIds, setConfirmedProposalIds] = useState<Set<string>>(new Set());
  const [groundingByMessageId, setGroundingByMessageId] = useState<Record<string, { dataAsOf?: string | null; coverage?: string; partial?: boolean; caveat?: string }>>(
    demoMode
      ? { "store-capture-answer": { dataAsOf: "2026-08-25T01:30:00-05:00", coverage: "Complete for this question" } }
      : {},
  );
  const [floPreferences, setFloPreferences] = useState<FloPreferences>(DEFAULT_FLO_PREFERENCES);
  const [preferencesScopeKey, setPreferencesScopeKey] = useState<string | null>(null);
  const [memoryScopeKey, setMemoryScopeKey] = useState<string | null>(null);
  const [reviewProposal, setReviewProposal] = useState<FloReviewProposal | null>(null);
  const [proposalConfirmState, setProposalConfirmState] = useState<"idle" | "reviewing" | "confirming" | "failed">("idle");
  const [proposalConfirmError, setProposalConfirmError] = useState("");
  const [proposalReceipt, setProposalReceipt] = useState<{ previousAmount: number; newAmount: number; confirmedAt: string } | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [retryAllowed, setRetryAllowed] = useState(true);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [lastPrompt, setLastPrompt] = useState("");
  const [aiConsentAccepted, setAiConsentAccepted] = useState(false);
  const [aiConsentReady, setAiConsentReady] = useState(false);
  const [aiConsentPrompt, setAiConsentPrompt] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const handledPromptRef = useRef<string | null>(null);
  const consumedRoutePromptsRef = useRef(new Set<string>());
  const inputRef = useRef<TextInput>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const skipConversationLoadRef = useRef<string | null>(null);
  const retryRequestRef = useRef<{ text: string; userMessageId: string; assistantMessageId: string; conversationId: string | null; creationDraft?: FloCreationDraft; creationOwner?: string; creationForm?: FloCreationFormInput } | null>(null);
  const requestGenerationRef = useRef(0);
  const activeRequestRef = useRef<number | null>(null);
  const historyMutationRef = useRef(false);
  const preferenceEditGenerationRef = useRef(0);
  const floDataScopeKey = `${user?.id ?? "anonymous"}:${activeHousehold?.householdId ?? "none"}`;
  const creationOwnerScopeKey = `${floDataScopeKey}:${activeHousehold?.budgetId ?? "none"}:${activeHousehold?.role ?? "none"}:${demoMode ? "demo" : "real"}:${canEditHousehold ? "edit" : "read"}`;
  const creationOwnerEpochRef = useRef({ scope: creationOwnerScopeKey, epoch: 0 });
  if (creationOwnerEpochRef.current.scope !== creationOwnerScopeKey) {
    creationOwnerEpochRef.current = { scope: creationOwnerScopeKey, epoch: creationOwnerEpochRef.current.epoch + 1 };
    // Invalidate callbacks synchronously, including A→B→A before effects settle.
    requestGenerationRef.current = nextFloRequestGeneration(requestGenerationRef.current);
    activeRequestRef.current = null;
  }
  const creationOwnerKey = `${creationOwnerScopeKey}:${creationOwnerEpochRef.current.epoch}`;
  const creationOwnerKeyRef = useRef(creationOwnerKey);
  creationOwnerKeyRef.current = creationOwnerKey;
  const creationResetOwnerRef = useRef(creationOwnerKey);
  const preferencesReady = floPreferencesReadyForScope(preferencesScopeKey, floDataScopeKey);
  const preferencesControlsReady = preferencesReady && floPreferencesReadyForScope(memoryScopeKey, floDataScopeKey);
  const floDataScopeKeyRef = useRef(floDataScopeKey);
  floDataScopeKeyRef.current = floDataScopeKey;
  const [chatScopeKey, setChatScopeKey] = useState<string | null>(null);
  const volatileLeaseRef = useRef<FloVolatileLease | null>(null);
  const [volatileRenderOwner, setVolatileRenderOwner] = useState<number | null>(null);
  const volatileLatestRef = useRef<{ owner: number | null; snapshot: FloVolatileSnapshot }>({ owner: null, snapshot: { messages: [], sources: {}, followups: {}, grounding: {} } });
  volatileLatestRef.current = { owner: volatileRenderOwner, snapshot: { messages: chat.messages, handledPromptKey: handledPromptRef.current, creations: creationByMessageId, sources: sourcesByMessageId, followups: followUpsByMessageId, grounding: groundingByMessageId } };
  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;
  const now = useMemo(() => new Date(), []);
  const today = localDateString(now);

  useEffect(() => {
    if (creationResetOwnerRef.current === creationOwnerKey) return;
    creationResetOwnerRef.current = creationOwnerKey;
    streamAbortRef.current?.abort(); streamAbortRef.current = null;
    dispatch({ type: "stop" });
    activeCreationDraftRef.current = null; retryCreationRef.current = null; retryRequestRef.current = null; creationOperationRef.current = null;
    setCreationSafety(null); setCreationSaving(false); setCreationByMessageId({}); setCreationFormSession(null); setCreationFormBusy(false); formSubmitRef.current = null;
  }, [creationOwnerKey]);

  useEffect(() => {
    let cancelled = false;
    setAiConsentReady(false);
    setAiConsentAccepted(false);
    setAiConsentPrompt(null);
    if (!user?.id) {
      setAiConsentReady(true);
      return () => { cancelled = true; };
    }
    void AsyncStorage.getItem(floAiConsentStorageKey(user.id))
      .then(value => {
        if (!cancelled) setAiConsentAccepted(parseFloAiConsent(value, user.id));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setAiConsentReady(true);
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    requestGenerationRef.current = nextFloRequestGeneration(requestGenerationRef.current);
    const loadGeneration = requestGenerationRef.current;
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    activeRequestRef.current = null;
    setChatScopeKey(floDataScopeKey);
    activeCreationDraftRef.current = null;
    retryCreationRef.current = null;
    creationOperationRef.current = null;
    setCreationByMessageId({}); setCreationFormSession(null); setCreationFormBusy(false); formSubmitRef.current = null;
    setCreationSafety(null);
    setCreationSaving(false);
    const claimed = floV4Preview && !demoMode ? volatileStore.claim(volatileSession.scope) : null;
    volatileLeaseRef.current = claimed?.lease ?? null;
    setVolatileRenderOwner(claimed?.lease.owner ?? null);
    const restored = claimed?.snapshot;
    if (restored?.handledPromptKey) handledPromptRef.current = restored.handledPromptKey;
    const cleanup = () => {
      cancelled = true;
      if (!floV4Preview) return;
      const lease = volatileLeaseRef.current;
      if (lease && volatileLatestRef.current.owner === lease.owner) volatileStore.save(lease,volatileLatestRef.current.snapshot);
      volatileStore.release(lease);
      requestGenerationRef.current = nextFloRequestGeneration(requestGenerationRef.current);
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      activeRequestRef.current = null;
    };
    retryRequestRef.current = null;
    setRetryAllowed(true);
    setInput("");
    setConversations([]);
    setActiveConversationId(null);
    setLastPrompt("");
    dispatch({ type: "hydrate", messages: demoMode ? storeCaptureChat.messages : restored?.messages ?? [] });
    setCreationByMessageId(restored?.creations ?? {});
    setSourcesByMessageId(restored?.sources ?? {});
    setFollowUpsByMessageId(restored?.followups ?? {});
    setProposalByMessageId({});
    setGroundingByMessageId(restored?.grounding ?? (demoMode
      ? { "store-capture-answer": { dataAsOf: "2026-08-25T01:30:00-05:00", coverage: "Complete for this question" } }
      : {}));
    setOlderMessageCursor(null);
    setChatError(null);
    if (demoMode || floV4Preview || !user?.id || !activeHousehold?.householdId || floAccessLocked) {
      setConversations([]);
      setActiveConversationId(null);
      return cleanup;
    }
    void listFloConversations(activeHousehold.householdId).then(next => {
      if (cancelled || loadGeneration !== requestGenerationRef.current) return;
      setConversations(next);
      setActiveConversationId(next[0]?.id ?? null);
    }).catch(() => {
      if (!cancelled && loadGeneration === requestGenerationRef.current) setChatError("Private Flo history is unavailable right now.");
    });
    return cleanup;
  }, [activeHousehold?.householdId, demoMode, floAccessLocked, floV4Preview, user?.id, volatileSession.scope, volatileSession.epoch, volatileStore]);

  useFocusEffect(useCallback(() => {
    if (!floV4Preview || demoMode || volatileStore.isCurrent(volatileLeaseRef.current)) return;
    const claimed = volatileStore.claim(volatileSession.scope);
    if (!claimed) return;
    requestGenerationRef.current = nextFloRequestGeneration(requestGenerationRef.current);
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    activeRequestRef.current = null;
    retryRequestRef.current = null;
    activeCreationDraftRef.current = null;
    retryCreationRef.current = null;
    creationOperationRef.current = null;
    setCreationByMessageId({}); setCreationFormSession(null); setCreationFormBusy(false); formSubmitRef.current = null;
    setCreationSafety(null);
    setCreationSaving(false);
    volatileLeaseRef.current = claimed.lease;
    setVolatileRenderOwner(claimed.lease.owner);
    setChatScopeKey(floDataScopeKey);
    if (claimed.snapshot?.handledPromptKey) handledPromptRef.current = claimed.snapshot.handledPromptKey;
    dispatch({ type: "hydrate", messages: claimed.snapshot?.messages ?? [] });
    setCreationByMessageId(claimed.snapshot?.creations ?? {});
    setSourcesByMessageId(claimed.snapshot?.sources ?? {});
    setFollowUpsByMessageId(claimed.snapshot?.followups ?? {});
    setGroundingByMessageId(claimed.snapshot?.grounding ?? {});
    setProposalByMessageId({});
    setLastPrompt("");
    setInput("");
    setChatError(null);
    setRetryAllowed(true);
  }, [floV4Preview, demoMode, volatileStore, volatileSession.scope, volatileSession.epoch, floDataScopeKey]));

  useEffect(() => {
    const lease = volatileLeaseRef.current;
    if (floV4Preview && chatScopeKey === floDataScopeKey && lease && volatileRenderOwner === lease.owner) volatileStore.save(lease,volatileLatestRef.current.snapshot);
  }, [chat.messages, creationByMessageId, sourcesByMessageId, followUpsByMessageId, groundingByMessageId, chatScopeKey, floDataScopeKey, floV4Preview, volatileRenderOwner, volatileStore]);

  useEffect(() => {
    let cancelled = false;
    setPreferencesScopeKey(null);
    setMemoryScopeKey(null);
    setFloPreferences({ ...DEFAULT_FLO_PREFERENCES, historyEnabled: false });
    if (demoMode) {
      setPreferencesScopeKey(floDataScopeKey);
      setMemoryScopeKey(floDataScopeKey);
      return () => { cancelled = true; };
    }
    if (!user?.id || !activeHousehold?.householdId) return () => { cancelled = true; };
    const loadedScope = floDataScopeKey;
    const editGeneration = preferenceEditGenerationRef.current;
    const memoryPromise = readFloHouseholdMemory(activeHousehold.householdId, user.id).catch(() => ({ enabled: false, note: "" }));
    void readFloPreferences(user.id, activeHousehold.householdId).then(preferences => {
      if (cancelled || loadedScope !== floDataScopeKeyRef.current) return;
      setFloPreferences({ ...preferences, rememberPreferences: false, preferenceNote: "" });
      setPreferencesScopeKey(loadedScope);
      // History is a local preference. A slower memory read must not delay it
      // or later overwrite a privacy preference the user has just changed.
      void memoryPromise.then(memory => {
        if (!cancelled && loadedScope === floDataScopeKeyRef.current && editGeneration === preferenceEditGenerationRef.current) {
          setFloPreferences(previous => ({ ...previous, rememberPreferences: memory.enabled, preferenceNote: memory.enabled ? memory.note : "" }));
          setMemoryScopeKey(loadedScope);
        }
      });
    });
    return () => { cancelled = true; };
  }, [activeHousehold?.householdId, demoMode, user?.id, floDataScopeKey]);

  useEffect(() => {
    let cancelled = false;
    const requestGeneration = requestGenerationRef.current;
    const requestScopeKey = floDataScopeKey;
    const requestCreationOwner = creationOwnerKey;
    const requestBudget = activeHousehold?.budgetId;
    const requestHousehold = activeHousehold?.householdId;
    const requestIsCurrent = () => (
      !cancelled
      && requestGeneration === requestGenerationRef.current
      && requestScopeKey === floDataScopeKeyRef.current
      && requestCreationOwner === creationOwnerKeyRef.current
    );
    if (floV4Preview || !activeConversationId || floAccessLocked) return () => { cancelled = true; };
    if (skipConversationLoadRef.current === activeConversationId) {
      skipConversationLoadRef.current = null;
      return () => { cancelled = true; };
    }
    void listFloMessages(activeConversationId).then(page => {
      if (!requestIsCurrent()) return;
      dispatch({ type: "hydrate", messages: page.messages.map((message, index) => ({ id: message.id, role: message.role, text: message.creation?.status === "ready" ? "Checking this request’s saved status…" : message.text, contextEligible: message.creation?.status !== "ready" && message.status === "completed" && (message.role === "flo" || page.messages[index + 1]?.role === "flo" && page.messages[index + 1]?.status === "completed") })) });
      if (requestHousehold && !demoMode) void readHistoryCreationReceipts(page.messages, requestHousehold, requestBudget).then(saved => {
        if (!requestIsCurrent()) return;
        setCreationByMessageId(saved);
        for (const message of page.messages) {
          const receipt = saved[message.id];
          if (receipt) { dispatch({ type: "replace", id: message.id, text: receipt.prompt }); dispatch({ type: "complete", id: message.id, userId: receipt.receipt!.commandId }); }
          else if (message.creation?.status === "ready") dispatch({ type: "replace", id: message.id, text: "This earlier save is not confirmed. Check your records before adding it again." });
        }
      });
      setSourcesByMessageId(Object.fromEntries(page.messages.filter(message => message.sources.length).map(message => [message.id, message.sources])));
      setFollowUpsByMessageId(Object.fromEntries(page.messages.filter(message => message.followUps.length).map(message => [message.id, message.followUps])));
      void Promise.all(page.messages.filter(message => message.proposal?.kind === "recurring_bill_change").map(async message => {
        const authoritative = await readAuthoritativeFloProposal(message.proposal!.id);
        return floProposalMatchesAuthoritative(message.proposal!, authoritative) ? [message.id, authoritative] as const : null;
      })).then(rows => { if (requestIsCurrent()) setProposalByMessageId(Object.fromEntries(rows.filter((row): row is readonly [string, FloReviewProposal] => Boolean(row)))); }).catch(() => { if (requestIsCurrent()) setProposalByMessageId({}); });
      setGroundingByMessageId(Object.fromEntries(page.messages.filter(message => message.dataAsOf || message.partial || message.coverage || message.caveat).map(message => [message.id, { dataAsOf: message.dataAsOf, partial: message.partial, coverage: describeCoverage(message.coverage), caveat: message.caveat }])));
      setOlderMessageCursor(page.nextCursor);
    }).catch(() => {
      if (requestIsCurrent()) setChatError("This private chat could not be loaded.");
    });
    return () => { cancelled = true; };
  }, [activeConversationId, floDataScopeKey, floAccessLocked, floV4Preview, creationOwnerKey, activeHousehold?.budgetId, activeHousehold?.householdId, demoMode]);


  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(timer);
  }, [chat.messages.length, chat.sending]);

  const baseline = useMemo(() => {
    const output: { date: string; balance: number }[] = [];
    for (let index = 0; index < settings.forecast_horizon_months; index += 1) {
      const month = (now.getMonth() + index) % 12;
      const year = now.getFullYear() + Math.floor((now.getMonth() + index) / 12);
      getDailyBalances(month, year).forEach(day => output.push({
        date: `${year}-${String(month + 1).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`,
        balance: day.balance,
      }));
    }
    return output.filter(day => day.date >= today);
  }, [getDailyBalances, settings.forecast_horizon_months, today]);

  const upcoming = useMemo(() => bills
    .filter(bill => bill.is_recurring || bill.is_debt)
    .map(bill => {
      let date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(Math.min(bill.due_day, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())).padStart(2, "0")}`;
      if (date < today) {
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        date = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-${String(Math.min(bill.due_day, new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate())).padStart(2, "0")}`;
      }
      return { name: bill.name, amount: bill.amount, date };
    })
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(0, 5), [bills, today]);

  const categoryBudgetKey = useMemo(() => {
    const month = now.getMonth();
    const year = now.getFullYear();
    return categoryBudgetStorageKey(month, year, categoryBudgetScope);
  }, [categoryBudgetScope, today]);

  useEffect(() => {
    let cancelled = false;
    const month = now.getMonth();
    const year = now.getFullYear();
    const refreshCategoryBudgets = () => {
      setCategoryBudgets(readCategoryBudgetCache(month, year, categoryBudgetScope));
      void loadCategoryBudgets(categoryBudgetScope, month, year).then(next => {
        if (!cancelled) setCategoryBudgets(next);
      });
    };
    refreshCategoryBudgets();
    const unsubscribe = subscribeCategoryBudgets(refreshCategoryBudgets);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [categoryBudgetKey, categoryBudgetScope, now]);

  const categoryPlan = useMemo(() => {
    if (!settings.zeroBasedBudgetEnabled) return [];
    const month = now.getMonth();
    const year = now.getFullYear();
    const monthBills = getMonthlyBills(month, year)
      .filter(isBillEligibleForUpcomingPlan)
      .map(bill => ({
        category: bill.is_debt ? "Debt" : bill.category || "Other",
        amount: getBillMonthlyTotal(bill, month, year),
      }));
    const monthTransactions = getTransactionsForMonth(month, year)
      .filter(transaction => isCashFlowTransaction(transaction) && transaction.category !== "Income")
      .map(transaction => ({ category: transaction.category || "Other", amount: transaction.amount }));
    const rows = buildCategoryPlan(
      categories,
      monthBills,
      monthTransactions,
      Object.entries(categoryBudgets).map(([category, amount]) => ({ category, amount })),
    );
    const transactionDetails = getTransactionsForMonth(month, year)
      .filter(transaction => isCashFlowTransaction(transaction) && transaction.amount < 0 && transaction.category !== "Income");
    return rows.map(row => {
      const topTransaction = transactionDetails
        .filter(transaction => (transaction.category || "Other") === row.category)
        .sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount))[0];
      return {
        category: row.category,
        budgeted: row.budgeted,
        spent: row.spent,
        remaining: row.remaining,
        status: row.status,
        percentUsed: row.percentUsed,
        topTransaction: topTransaction ? {
          name: topTransaction.note?.trim() || row.category,
          amount: topTransaction.amount,
          date: topTransaction.date,
        } : undefined,
      };
    });
  }, [categories, categoryBudgets, getMonthlyBills, getBillMonthlyTotal, getTransactionsForMonth, now, settings.zeroBasedBudgetEnabled]);

  const decisionHistory = useMemo(
    () => buildDecisionHistory(decisions.filter(decision => decisionStillHasSource(decision, transactions)), today, now.toISOString()),
    [decisions, transactions, today, now],
  );

  const decisionRiskAlerts = useMemo(
    () => buildDecisionRiskAlerts(decisions, baseline, settings.safety_floor, today),
    [decisions, baseline, settings.safety_floor, today],
  );
  const paycheckPlan = useMemo(() => {
    return buildPaydayReviewPlan({ getDailyBalances }, now, settings.forecast_horizon_months, settings.safety_floor);
  }, [getBillMonthlyTotal, getBillOccurrencesInMonth, getDailyBalances, getDebtMonthSettlements, getIncomeOccurrencesInMonth, getMonthlyBills, getPaidAmount, now, settings.forecast_horizon_months, settings.safety_floor, today]);
  const facts = useMemo<FloFacts>(() => {
    const lowest = baseline.reduce(
      (best, day) => day.balance < best.balance ? day : best,
      baseline[0] ?? { date: today, balance: 0 },
    );
    const cashFlow = getCashFlow(now.getMonth(), now.getFullYear());
    const previousMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const previousCashFlow = getCashFlow(previousMonthDate.getMonth(), previousMonthDate.getFullYear());
    const month = now.getMonth();
    const year = now.getFullYear();
    const debtSettlements = getDebtMonthSettlements(month, year);
    const billSummary = summarizeMonthlyBills(
      getMonthlyBills(month, year).filter(isBillEligibleForUpcomingPlan),
      bill => bill.is_debt
        ? (debtSettlements.get(bill.id)?.configuredObligation
          ?? getBillMonthlyTotal(bill, month, year))
        : getBillMonthlyTotal(bill, month, year),
      bill => bill.is_debt
        ? (debtSettlements.get(bill.id)?.paidAmount
          ?? getPaidAmount(bill.id, month, year))
        : getPaidAmount(bill.id, month, year),
    );
    const currentMonth = today.slice(0, 7);
    const unallocatedExpenses = transactions.filter(transaction =>
      isCashFlowTransaction(transaction) && transaction.date.startsWith(currentMonth) && transaction.amount < 0 && !transaction.linked_bill_id
    );
    const todayForecastDay = getDailyBalances(month, year).find(day => day.day === now.getDate());
    const todayForecastGroups = groupForecastEvents(calendarVisibleForecastEvents(todayForecastDay?.events));
    const algorithmSuite = buildAlgorithmSuite({
      month,
      year,
      todayDay: now.getDate(),
      safetyFloor: settings.safety_floor,
      cashFlow,
      dailyBalances: getDailyBalances(month, year).map(day => ({
        day: day.day,
        income: day.income,
        bills: day.bills,
        expense: day.expense,
        net: day.net,
        balance: day.balance,
      })),
      bills: getMonthlyBills(month, year).map(bill => {
        const debtSettlement = bill.is_debt ? debtSettlements.get(bill.id) : undefined;
        return {
          id: bill.id,
          name: bill.name,
          amount: debtSettlement?.configuredObligation
            ?? getBillMonthlyTotal(bill, month, year),
          paidAmount: debtSettlement?.paidAmount
            ?? getPaidAmount(bill.id, month, year),
          occurrenceDays: getBillOccurrencesInMonth(bill, month, year),
          occurrenceSettlements: debtSettlement?.occurrences?.map(occurrence => ({
            day: Number(occurrence.occurrenceDate.slice(8, 10)),
            requiredAmount: occurrence.configuredObligation,
            paidAmount: occurrence.paidAmount,
          })),
          importance: bill.smart_priority,
          category: bill.category || "Other",
          due_day: bill.due_day,
          is_debt: bill.is_debt,
          is_recurring: bill.is_recurring,
          includeInSnowball: bill.include_in_snowball !== false,
          balance: bill.balance,
          interest_rate: bill.interest_rate,
        };
      }),
      transactions: getTransactionsForMonth(month, year).filter(isCashFlowTransaction).map(transaction => ({
        id: transaction.id,
        date: transaction.date,
        amount: transaction.amount,
        category: transaction.category || "Other",
        note: transaction.note,
      })),
      incomes: incomes.map(income => ({
        id: income.id,
        name: income.name,
        amount: income.amount,
        frequency: income.frequency,
      })),
      goals: goals.map(goal => ({
        id: goal.id,
        name: goal.name,
        target_amount: goal.target_amount,
        current_amount: goal.current_amount,
        target_date: goal.target_date,
        goal_type: goal.goal_type,
      })),
      categoryPlan,
      forecastConfidence,
      settings: decisionHubSettings,
    });
    return {
      balanceToday: baseline[0]?.balance ?? 0,
      lowestBalance: lowest.balance,
      lowestBalanceDate: lowest.date,
      safetyFloor: settings.safety_floor,
      monthlyIncome: cashFlow.monthlyIncome,
      monthlyBills: cashFlow.totalBillsDue,
      monthlyRemaining: cashFlow.remaining,
      billsLeftAmount: billSummary.remaining,
      billsLeftCount: billSummary.unpaidCount,
      billProgressPercent: billSummary.billProgressPercent,
      previousMonthIncome: previousCashFlow.monthlyIncome,
      previousMonthBills: previousCashFlow.totalBillsDue,
      previousMonthRemaining: previousCashFlow.remaining,
      unallocatedSpendingThisMonth: unallocatedExpenses.reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0),
      unallocatedTransactionCount: unallocatedExpenses.length,
      upcoming,
      activePlans: decisions.filter(decision => decision.status === "planned" || decision.status === "calendar").length,
      forecastConfidence: forecastConfidence.level,
      sourceTypes: ["forecast", "bill", "transaction", "account", "debt", "goal", "decision"],
      todayForecast: {
        date: today,
        projectedClose: todayForecastDay?.balance ?? baseline[0]?.balance ?? 0,
        net: todayForecastDay?.net ?? 0,
        sources: todayForecastGroups.flatMap(group => group.events.map(item => ({
          group: group.title,
          label: item.label,
          amount: item.event.amount,
          status: item.statusLabel,
        }))),
      },
      categoryPlan,
      paycheckPlan,
      billDateMoves: billDateMoves.map(move => ({
        id: move.id,
        billId: move.bill_id,
        billName: bills.find(bill => bill.id === move.bill_id)?.name ?? "Bill",
        fromDate: move.from_date,
        toDate: move.to_date,
        customAmount: move.custom_amount,
        isSkipped: move.is_skipped,
      })),
      debts: bills
        .filter(bill => bill.is_debt && bill.balance > 0)
        .map(bill => ({
          id: bill.id,
          name: bill.name,
          balance: bill.balance,
          minimumPayment: bill.amount,
          dueDay: bill.due_day,
        })),
      recurringBills: bills
        .filter(bill => bill.is_recurring && !bill.is_debt)
        .map(bill => ({
          id: bill.id,
          name: bill.name,
          amount: bill.amount,
          dueDay: bill.due_day,
          category: bill.category || "Other",
        })),
      stability: {
        stageLabel: algorithmSuite.stability.stageLabel,
        status: algorithmSuite.stability.status,
        protectedAmount: algorithmSuite.stability.protectedAmount,
        reserveTarget: algorithmSuite.stability.reserveTarget,
        reserveProgress: algorithmSuite.stability.reserveProgress,
        backupTarget: algorithmSuite.stability.backupTarget,
        backupProgress: algorithmSuite.stability.backupProgress,
        protectedDays: algorithmSuite.stability.protectedDays,
        safeUntilPayday: algorithmSuite.stability.safeUntilPayday,
        nextPaycheckLabel: algorithmSuite.stability.nextPaycheckLabel,
        headline: algorithmSuite.stability.headline,
        explanation: algorithmSuite.stability.explanation,
        nextAction: algorithmSuite.stability.nextAction,
      },
      flowScore: {
        score: algorithmSuite.flowScore.score,
        label: algorithmSuite.flowScore.label,
        topReason: algorithmSuite.flowScore.topReason,
        topAction: algorithmSuite.flowScore.topAction,
        positiveFactors: algorithmSuite.flowScore.positiveFactors,
        negativeFactors: algorithmSuite.flowScore.negativeFactors,
      },
      safeCushion: {
        amount: algorithmSuite.safeCushion.amount,
        label: algorithmSuite.safeCushion.label,
        status: algorithmSuite.safeCushion.status,
        lowestBalance: algorithmSuite.safeCushion.lowestBalance,
        lowestDay: algorithmSuite.safeCushion.lowestDay,
        safetyFloor: algorithmSuite.safeCushion.safetyFloor,
        reservedAmount: algorithmSuite.safeCushion.reservedAmount,
        topReason: algorithmSuite.safeCushion.topReason,
        topAction: algorithmSuite.safeCushion.topAction,
      },
      purchaseDecision: {
        safeNowLimit: algorithmSuite.purchaseDecision.safeNowLimit,
        action: algorithmSuite.purchaseDecision.action,
        detail: algorithmSuite.purchaseDecision.detail,
        nextMove: algorithmSuite.purchaseDecision.nextMove,
        bestDay: algorithmSuite.purchaseDecision.bestDay,
        confidence: algorithmSuite.purchaseDecision.confidence,
      },
      billPriority: {
        nextBill: algorithmSuite.billPriority.nextBill
          ? {
            name: algorithmSuite.billPriority.nextBill.name,
            amount: algorithmSuite.billPriority.nextBill.amount,
            dueDay: algorithmSuite.billPriority.nextBill.dueDay,
            reason: algorithmSuite.billPriority.nextBill.reason,
            urgency: algorithmSuite.billPriority.nextBill.urgency,
          }
          : null,
        summary: algorithmSuite.billPriority.summary,
        nextMove: algorithmSuite.billPriority.nextMove,
        bills: algorithmSuite.billPriority.bills.map(bill => ({
          name: bill.name,
          amount: bill.amount,
          dueDay: bill.dueDay,
          reason: bill.reason,
          urgency: bill.urgency,
        })),
      },
      paydaySplitAlgo: {
        bills: algorithmSuite.paydaySplit.bills,
        spending: algorithmSuite.paydaySplit.spending,
        savings: algorithmSuite.paydaySplit.savings,
        debt: algorithmSuite.paydaySplit.debt,
        goals: algorithmSuite.paydaySplit.goals,
        dollars: algorithmSuite.paydaySplit.dollars,
        summary: algorithmSuite.paydaySplit.summary,
        nextMove: algorithmSuite.paydaySplit.nextMove,
      },
      cashFlowGap: {
        startDay: algorithmSuite.cashFlowGap.startDay,
        endDay: algorithmSuite.cashFlowGap.endDay,
        lowestBalance: algorithmSuite.cashFlowGap.lowestBalance,
        detail: algorithmSuite.cashFlowGap.detail,
      },
      debtPayoff: settings.debtPayoffEnabled ? {
        nextDebtName: algorithmSuite.debtPayoff.nextDebtName,
        snowballBalance: algorithmSuite.debtPayoff.snowballBalance,
        avalancheName: algorithmSuite.debtPayoff.avalancheName,
        cashFlowReliefName: algorithmSuite.debtPayoff.cashFlowReliefName,
        cashFlowReliefAmount: algorithmSuite.debtPayoff.cashFlowReliefAmount,
        totalMonthlyMinimum: algorithmSuite.debtPayoff.totalMonthlyMinimum,
        currentRolloverExtra: algorithmSuite.debtPayoff.currentRolloverExtra,
        nextMove: algorithmSuite.debtPayoff.nextMove,
        status: algorithmSuite.debtPayoff.status,
        detail: algorithmSuite.debtPayoff.detail,
      } : undefined,
      spendingLimit: {
        daily: algorithmSuite.spendingLimit.daily,
        weekly: algorithmSuite.spendingLimit.weekly,
        status: algorithmSuite.spendingLimit.status,
        paceLabel: algorithmSuite.spendingLimit.paceLabel,
        remainingDays: algorithmSuite.spendingLimit.remainingDays,
        detail: algorithmSuite.spendingLimit.detail,
      },
      extraMoneyRouter: {
        amount: algorithmSuite.extraMoneyRouter.amount,
        recommendation: algorithmSuite.extraMoneyRouter.recommendation,
        targetLabel: algorithmSuite.extraMoneyRouter.targetLabel,
        detail: algorithmSuite.extraMoneyRouter.detail,
        nextMove: algorithmSuite.extraMoneyRouter.nextMove,
      },
      monthlyHealth: {
        score: algorithmSuite.monthlyHealth.score,
        grade: algorithmSuite.monthlyHealth.grade,
        summary: algorithmSuite.monthlyHealth.summary,
      },
      smartReminder: {
        reminders: algorithmSuite.smartReminder.reminders,
      },
      decisionHistory: {
        due: decisionHistory.due,
        upcoming: decisionHistory.upcoming,
        completed: decisionHistory.completed,
        changed: decisionHistory.changed,
        risky: decisionRiskAlerts.map(alert => ({
          name: alert.name,
          date: alert.date,
          plannedAmount: alert.plannedAmount,
          status: "upcoming",
          varianceLabel: `$${alert.shortfall.toFixed(2)} more room to add`,
        })),
      },
    };
  }, [baseline, today, settings.safety_floor, getCashFlow, getDailyBalances, getMonthlyBills, getBillMonthlyTotal, getBillOccurrencesInMonth, getDebtMonthSettlements, getPaidAmount, getTransactionsForMonth, transactions, upcoming, decisions, forecastConfidence, categoryPlan, paycheckPlan, billDateMoves, bills, decisionHistory, decisionRiskAlerts, now, incomes, goals, decisionHubSettings]);

  const quickPrompts = useMemo(() => {
    const entity = Array.isArray(params.entityType) ? params.entityType[0] : params.entityType;
    const contextual = entity === "transactions" ? ["What should I review in my recent activity?"]
      : entity === "bills" ? ["Which bills are due next?"]
      : entity === "goals" ? ["How are my spending buckets doing?"]
      : entity === "accounts" || entity === "account" ? ["What are my recorded account balances?"]
      : entity === "forecast" ? ["What does my forecast look like?"] : [];
    return Array.from(new Set([
      ...contextual,
      "Which bills are due next?",
      "What are my recorded account balances?",
      "How is my debt payoff going?",
      "How do I add a spending bucket?",
    ])).slice(0, 4);
  }, [params.entityType]);

  const closeCreationForm = (id: string) => {
    const session = creationFormRef.current;
    if (!session || session.id !== id || session.owner !== creationOwnerKeyRef.current || session.conversationId !== activeConversationIdRef.current || formSubmitRef.current || activeRequestRef.current !== null || (creationOperationRef.current?.submitted && !creationOperationRef.current.settled)) return;
    setCreationFormSession(previous => previous?.id === id ? { ...previous, open: false } : previous);
  };

  const reopenCreationForm = (id: string) => {
    const session = creationFormRef.current;
    if (!session || session.id !== id || session.owner !== creationOwnerKeyRef.current || session.conversationId !== activeConversationIdRef.current || formSubmitRef.current || activeRequestRef.current !== null || historyMutationRef.current) return;
    setChatError(null);
    setCreationFormSession(previous => previous?.id === id ? { ...previous, open: true } : previous);
  };

  const submitCreationForm = async (id: string, creationForm: FloCreationFormInput) => {
    const session = creationFormRef.current;
    if (!session || !session.open || session.id !== id || session.owner !== creationOwnerKeyRef.current || session.conversationId !== activeConversationIdRef.current || session.creation.kind !== creationForm.kind || formSubmitRef.current || activeRequestRef.current !== null || historyMutationRef.current || demoMode || !canEditHousehold) return;
    const ticket = { owner: session.owner, id };
    formSubmitRef.current = ticket; setCreationFormBusy(true);
    try { await send(`Add ${FLO_FORM_TITLES[creationForm.kind]}`, false, false, creationForm); }
    finally { if (formSubmitRef.current === ticket && ticket.owner === creationOwnerKeyRef.current) { formSubmitRef.current = null; setCreationFormBusy(false); } }
  };

  const cancelCreationDraft = (messageId: string) => {
    const draft = activeCreationDraftRef.current;
    const operation = creationOperationRef.current;
    const session = creationFormRef.current;
    const ownsForm = session?.id === messageId && session.owner === creationOwnerKeyRef.current && session.conversationId === activeConversationIdRef.current;
    const ownsDraft = draft?.scope === creationOwnerKeyRef.current && draft.draft === creationByMessageId[messageId]?.draft;
    if (activeRequestRef.current !== null || formSubmitRef.current || (operation?.submitted && !operation.settled) || (!ownsForm && !ownsDraft)) return;
    if (ownsDraft) activeCreationDraftRef.current = null;
    if (ownsForm) setCreationFormSession(null);
    setCreationByMessageId(previous => { const next = { ...previous }; delete next[messageId]; return next; });
  };

  const startNewConversation = () => {
    if (historyMutationRef.current || (creationOperationRef.current?.scope === creationOwnerKeyRef.current && creationOperationRef.current.submitted && !creationOperationRef.current.settled)) return;
    activeCreationDraftRef.current = null;
    retryCreationRef.current = null;
    creationOperationRef.current = null;
    setCreationByMessageId({}); setCreationFormSession(null); setCreationFormBusy(false); formSubmitRef.current = null;
    setCreationSafety(null);
    setCreationSaving(false);
    requestGenerationRef.current = nextFloRequestGeneration(requestGenerationRef.current);
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    activeRequestRef.current = null;
    setChatScopeKey(floDataScopeKeyRef.current);
    if (floV4Preview) {
      const lease = volatileStore.reset(volatileLeaseRef.current);
      volatileLeaseRef.current = lease;
      setVolatileRenderOwner(lease?.owner ?? null);
    }
    setInput("");
    setLastPrompt("");
    setRetryAllowed(true);
    setAiConsentPrompt(null);
    setActiveConversationId(null);
    setOlderMessageCursor(null);
    setSourcesByMessageId({});
    setFollowUpsByMessageId({});
    setProposalByMessageId({});
    setGroundingByMessageId({});
    setChatError(null);
    retryRequestRef.current = null;
    dispatch({ type: "hydrate", messages: [] });
  };

  const selectConversation = (conversationId: string) => {
    if (activeRequestRef.current !== null || historyMutationRef.current || (creationOperationRef.current?.scope === creationOwnerKeyRef.current && creationOperationRef.current.submitted && !creationOperationRef.current.settled)) return;
    activeCreationDraftRef.current = null;
    retryCreationRef.current = null;
    creationOperationRef.current = null;
    setCreationByMessageId({}); setCreationFormSession(null); setCreationFormBusy(false); formSubmitRef.current = null;
    setCreationSafety(null);
    setCreationSaving(false);
    requestGenerationRef.current = nextFloRequestGeneration(requestGenerationRef.current);
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setChatError(null);
    retryRequestRef.current = null;
    setActiveConversationId(conversationId);
  };

  const renameConversation = async (conversationId: string, title: string) => {
    await renameFloConversation(conversationId, title);
    setConversations(previous => previous.map(conversation => conversation.id === conversationId ? { ...conversation, title: title.trim().slice(0, 80) } : conversation));
  };

  const removeConversation = async (conversationId: string) => {
    if (activeRequestRef.current !== null || historyMutationRef.current) throw new Error("Wait for Flo to finish before deleting history.");
    historyMutationRef.current = true;
    setHistoryBusy(true);
    try {
      const mutationGeneration = nextFloRequestGeneration(requestGenerationRef.current);
      requestGenerationRef.current = mutationGeneration;
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      await deleteFloConversation(conversationId);
      if (mutationGeneration !== requestGenerationRef.current) return;
      const remaining = conversations.filter(conversation => conversation.id !== conversationId);
      setConversations(remaining);
      if (conversationId === activeConversationId) setActiveConversationId(remaining[0]?.id ?? null);
      if (!remaining.length) dispatch({ type: "hydrate", messages: [] });
    } finally {
      historyMutationRef.current = false;
      setHistoryBusy(false);
    }
  };

  const removeAllConversations = async () => {
    if (!activeHousehold?.householdId) throw new Error("An active household is required.");
    if (activeRequestRef.current !== null || historyMutationRef.current) throw new Error("Wait for Flo to finish before deleting history.");
    historyMutationRef.current = true;
    setHistoryBusy(true);
    try {
      const mutationGeneration = nextFloRequestGeneration(requestGenerationRef.current);
      requestGenerationRef.current = mutationGeneration;
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      await deleteAllFloConversations(activeHousehold.householdId);
      if (mutationGeneration !== requestGenerationRef.current) return;
      setConversations([]);
      setActiveConversationId(null);
      setSourcesByMessageId({});
      setFollowUpsByMessageId({});
      setProposalByMessageId({});
      setGroundingByMessageId({});
      dispatch({ type: "hydrate", messages: demoMode ? storeCaptureChat.messages : [] });
    } finally {
      historyMutationRef.current = false;
      setHistoryBusy(false);
    }
  };

  const exportConversations = async () => {
    const sections: string[] = [];
    for (const conversation of conversations) {
      const messages = await listAllFloMessages(conversation.id);
      sections.push(`${conversation.title}\n${messages.map(message => `${message.role === "flo" ? "Flo" : "You"}: ${message.text}${message.caveat ? `\nCaveat: ${message.caveat}` : ""}`).join("\n\n")}`);
    }
    const content = `${exportFloHistoryText(activeHousehold?.name ?? "Personal household", [])}\n${sections.join("\n\n---\n\n")}`;
    await Share.share({ title: "FlowLedger Flo history", message: content });
  };

  const updatePreferences = (preferences: FloPreferences) => {
    if (!preferencesControlsReady || activeRequestRef.current !== null || historyMutationRef.current) return;
    preferenceEditGenerationRef.current += 1;
    if (preferences.historyEnabled !== floPreferences.historyEnabled) retryRequestRef.current = null;
    setFloPreferences(preferences);
    if (user?.id && activeHousehold?.householdId) {
      void Promise.all([
        saveFloPreferences(user.id, activeHousehold.householdId, preferences),
        updateFloHouseholdMemory({ householdId: activeHousehold.householdId, userId: user.id, enabled: preferences.rememberPreferences, preferences: { note: preferences.preferenceNote.trim().slice(0, 240) } }),
      ]).catch(() => setChatError("Flo privacy preferences could not be saved."));
    }
  };

  const openProposalReview = (proposal: FloReviewProposal) => {
    if (proposal.kind !== "recurring_bill_change") return;
    setProposalConfirmState("reviewing");
    setProposalConfirmError("");
    setProposalReceipt(null);
    setReviewProposal(null);
    void readAuthoritativeFloProposal(proposal.id).then(authoritative => {
      if (!floProposalMatchesAuthoritative(proposal, authoritative) || authoritative.kind !== "recurring_bill_change") {
        throw new Error("proposal_review_mismatch");
      }
      setReviewProposal(authoritative);
      setProposalConfirmState("idle");
    }).catch(() => {
      setReviewProposal(null);
      setChatError("Flo could not verify this proposed change. Your plan was not changed.");
      setProposalConfirmState("failed");
    });
  };

  const confirmProposal = async () => {
    if (!reviewProposal || reviewProposal.kind !== "recurring_bill_change" || proposalConfirmState === "confirming") return;
    setProposalConfirmState("confirming");
    setProposalConfirmError("");
    try {
      const authoritative = await readAuthoritativeFloProposal(reviewProposal.id);
      if (!floProposalMatchesAuthoritative(reviewProposal, authoritative) || authoritative.status !== "review") throw new Error("proposal_review_mismatch");
      const receipt = await confirmFloRecurringBillProposal(reviewProposal.id);
      setProposalReceipt(receipt);
      setConfirmedProposalIds(previous => new Set(previous).add(reviewProposal.id));
      setProposalConfirmState("idle");
      retryBudgetLoad();
    } catch (error) {
      const code = error instanceof Error ? error.message.toLocaleLowerCase() : "";
      const message = code.includes("proposal_stale")
        ? "This bill changed since Flo prepared the review. Ask Flo to create a fresh change."
        : code.includes("proposal_expired") || code.includes("proposal_not_reviewable")
          ? "This review expired. Ask Flo to prepare it again."
          : code.includes("proposal_role_denied") || code.includes("proposal_access_denied")
            ? "Your household role cannot confirm this change."
            : code.includes("proposal_pro_required")
              ? "Confirming Flo changes is planned for Pro. Your plan was not changed."
              : "This change could not be confirmed. Your plan was not changed.";
      setProposalConfirmError(message);
      setProposalConfirmState("failed");
    }
  };

  const searchHistory = useCallback((query: string) => searchFloConversationContent(conversations.map(item => item.id), query), [conversations]);

  const loadOlderMessages = async () => {
    if (!activeConversationId || !olderMessageCursor) return;
    const requestConversationId = activeConversationId;
    const requestCursor = olderMessageCursor;
    const requestGeneration = requestGenerationRef.current;
    const requestScopeKey = floDataScopeKey;
    const requestCreationOwner = creationOwnerKey;
    const requestBudget = activeHousehold?.budgetId;
    const requestHousehold = activeHousehold?.householdId;
    const requestIsCurrent = () => (
      requestGeneration === requestGenerationRef.current
      && requestScopeKey === floDataScopeKeyRef.current
      && requestConversationId === activeConversationIdRef.current
      && requestCreationOwner === creationOwnerKeyRef.current
    );
    try {
      const page = await listFloMessages(requestConversationId, requestCursor);
      if (!requestIsCurrent()) return;
      dispatch({ type: "prepend", messages: page.messages.map((message, index) => ({ id: message.id, role: message.role, text: message.creation?.status === "ready" ? "Checking this request’s saved status…" : message.text, contextEligible: message.creation?.status !== "ready" && message.status === "completed" && (message.role === "flo" || page.messages[index + 1]?.role === "flo" && page.messages[index + 1]?.status === "completed") })) });
      if (requestHousehold && !demoMode) void readHistoryCreationReceipts(page.messages, requestHousehold, requestBudget).then(saved => {
        if (!requestIsCurrent()) return;
        setCreationByMessageId(previous => ({ ...previous, ...saved }));
        for (const message of page.messages) {
          const receipt = saved[message.id];
          if (receipt) { dispatch({ type: "replace", id: message.id, text: receipt.prompt }); dispatch({ type: "complete", id: message.id, userId: receipt.receipt!.commandId }); }
          else if (message.creation?.status === "ready") dispatch({ type: "replace", id: message.id, text: "This earlier save is not confirmed. Check your records before adding it again." });
        }
      });
      setSourcesByMessageId(previous => ({ ...previous, ...Object.fromEntries(page.messages.filter(message => message.sources.length).map(message => [message.id, message.sources])) }));
      setFollowUpsByMessageId(previous => ({ ...previous, ...Object.fromEntries(page.messages.filter(message => message.followUps.length).map(message => [message.id, message.followUps])) }));
      setGroundingByMessageId(previous => ({ ...previous, ...Object.fromEntries(page.messages.filter(message => message.dataAsOf || message.partial || message.coverage || message.caveat).map(message => [message.id, { dataAsOf: message.dataAsOf, partial: message.partial, coverage: describeCoverage(message.coverage), caveat: message.caveat }])) }));
      const verifiedProposals = await Promise.all(page.messages.filter(message => message.proposal?.kind === "recurring_bill_change").map(async message => {
        const authoritative = await readAuthoritativeFloProposal(message.proposal!.id);
        return floProposalMatchesAuthoritative(message.proposal!, authoritative) ? [message.id, authoritative] as const : null;
      }));
      if (!requestIsCurrent()) return;
      setProposalByMessageId(previous => ({ ...previous, ...Object.fromEntries(verifiedProposals.filter((row): row is readonly [string, FloReviewProposal] => Boolean(row))) }));
      setOlderMessageCursor(page.nextCursor);
    } catch {
      if (requestIsCurrent()) setChatError("Older messages could not be loaded.");
    }
  };

  const stopStreaming = () => {
    const operation = creationOperationRef.current?.scope === creationOwnerKeyRef.current ? creationOperationRef.current : null;
    const saveSubmitted = operation?.submitted && !operation.settled;
    const savedCreation = operation?.saved;
    setCreationSafety(null);
    setCreationSaving(Boolean(saveSubmitted));
    activeCreationDraftRef.current = null;
    requestGenerationRef.current = nextFloRequestGeneration(requestGenerationRef.current);
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    activeRequestRef.current = null;
    const stoppedId = retryRequestRef.current?.assistantMessageId;
    if (stoppedId) {
      dispatch({ type: "replace", id: stoppedId, text: savedCreation?.prompt ?? (saveSubmitted ? "Response stopped. Your requested save may still finish. Retry the same question to check its status." : "Response stopped before Flo could verify an answer.") });
      setCreationByMessageId(previous => { const next = { ...previous }; if (savedCreation) next[stoppedId] = savedCreation; else delete next[stoppedId]; return next; });
      setSourcesByMessageId(previous => ({ ...previous, [stoppedId]: [] }));
      setFollowUpsByMessageId(previous => ({ ...previous, [stoppedId]: [] }));
      setProposalByMessageId(previous => ({ ...previous, [stoppedId]: null }));
      setGroundingByMessageId(previous => ({ ...previous, [stoppedId]: savedCreation ? {} : { partial: true, coverage: "No verified account data" } }));
    }
    dispatch({ type: "stop" });
    setRetryAllowed(true);
    setChatError(savedCreation ? null : saveSubmitted ? "The save may still be processing. Retry to check the same request." : "Response stopped. You can retry the last question.");
  };

  const send = async (text = input, retry = false, consentOverride = false, submittedForm?: FloCreationFormInput) => {
    const clean = text.trim();
    const recovery = retry && retryCreationRef.current?.owner === creationOwnerKey && retryCreationRef.current.text === clean ? retryCreationRef.current : null;
    const pendingSave = creationOperationRef.current;
    if (pendingSave?.scope === creationOwnerKey && pendingSave.submitted && !pendingSave.settled && !recovery) return;
    if (!clean || chat.sending || activeRequestRef.current !== null || historyMutationRef.current || floAccessLocked || !user?.id || !activeHousehold?.householdId) return;
    if (!aiConsentReady || !preferencesReady || chatScopeKey !== floDataScopeKey) return;
    if (floV4Preview && !volatileStore.isCurrent(volatileLeaseRef.current)) return;
    if (!aiConsentAccepted && !consentOverride) {
      setAiConsentPrompt(clean);
      return;
    }
    const requestDraft = retry && retryRequestRef.current?.text === clean && retryRequestRef.current.creationOwner === creationOwnerKey ? retryRequestRef.current.creationDraft : undefined;
    const retryForm = retry && retryRequestRef.current?.text === clean && retryRequestRef.current.creationOwner === creationOwnerKey ? retryRequestRef.current.creationForm : undefined;
    const creationForm = submittedForm ?? retryForm;
    const creationDraft = creationForm ? undefined : requestDraft ?? (activeCreationDraftRef.current?.scope === creationOwnerKey ? activeCreationDraftRef.current.draft : undefined);
    if (!recovery) retryCreationRef.current = null;
    setCreationSafety(null);
    creationOperationRef.current = null;
    const requestGeneration = nextFloRequestGeneration(requestGenerationRef.current);
    requestGenerationRef.current = requestGeneration;
    activeRequestRef.current = requestGeneration;
    const requestUserId = user.id;
    const requestHouseholdId = activeHousehold.householdId;
    const requestScopeKey = `${requestUserId}:${requestHouseholdId}`;
    const requestLease = volatileLeaseRef.current;
    const requestCreationOwnerKey = creationOwnerKey;
    const requestBudgetId = recovery?.expectedBudgetId ?? activeHousehold.budgetId;
    const requestIsCurrent = () => isFloRequestGenerationCurrent(requestGeneration, requestGenerationRef.current) && requestScopeKey === floDataScopeKeyRef.current && (!floV4Preview || volatileStore.isCurrent(requestLease));
    const creationIsCurrent = () => requestIsCurrent() && requestCreationOwnerKey === creationOwnerKeyRef.current && !demoMode && canEditHousehold && Boolean(requestBudgetId);
    setInput("");
    setChatError(null);
    setRetryAllowed(true);
    setLastPrompt(clean);
    const priorRequest = retry && retryRequestRef.current?.text === clean ? retryRequestRef.current : null;
    const userMessageId = recovery?.userMessageId ?? priorRequest?.userMessageId ?? createFloId();
    const assistantMessageId = recovery?.assistantMessageId ?? priorRequest?.assistantMessageId ?? createFloId();
    dispatch({ type: "submit", id: userMessageId, assistantId: assistantMessageId, text: clean });
    const historyEnabled = !floV4Preview && floPreferences.historyEnabled;
    let conversationId = floConversationForRequest(historyEnabled, priorRequest?.conversationId ?? activeConversationId);
    retryRequestRef.current = { text: clean, userMessageId, assistantMessageId, conversationId, creationDraft, creationForm, creationOwner: requestCreationOwnerKey };
    let reply = "";
    let completedAnswer = false;
    let creationCommit: Promise<void> | null = null;
    const creationReply: { current: string | null; saved?: FloCreationResult } = { current: null };
    const seenCreationCommands = new Set<string>();
    const handleCreationEvent = (value: FloCreationResult | null) => {
      const creation = parseFloCreationResult(value);
      if (!creationIsCurrent() || !requestBudgetId || activeRequestRef.current !== requestGeneration) return;
      if (!creation) { activeCreationDraftRef.current = null; setCreationFormSession(null); return; }
      if (creation.status === "needs_details") {
        activeCreationDraftRef.current = creation.draft?.householdId === requestHouseholdId ? { scope: requestCreationOwnerKey, draft: creation.draft } : null;
        setCreationByMessageId(previous => ({ ...previous, [assistantMessageId]: creation }));
        if (creation.kind) { setCreationFormBusy(true); setCreationFormSession({ id: assistantMessageId, revision: ++formFeedbackRevisionRef.current, owner: requestCreationOwnerKey, conversationId: historyEnabled ? conversationId : activeConversationIdRef.current, creation, open: true }); }
        return;
      }
      activeCreationDraftRef.current = null;
      if (creation.status === "unavailable") {
        const session = creationFormRef.current;
        if (creationForm && session?.owner === requestCreationOwnerKey && session.creation.kind === creationForm.kind && session.conversationId === activeConversationIdRef.current) setChatError(creation.prompt || "I couldn’t verify these details. Please try again.");
        return;
      }
      if (creation.status !== "ready" || creation.commandId !== userMessageId || creation.householdId !== requestHouseholdId || !creation.kind || !creation.payload || seenCreationCommands.has(creation.commandId)) return;
      seenCreationCommands.add(creation.commandId);
      retryCreationRef.current = { owner: requestCreationOwnerKey, creation: { ...creation, payload: { ...creation.payload } }, expectedBudgetId: requestBudgetId, text: clean, userMessageId, assistantMessageId };
      setCreationByMessageId(previous => ({ ...previous, [assistantMessageId]: creation }));
      const operation = { commandId: creation.commandId, generation: requestGeneration, scope: requestCreationOwnerKey, submitted: false, settled: false, saved: undefined as FloCreationResult | undefined };
      creationOperationRef.current = operation;
      const persist = async () => {
        if (!creationIsCurrent() || creationOperationRef.current !== operation || operation.submitted) return;
        operation.submitted = true;
        setCreationFormSession(null);
        setCreationSaving(true);
        setCreationSafety(null);
        try {
          const saved = await commitFloCreation(creation, requestBudgetId);
          if (!creationIsCurrent() || creationOperationRef.current !== operation) return;
          if (saved.status !== "saved" || saved.receipt?.commandId !== userMessageId || saved.receipt.householdId !== requestHouseholdId) throw new Error("creation_receipt_mismatch");
          operation.saved = saved;
          creationReply.saved = saved;
          creationReply.current = saved.prompt;
          setCreationByMessageId(previous => ({ ...previous, [assistantMessageId]: saved }));
          dispatch({ type: "replace", id: assistantMessageId, text: saved.prompt });
          dispatch({ type: "complete", id: assistantMessageId, userId: userMessageId });
          retryBudgetLoad();
        } catch {
          if (!creationIsCurrent() || creationOperationRef.current !== operation) return;
          creationReply.current = "I couldn’t verify the save. Retry the same question to check it safely.";
          dispatch({ type: "replace", id: assistantMessageId, text: creationReply.current });
          setCreationByMessageId(previous => ({ ...previous, [assistantMessageId]: { status: "unavailable", prompt: creationReply.current!, missingFields: [] } }));
          setChatError("The save could not be verified. Retry checks the same request.");
          setRetryAllowed(true);
        } finally {
          operation.settled = true;
          if (requestCreationOwnerKey === creationOwnerKeyRef.current && creationOperationRef.current === operation) setCreationSaving(false);
        }
      };
      const payload = creation.payload;
      const warning = creation.kind === "create_bucket" ? buildBucketSafetyStop({ name: String(payload.name), amount: Number(payload.target_amount), targetDate: String(payload.target_date), safetyFloor: settings.safety_floor, horizonMonths: settings.forecast_horizon_months, getDailyBalances })
        : creation.kind === "create_manual_transaction" && payload.direction === "expense" ? previewTransactionSafetyStop({ amount: -Number(payload.amount), date: String(payload.date), category: String(payload.category), note: String(payload.note), source: "manual", account_id: String(payload.account_id) }) : null;
      if (warning) {
        setCreationSafety({ warning, proceed: () => { if (creationIsCurrent() && creationOperationRef.current === operation) { creationCommit = persist(); void creationCommit; } }, cancel: () => {
          if (!creationIsCurrent() || creationOperationRef.current !== operation || operation.submitted) return;
          creationOperationRef.current = null; retryCreationRef.current = null; activeCreationDraftRef.current = null; setCreationSafety(null);
          setCreationByMessageId(previous => { const next = { ...previous }; delete next[assistantMessageId]; return next; });
          creationReply.current = "Nothing was added. Update the details below when you’re ready.";
          dispatch({ type: "replace", id: assistantMessageId, text: creationReply.current });
          setInput(clean); inputRef.current?.focus();
        } });
      } else creationCommit = persist();
    };
    const verifiedFallback: { current: FloVerifiedFallback | null } = { current: null };
    const streamFailure: { current: { code: string; message: string } | null } = { current: null };
    try {
      if (recovery) {
        // Explicit Retry reuses the exact canonical command, never a reinterpreted fragment.
        handleCreationEvent(recovery.creation);
        if (creationCommit) await creationCommit;
        if (!requestIsCurrent()) return;
        if (creationReply.current) dispatch({ type: "replace", id: assistantMessageId, text: creationReply.current });
        dispatch({ type: "stop" });
        return;
      }
      if (!conversationId && historyEnabled) {
        const created = await createFloConversation(requestUserId, requestHouseholdId, clean);
        if (!requestIsCurrent()) return;
        conversationId = created.id;
        skipConversationLoadRef.current = created.id;
        setConversations(previous => [created, ...previous]);
        setActiveConversationId(created.id);
        retryRequestRef.current = { text: clean, userMessageId, assistantMessageId, conversationId: created.id, creationDraft, creationForm, creationOwner: requestCreationOwnerKey };
      }
      const controller = new AbortController();
      streamAbortRef.current = controller;
      await streamFloChat({
        engine: floV4Preview ? "v4" : "v3",
        conversationId: conversationId ?? undefined,
        householdId: requestHouseholdId,
        userMessageId,
        assistantMessageId,
        text: clean,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        previewTier,
        creationDraft,
        creationForm,
        context: {
          route: Array.isArray(params.sourceRoute) ? params.sourceRoute[0] : params.sourceRoute,
          entityType: Array.isArray(params.entityType) ? params.entityType[0] : params.entityType,
          entityId: Array.isArray(params.entityId) ? params.entityId[0] : params.entityId,
          date: Array.isArray(params.date) ? params.date[0] : params.date,
          label: Array.isArray(params.label) ? params.label[0] : params.label,
        },
        historyEnabled,
        conversationContext: historyEnabled ? undefined : chatScopeKey === requestScopeKey ? floConversationContext(chat.messages, [userMessageId, assistantMessageId]) : [],
        signal: controller.signal,
        onEvent: event => {
          if (!requestIsCurrent()) return;
          if (event.type === "creation") {
            handleCreationEvent(event.creation);
          } else if (event.type === "meta") {
            setGroundingByMessageId(previous => ({ ...previous, [assistantMessageId]: { dataAsOf: event.dataAsOf, partial: event.partial, coverage: describeCoverage(event.coverage) } }));
          } else if (event.type === "status") {
            dispatch({ type: "status", id: assistantMessageId, text: event.message });
          } else if (event.type === "verified-fallback") {
            verifiedFallback.current = event.fallback;
          } else if (event.type === "text-delta") {
            reply += event.delta;
            if (!creationReply.current) dispatch({ type: "stream-delta", id: assistantMessageId, delta: event.delta });
          } else if (event.type === "sources") {
            setSourcesByMessageId(previous => ({ ...previous, [assistantMessageId]: event.sources }));
          } else if (event.type === "followups") {
            setFollowUpsByMessageId(previous => ({ ...previous, [assistantMessageId]: event.items }));
          } else if (!floV4Preview && event.type === "proposal" && event.proposal?.kind === "recurring_bill_change") {
            setProposalByMessageId(previous => ({ ...previous, [assistantMessageId]: event.proposal }));
          } else if (event.type === "error") {
            streamFailure.current = { code: event.code, message: event.message };
          } else if (event.type === "done") {
            completedAnswer = true;
            reply = creationReply.current ?? event.answer?.answer ?? event.text ?? reply;
            dispatch({ type: "replace", id: assistantMessageId, text: reply });
            if (event.answer) setGroundingByMessageId(previous => ({ ...previous, [assistantMessageId]: {
              ...previous[assistantMessageId],
              dataAsOf: event.answer?.dataAsOf ?? previous[assistantMessageId]?.dataAsOf,
              coverage: describeCoverage(event.answer?.coverage) ?? previous[assistantMessageId]?.coverage,
              partial: event.answer?.partial ?? previous[assistantMessageId]?.partial,
              caveat: event.answer?.caveat ?? undefined,
            } }));
          }
        },
      });
      if (creationCommit) await creationCommit;
      if (!requestIsCurrent()) return;
      streamAbortRef.current = null;
      if (creationReply.current) reply = creationReply.current;
      if (streamFailure.current) throw new Error(streamFailure.current.code);
      if (completedAnswer && reply.trim()) dispatch({ type: "complete", id: assistantMessageId, userId: userMessageId });
      dispatch({ type: "stop" });
    } catch (error) {
      if (!requestIsCurrent()) return;
      streamAbortRef.current = null;
      if (creationReply.saved) {
        dispatch({ type: "replace", id: assistantMessageId, text: creationReply.saved.prompt });
        dispatch({ type: "complete", id: assistantMessageId, userId: userMessageId });
        dispatch({ type: "stop" }); setChatError(null); return;
      }
      const stopped = error instanceof Error && error.name === "AbortError";
      const cleanupFailed = error instanceof Error && error.message.includes("ephemeral_cleanup_failed");
      const failure = floFailureDisplay(streamFailure.current?.code ?? (error instanceof Error ? error.message : null));
      if (cleanupFailed) {
        dispatch({ type: "hydrate", messages: [] });
        setSourcesByMessageId({});
        setFollowUpsByMessageId({});
        setProposalByMessageId({});
    setGroundingByMessageId(demoMode
      ? { "store-capture-answer": { dataAsOf: "2026-08-25T01:30:00-05:00", coverage: "Complete for this question" } }
      : {});
        setChatError("Flo couldn't clear this no-history chat. Local content was cleared; please try again.");
        retryRequestRef.current = { text: clean, userMessageId, assistantMessageId, conversationId: null, creationDraft, creationForm, creationOwner: requestCreationOwnerKey };
        return;
      }
      const recovery = verifiedFallback.current;
      if (recovery && !stopped) {
        reply = recovery.answer;
        dispatch({ type: "replace", id: assistantMessageId, text: reply });
        setSourcesByMessageId(previous => ({ ...previous, [assistantMessageId]: recovery.sources ?? [] }));
        setFollowUpsByMessageId(previous => ({ ...previous, [assistantMessageId]: recovery.followups ?? [] }));
        setProposalByMessageId(previous => ({ ...previous, [assistantMessageId]: null }));
        setGroundingByMessageId(previous => ({ ...previous, [assistantMessageId]: {
          dataAsOf: recovery.dataAsOf,
          partial: true,
          coverage: describeCoverage(recovery.coverage),
          caveat: recovery.caveat,
        } }));
        setChatError(null);
      } else {
        reply = stopped
          ? "Response stopped before Flo could verify an answer."
          : failure.answer;
        dispatch({ type: "replace", id: assistantMessageId, text: reply });
        setSourcesByMessageId(previous => ({ ...previous, [assistantMessageId]: [] }));
        setFollowUpsByMessageId(previous => ({ ...previous, [assistantMessageId]: [] }));
        setProposalByMessageId(previous => ({ ...previous, [assistantMessageId]: null }));
        setGroundingByMessageId(previous => ({ ...previous, [assistantMessageId]: { partial: true, coverage: "No verified account data" } }));
        setChatError(stopped
          ? "Response stopped. You can retry the last question."
          : failure.action);
        setRetryAllowed(stopped || failure.retryable);
      }
    } finally {
      if (activeRequestRef.current === requestGeneration) { activeRequestRef.current = null; setCreationFormBusy(false); }
    }
    if (!requestIsCurrent()) return;
    if (!historyEnabled) retryRequestRef.current = { text: clean, userMessageId, assistantMessageId, conversationId: null, creationDraft, creationForm, creationOwner: requestCreationOwnerKey };
  };

  const openFloSource = (route: string) => {
    if (floV4Preview) {
      if (activeRequestRef.current !== null || chat.sending) stopStreaming();
      const lease = volatileLeaseRef.current;
      if (lease && volatileLatestRef.current.owner === lease.owner) volatileStore.save(lease,volatileLatestRef.current.snapshot);
    }
    router.push(route as never);
  };

  const acceptAiConsent = async () => {
    if (!user?.id || !aiConsentPrompt) return;
    const prompt = aiConsentPrompt;
    const consentScopeKey = floDataScopeKey;
    const consentGeneration = requestGenerationRef.current;
    try {
      await AsyncStorage.setItem(floAiConsentStorageKey(user.id), createFloAiConsent(user.id));
      if (consentScopeKey !== floDataScopeKeyRef.current || consentGeneration !== requestGenerationRef.current) return;
      setAiConsentAccepted(true);
      setAiConsentPrompt(null);
      await send(prompt, false, true);
    } catch {
      setChatError("Flo consent could not be saved. No account information was sent.");
    }
  };

  // Route context can suggest a draft. Only an explicit Send or question tap asks Flo.
  useEffect(() => {
    const prompt = Array.isArray(params.prompt) ? params.prompt[0] : params.prompt;
    const promptId = Array.isArray(params.promptId) ? params.promptId[0] : params.promptId;
    const cleanPrompt = typeof prompt === "string" ? prompt.trim().slice(0, 4000) : "";
    const promptKey = `${floDataScopeKey}:${promptId || "manual"}:${cleanPrompt}`;
    if (!user?.id || !activeHousehold?.householdId || chatScopeKey !== floDataScopeKey || floAccessLocked || historyBusy || !cleanPrompt || handledPromptRef.current === promptKey || consumedRoutePromptsRef.current.has(promptKey)) return;
    consumedRoutePromptsRef.current.add(promptKey);
    handledPromptRef.current = promptKey;
    setInput(current => current.trim() ? current : cleanPrompt);
  }, [params.prompt, params.promptId, chatScopeKey, floDataScopeKey, user?.id, activeHousehold?.householdId, floAccessLocked, historyBusy]);

  const composerBottom = Platform.OS === "web" ? 88 : Math.max(insets.bottom, 8) + 54;

  if (moneyPrivacy.hidden) {
    return <View style={[styles.screen, { backgroundColor: colors.background }]}><PremiumBackdrop variant="purple" /><View style={[styles.welcome, { flex: 1, justifyContent: "center", paddingHorizontal: 24 }]}><FloLogo size={58} /><Text accessibilityRole="header" style={[styles.welcomeTitle, { color: colors.foreground }]}>Flo conversations are hidden</Text><Text style={[styles.welcomeSubtitle, { color: colors.mutedForeground }]}>Privacy Mode keeps messages and drafts out of view. Your conversation stays here.</Text><MoneyPrivacyToggle label /></View></View>;
  }

  if (floAccessLocked) {
    return <BasicFlo facts={facts} baseline={baseline} />;
  }

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <PremiumBackdrop variant="purple" />
      <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 12 : insets.top + 10, borderColor: colors.border, backgroundColor: colors.background }]}>
        <FloLogo size={38} />
        <View style={styles.headerText}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Flo</Text>
          <Text numberOfLines={1} style={[styles.subtitle, { color: colors.mutedForeground }]}>{floV4Preview ? "Chat not saved" : activeHousehold?.name ?? "Your money assistant"}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="New chat" disabled={creationSaving} onPress={() => { startNewConversation(); inputRef.current?.focus(); }} style={[styles.headerButton, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Feather name="edit" size={18} color={colors.foreground} />
          {isDesktop ? <Text style={[styles.headerButtonText, { color: colors.foreground }]}>New chat</Text> : null}
        </Pressable>
        {!floV4Preview ? <FloConversationBar key={floDataScopeKey} compact desktop={isDesktop} conversations={conversations} activeId={activeConversationId} disabled={chat.sending || creationSaving || historyBusy} preferencesDisabled={!preferencesControlsReady} householdName={activeHousehold?.name ?? "Personal household"} preferences={floPreferences} onNew={startNewConversation} onSelect={selectConversation} onRename={renameConversation} onDelete={removeConversation} onDeleteAll={removeAllConversations} onExport={exportConversations} onSearchHistory={searchHistory} onPreferencesChange={updatePreferences} /> : null}
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.conversation}
        contentContainerStyle={[styles.conversationContent, isDesktop && styles.conversationContentDesktop, !chat.messages.length && styles.emptyConversation]}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {!floV4Preview && olderMessageCursor ? (
          <Pressable accessibilityRole="button" onPress={() => void loadOlderMessages()} style={[styles.loadOlderButton, { backgroundColor: colors.muted }]}>
            <Text style={[styles.loadOlderText, { color: colors.mutedForeground }]}>Load older messages</Text>
          </Pressable>
        ) : null}
        {!chat.messages.length ? (
          <View style={styles.welcome}>
            <View style={[styles.welcomeMark, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "25" }]}><FloLogo size={58} /></View>
            <Text accessibilityRole="header" style={[styles.welcomeTitle, { color: colors.foreground }]}>Let’s make sense of your money.</Text>
            <Text style={[styles.welcomeSubtitle, { color: colors.mutedForeground }]}>Ask about your bills, balances, or next move.</Text>
            <View style={[styles.questionGrid, isDesktop && styles.questionGridDesktop]}>
              {quickPrompts.map((prompt, index) => <Pressable key={prompt} accessibilityRole="button" accessibilityLabel={`Ask Flo: ${prompt}`} disabled={historyBusy || !preferencesReady} onPress={() => void send(prompt)} style={({ pressed }) => [styles.questionCard, isDesktop && styles.questionCardDesktop, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed || !preferencesReady ? 0.6 : 1 }]}>
                <Feather name={(["calendar", "credit-card", "trending-down", "help-circle"] as const)[index]} size={18} color={colors.primary} />
                <Text style={[styles.questionText, { color: colors.foreground }]}>{prompt}</Text>
                <Feather name="arrow-up-right" size={15} color={colors.mutedForeground} />
              </Pressable>)}
            </View>
          </View>
        ) : null}

        {chat.messages.map(message => (
          <View
            key={message.id}
            style={[
              styles.bubble,
              message.role === "user" ? styles.userBubble : styles.floBubble,
              message.role === "user"
                ? { backgroundColor: colors.primary }
                : { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.messageAuthor, { color: message.role === "user" ? colors.primaryForeground : colors.primary }]}>{message.role === "user" ? "You" : "Flo"}</Text>
            <View style={message.thinking ? styles.thinkingRow : undefined}>
              {message.thinking ? <ActivityIndicator size="small" color={colors.primary} /> : null}
              {message.role === "flo" && !message.thinking ? <FloGroundedAnswer text={humanizeFloText(message.text)} sources={sourcesByMessageId[message.id] ?? []} dataAsOf={groundingByMessageId[message.id]?.dataAsOf} coverage={groundingByMessageId[message.id]?.coverage} partial={groundingByMessageId[message.id]?.partial} caveat={groundingByMessageId[message.id]?.caveat} followUps={followUpsByMessageId[message.id]} proposal={floV4Preview ? null : proposalByMessageId[message.id]} proposalConfirmed={Boolean(!floV4Preview && (proposalByMessageId[message.id]?.status === "confirmed" || (proposalByMessageId[message.id] && confirmedProposalIds.has(proposalByMessageId[message.id]!.id))))} onOpenSource={openFloSource} onFollowUp={question => void send(question)} onReviewProposal={proposal => { if (!floV4Preview) openProposalReview(proposal); }} /> : <Text style={[styles.bubbleText, { color: message.role === "user" ? colors.primaryForeground : colors.mutedForeground }]}>{message.text}</Text>}
            </View>
            {message.role === "flo" && creationByMessageId[message.id] ? <FloCreationCard creation={creationByMessageId[message.id]} onOpen={route => openFloSource(creationByMessageId[message.id].receipt?.kind === "create_debt" ? "/(tabs)/bills?view=debt" : route)} onCancel={creationByMessageId[message.id].status === "needs_details" && !chat.sending && !creationSaving && (Boolean(creationByMessageId[message.id].draft) && activeCreationDraftRef.current?.draft === creationByMessageId[message.id].draft || creationFormSession?.id === message.id) ? () => cancelCreationDraft(message.id) : undefined} /> : null}
            {message.role === "flo" && creationFormSession?.id === message.id && creationFormSession.owner === creationOwnerKey && !creationFormSession.open ? <Pressable accessibilityRole="button" accessibilityLabel="Complete details" disabled={chat.sending || creationSaving || historyBusy} onPress={() => reopenCreationForm(message.id)} style={[styles.retryButton, { backgroundColor: colors.primary + "18", marginTop: 8 }]}><Feather name="edit-3" size={15} color={colors.primary} /><Text style={[styles.retryText, { color: colors.primary }]}>Complete details</Text></Pressable> : null}
          </View>
        ))}
      </ScrollView>

      {creationFormSession && creationFormSession.owner === creationOwnerKey ? <FloCreationForm key={`${creationFormSession.owner}:${creationFormSession.id}:${creationFormSession.revision}`} creation={creationFormSession.creation} visible={creationFormSession.open} suspended={Boolean(creationSafety)} busy={creationFormBusy || creationSaving || historyBusy} error={chatError} accounts={accounts} onClose={() => closeCreationForm(creationFormSession.id)} onBackFromSafety={() => creationSafety?.cancel()} onSave={value => submitCreationForm(creationFormSession.id, value)} /> : null}

      <FloSafetyStopModal manageBackHistory={!creationFormSession?.open} visible={Boolean(creationSafety)} warning={creationSafety?.warning ?? null} onKeepEditing={() => creationSafety?.cancel()} onScheduleAnyway={() => creationSafety?.proceed()} />

      <Modal visible={!floV4Preview && Boolean(reviewProposal)} transparent animationType={isDesktop ? "fade" : "slide"} onRequestClose={() => proposalConfirmState !== "confirming" && setReviewProposal(null)}>
        <Pressable style={[styles.modalOverlay, isDesktop && styles.reviewOverlayDesktop]} onPress={() => proposalConfirmState !== "confirming" && setReviewProposal(null)}>
          <Pressable style={[styles.followSheet, isDesktop && styles.reviewDialogDesktop, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => undefined}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.mutedForeground }]} />
            <View style={[styles.reviewProposalIcon, { backgroundColor: proposalReceipt ? colors.success + "18" : colors.primary + "18" }]}><Feather name={proposalReceipt ? "check" : "shield"} size={20} color={proposalReceipt ? colors.success : colors.primary} /></View>
            <Text style={[styles.followTitle, { color: colors.foreground }]}>{proposalReceipt ? "Change confirmed" : "Review bill change"}</Text>
            <Text style={[styles.followSub, { color: colors.mutedForeground }]}>{proposalReceipt ? "FlowLedger confirmed the database change and refreshed your plan." : reviewProposal?.summary}</Text>
            <View style={[styles.reviewImpact, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Text style={[styles.reviewImpactLabel, { color: colors.mutedForeground }]}>PLANNED PAYMENT AMOUNT</Text>
              <Text style={[styles.reviewImpactText, { color: colors.foreground }]}>{moneyValue(proposalReceipt?.previousAmount ?? reviewProposal?.payload?.expectedAmount)} → {moneyValue(proposalReceipt?.newAmount ?? reviewProposal?.payload?.newAmount)}</Text>
            </View>
            {proposalConfirmError ? <Text accessibilityRole="alert" style={[styles.saveDecisionError, { color: colors.destructive }]}>{proposalConfirmError}</Text> : null}
            <Text style={[styles.reviewSafety, { color: colors.mutedForeground }]}>{proposalReceipt ? `Confirmed ${new Date(proposalReceipt.confirmedAt).toLocaleString()}` : "Nothing changes until you press Confirm change."}</Text>
            <View style={styles.followActions}>
              <Pressable accessibilityRole="button" disabled={proposalConfirmState === "confirming"} onPress={() => setReviewProposal(null)} style={[styles.followButton, { backgroundColor: colors.muted, opacity: proposalConfirmState === "confirming" ? 0.5 : 1 }]}><Text style={[styles.followButtonText, { color: colors.foreground }]}>{proposalReceipt ? "Done" : "Cancel"}</Text></Pressable>
              {!proposalReceipt ? <Pressable accessibilityRole="button" disabled={proposalConfirmState === "confirming"} onPress={() => void confirmProposal()} style={[styles.followButton, { backgroundColor: colors.primary, opacity: proposalConfirmState === "confirming" ? 0.6 : 1 }]}><Text style={styles.followPrimaryText}>{proposalConfirmState === "confirming" ? "Confirming..." : "Confirm change"}</Text></Pressable> : null}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={Boolean(aiConsentPrompt)} transparent animationType="fade" onRequestClose={() => setAiConsentPrompt(null)}>
        <Pressable
          style={[
            styles.modalOverlay,
            {
              paddingTop: Math.max(insets.top, 16),
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}
          onPress={() => setAiConsentPrompt(null)}
        >
          <Pressable accessibilityViewIsModal style={[styles.aiConsentCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => undefined}>
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.aiConsentContent}
            >
              <View style={[styles.reviewProposalIcon, { backgroundColor: colors.primary + "18" }]}><Feather name="shield" size={21} color={colors.primary} /></View>
              <Text style={[styles.followTitle, { color: colors.foreground }]}>Use Flo with your account data?</Text>
              <Text style={[styles.aiConsentBody, { color: colors.mutedForeground }]}>Flo sends your question and only the relevant household records needed to answer it to OpenAI. FlowLedger does not send bank passwords or full account numbers. Chats are saved only when history is on.</Text>
              <Text style={[styles.reviewSafety, { color: colors.mutedForeground }]}>You can cancel and keep using FlowLedger without Flo.</Text>
              <View style={[styles.followActions, styles.aiConsentActions]}>
                <Pressable accessibilityRole="button" onPress={() => setAiConsentPrompt(null)} style={[styles.followButton, styles.aiConsentButton, { backgroundColor: colors.muted }]}><Text style={[styles.followButtonText, { color: colors.foreground }]}>Not now</Text></Pressable>
                <Pressable accessibilityRole="button" onPress={() => void acceptAiConsent()} style={[styles.followButton, styles.aiConsentButton, { backgroundColor: colors.primary }]}><Text style={styles.followPrimaryText}>Agree & ask Flo</Text></Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <View style={[styles.composerArea, isDesktop && styles.composerAreaDesktop, { backgroundColor: colors.background, borderColor: colors.border, paddingBottom: isDesktop ? 16 : composerBottom }]}>
        {chatError ? (
          <View style={styles.errorRow}>
            <Text style={[styles.chatError, { color: colors.mutedForeground }]}>{chatError}</Text>
            {lastPrompt && retryAllowed && !chat.sending ? (
              <Pressable accessibilityRole="button" onPress={() => void send(lastPrompt, true)} style={[styles.retryButton, { backgroundColor: colors.primary + "18" }]}>
                <Feather name="rotate-ccw" size={13} color={colors.primary} />
                <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={[styles.composer, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TextInput
            ref={inputRef}
            nativeID="guided-tour-flo"
            accessibilityLabel="Ask Flo anything"
            value={input}
            editable={!historyBusy && preferencesReady}
            maxLength={4000}
            onChangeText={setInput}
            onSubmitEditing={() => void send()}
            placeholder={preferencesReady ? "Ask Flo…" : "Getting ready…"}
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground }]}
            returnKeyType="send"
            multiline
            blurOnSubmit={Platform.OS !== "web"}
            {...(Platform.OS === "web" ? { onKeyPress: (event: { nativeEvent: { key?: string; shiftKey?: boolean; isComposing?: boolean }; preventDefault: () => void }) => { if (event.nativeEvent.key === "Enter" && !event.nativeEvent.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } } } : {})}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={chat.sending || creationSaving ? "Stop response" : "Send message"}
            onPress={chat.sending || creationSaving ? stopStreaming : () => void send()}
            disabled={historyBusy || !preferencesReady || (!chat.sending && !creationSaving && !input.trim())}
            style={[
              styles.send,
              { backgroundColor: chat.sending || creationSaving ? colors.destructive : colors.primary, opacity: !chat.sending && !creationSaving && !input.trim() ? 0.45 : 1 },
            ]}
          >
            <Feather name={chat.sending || creationSaving ? "square" : "arrow-up"} size={20} color={colors.primaryForeground} />
          </Pressable>
        </View>
        <Text style={[styles.composerNote, { color: colors.mutedForeground }]}>{floV4Preview || !floPreferences.historyEnabled ? "This chat is not saved." : "Private to you in this household."} Check important details.</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

function describeCoverage(coverage?: Record<string, unknown>): string | undefined {
  if (!coverage) return undefined;
  if (coverage.complete === false) return "Some details could not be verified";
  const tools = Number(coverage.tools);
  if (Number.isFinite(tools) && tools > 0) return `${tools} account source${tools === 1 ? "" : "s"} checked`;
  return coverage.complete === true ? "Complete for this question" : undefined;
}

function decisionStillHasSource(decision: { status: string; scenario: { type?: string }; applied_change?: Record<string, unknown> | null; actual_amount?: number | null }, transactions: { id: string }[]) {
  if (decision.status !== "completed" && decision.status !== "applied") return true;
  const applied = decision.applied_change ?? {};
  const hasActualAmount = decision.actual_amount !== undefined && decision.actual_amount !== null;
  const linkedTransactionId = typeof applied.id === "string"
    ? applied.id
    : typeof applied.transactionId === "string"
      ? applied.transactionId
      : null;
  const expectsTransaction = decision.scenario.type === "one_time_purchase"
    || decision.scenario.type === "savings_contribution"
    || decision.scenario.type === "recurring_bill"
    || applied.kind === "transaction"
    || applied.kind === "recurring";
  if (!expectsTransaction) return hasActualAmount || Object.keys(applied).length > 0;
  return !!linkedTransactionId && transactions.some(transaction => transaction.id === linkedTransactionId);
}

const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 0 },
  header: { minHeight: 74, paddingHorizontal: 16, paddingBottom: 12, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, gap: 10 },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: 23, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.5 },
  subtitle: { fontSize: 11, lineHeight: 16, marginTop: 1, fontFamily: "Inter_500Medium" },
  headerButton: { minHeight: 44, minWidth: 44, borderRadius: 13, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 12 },
  headerButtonText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  conversation: { flex: 1, minHeight: 0 },
  conversationContent: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 24, gap: 18 },
  conversationContentDesktop: { width: "100%", maxWidth: 860, alignSelf: "center", paddingHorizontal: 28, paddingTop: 28 },
  emptyConversation: { flexGrow: 1, justifyContent: "center" },
  welcome: { width: "100%", maxWidth: 640, alignSelf: "center", paddingVertical: 16 },
  welcomeMark: { width: 78, height: 78, borderRadius: 26, borderWidth: 1, alignSelf: "center", alignItems: "center", justifyContent: "center", marginBottom: 22 },
  welcomeTitle: { fontSize: 25, lineHeight: 33, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.6, textAlign: "center" },
  welcomeSubtitle: { fontSize: 13, lineHeight: 20, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 9, marginBottom: 24 },
  questionGrid: { gap: 9 },
  questionGridDesktop: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  questionCard: { minHeight: 60, borderRadius: 17, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13, flexDirection: "row", alignItems: "center", gap: 12 },
  questionCardDesktop: { width: "48%", flexGrow: 1, minHeight: 88 },
  questionText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
  messageAuthor: { fontSize: 10, fontFamily: "Inter_700Bold", marginBottom: 6 },
  composerNote: { width: "100%", maxWidth: 820, alignSelf: "center", fontSize: 10, lineHeight: 15, fontFamily: "Inter_400Regular", marginTop: 8, textAlign: "center" },
  loadOlderButton: { alignSelf: "center", minHeight: 36, borderRadius: 999, justifyContent: "center", paddingHorizontal: 14 },
  loadOlderText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(2,6,23,0.68)", justifyContent: "flex-end" },
  aiConsentCard: { width: "100%", maxHeight: "100%", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, overflow: "hidden" },
  aiConsentContent: { padding: 20, gap: 12 },
  aiConsentBody: { fontSize: 13, lineHeight: 20, fontFamily: "Inter_400Regular", textAlign: "center" },
  followSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 18, gap: 12 },
  sheetHandle: { alignSelf: "center", width: 48, height: 4, borderRadius: 999, opacity: 0.5, marginBottom: 4 },
  followTitle: { fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  followSub: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", textAlign: "center" },
  actualInputWrap: { height: 52, borderRadius: 14, borderWidth: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 14 },
  actualPrefix: { fontSize: 17, fontFamily: "Inter_700Bold", marginRight: 8 },
  actualInput: { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold" },
  followActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  aiConsentActions: { flexWrap: "wrap" },
  aiConsentButton: { minWidth: 140 },
  followButton: { flex: 1, minHeight: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  followButtonText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  followPrimaryText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  bubble: { maxWidth: "94%", minWidth: 80, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 20 },
  floBubble: { alignSelf: "flex-start", borderWidth: 1, borderTopLeftRadius: 6 },
  userBubble: { alignSelf: "flex-end", borderTopRightRadius: 6 },
  thinkingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  bubbleText: { fontSize: 15, lineHeight: 23, fontFamily: "Inter_400Regular" },
  trustLine: { marginTop: 8, fontSize: 10, lineHeight: 15, fontFamily: "Inter_500Medium" },
  cardGrid: { marginTop: 10, gap: 8 },
  insightCard: { borderWidth: 1, borderRadius: 15, padding: 12 },
  insightTitle: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  insightValue: { fontSize: 18, fontFamily: "Inter_700Bold", marginTop: 3 },
  insightDetail: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 15 },
  sourceRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 9 },
  sourceChip: { minHeight: 28, maxWidth: 240, borderWidth: 1, borderRadius: 999, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9 },
  sourceText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  decisionActions: { gap: 6, marginTop: 2 },
  saveDecisionButton: { minHeight: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, paddingHorizontal: 12 },
  saveDecisionText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
  saveDecisionHint: { fontSize: 11, lineHeight: 15, textAlign: "center" },
  saveDecisionError: { fontSize: 11, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  reductionTargetCard: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 2 },
  reductionTargetLabel: { fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  reductionTargetName: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  reductionTargetMeta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  reductionActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  reductionButton: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 8 },
  reductionButtonText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  composerArea: { flexShrink: 0, borderTopWidth: 1, paddingHorizontal: 14, paddingTop: 12 },
  composerAreaDesktop: { paddingHorizontal: 28, alignItems: "center" },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  chatError: { flex: 1, fontSize: 11, lineHeight: 15, fontFamily: "Inter_500Medium" },
  retryButton: { minHeight: 44, borderRadius: 999, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11 },
  retryText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  quickPromptScroller: { marginBottom: 10, maxHeight: 42 },
  quickPromptContent: { gap: 8, paddingRight: 12 },
  quickPromptChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9 },
  quickPromptText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  composer: {
    width: "100%",
    maxWidth: 820,
    minHeight: 62,
    maxHeight: 112,
    borderRadius: 22,
    borderWidth: 1,
    paddingLeft: 15,
    paddingRight: 7,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  input: { flex: 1, minWidth: 0, minHeight: 44, maxHeight: 96, paddingTop: 11, paddingBottom: 10, fontSize: 15 },
  send: { minWidth: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", paddingHorizontal: 15 },
  sendText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
  reviewOverlayDesktop: { justifyContent: "center", alignItems: "center", padding: 24 },
  reviewDialogDesktop: { width: "100%", maxWidth: 520, borderRadius: 24 },
  reviewProposalIcon: { alignSelf: "center", width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  reviewImpact: { borderWidth: 1, borderRadius: 13, padding: 11 },
  reviewImpactLabel: { fontSize: 9, letterSpacing: 0.8, fontFamily: "Inter_800ExtraBold" },
  reviewImpactText: { fontSize: 11, lineHeight: 16, marginTop: 4, fontFamily: "Inter_600SemiBold" },
  reviewSafety: { fontSize: 10, lineHeight: 15, textAlign: "center", fontFamily: "Inter_500Medium" },
});
