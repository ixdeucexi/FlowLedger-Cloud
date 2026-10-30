export type PlanTier = "free" | "pro";

export const PLAN_FEATURES = [
  "manual_budgeting",
  "flo_basic",
  "flo_account_chat",
  "flo_creation",
  "debt_payoff",
  "debt_strategies",
  "plaid_sync",
  "transaction_matching",
  "connected_insights",
  "plan_simulator",
  "saved_scenarios",
  "scenario_comparison",
  "cloud_scenarios",
  "long_term_reports",
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];
export const FREE_CORE_FEATURES: readonly PlanFeature[] = [
  "manual_budgeting",
  "flo_basic",
  "debt_payoff",
  "plan_simulator",
  "transaction_matching",
];
export const FOUNDING_PLANNING_FEATURES: readonly PlanFeature[] = [
  ...FREE_CORE_FEATURES,
  "flo_account_chat",
  "flo_creation",
  "debt_strategies",
  "connected_insights",
  "saved_scenarios",
  "scenario_comparison",
  "long_term_reports",
];

export interface HouseholdPlan {
  householdId: string;
  tier: PlanTier;
  source: "default" | "grandfathered" | "admin" | "billing";
  grandfatheredAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}
export interface FloAllowance {
  period: "month" | "day";
  limit: number;
  used: number;
  remaining: number;
  resetsAt: string;
  canCreate: boolean;
}
export interface HouseholdFeatureAccess {
  version: 1;
  householdId: string;
  plan: Pick<HouseholdPlan, "tier" | "source">;
  foundingPlanning: boolean;
  features: readonly PlanFeature[];
  flo: FloAllowance;
}
export interface PlanDefinition {
  tier: PlanTier;
  name: string;
  promise: string;
  description: string;
  monthlyPrice: number;
  annualPrice: number;
  features: readonly PlanFeature[];
  highlights: readonly string[];
}
export const PLAN_TIERS: readonly PlanTier[] = ["free", "pro"] as const;
export const PRO_INTRO_ANNUAL_PRICE = 59.99;
export const PLAN_CATALOG: Record<PlanTier, PlanDefinition> = {
  free: {
    tier: "free",
    name: "Free",
    promise: "A complete everyday plan",
    description:
      "Plan your money manually, with useful Flo Essentials and a limited full-AI preview.",
    monthlyPrice: 0,
    annualPrice: 0,
    features: [...FREE_CORE_FEATURES, "flo_account_chat"],
    highlights: [
      "Unlimited manual accounts, bills, income and activity",
      "Forecast, affordability and basic debt guidance",
      "Goals, spending buckets and monthly reports",
      "One temporary what-if scenario",
      "Flo Essentials + 10 AI preview requests each month",
      "Household sharing, customization, Privacy and recovery",
    ],
  },
  pro: {
    tier: "pro",
    name: "Pro",
    promise: "Explore your options with Flo",
    description:
      "Advanced planning and full Flo tools for your household. Bank connectivity remains planned until approved.",
    monthlyPrice: 9.99,
    annualPrice: 79.99,
    features: [...PLAN_FEATURES],
    highlights: [
      "Everything in Free, for the whole household",
      "Full Flo chat and confirmed creations · 300 requests/month",
      "Advanced debt strategies and extra-payment analysis",
      "Saved scenarios, comparisons and household scenario sync",
      "Longer-term report trends and deeper insights",
    ],
  },
};

export const PLAN_FEATURE_COPY: Record<
  Exclude<PlanFeature, "manual_budgeting" | "flo_basic">,
  { title: string; description: string }
> = {
  flo_account_chat: {
    title: "Flo chat is getting ready",
    description:
      "Your preview allowance and household access must be verified before a chat starts. Flo Essentials remains available.",
  },
  flo_creation: {
    title: "Confirmed Flo creations are Pro",
    description:
      "Let Flo prepare bills, income, debts and other entries for your review. Manual Add controls remain free.",
  },
  debt_payoff: {
    title: "Basic debt planning is Free",
    description:
      "Track balances, required payments and your basic payoff plan.",
  },
  debt_strategies: {
    title: "Advanced debt strategies are Pro",
    description:
      "Compare payoff strategies and explore extra-payment plans without changing required payments.",
  },
  plaid_sync: {
    title: "Bank connectivity is planned for Pro",
    description:
      "Manual accounts and statement imports are available now. Public bank connections open after approval and testing.",
  },
  transaction_matching: {
    title: "Manual matching is Free",
    description:
      "Review and match records already in your plan, including safe recovery controls.",
  },
  connected_insights: {
    title: "Automatic insights are Pro",
    description:
      "Review detected subscriptions and deeper patterns. Your monthly totals remain free.",
  },
  plan_simulator: {
    title: "Try a scenario for free",
    description:
      "Explore one temporary what-if scenario without changing your real plan.",
  },
  saved_scenarios: {
    title: "Saved scenarios are Pro",
    description:
      "Name and save multiple options. Your existing saved information remains available to read or remove.",
  },
  scenario_comparison: {
    title: "Scenario comparisons are Pro",
    description:
      "Compare saved options side by side to see their effect on your Forecast.",
  },
  cloud_scenarios: {
    title: "Household scenario sync is Pro",
    description:
      "Save scenarios for the members of your household. Existing saved rows remain readable after a plan change.",
  },
  long_term_reports: {
    title: "Longer-term trends are Pro",
    description:
      "Compare six-month and yearly income and spending. Your monthly report remains free.",
  },
};

export function normalizePlanTier(
  value: unknown,
  fallback: PlanTier = "free",
): PlanTier {
  return value === "pro" || value === "free" ? value : fallback;
}
export function canUseFeature(
  plan: PlanTier | Pick<HouseholdPlan, "tier">,
  feature: PlanFeature,
): boolean {
  const tier = typeof plan === "string" ? plan : plan.tier;
  return PLAN_CATALOG[tier].features.includes(feature);
}
export function annualSavings(tier: PlanTier): number {
  const plan = PLAN_CATALOG[tier];
  return Math.max(
    0,
    Math.round((plan.monthlyPrice * 12 - plan.annualPrice) * 100) / 100,
  );
}
export function annualMonthlyEquivalent(tier: PlanTier): number {
  return Math.round((PLAN_CATALOG[tier].annualPrice / 12) * 100) / 100;
}
export function resolvePreviewTier(
  isAdmin: boolean,
  storedTier: unknown,
): PlanTier | null {
  if (!isAdmin || (storedTier !== "free" && storedTier !== "pro")) return null;
  return storedTier;
}
export function mapHouseholdPlan(
  row: Record<string, unknown> | null | undefined,
  householdId: string,
  fallback: PlanTier = "free",
): HouseholdPlan {
  return {
    householdId,
    tier: normalizePlanTier(row?.tier, fallback),
    source:
      row?.source === "grandfathered" ||
      row?.source === "admin" ||
      row?.source === "billing"
        ? row.source
        : "default",
    grandfatheredAt:
      typeof row?.grandfathered_at === "string" ? row.grandfathered_at : null,
    createdAt: typeof row?.created_at === "string" ? row.created_at : null,
    updatedAt: typeof row?.updated_at === "string" ? row.updated_at : null,
  };
}

export function parseHouseholdFeatureAccess(
  value: unknown,
  expectedHouseholdId: string,
): HouseholdFeatureAccess {
  const row = value as Partial<HouseholdFeatureAccess> | null;
  const fail = () => {
    throw new Error("Household access could not be verified. Try again.");
  };
  if (
    !row ||
    typeof row !== "object" ||
    row.version !== 1 ||
    row.householdId !== expectedHouseholdId ||
    typeof row.foundingPlanning !== "boolean"
  )
    return fail();
  if (
    !row.plan ||
    !["free", "pro"].includes(row.plan.tier) ||
    !["default", "grandfathered", "admin", "billing"].includes(row.plan.source)
  )
    return fail();
  if (
    !Array.isArray(row.features) ||
    new Set(row.features).size !== row.features.length ||
    !row.features.every((feature) => PLAN_FEATURES.includes(feature))
  )
    return fail();
  if (!FREE_CORE_FEATURES.every((feature) => row.features!.includes(feature)))
    return fail();
  const flo = row.flo;
  if (
    !flo ||
    !["day", "month"].includes(flo.period) ||
    ![flo.limit, flo.used, flo.remaining].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    flo.limit > 100_000 ||
    flo.remaining !== Math.max(0, flo.limit - flo.used) ||
    typeof flo.resetsAt !== "string" ||
    !Number.isFinite(Date.parse(flo.resetsAt)) ||
    typeof flo.canCreate !== "boolean"
  )
    return fail();
  if (flo.canCreate && !row.features.includes("flo_creation")) return fail();
  return {
    version: 1,
    householdId: expectedHouseholdId,
    plan: { ...row.plan },
    foundingPlanning: row.foundingPlanning,
    features: [...row.features],
    flo: { ...flo },
  };
}
