export const SETTINGS_FIELDS = [
  "zeroBasedBudgetEnabled",
  "debtPayoffEnabled",
  "paymentMethod",
  "starting_balance",
  "starting_balance_date",
  "calendar_start_date",
  "safety_floor",
  "forecast_horizon_months",
  "onboarding_completed",
] as const;

export type SettingsField = typeof SETTINGS_FIELDS[number];
export type SettingsPatch = Partial<Record<SettingsField, unknown>>;

const DB_FIELD: Record<SettingsField, string> = {
  zeroBasedBudgetEnabled: "zero_based_budget_enabled",
  debtPayoffEnabled: "debt_payoff_enabled",
  paymentMethod: "payment_method",
  starting_balance: "starting_balance",
  starting_balance_date: "starting_balance_date",
  calendar_start_date: "calendar_start_date",
  safety_floor: "safety_floor",
  forecast_horizon_months: "forecast_horizon_months",
  onboarding_completed: "onboarding_completed",
};

const NULLABLE_FIELDS = new Set<SettingsField>([
  "starting_balance_date",
  "calendar_start_date",
]);

export function normalizedSettingsFields(fields: readonly string[]): SettingsField[] {
  const requested = new Set(fields);
  return SETTINGS_FIELDS.filter(field => requested.has(field));
}

/** Produces only the columns owned by this settings intent. */
export function settingsDbPatch(
  patch: SettingsPatch,
  fields: readonly SettingsField[] = normalizedSettingsFields(Object.keys(patch)),
): Record<string, unknown> {
  return Object.fromEntries(fields.map(field => {
    const value = patch[field];
    return [DB_FIELD[field], NULLABLE_FIELDS.has(field) ? value ?? null : value];
  }));
}
