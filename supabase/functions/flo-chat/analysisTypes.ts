/** The model supplies intent, never calculated financial facts. */
export type AnalysisDomain = "money" | "forecast" | "purchase" | "spending" | "bills" | "subscriptions" | "income" | "debt" | "credit" | "savings" | "emergency" | "budget" | "stability" | "buffer" | "paycheck" | "progress" | "transactions" | "unusual" | "fees" | "health" | "review";
export type AnalysisRequest = {
  purpose?: "general" | "current_balance" | "forecast_balance" | "affordability" | "buffer_timeline" | "goal_timeline" | "debt_timeline";
  amountRole?: "none" | "target_balance" | "contribution_amount" | "payment_amount" | "purchase_amount" | "threshold";
  contribution?: { amount: number; frequency: "once" | "monthly" | "paycheck" } | null;
  domain: AnalysisDomain;
  operation: "summary" | "detail" | "compare" | "minimum" | "maximum" | "threshold" | "plan" | "scenario" | "search" | "average";
  groupBy?: "category" | "merchant" | "none";
  incomeTiming?: "received" | "expected";
  startDate: string | null;
  endDate: string | null;
  dateEvent: "none" | "next_payday" | "before_payday" | "after_payday" | "after_bill";
  merchant: string | null;
  category: string | null;
  entity: string | null;
  amount: number | null;
  comparisonStart: string | null;
  comparisonEnd: string | null;
  target: "none" | "paycheck_ahead" | "month_ahead" | "three_months" | "six_months";
  debtMethod: "snowball" | "avalanche";
  scenario: { kind: "purchase" | "income_change" | "extra_debt" | "save" | "bill_increase" | "cancel_bill" | "move_bill"; amount: number; date: string; sourceDate?: string | null; entity: string | null; repeat: "once" | "monthly" | "paycheck" } | null;
};

export type SourceRows = { rows: Record<string, any>[]; complete: boolean; reason?: string };
export type AnalysisSnapshot = { householdId: string; capturedAt: string; timeZone: string; today: string; sources: Record<string, SourceRows>; hash: string };
export type AnalysisResult = { text: string; facts: Record<string, string | number | boolean | null>; sources: string[]; assumptions: string[]; missing: string[]; scenario: boolean };

export const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const sum = (values: number[]) => values.reduce((total, value) => total + Math.round(value * 100), 0) / 100;
export function numeric(value: unknown): number | null {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()))) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export const dollars = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(round(value));
export function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function dayAdd(date: string, days: number): string { return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10); }
export function monthStart(date: string) { return `${date.slice(0, 7)}-01`; }
export function monthEnd(date: string) { const d = new Date(`${monthStart(date)}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return dayAdd(d.toISOString().slice(0, 10), -1); }
export function shiftMonth(date: string, offset: number) { const d = new Date(`${monthStart(date)}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + offset); return d.toISOString().slice(0, 10); }
export function localDay(now: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
  return ["year", "month", "day"].map(key => parts.find(p => p.type === key)!.value).join("-");
}
export const label = (value: unknown) => String(value ?? "Unnamed record").replace(/[\r\n\x00-\x1f]/g, " ").slice(0, 80);
export const matches = (value: unknown, search: string | null) => !search || String(value ?? "").toLowerCase().includes(search.toLowerCase());
export function requireSources(snapshot: AnalysisSnapshot, names: string[]): string[] {
  return names.filter(name => !snapshot.sources[name]?.complete).map(name => `${name.replaceAll("_", " ")} could not be fully checked`);
}
