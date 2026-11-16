export type AccountTip = {
  key: string;
  title: string;
  body: string;
  route: string;
};
export type WeeklyAccountTip = AccountTip & {
  id: string;
  week: string;
  timestamp: string;
};
export const ACCOUNT_TIPS: readonly Readonly<AccountTip>[];
export function getWeeklyAccountTip(now?: Date | string): WeeklyAccountTip | null;
