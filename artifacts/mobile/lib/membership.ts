export type PlanTier = "free" | "pro";

export type PlanFeature =
  | "manual_budgeting"
  | "flo_assistant"
  | "debt_payoff"
  | "plaid_sync"
  | "transaction_matching"
  | "connected_insights";

export interface HouseholdPlan {
  householdId: string;
  tier: PlanTier;
  source: "default" | "grandfathered" | "admin" | "billing";
  grandfatheredAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
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

export const PLAN_CATALOG: Record<PlanTier, PlanDefinition> = {
  free: {
    tier: "free",
    name: "Free",
    promise: "Do it yourself",
    description: "The complete manual FlowLedger app for building and running your money plan.",
    monthlyPrice: 0,
    annualPrice: 0,
    features: ["manual_budgeting"],
    highlights: [
      "Manual accounts and transactions",
      "Bills, income, categories, and goals",
      "Forecasts, reports, and reconciliation",
      "Household sharing",
    ],
  },
  pro: {
    tier: "pro",
    name: "Pro",
    promise: "Connect and automate",
    description: "Let Flo and connected bank activity keep the plan current and help with the work.",
    monthlyPrice: 9.99,
    annualPrice: 89,
    features: [
      "manual_budgeting",
      "flo_assistant",
      "debt_payoff",
      "plaid_sync",
      "transaction_matching",
      "connected_insights",
    ],
    highlights: [
      "Flo guidance and confirmed actions",
      "Snowball and avalanche payoff tools",
      "Plaid bank sync and transaction matching",
      "Automatic review and connected insights",
    ],
  },
};

export const PLAN_FEATURE_COPY: Record<Exclude<PlanFeature, "manual_budgeting">, { title: string; description: string }> = {
  flo_assistant: {
    title: "Flo is a Pro feature",
    description: "Upgrade to Pro to ask Flo questions and let her preview and apply confirmed money-plan changes.",
  },
  debt_payoff: {
    title: "Debt payoff tools are Pro",
    description: "Upgrade to Pro for snowball and avalanche ordering, safe extra-payment calculations, and payoff projections.",
  },
  plaid_sync: {
    title: "Bank sync is a Pro feature",
    description: "Upgrade to Pro to connect accounts through Plaid and automatically import bank activity.",
  },
  transaction_matching: {
    title: "Bill matching is a Pro feature",
    description: "Upgrade to Pro to match imported bank transactions to planned bills without counting them twice.",
  },
  connected_insights: {
    title: "Connected insights are Pro",
    description: "Upgrade to Pro for automatic review, categorization, subscription detection, and proactive insights.",
  },
};

export function normalizePlanTier(value: unknown, fallback: PlanTier = "free"): PlanTier {
  return value === "pro" || value === "free" ? value : fallback;
}

export function canUseFeature(plan: PlanTier | Pick<HouseholdPlan, "tier">, feature: PlanFeature): boolean {
  const tier = typeof plan === "string" ? plan : plan.tier;
  return PLAN_CATALOG[tier].features.includes(feature);
}

export function annualSavings(tier: PlanTier): number {
  const plan = PLAN_CATALOG[tier];
  return Math.max(0, Math.round((plan.monthlyPrice * 12 - plan.annualPrice) * 100) / 100);
}

export function annualMonthlyEquivalent(tier: PlanTier): number {
  return Math.round((PLAN_CATALOG[tier].annualPrice / 12) * 100) / 100;
}

export function resolvePreviewTier(isAdmin: boolean, storedTier: unknown): PlanTier | null {
  if (!isAdmin || (storedTier !== "free" && storedTier !== "pro")) return null;
  return storedTier;
}

export function mapHouseholdPlan(row: Record<string, unknown> | null | undefined, householdId: string, fallback: PlanTier = "free"): HouseholdPlan {
  return {
    householdId,
    tier: normalizePlanTier(row?.tier, fallback),
    source: row?.source === "grandfathered" || row?.source === "admin" || row?.source === "billing" ? row.source : "default",
    grandfatheredAt: typeof row?.grandfathered_at === "string" ? row.grandfathered_at : null,
    createdAt: typeof row?.created_at === "string" ? row.created_at : null,
    updatedAt: typeof row?.updated_at === "string" ? row.updated_at : null,
  };
}
