import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import {
  FREE_CORE_FEATURES,
  PLAN_CATALOG,
  mapHouseholdPlan,
  resolvePreviewTier,
  type HouseholdPlan,
  type PlanFeature,
  type PlanTier,
  type HouseholdFeatureAccess,
  type FloAllowance,
} from "@/lib/membership";
import { supabase } from "@/lib/supabase";
import {
  activateBillingIdentity,
  deactivateBillingIdentity,
  isNativeBillingReady,
} from "@/lib/nativeBilling";
import { readBillingStatus } from "@/lib/billing";
import { STORE_CHECKOUT_ENABLED } from "@/lib/launchMode";
import { requestHouseholdFeatureAccess } from "@/lib/membershipAccess";
import { isStoreCaptureMode } from "@/lib/demoMode";

interface MembershipContextValue {
  actualPlan: HouseholdPlan;
  effectiveTier: PlanTier;
  previewTier: PlanTier | null;
  isAdmin: boolean;
  loading: boolean;
  accessReady: boolean;
  accessError: string | null;
  hasFoundingAccess: boolean;
  floAllowance: FloAllowance | null;
  refreshAccess: () => Promise<void>;
  refreshPlan: () => Promise<void>;
  isFeatureLocked: (feature: PlanFeature) => boolean;
  bypassFeature: (feature: PlanFeature) => void;
  setPreviewTier: (tier: PlanTier) => Promise<void>;
  resetPreview: () => Promise<void>;
}

const MembershipContext = createContext<MembershipContextValue | undefined>(
  undefined,
);
const NO_BYPASSED_FEATURES: readonly PlanFeature[] = [];

function previewStorageKey(userId: string, householdId: string) {
  return `flowledger-plan-preview-${userId}-${householdId}`;
}

export function MembershipProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const { activeHousehold, demoMode } = useBudget();
  const householdId = activeHousehold?.householdId ?? "local";
  const planScopeKey = `${user?.id ?? "anonymous"}:${householdId}`;
  const [planState, setPlanState] = useState<{
    scopeKey: string;
    plan: HouseholdPlan;
  }>({ scopeKey: planScopeKey, plan: mapHouseholdPlan(null, householdId) });
  const [previewTier, setPreviewTierState] = useState<PlanTier | null>(null);
  const [bypassState, setBypassState] = useState<{
    scopeKey: string;
    features: PlanFeature[];
  }>({ scopeKey: "", features: [] });
  const [adminState, setAdminState] = useState<{
    userId: string | null;
    value: boolean;
  }>({
    userId: user?.id ?? null,
    value: false,
  });
  const [loading, setLoading] = useState(true);
  const planRequestRef = useRef(0);
  const [accessState, setAccessState] = useState<{
    scopeKey: string;
    access: HouseholdFeatureAccess | null;
    error: string | null;
  }>({ scopeKey: "", access: null, error: null });
  const accessScopeKey = `${planScopeKey}:${activeHousehold?.role ?? "none"}:preview:${previewTier ?? "actual"}`;
  const liveAccess = useRef({
    key: accessScopeKey,
    generation: 0,
    mounted: true,
  });
  if (liveAccess.current.key !== accessScopeKey)
    liveAccess.current = {
      ...liveAccess.current,
      key: accessScopeKey,
      generation: liveAccess.current.generation + 1,
    };
  useLayoutEffect(() => {
    liveAccess.current.mounted = true;
    return () => {
      liveAccess.current.mounted = false;
      liveAccess.current.generation += 1;
    };
  }, []);
  const bypassedFeatures =
    bypassState.scopeKey === accessScopeKey
      ? bypassState.features
      : NO_BYPASSED_FEATURES;
  const resolvedAccess =
    accessState.scopeKey === accessScopeKey ? accessState.access : null;
  const accessReady = resolvedAccess !== null;
  const accessError =
    accessState.scopeKey === accessScopeKey ? accessState.error : null;
  const hasFoundingAccess = resolvedAccess?.foundingPlanning === true;
  const floAllowance = resolvedAccess?.flo ?? null;
  const adminRequestRef = useRef(0);

  const storageKey = user?.id ? previewStorageKey(user.id, householdId) : null;
  // Never expose a prior user's admin state during an authenticated A→B
  // transition or while B's authoritative lookup is retrying/failing.
  const isAdmin = adminState.userId === (user?.id ?? null) && adminState.value;
  const actualPlan =
    planState.scopeKey === planScopeKey
      ? planState.plan
      : mapHouseholdPlan(null, householdId);

  useLayoutEffect(() => {
    adminRequestRef.current += 1;
    setAdminState({ userId: user?.id ?? null, value: false });
  }, [user?.id]);

  useLayoutEffect(() => {
    planRequestRef.current += 1;
    setLoading(true);
    setPreviewTierState(null);
    setBypassState({ scopeKey: "", features: [] });
  }, [planScopeKey]);

  useEffect(() => {
    if (
      !STORE_CHECKOUT_ENABLED ||
      !isNativeBillingReady() ||
      !user?.id ||
      demoMode
    ) {
      deactivateBillingIdentity();
      return;
    }
    void activateBillingIdentity(user.id).catch((error) => {
      console.warn(
        "Native billing identity is unavailable",
        error instanceof Error ? error.message : error,
      );
    });
    return () => deactivateBillingIdentity();
  }, [demoMode, user?.id]);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++adminRequestRef.current;
    if (!user?.id) {
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      const retryDelays = [0, 300, 1_200] as const;
      for (const delay of retryDelays) {
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          if (cancelled) return;
        }
        try {
          const { data, error } = await supabase
            .from("feedback_admins")
            .select("user_id")
            .eq("user_id", user.id)
            .maybeSingle();
          if (error) throw error;
          if (!cancelled && requestId === adminRequestRef.current) {
            setAdminState({ userId: user.id, value: Boolean(data) });
          }
          return;
        } catch {
          // A token-refresh race must not permanently hide tester/admin tools.
          // Keep the last authoritative value and retry before giving up.
        }
      }
      if (!cancelled && requestId === adminRequestRef.current) {
        setAdminState({ userId: user.id, value: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const refreshAccess = useCallback(async () => {
    const generation = ++liveAccess.current.generation;
    const scopeKey = accessScopeKey;
    const current = () =>
      liveAccess.current.mounted &&
      liveAccess.current.key === scopeKey &&
      liveAccess.current.generation === generation;
    if (demoMode) {
      const tier = isStoreCaptureMode() ? "free" : "pro";
      const now = new Date();
      const reset = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
      );
      const demoAccess: HouseholdFeatureAccess = {
        version: 1,
        householdId,
        plan: { tier, source: tier === "pro" ? "admin" : "default" },
        foundingPlanning: false,
        features: [...PLAN_CATALOG[tier].features],
        flo: {
          period: "month",
          limit: tier === "pro" ? 300 : 10,
          used: 0,
          remaining: tier === "pro" ? 300 : 10,
          resetsAt: reset.toISOString(),
          canCreate: tier === "pro",
        },
      };
      if (current()) {
        setAccessState({ scopeKey, access: demoAccess, error: null });
        setPlanState({
          scopeKey: planScopeKey,
          plan: mapHouseholdPlan(demoAccess.plan, householdId),
        });
      }
      return;
    }
    if (!user?.id || !activeHousehold?.householdId) {
      if (current()) {
        setAccessState({ scopeKey, access: null, error: null });
        setPlanState({
          scopeKey: planScopeKey,
          plan: mapHouseholdPlan(null, householdId),
        });
      }
      return;
    }
    try {
      const access = await requestHouseholdFeatureAccess(
        supabase,
        {
          userId: user.id,
          householdId: activeHousehold.householdId,
          previewTier,
        },
        current,
      );
      if (!current() || !access) return;
      setAccessState({ scopeKey, access, error: null });
      setPlanState({
        scopeKey: planScopeKey,
        plan: mapHouseholdPlan(access.plan, householdId),
      });
    } catch (error) {
      if (current())
        setAccessState({
          scopeKey,
          access: null,
          error:
            error instanceof Error
              ? error.message
              : "Household access could not be verified. Try again.",
        });
    }
  }, [
    accessScopeKey,
    activeHousehold?.householdId,
    demoMode,
    householdId,
    planScopeKey,
    previewTier,
    user?.id,
  ]);

  const refreshPlan = useCallback(async () => {
    const requestId = ++planRequestRef.current;
    setLoading(true);
    // Reconciliation is separate from eligibility and remains dormant until
    // the configured native checkout is explicitly enabled.
    if (
      STORE_CHECKOUT_ENABLED &&
      user?.id &&
      activeHousehold?.role === "owner" &&
      !demoMode
    ) {
      await readBillingStatus(activeHousehold.householdId).catch(
        () => undefined,
      );
      if (
        requestId !== planRequestRef.current ||
        liveAccess.current.key !== accessScopeKey ||
        !liveAccess.current.mounted
      )
        return;
    }
    await refreshAccess();
    if (
      requestId === planRequestRef.current &&
      liveAccess.current.key === accessScopeKey &&
      liveAccess.current.mounted
    )
      setLoading(false);
  }, [
    accessScopeKey,
    activeHousehold?.householdId,
    activeHousehold?.role,
    demoMode,
    refreshAccess,
    user?.id,
  ]);

  useEffect(() => {
    void refreshPlan();
  }, [refreshPlan]);

  useEffect(() => {
    let cancelled = false;
    setPreviewTierState(null);
    setBypassState({ scopeKey: "", features: [] });
    if (!isAdmin || !storageKey)
      return () => {
        cancelled = true;
      };
    void AsyncStorage.getItem(storageKey)
      .then((value) => {
        if (!cancelled) setPreviewTierState(resolvePreviewTier(true, value));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isAdmin, storageKey]);

  const setPreviewTier = useCallback(
    async (tier: PlanTier) => {
      if (
        !isAdmin ||
        !storageKey ||
        !liveAccess.current.mounted ||
        liveAccess.current.key !== accessScopeKey
      )
        return;
      setPreviewTierState(tier);
      setBypassState({ scopeKey: "", features: [] });
      await AsyncStorage.setItem(storageKey, tier).catch(() => undefined);
    },
    [accessScopeKey, isAdmin, storageKey],
  );

  const resetPreview = useCallback(async () => {
    if (
      !isAdmin ||
      !liveAccess.current.mounted ||
      liveAccess.current.key !== accessScopeKey
    )
      return;
    setPreviewTierState(null);
    setBypassState({ scopeKey: "", features: [] });
    if (storageKey)
      await AsyncStorage.removeItem(storageKey).catch(() => undefined);
  }, [accessScopeKey, isAdmin, storageKey]);

  const bypassFeature = useCallback(
    (feature: PlanFeature) => {
      if (
        !isAdmin ||
        !previewTier ||
        !liveAccess.current.mounted ||
        liveAccess.current.key !== accessScopeKey
      )
        return;
      setBypassState((previous) => ({
        scopeKey: accessScopeKey,
        features:
          previous.scopeKey === accessScopeKey
            ? previous.features.includes(feature)
              ? previous.features
              : [...previous.features, feature]
            : [feature],
      }));
    },
    [accessScopeKey, isAdmin, previewTier],
  );

  const effectiveTier = previewTier ?? actualPlan.tier;
  const isFeatureLocked = useCallback(
    (feature: PlanFeature) => {
      if (bypassedFeatures.includes(feature)) return false;
      // Only the server's scoped response grants cost-bearing capabilities.
      if (FREE_CORE_FEATURES.includes(feature)) return false;
      return !resolvedAccess?.features.includes(feature);
    },
    [bypassedFeatures, resolvedAccess],
  );

  const value = useMemo<MembershipContextValue>(
    () => ({
      actualPlan,
      effectiveTier,
      previewTier,
      isAdmin,
      loading,
      accessReady,
      accessError,
      hasFoundingAccess,
      floAllowance,
      refreshAccess,
      refreshPlan,
      isFeatureLocked,
      bypassFeature,
      setPreviewTier,
      resetPreview,
    }),
    [
      actualPlan,
      effectiveTier,
      previewTier,
      isAdmin,
      loading,
      accessReady,
      accessError,
      hasFoundingAccess,
      floAllowance,
      refreshAccess,
      refreshPlan,
      isFeatureLocked,
      bypassFeature,
      setPreviewTier,
      resetPreview,
    ],
  );

  return (
    <MembershipContext.Provider value={value}>
      {children}
    </MembershipContext.Provider>
  );
}

export function useMembership() {
  const context = useContext(MembershipContext);
  if (!context)
    throw new Error("useMembership must be used within MembershipProvider");
  return context;
}
