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
  | "children"
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
  id: "money" | "insights" | "preferences" | "account" | "admin";
  label: string;
  sectionIds: readonly SettingsDestinationId[];
}

export interface SettingsStatus {
  label: string;
  tone?: "neutral" | "attention";
}

export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
  { id: "accounts", label: "Accounts & household", description: "Balances and sharing", icon: "users" },
  { id: "plaid", label: "Bank connections", description: "Connections and imports", icon: "credit-card" },
  { id: "money", label: "Money plan", description: "Income, safety, and payoff", icon: "sliders" },
  { id: "goals", label: "Goals", description: "Savings plans", icon: "target" },
  { id: "children", label: "Child money", description: "Allowances and goals", icon: "smile" },
  { id: "review", label: "Review Center", description: "Match bank activity", icon: "check-square" },
  { id: "subscriptions", label: "Subscriptions", description: "Recurring charges", icon: "repeat" },
  { id: "reports", label: "Reports & insights", description: "Spending and progress", icon: "bar-chart-2" },
  { id: "setup", label: "Flo setup & demo", description: "Setup and demo", icon: "message-circle" },
  { id: "notifications", label: "Notifications", description: "Alert preferences", icon: "bell" },
  { id: "appearance", label: "Display options", description: "Theme and text", icon: "sliders" },
  { id: "backup", label: "Backup & data", description: "Import and export", icon: "download" },
  { id: "deleted", label: "Recently deleted", description: "Restore transactions", icon: "trash-2" },
  { id: "membership", label: "Membership", description: "Plan and pricing", icon: "award" },
  { id: "security", label: "Account & security", description: "Account controls", icon: "user" },
  { id: "help", label: "Help & feedback", description: "Support and feedback", icon: "message-square" },
  { id: "legal", label: "Legal & privacy", description: "Terms and privacy", icon: "file-text" },
  { id: "admin", label: "Admin", description: "Testing and tester management", icon: "shield" },
] as const;

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: "money", label: "Plan", sectionIds: ["money", "accounts", "plaid", "goals", "children"] },
  { id: "insights", label: "Review & insights", sectionIds: ["review", "subscriptions", "reports"] },
  { id: "preferences", label: "App", sectionIds: ["appearance", "notifications", "setup", "backup", "deleted"] },
  { id: "account", label: "Account & support", sectionIds: ["membership", "security", "help", "legal"] },
  { id: "admin", label: "Admin", sectionIds: ["admin"] },
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
