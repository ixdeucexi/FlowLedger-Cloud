import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AccessibilityInfo,
  AppState,
  findNodeHandle,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useBudget } from "@/context/BudgetContext";
import { useDashboardFinancialSnapshot } from "@/context/DashboardFinancialSnapshotContext";
import { useColors } from "@/hooks/useColors";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useTodayWithFloPreference } from "@/hooks/useTodayWithFloPreference";
import { localDateInTimeZone } from "@/lib/dailyCheckingClose";
import { overlayActivity } from "@/lib/overlayActivity";
import {
  dailySnapshotMatches,
  selectTodayWithFlo,
  type FloDailyTip,
} from "@/lib/todayWithFlo";

const workspacePaths = new Set([
  "/",
  "/bills",
  "/transactions",
  "/monthly",
  "/more",
  "/review",
]);
type Presentation = { tip: FloDailyTip; scope: string; day: string };

/** Optional post-reveal enhancement. Never contributes to appReady or snapshot demand. */
export function TodayWithFlo({ ready }: { ready: boolean }) {
  const c = useColors();
  const router = useRouter();
  const pathname = usePathname();
  const { householdTimeZone } = useBudget();
  const preference = useTodayWithFloPreference();
  const { dashboardFinancialSnapshot: snapshot } =
    useDashboardFinancialSnapshot();
  const blocked = useSyncExternalStore(
    overlayActivity.subscribe,
    overlayActivity.getSnapshot,
    () => false,
  );
  const [foreground, setForeground] = useState(0);
  const [active, setActive] = useState(AppState.currentState !== "background");
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const keyboardOpen = useRef(false);
  const releaseLock = useRef<(() => void) | null>(null);
  const closeRef = useRef<React.ElementRef<typeof Pressable>>(null);
  const attemptedOpportunity = useRef("");
  const scope = JSON.stringify([
    preference.userId,
    preference.householdId,
    preference.budgetId,
  ]);
  const budget = preference.budgetId ?? "personal";
  const latest = useRef({
    ready,
    active,
    blocked,
    pathname,
    snapshot,
    preference,
    scope,
    householdTimeZone,
  });
  latest.current = {
    ready,
    active,
    blocked,
    pathname,
    snapshot,
    preference,
    scope,
    householdTimeZone,
  };
  const close = useCallback(() => {
    setPresentation(null);
    releaseLock.current?.();
    releaseLock.current = null;
  }, []);
  const visible =
    !!presentation &&
    presentation.scope === scope &&
    ready &&
    active &&
    !blocked &&
    preference.enabled &&
    preference.ready;
  useBackDismiss(visible, close, false);

  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (state) => {
      setActive(state === "active");
      if (state === "active" && previous !== "active")
        setForeground((n) => n + 1);
      previous = state;
    });
    const show = Keyboard.addListener("keyboardDidShow", () => {
      keyboardOpen.current = true;
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      keyboardOpen.current = false;
    });
    const onVisibility = () => {
      const on = document.visibilityState === "visible";
      setActive(on);
      if (on) setForeground((n) => n + 1);
    };
    if (Platform.OS === "web")
      document.addEventListener("visibilitychange", onVisibility);
    return () => {
      subscription.remove();
      show.remove();
      hide.remove();
      if (Platform.OS === "web")
        document.removeEventListener("visibilitychange", onVisibility);
      releaseLock.current?.();
    };
  }, []);

  useEffect(() => {
    if (!visible && presentation) close();
  }, [visible, presentation, close]);

  useEffect(() => {
    if (
      !ready ||
      !active ||
      !preference.ready ||
      !preference.enabled ||
      !preference.userId ||
      !preference.householdId
    )
      return;
    const opportunity = `${scope}:${foreground}`;
    if (attemptedOpportunity.current === opportunity) return;
    attemptedOpportunity.current = opportunity;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    const initialPath = pathname;
    const cancel = () => {
      cancelled = true;
      clearTimeout(timer);
    };
    const unsubscribeInteractions =
      overlayActivity.subscribeInteractions(cancel);
    const editing = () =>
      keyboardOpen.current ||
      (Platform.OS === "web" &&
        (document.querySelector('[role="dialog"], [aria-modal="true"]') ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(
            document.activeElement?.tagName ?? "",
          ) ||
          (document.activeElement as HTMLElement | null)?.isContentEditable));
    if (Platform.OS === "web") {
      document.addEventListener("pointerdown", cancel, true);
      document.addEventListener("keydown", cancel, true);
    }
    const tryPresent = async () => {
      if (cancelled || Date.now() - started > 8000) return;
      const current = latest.current;
      if (
        current.scope !== scope ||
        !current.ready ||
        !current.active ||
        current.pathname !== initialPath ||
        !workspacePaths.has(current.pathname)
      )
        return;
      const domEditing =
        Platform.OS === "web" &&
        (document.querySelector('[role="dialog"], [aria-modal="true"]') ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(
            document.activeElement?.tagName ?? "",
          ) ||
          (document.activeElement as HTMLElement | null)?.isContentEditable);
      if (
        current.blocked ||
        keyboardOpen.current ||
        domEditing ||
        current.snapshot?.status !== "ready"
      ) {
        timer = setTimeout(() => {
          void tryPresent();
        }, 300);
        return;
      }
      let day: string;
      try {
        day = localDateInTimeZone(new Date(), current.householdTimeZone);
      } catch {
        return;
      }
      const value = current.snapshot.value;
      if (
        !dailySnapshotMatches(
          current.snapshot.identity,
          {
            userId: current.preference.userId!,
            householdId: current.preference.householdId!,
            budgetId: current.preference.budgetId,
          },
          value.model.todayIso,
          day,
        )
      )
        return;
      const presentUnderLock = async () => {
        // Re-read under a cross-tab lock: a different window may have shown today's card.
        await preference.store.hydrate(true);
        if (
          cancelled ||
          Date.now() - started > 8000 ||
          latest.current.pathname !== initialPath ||
          !latest.current.preference.enabled ||
          !latest.current.preference.ready ||
          latest.current.scope !== scope ||
          latest.current.snapshot?.key !== current.snapshot?.key ||
          !latest.current.ready ||
          !latest.current.active ||
          editing() ||
          overlayActivity.getSnapshot() ||
          !preference.store.canPresent(budget, day)
        )
          return;
        const tip = selectTodayWithFlo(
          {
            today: day,
            decisions: value.todayDecisions,
            reviewCount: value.reviewCenterCount,
            upcoming: value.upcoming,
            goals: value.model.currentGoals,
            payday:
              value.model.decisionForecastDays.find(
                (d) => d.date > day && d.income > 0,
              ) ?? null,
            categories: value.model.categoryPlan,
            safetyFloor: value.model.algorithmSuite.safeCushion.safetyFloor,
          },
          Object.values(preference.store.getSnapshot().history)
            .flat()
            .sort((a, b) => b.day.localeCompare(a.day)),
        );
        if (!tip) return;
        // Claim only at the final presentation boundary. Storage failure never flashes a card.
        if (!(await preference.store.claimPresentation(budget, day, tip.topic)))
          return;
        if (
          cancelled ||
          Date.now() - started > 8000 ||
          latest.current.pathname !== initialPath ||
          !latest.current.preference.enabled ||
          !latest.current.preference.ready ||
          latest.current.scope !== scope ||
          latest.current.snapshot?.key !== current.snapshot?.key ||
          !latest.current.ready ||
          !latest.current.active ||
          editing() ||
          overlayActivity.getSnapshot()
        )
          return;
        await new Promise<void>((resolve) => {
          releaseLock.current = resolve;
          setPresentation({ tip, scope, day });
        });
      };
      if (Platform.OS === "web") {
        // Without Web Locks, skip auto presentation rather than race another tab.
        if (!navigator.locks) return;
        void navigator.locks.request(
          `flowledger-daily:${JSON.stringify([preference.userId, preference.householdId])}`,
          { ifAvailable: true },
          async (lock) => {
            if (lock) await presentUnderLock();
          },
        );
      } else void presentUnderLock();
    };
    // Existing pending-charge and install prompts open around 1.5 seconds.
    timer = setTimeout(() => {
      void tryPresent();
    }, 2300);
    return () => {
      cancel();
      unsubscribeInteractions();
      if (Platform.OS === "web") {
        document.removeEventListener("pointerdown", cancel, true);
        document.removeEventListener("keydown", cancel, true);
      }
    };
  }, [
    ready,
    active,
    preference.ready,
    preference.enabled,
    preference.userId,
    preference.householdId,
    preference.store,
    scope,
    budget,
    foreground,
    pathname,
  ]);

  useEffect(() => {
    if (!visible || Platform.OS !== "web") return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [visible, close]);

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={close}
      onShow={() => {
        if (
          !presentation ||
          latest.current.scope !== presentation.scope ||
          !latest.current.ready
        ) {
          close();
          return;
        }
        if (Platform.OS === "web")
          (closeRef.current as unknown as HTMLElement | null)?.focus?.();
        else {
          const handle = findNodeHandle(closeRef.current);
          if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
        }
      }}
    >
      <View
        accessibilityViewIsModal
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
          backgroundColor: "rgba(0,0,0,0.65)",
        }}
      >
        <ScrollView
          style={{
            width: "100%",
            maxWidth: 440,
            maxHeight: "90%",
            borderRadius: 24,
            backgroundColor: c.card,
          }}
          contentContainerStyle={{ padding: 24, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text
              style={{
                color: c.primary,
                fontFamily: "Inter_700Bold",
                fontSize: 14,
              }}
            >
              TODAY WITH FLO
            </Text>
            <Pressable
              ref={closeRef}
              accessibilityRole="button"
              accessibilityLabel="Close Today with Flo"
              onPress={close}
              style={{
                minWidth: 44,
                minHeight: 44,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 26, color: c.foreground }}>×</Text>
            </Pressable>
          </View>
          <Text
            accessibilityRole="header"
            style={{
              color: c.foreground,
              fontFamily: "Inter_700Bold",
              fontSize: 23,
            }}
          >
            {presentation?.tip.title}
          </Text>
          {presentation?.tip.details.slice(0, 2).map((detail) => (
            <Text
              key={detail}
              style={{ color: c.mutedForeground, fontSize: 15, lineHeight: 22 }}
            >
              {detail}
            </Text>
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              const tip = presentation?.tip;
              close();
              if (tip)
                router.push({
                  pathname: tip.route as never,
                  params: tip.params,
                });
            }}
            style={{
              minHeight: 48,
              borderRadius: 14,
              backgroundColor: c.primary,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 16,
            }}
          >
            <Text
              style={{
                color: "#fff",
                fontFamily: "Inter_700Bold",
                fontSize: 15,
              }}
            >
              {presentation?.tip.actionLabel}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={close}
            style={{
              minHeight: 44,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: c.foreground, fontSize: 15 }}>Got it</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}
