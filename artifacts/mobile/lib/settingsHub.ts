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
  | "legal";

export type SettingsDestinationId = Exclude<SettingsSectionId, "overview">;

export interface SettingsSectionMeta {
  id: SettingsDestinationId;
  label: string;
  description: string;
  icon: string;
}

export interface SettingsGroup {
  id: "money" | "insights" | "preferences" | "account";
  label: string;
  sectionIds: readonly SettingsDestinationId[];
}

export interface SettingsStatus {
  label: string;
  tone?: "neutral" | "attention";
}

export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
  { id: "accounts", label: "Accounts & household", description: "Balances, reconciliation, and household sharing.", icon: "users" },
  { id: "plaid", label: "Bank connections", description: "Connect a bank or import activity safely.", icon: "credit-card" },
  { id: "money", label: "Money plan", description: "Income, categories, safety, and payoff.", icon: "sliders" },
  { id: "goals", label: "Goals", description: "Build safe monthly plans for your goals.", icon: "target" },
  { id: "children", label: "Child money", description: "Profiles, allowances, and savings goals.", icon: "smile" },
  { id: "review", label: "Review Center", description: "Resolve activity that needs your attention.", icon: "check-square" },
  { id: "subscriptions", label: "Subscriptions", description: "Review recurring charges and price changes.", icon: "repeat" },
  { id: "reports", label: "Reports & insights", description: "See spending, debt, goals, and recent changes.", icon: "bar-chart-2" },
  { id: "setup", label: "Flo setup & demo", description: "Review setup progress and replay the Demo.", icon: "message-circle" },
  { id: "notifications", label: "Notifications", description: "Private alerts for bills and bank activity.", icon: "bell" },
  { id: "appearance", label: "Display options", description: "Theme, text style, motion, and effects.", icon: "sliders" },
  { id: "backup", label: "Backup & data", description: "Import, export, install, and Flo memory.", icon: "download" },
  { id: "deleted", label: "Recently deleted", description: "Restore transactions removed by mistake.", icon: "trash-2" },
  { id: "membership", label: "Membership", description: "Your plan, pricing, and plan preview.", icon: "award" },
  { id: "security", label: "Account & security", description: "Signed-in account and sign-out controls.", icon: "user" },
  { id: "help", label: "Help & feedback", description: "Send feedback or review the support inbox.", icon: "message-square" },
  { id: "legal", label: "Legal & privacy", description: "Terms, privacy, and data use.", icon: "file-text" },
] as const;

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: "money", label: "Plan", sectionIds: ["money", "accounts", "plaid", "goals", "children"] },
  { id: "insights", label: "Review & insights", sectionIds: ["review", "subscriptions", "reports"] },
  { id: "preferences", label: "App", sectionIds: ["appearance", "notifications", "setup", "backup", "deleted"] },
  { id: "account", label: "Account & support", sectionIds: ["membership", "security", "help", "legal"] },
] as const;

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
