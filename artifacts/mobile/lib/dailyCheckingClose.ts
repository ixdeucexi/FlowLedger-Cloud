export type DailyBalanceSource = "projected" | "actual_close" | "unavailable";
export type DailyCheckingCloseLoadStatus = "loading" | "ready" | "error";

export interface DailyCheckingCloseSnapshot {
  balance_date: string;
  checking_balance: number;
  observed_at: string;
  account_count: number;
  source: "plaid_sync";
}

export interface DailyBalanceCloseMetadata {
  balanceSource: DailyBalanceSource;
  balanceDate: string;
  balanceObservedAt?: string;
  balanceUnavailableReason?: "history_loading" | "history_error" | "close_not_recorded";
}

export function calendarBalanceIsVisible(
  day: Pick<DailyBalanceCloseMetadata, "balanceSource"> | null | undefined,
): boolean {
  return Boolean(day && day.balanceSource !== "unavailable");
}

export type DailyCheckingClosePageResult = {
  data: DailyCheckingCloseSnapshot[] | null;
  error: { message: string } | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function shouldApplyDailyCheckingCloseLoad(
  requestGeneration: number,
  latestGeneration: number,
  scopeIsCurrent: boolean,
): boolean {
  return scopeIsCurrent && requestGeneration === latestGeneration;
}

export function localDateInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function overlayCompletedDailyCheckingCloses<
  T extends { day: number; balance: number },
>(
  projectedDays: T[],
  month: number,
  year: number,
  snapshots: DailyCheckingCloseSnapshot[],
  householdLocalToday: string,
  _historyStatus: DailyCheckingCloseLoadStatus = "ready",
): Array<T & DailyBalanceCloseMetadata> {
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const completedByDay = new Map<number, DailyCheckingCloseSnapshot>();

  if (ISO_DATE.test(householdLocalToday)) {
    snapshots.forEach(snapshot => {
      if (!ISO_DATE.test(snapshot.balance_date)) return;
      if (!snapshot.balance_date.startsWith(`${monthPrefix}-`)) return;
      if (snapshot.balance_date >= householdLocalToday) return;
      if (!Number.isFinite(snapshot.checking_balance)) return;
      const day = Number(snapshot.balance_date.slice(8, 10));
      const current = completedByDay.get(day);
      if (!current || snapshot.observed_at > current.observed_at) completedByDay.set(day, snapshot);
    });
  }

  return projectedDays.map(projected => {
    const balanceDate = `${monthPrefix}-${String(projected.day).padStart(2, "0")}`;
    if (!ISO_DATE.test(householdLocalToday) || balanceDate >= householdLocalToday) {
      return { ...projected, balanceSource: "projected", balanceDate };
    }
    const actual = completedByDay.get(projected.day);
    if (!actual) {
      return {
        ...projected,
        balanceSource: "projected",
        balanceDate,
      };
    }
    return {
      ...projected,
      balance: actual.checking_balance,
      balanceSource: "actual_close",
      balanceDate,
      balanceObservedAt: actual.observed_at,
    };
  });
}

export async function loadAllDailyCheckingCloses(
  fetchPage: (from: number, to: number) => Promise<DailyCheckingClosePageResult>,
  pageSize = 200,
): Promise<DailyCheckingClosePageResult> {
  const rows: DailyCheckingCloseSnapshot[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    if (page.error) return { data: null, error: page.error };
    const pageRows = page.data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) return { data: rows, error: null };
  }
}
