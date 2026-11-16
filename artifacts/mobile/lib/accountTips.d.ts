export type AccountTip = {
  key: string;
  title: string;
  body: string;
  explanation: string;
  actionLabel: string;
  route: string;
};
export type WeeklyAccountTip = AccountTip & {
  id: string;
  week: string;
  timestamp: string;
};
export const ACCOUNT_TIPS: readonly Readonly<AccountTip>[];
export function getWeeklyAccountTip(now?: Date | string): WeeklyAccountTip | null;
export function getAccountTipForWeek(week: unknown, now?: Date | string): WeeklyAccountTip | null;
export function accountTipRoute(week: unknown, now?: Date | string): string | null;
export function accountTipWeekFromRoute(value: unknown, now?: Date | string): string | null;
