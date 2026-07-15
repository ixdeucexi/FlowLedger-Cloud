import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

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

interface MembershipContextValue {
  actualPlan: HouseholdPlan;
  effectiveTier: PlanTier;
  previewTier: PlanTier | null;
  isAdmin: boolean;
  loading: boolean;
  isFeatureLocked: (feature: PlanFeature) => boolean;
  bypassFeature: (feature: PlanFeature) => void;
  setPreviewTier: (tier: PlanTier) => Promise<void>;
  resetPreview: () => Promise<void>;
}

const FALLBACK_PLAN: HouseholdPlan = {
  householdId: "local",
  tier: "free",
  source: "default",
};

const MembershipContext = createContext<MembershipContextValue | undefined>(undefined);

function previewStorageKey(userId: string, householdId: string) {
  return `flowledger-plan-preview-${userId}-${householdId}`;
}

export function MembershipProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { activeHousehold, demoMode } = useBudget();
  const [actualPlan, setActualPlan] = useState<HouseholdPlan>(FALLBACK_PLAN);
  const [previewTier, setPreviewTierState] = useState<PlanTier | null>(null);
  const [bypassedFeatures, setBypassedFeatures] = useState<PlanFeature[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const householdId = activeHousehold?.householdId ?? "local";
  const storageKey = user?.id ? previewStorageKey(user.id, householdId) : null;

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setIsAdmin(false);
      return () => { cancelled = true; };
    }
    void (async () => {
      try {
        const { data } = await supabase
          .from("feedback_admins")
          .select("user_id")
          .eq("user_id", user.id)
          .maybeSingle();
        if (!cancelled) setIsAdmin(Boolean(data));
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (demoMode) {
      setActualPlan(mapHouseholdPlan({ tier: "pro", source: "admin" }, householdId, "pro"));
      setLoading(false);
      return () => { cancelled = true; };
    }
    if (!activeHousehold?.householdId) {
      setActualPlan(FALLBACK_PLAN);
      setLoading(false);
      return () => { cancelled = true; };
    }
    void (async () => {
      try {
        const { data } = await supabase
          .from("household_plans")
          .select("household_id,tier,source,grandfathered_at,created_at,updated_at")
          .eq("household_id", activeHousehold.householdId)
          .maybeSingle();
        if (!cancelled) setActualPlan(mapHouseholdPlan(data as Record<string, unknown> | null, activeHousehold.householdId));
      } catch {
        if (!cancelled) setActualPlan(mapHouseholdPlan(null, activeHousehold.householdId));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeHousehold?.householdId, demoMode, householdId]);

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
    if (!isAdmin || !previewTier) return false;
    if (bypassedFeatures.includes(feature)) return false;
    return !canUseFeature(effectiveTier, feature);
  }, [bypassedFeatures, effectiveTier, isAdmin, previewTier]);

  const value = useMemo<MembershipContextValue>(() => ({
    actualPlan,
    effectiveTier,
    previewTier,
    isAdmin,
    loading,
    isFeatureLocked,
    bypassFeature,
    setPreviewTier,
    resetPreview,
  }), [actualPlan, effectiveTier, previewTier, isAdmin, loading, isFeatureLocked, bypassFeature, setPreviewTier, resetPreview]);

  return <MembershipContext.Provider value={value}>{children}</MembershipContext.Provider>;
}

export function useMembership() {
  const context = useContext(MembershipContext);
  if (!context) throw new Error("useMembership must be used within MembershipProvider");
  return context;
}
