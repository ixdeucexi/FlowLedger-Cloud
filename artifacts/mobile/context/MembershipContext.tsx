import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import {
  canUseFeature,
  mapHouseholdPlan,
  resolvePreviewTier,
  type HouseholdPlan,
  type PlanFeature,
  type PlanTier,
} from "@/lib/membership";
import { supabase } from "@/lib/supabase";
import { activateBillingIdentity, deactivateBillingIdentity } from "@/lib/nativeBilling";
import { readBillingStatus } from "@/lib/billing";
import { FOUNDING_FREE_LAUNCH } from "@/lib/launchMode";
import { isStoreCaptureMode } from "@/lib/demoMode";

interface MembershipContextValue {
  actualPlan: HouseholdPlan;
  effectiveTier: PlanTier;
  previewTier: PlanTier | null;
  isAdmin: boolean;
  loading: boolean;
  refreshPlan: () => Promise<void>;
  isFeatureLocked: (feature: PlanFeature) => boolean;
  bypassFeature: (feature: PlanFeature) => void;
  setPreviewTier: (tier: PlanTier) => Promise<void>;
  resetPreview: () => Promise<void>;
}

const MembershipContext = createContext<MembershipContextValue | undefined>(undefined);

function previewStorageKey(userId: string, householdId: string) {
  return `flowledger-plan-preview-${userId}-${householdId}`;
}

export function MembershipProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { activeHousehold, demoMode } = useBudget();
  const householdId = activeHousehold?.householdId ?? "local";
  const planScopeKey = `${user?.id ?? "anonymous"}:${householdId}`;
  const [planState, setPlanState] = useState<{
    scopeKey: string;
    plan: HouseholdPlan;
  }>({ scopeKey: planScopeKey, plan: mapHouseholdPlan(null, householdId) });
  const [previewTier, setPreviewTierState] = useState<PlanTier | null>(null);
  const [bypassedFeatures, setBypassedFeatures] = useState<PlanFeature[]>([]);
  const [adminState, setAdminState] = useState<{ userId: string | null; value: boolean }>({
    userId: user?.id ?? null,
    value: false,
  });
  const [loading, setLoading] = useState(true);
  const planRequestRef = useRef(0);
  const adminRequestRef = useRef(0);

  const storageKey = user?.id ? previewStorageKey(user.id, householdId) : null;
  // Never expose a prior user's admin state during an authenticated A→B
  // transition or while B's authoritative lookup is retrying/failing.
  const isAdmin = adminState.userId === (user?.id ?? null) && adminState.value;
  const actualPlan = planState.scopeKey === planScopeKey
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
    setBypassedFeatures([]);
  }, [planScopeKey]);

  useEffect(() => {
    if (FOUNDING_FREE_LAUNCH || !user?.id || demoMode) {
      deactivateBillingIdentity();
      return;
    }
    void activateBillingIdentity(user.id).catch(error => {
      console.warn("Native billing identity is unavailable", error instanceof Error ? error.message : error);
    });
    return () => deactivateBillingIdentity();
  }, [demoMode, user?.id]);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++adminRequestRef.current;
    if (!user?.id) {
      return () => { cancelled = true; };
    }
    void (async () => {
      const retryDelays = [0, 300, 1_200] as const;
      for (const delay of retryDelays) {
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
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
    return () => { cancelled = true; };
  }, [user?.id]);

  const refreshPlan = useCallback(async () => {
    const requestId = ++planRequestRef.current;
    setLoading(true);
    if (demoMode) {
      if (requestId === planRequestRef.current) {
        setPlanState({
          scopeKey: planScopeKey,
          plan: isStoreCaptureMode()
            ? mapHouseholdPlan({ tier: "free", source: "default" }, householdId)
            : mapHouseholdPlan({ tier: "pro", source: "admin" }, householdId, "pro"),
        });
        setLoading(false);
      }
      return;
    }
    if (!activeHousehold?.householdId) {
      if (requestId === planRequestRef.current) {
        setPlanState({ scopeKey: planScopeKey, plan: mapHouseholdPlan(null, householdId) });
        setLoading(false);
      }
      return;
    }
    try {
      if (!FOUNDING_FREE_LAUNCH && user?.id && activeHousehold.role === "owner") {
        // The server rate-limits this authoritative RevenueCat reconciliation;
        // foreground refreshes recover missed expiry/refund webhooks without
        // trusting cached client purchase state.
        await readBillingStatus(activeHousehold.householdId).catch(() => undefined);
      }
      const { data } = await supabase
        .from("household_plans")
        .select("household_id,tier,source,grandfathered_at,created_at,updated_at")
        .eq("household_id", activeHousehold.householdId)
        .maybeSingle();
      if (requestId === planRequestRef.current) {
        setPlanState({
          scopeKey: planScopeKey,
          plan: mapHouseholdPlan(data as Record<string, unknown> | null, activeHousehold.householdId),
        });
      }
    } catch {
      if (requestId === planRequestRef.current) {
        setPlanState({
          scopeKey: planScopeKey,
          plan: mapHouseholdPlan(null, activeHousehold.householdId),
        });
      }
    } finally {
      if (requestId === planRequestRef.current) setLoading(false);
    }
  }, [activeHousehold?.householdId, activeHousehold?.role, demoMode, householdId, planScopeKey, user?.id]);

  useEffect(() => {
    void refreshPlan();
  }, [refreshPlan]);

  useEffect(() => {
    let cancelled = false;
    setPreviewTierState(null);
    setBypassedFeatures([]);
    if (!isAdmin || !storageKey) return () => { cancelled = true; };
    void AsyncStorage.getItem(storageKey).then(value => {
      if (!cancelled) setPreviewTierState(resolvePreviewTier(true, value));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [isAdmin, storageKey]);

  const setPreviewTier = useCallback(async (tier: PlanTier) => {
    if (!isAdmin || !storageKey) return;
    setPreviewTierState(tier);
    setBypassedFeatures([]);
    await AsyncStorage.setItem(storageKey, tier).catch(() => undefined);
  }, [isAdmin, storageKey]);

  const resetPreview = useCallback(async () => {
    setPreviewTierState(null);
    setBypassedFeatures([]);
    if (storageKey) await AsyncStorage.removeItem(storageKey).catch(() => undefined);
  }, [storageKey]);

  const bypassFeature = useCallback((feature: PlanFeature) => {
    if (!isAdmin || !previewTier) return;
    setBypassedFeatures(previous => previous.includes(feature) ? previous : [...previous, feature]);
  }, [isAdmin, previewTier]);

  const effectiveTier = previewTier ?? actualPlan.tier;
  const isFeatureLocked = useCallback((feature: PlanFeature) => {
    if (FOUNDING_FREE_LAUNCH) return false;
    if (bypassedFeatures.includes(feature)) return false;
    const lockedForTier = !canUseFeature(effectiveTier, feature);
    if (isAdmin && previewTier) return lockedForTier;
    return lockedForTier;
  }, [bypassedFeatures, effectiveTier, isAdmin, previewTier]);

  const value = useMemo<MembershipContextValue>(() => ({
    actualPlan,
    effectiveTier,
    previewTier,
    isAdmin,
    loading,
    refreshPlan,
    isFeatureLocked,
    bypassFeature,
    setPreviewTier,
    resetPreview,
  }), [actualPlan, effectiveTier, previewTier, isAdmin, loading, refreshPlan, isFeatureLocked, bypassFeature, setPreviewTier, resetPreview]);

  return <MembershipContext.Provider value={value}>{children}</MembershipContext.Provider>;
}

export function useMembership() {
  const context = useContext(MembershipContext);
  if (!context) throw new Error("useMembership must be used within MembershipProvider");
  return context;
}
