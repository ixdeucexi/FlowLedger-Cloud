import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import {
  DEFAULT_ONBOARDING_PREFERENCES,
  normalizeOnboardingPreferences,
  setupScopeProgress,
  type OnboardingPreferences,
} from "@/lib/onboarding";
import { loadOnboardingPreferences } from "@/lib/onboardingPreferences";
import { buildSetupReadiness, setupScopeKey } from "@/lib/setupReadiness";

export function useSetupReadiness() {
  const { user } = useAuth();
  const { activeHousehold, accounts, incomes, bills, goals, settings } = useBudget();
  const [preferences, setPreferences] = useState<OnboardingPreferences>(DEFAULT_ONBOARDING_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const scopeKey = setupScopeKey(user?.id, activeHousehold?.householdId);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadOnboardingPreferences(user?.id)
      .then(value => {
        if (active) setPreferences(normalizeOnboardingPreferences(value));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [scopeKey, user?.id]);

  const readiness = useMemo(() => buildSetupReadiness({
    preferences,
    progress: setupScopeProgress(preferences, scopeKey),
    accounts,
    incomeCount: incomes.length,
    bills,
    goalCount: goals.length,
    safetyFloor: settings.safety_floor,
    forecastMonths: settings.forecast_horizon_months,
  }), [accounts, bills, goals.length, incomes.length, preferences, scopeKey, settings.forecast_horizon_months, settings.safety_floor]);

  return { loading, preferences, readiness };
}
