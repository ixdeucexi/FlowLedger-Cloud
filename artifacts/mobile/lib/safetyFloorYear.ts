import type { DailyBalanceSource } from "./dailyCheckingClose";

export interface SafetyFloorYearDay {
  date: string;
  balance: number;
  shortfall: number;
  source: "recorded" | "projected";
}
export interface SafetyFloorYearMonth {
  month: number;
  days: SafetyFloorYearDay[];
  recorded: number;
  projected: number;
  unavailable: number;
  lowestBalance: number | null;
}

/** Read canonical daily balances; absence of recorded history is never a safe day. */
export function summarizeSafetyFloorYear(input: {
  year: number;
  today: string;
  safetyFloor: number;
  startingBalanceDate?: string;
  getDays: (month: number, year: number) => readonly { day: number; balance: number; balanceSource?: DailyBalanceSource }[];
}): SafetyFloorYearMonth[] {
  const currentYear = Number(input.today.slice(0, 4));
  if (input.year !== currentYear && input.year !== currentYear + 1) return [];
  return Array.from({ length: 12 }, (_, month) => {
    const result: SafetyFloorYearMonth = { month, days: [], recorded: 0, projected: 0, unavailable: 0, lowestBalance: null };
    const byDay = new Map(input.getDays(month, input.year).map(day => [day.day, day]));
    const count = new Date(input.year, month + 1, 0).getDate();
    for (let day = 1; day <= count; day++) {
      const date = `${input.year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const row = byDay.get(day);
      const recorded = date < input.today && row?.balanceSource === "actual_close";
      const available = row && Number.isFinite(row.balance) && row.balanceSource !== "unavailable"
        && (recorded || (date >= input.today && (!input.startingBalanceDate || date >= input.startingBalanceDate)));
      if (!available) { result.unavailable++; continue; }
      const balance = row.balance;
      const source = recorded ? "recorded" : "projected";
      result[source]++;
      result.lowestBalance = result.lowestBalance === null ? balance : Math.min(result.lowestBalance, balance);
      if (balance < input.safetyFloor) result.days.push({ date, balance, shortfall: input.safetyFloor - balance, source });
    }
    return result;
  });
}
