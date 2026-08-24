export type SettingsSectionId =
  | "overview"
  | "membership"
  | "setup"
  | "appearance"
  | "accounts"
  | "plaid"
  | "notifications"
  | "money"
  | "review"
  | "subscriptions"
  | "reports"
  | "goals"
  | "help"
  | "backup"
  | "deleted"
  | "security"
  | "legal"
  | "admin";

export type SettingsDestinationId = Exclude<SettingsSectionId, "overview">;

export interface SettingsSectionMeta {
  id: SettingsDestinationId;
  label: string;
  description: string;
  icon: string;
}

export interface SettingsGroup {
  id: "money" | "preferences" | "data" | "account" | "admin";
  label: string;
  description: string;
  sectionIds: readonly SettingsDestinationId[];
}

export interface SettingsStatus {
  label: string;
  tone?: "neutral" | "attention";
}

export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
  { id: "accounts", label: "Household & accounts", description: "Balances, savings names, and household access", icon: "users" },
  { id: "plaid", label: "Bank connections", description: "Bank sync planned for Pro", icon: "credit-card" },
  { id: "money", label: "Plan settings", description: "Income timing, planning preferences, and payoff rules", icon: "sliders" },
  { id: "goals", label: "Goals", description: "Savings plans", icon: "target" },
  { id: "review", label: "Review Center", description: "Match bank activity", icon: "check-square" },
  { id: "subscriptions", label: "Subscriptions", description: "Recurring charges", icon: "repeat" },
  { id: "reports", label: "Reports & insights", description: "Monthly results and next steps", icon: "bar-chart-2" },
  { id: "setup", label: "Setup & walkthrough", description: "Run setup again or explore the demo", icon: "compass" },
  { id: "notifications", label: "Notifications", description: "Choose the reminders you receive", icon: "bell" },
  { id: "appearance", label: "Appearance & feedback", description: "Theme, text style, and haptic feedback", icon: "sliders" },
  { id: "backup", label: "Data & backup", description: "Import, export, install, and reset Flo memory", icon: "download" },
  { id: "deleted", label: "Recently deleted", description: "Restore transactions", icon: "trash-2" },
  { id: "membership", label: "Membership", description: "Plan and pricing", icon: "award" },
  { id: "security", label: "Security & sign-in", description: "App lock, identity, and sign-out controls", icon: "shield" },
  { id: "help", label: "Help & user guide", description: "Illustrated guidance, support, and feedback", icon: "book-open" },
  { id: "legal", label: "Privacy & legal", description: "Privacy policy, terms, and disclosures", icon: "file-text" },
  { id: "admin", label: "Admin", description: "Testing and tester management", icon: "shield" },
] as const;

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: "money",
    label: "Money & household",
    description: "Set up the information that powers your plan",
    sectionIds: ["money", "accounts", "plaid"],
  },
  {
    id: "preferences",
    label: "App preferences",
    description: "Choose how FlowLedger looks, feels, and alerts you",
    sectionIds: ["appearance", "notifications", "setup"],
  },
  {
    id: "data",
    label: "Data & privacy",
    description: "Control your data, security, and privacy",
    sectionIds: ["backup", "deleted", "security", "legal"],
  },
  {
    id: "account",
    label: "Account & support",
    description: "Manage your plan and get help",
    sectionIds: ["membership", "help"],
  },
  { id: "admin", label: "Admin", description: "Testing and app administration", sectionIds: ["admin"] },
] as const;

export function visibleSettingsGroups(isAdmin: boolean): readonly SettingsGroup[] {
  return SETTINGS_GROUPS.filter(group => group.id !== "admin" || isAdmin);
}

export function settingsGroupById(groupId: SettingsGroup["id"]): SettingsGroup {
  const group = SETTINGS_GROUPS.find(item => item.id === groupId);
  if (!group) throw new Error(`Unknown settings group: ${groupId}`);
  return group;
}

export function settingsGroupForSection(sectionId: SettingsDestinationId): SettingsGroup {
  const group = SETTINGS_GROUPS.find(item => item.sectionIds.includes(sectionId));
  if (!group) throw new Error(`No settings group for section: ${sectionId}`);
  return group;
}

export function settingsSectionById(sectionId: SettingsDestinationId): SettingsSectionMeta {
  const section = SETTINGS_SECTIONS.find(item => item.id === sectionId);
  if (!section) throw new Error(`Unknown settings section: ${sectionId}`);
  return section;
}

export function formatCountStatus(count: number, singular: string, plural = `${singular}s`): string {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  return `${safeCount} ${safeCount === 1 ? singular : plural}`;
}

export function attentionCountStatus(
  count: number,
  zeroLabel: string,
  singular: string,
  plural = `${singular}s`,
): SettingsStatus {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  return safeCount === 0
    ? { label: zeroLabel }
    : { label: formatCountStatus(safeCount, singular, plural), tone: "attention" };
}
