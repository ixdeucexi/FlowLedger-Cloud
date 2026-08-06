import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";

import { NotificationCenterModal } from "@/components/NotificationCenterModal";
import { UniversalSearchModal } from "@/components/UniversalSearchModal";
import { useAuth } from "@/context/AuthContext";
import { useBudget, type Transaction } from "@/context/BudgetContext";
import { useMembership } from "@/context/MembershipContext";
import { localDateString } from "@/lib/dateLabels";
import { readInterfacePreferences, updateInterfacePreferences } from "@/lib/interfacePreferences";
import {
  dismissNotification,
  EMPTY_NOTIFICATION_STATE,
  markAllNotificationsRead,
  markNotificationRead,
  normalizeNotificationState,
  unreadNotificationCount,
  visibleNotifications,
  type InAppNotification,
  type NotificationCenterState,
} from "@/lib/notificationCenter";
import { pendingOccurrenceKeySet } from "@/lib/pendingPlanMatches";
import { buildReviewQueue } from "@/lib/reviewCenter";
import { SETTINGS_SECTIONS } from "@/lib/settingsHub";
import { supabase } from "@/lib/supabase";
import {
  buildUniversalSearchIndex,
  filterCommands,
  mergeSearchResults,
  searchUniversalIndex,
  type UniversalSearchResult,
} from "@/lib/universalSearch";

type DiscoveryMode = "search" | "commands";

type AppDiscoveryValue = {
  openSearch: () => void;
  openCommands: () => void;
  openNotifications: () => void;
  unreadNotificationCount: number;
};

const AppDiscoveryContext = createContext<AppDiscoveryValue | null>(null);

function transactionTitle(transaction: Pick<Transaction, "merchant_name" | "note" | "category">) {
  return transaction.merchant_name?.trim() || transaction.note?.trim() || transaction.category || "Transaction";
}

function currency(value: number) {
  return Math.abs(Number.isFinite(value) ? value : 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function localNoonIso(year: number, month: number, day: number) {
  const date = new Date(year, month, day, 12);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function validRecentTimestamp(value: string | undefined, now: Date) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return now.getTime() - date.getTime() <= 90 * 86_400_000 ? date.toISOString() : null;
}

export function AppDiscoveryProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, demoMode } = useAuth();
  const { isAdmin } = useMembership();
  const {
    activeHousehold,
    bills,
    categories,
    goals,
    pendingBankTransactions,
    pendingPlanMatches,
    settings,
    transactions,
    getDailyBalances,
    getMonthlyBills,
    getBillOccurrencesInMonth,
    getBillMonthlyTotal,
    getPaidAmount,
    setDashboardFilter,
  } = useBudget();

  const [searchVisible, setSearchVisible] = useState(false);
  const [mode, setMode] = useState<DiscoveryMode>("search");
  const [query, setQuery] = useState("");
  const [remoteResults, setRemoteResults] = useState<UniversalSearchResult[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [notificationsVisible, setNotificationsVisible] = useState(false);
  const [notificationState, setNotificationState] = useState<NotificationCenterState>(EMPTY_NOTIFICATION_STATE);
  const notificationStateRef = useRef(notificationState);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  const userId = user?.id ?? null;
  const householdId = activeHousehold?.householdId ?? null;

  const openSearch = useCallback(() => {
    setMode("search");
    setQuery("");
    setSearchVisible(true);
  }, []);
  const openCommands = useCallback(() => {
    setMode("commands");
    setQuery("");
    setSearchVisible(true);
  }, []);
  const openNotifications = useCallback(() => setNotificationsVisible(true), []);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable;
      if (typing) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openCommands();
      } else if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "/") {
        event.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openCommands, openSearch]);

  useEffect(() => {
    let cancelled = false;
    notificationStateRef.current = EMPTY_NOTIFICATION_STATE;
    setNotificationState(EMPTY_NOTIFICATION_STATE);
    if (!userId || !householdId) return () => { cancelled = true; };

    void (async () => {
      const [local, remote] = await Promise.all([
        readInterfacePreferences(userId, householdId),
        demoMode
          ? Promise.resolve(null)
          : supabase.from("user_preferences").select("notification_center_states").eq("user_id", userId).maybeSingle(),
      ]);
      let next = normalizeNotificationState(local.notifications);
      if (remote && !remote.error) {
        const states = remote.data?.notification_center_states;
        if (states && typeof states === "object" && !Array.isArray(states)) {
          const householdState = (states as Record<string, unknown>)[householdId];
          if (householdState) next = normalizeNotificationState(householdState);
        }
      }
      if (cancelled) return;
      notificationStateRef.current = next;
      setNotificationState(next);
      void updateInterfacePreferences(userId, householdId, { notifications: next });
    })();
    return () => { cancelled = true; };
  }, [demoMode, householdId, userId]);

  const persistNotificationState = useCallback((nextValue: NotificationCenterState | ((current: NotificationCenterState) => NotificationCenterState)) => {
    const next = normalizeNotificationState(typeof nextValue === "function" ? nextValue(notificationStateRef.current) : nextValue);
    notificationStateRef.current = next;
    setNotificationState(next);
    if (!userId || !householdId) return;
    void updateInterfacePreferences(userId, householdId, { notifications: next });
    if (!demoMode) {
      saveQueue.current = saveQueue.current.catch(() => undefined).then(async () => {
        const { error } = await supabase.rpc("save_notification_center_state", {
          p_household_id: householdId,
          p_state: next,
        });
        if (error) throw error;
      }).catch(() => undefined);
    }
  }, [demoMode, householdId, userId]);

  const searchIndex = useMemo(() => buildUniversalSearchIndex({
    bills,
    goals,
    transactions,
    categories,
    settings: SETTINGS_SECTIONS.filter(section => section.id !== "admin" || isAdmin),
  }), [bills, categories, goals, isAdmin, transactions]);

  const localResults = useMemo(
    () => mode === "commands" ? filterCommands(query) : searchUniversalIndex(searchIndex, query),
    [mode, query, searchIndex],
  );

  useEffect(() => {
    setRemoteResults([]);
    if (!searchVisible || mode !== "search" || demoMode || !userId || !householdId || query.trim().length < 2) {
      setRemoteLoading(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      const safeQuery = query.trim().replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ").slice(0, 64);
      if (!safeQuery) return;
      setRemoteLoading(true);
      void supabase
        .from("transactions")
        .select("id,date,amount,category,note,merchant_name")
        .eq("household_id", householdId)
        .is("removed_at", null)
        .or(`merchant_name.ilike.%${safeQuery}%,note.ilike.%${safeQuery}%,category.ilike.%${safeQuery}%`)
        .order("date", { ascending: false })
        .limit(8)
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error) {
            setRemoteResults([]);
          } else {
            setRemoteResults((data ?? []).map(row => ({
              id: String(row.id),
              kind: "Activity" as const,
              title: String(row.merchant_name || row.note || row.category || "Transaction"),
              subtitle: `${row.date} · ${row.category || "Other"} · ${Number(row.amount) >= 0 ? "+" : "−"}${currency(Number(row.amount))}`,
              icon: Number(row.amount) >= 0 ? "arrow-down-left" : "arrow-up-right",
              route: "/(tabs)/transactions",
              params: { activityId: String(row.id), activityDate: String(row.date), activityAt: String(Date.now()) },
              keywords: String(row.note || ""),
            })));
          }
          setRemoteLoading(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [demoMode, householdId, mode, query, searchVisible, userId]);

  const searchResults = useMemo(
    () => mode === "commands" ? localResults : mergeSearchResults(localResults, remoteResults),
    [localResults, mode, remoteResults],
  );

  const generatedNotifications = useMemo<InAppNotification[]>(() => {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    const today = now.getDate();
    const result: InAppNotification[] = [];
    const protectedOccurrences = pendingOccurrenceKeySet(pendingPlanMatches, pendingBankTransactions);

    buildReviewQueue(transactions, localDateString()).forEach(transaction => {
      result.push({
        id: `review:${transaction.id}`,
        type: "review",
        title: `${transactionTitle(transaction)} needs review`,
        body: "Confirm where this posted activity belongs so your plan stays accurate.",
        timestamp: localNoonIso(Number(transaction.date.slice(0, 4)), Number(transaction.date.slice(5, 7)) - 1, Number(transaction.date.slice(8, 10))),
        route: "/(tabs)/review",
        params: { transactionId: transaction.id },
        tone: "watch",
      });
    });

    getMonthlyBills(month, year).forEach(bill => {
      const days = getBillOccurrencesInMonth(bill, month, year).sort((left, right) => left - right);
      if (!days.length) return;
      const amount = getBillMonthlyTotal(bill, month, year) / days.length;
      let paid = getPaidAmount(bill.id, month, year);
      days.forEach(day => {
        const settled = Math.min(amount, Math.max(0, paid));
        paid = Math.max(0, paid - settled);
        const remaining = Math.max(0, amount - settled);
        const occurrenceDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        if (remaining <= 0.005 || protectedOccurrences.has(`${bill.id}:${occurrenceDate}`)) return;
        const daysAway = day - today;
        if (daysAway < 0) {
          result.push({ id: `bill-overdue:${bill.id}:${occurrenceDate}`, type: "bill", title: `${bill.name} is overdue`, body: `${currency(remaining)} remains from the ${new Date(year, month, day).toLocaleDateString(undefined, { month: "short", day: "numeric" })} payment.`, timestamp: localNoonIso(year, month, day), route: "/(tabs)/bills", params: { view: bill.is_debt ? "debt" : "bills" }, tone: "risk" });
        } else if (daysAway <= 7) {
          result.push({ id: `bill-due:${bill.id}:${occurrenceDate}`, type: "bill", title: `${bill.name} is due ${daysAway === 0 ? "today" : daysAway === 1 ? "tomorrow" : "soon"}`, body: `${currency(remaining)} is planned for ${new Date(year, month, day).toLocaleDateString(undefined, { month: "short", day: "numeric" })}.`, timestamp: localNoonIso(year, month, day), route: "/(tabs)/bills", params: { view: bill.is_debt ? "debt" : "bills" }, tone: daysAway <= 1 ? "watch" : "info" });
        }
      });
    });

    const lowest = getDailyBalances(month, year)
      .filter(day => day.day >= today)
      .reduce<{ day: number; balance: number } | null>((current, day) => !current || day.balance < current.balance ? { day: day.day, balance: day.balance } : current, null);
    if (lowest && lowest.balance < settings.safety_floor) {
      const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(lowest.day).padStart(2, "0")}`;
      result.push({ id: `forecast-low:${date}`, type: "forecast", title: "Low-balance forecast", body: `The current forecast falls ${currency(settings.safety_floor - lowest.balance)} below your safety floor on ${new Date(year, month, lowest.day).toLocaleDateString(undefined, { month: "short", day: "numeric" })}.`, timestamp: localNoonIso(year, month, lowest.day), route: "/(tabs)/monthly", params: { openDate: date }, tone: "risk" });
    }

    goals.filter(goal => !goal.archived_at && goal.target_amount > 0 && goal.current_amount >= goal.target_amount).forEach(goal => {
      const timestamp = validRecentTimestamp(goal.closed_at || goal.target_date || goal.created_at, now);
      if (timestamp) result.push({ id: `goal-complete:${goal.id}`, type: "goal", title: `${goal.name} is funded`, body: `You reached the ${currency(goal.target_amount)} target.`, timestamp, route: "/(tabs)/more", params: { section: "goals" }, tone: "safe" });
    });

    bills.filter(bill => bill.is_debt && bill.balance <= 0.005).forEach(debt => {
      const timestamp = validRecentTimestamp(debt.end_date || debt.created_at, now);
      if (timestamp) result.push({ id: `debt-paid:${debt.id}`, type: "debt", title: `${debt.name} is paid off`, body: "Your snowball can now roll this payment toward the next eligible debt.", timestamp, route: "/(tabs)/bills", params: { view: "debt" }, tone: "safe" });
    });

    return result.filter(item => !Number.isNaN(new Date(item.timestamp).getTime()));
  }, [bills, getBillOccurrencesInMonth, getBillMonthlyTotal, getDailyBalances, getMonthlyBills, getPaidAmount, goals, pendingBankTransactions, pendingPlanMatches, settings.safety_floor, transactions]);

  const notifications = useMemo(
    () => visibleNotifications(generatedNotifications, notificationState),
    [generatedNotifications, notificationState],
  );
  const unreadCount = useMemo(
    () => unreadNotificationCount(generatedNotifications, notificationState),
    [generatedNotifications, notificationState],
  );

  const navigateTo = useCallback((result: Pick<UniversalSearchResult, "route" | "params">) => {
    if (result.params?.view === "debt") setDashboardFilter("debt");
    else if (result.params?.view === "bills") setDashboardFilter("bills");
    router.push({ pathname: result.route as never, params: result.params } as never);
  }, [router, setDashboardFilter]);

  const selectResult = useCallback((result: UniversalSearchResult) => {
    setSearchVisible(false);
    navigateTo(result);
  }, [navigateTo]);

  const openNotification = useCallback((notification: InAppNotification) => {
    persistNotificationState(state => markNotificationRead(state, notification.id));
    setNotificationsVisible(false);
    navigateTo(notification);
  }, [navigateTo, persistNotificationState]);

  const value = useMemo<AppDiscoveryValue>(() => ({
    openSearch,
    openCommands,
    openNotifications,
    unreadNotificationCount: unreadCount,
  }), [openCommands, openNotifications, openSearch, unreadCount]);

  return (
    <AppDiscoveryContext.Provider value={value}>
      {children}
      <UniversalSearchModal
        visible={searchVisible}
        mode={mode}
        query={query}
        results={searchResults}
        loading={remoteLoading}
        onModeChange={setMode}
        onQueryChange={setQuery}
        onSelect={selectResult}
        onClose={() => setSearchVisible(false)}
      />
      <NotificationCenterModal
        visible={notificationsVisible}
        notifications={notifications}
        readIds={notificationState.readIds}
        onOpen={openNotification}
        onDismiss={id => persistNotificationState(state => dismissNotification(state, id))}
        onMarkAllRead={() => persistNotificationState(state => markAllNotificationsRead(state, generatedNotifications))}
        onClose={() => setNotificationsVisible(false)}
      />
    </AppDiscoveryContext.Provider>
  );
}

export function useAppDiscovery() {
  const context = useContext(AppDiscoveryContext);
  if (!context) throw new Error("useAppDiscovery must be used within AppDiscoveryProvider");
  return context;
}
