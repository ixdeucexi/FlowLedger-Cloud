import type { Bill } from "./financialProjectionTypes";
import { parseDecimalInput, parseMoneyInput } from "./moneyFormInput";

type ImportedBill = Omit<Bill, "id" | "created_at">;

/** Read records, not physical lines: quoted names can contain commas/newlines. */
function csvRecords(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], value = "", quoted = false, closedQuote = false;
  const field = () => { row.push(value.trim()); value = ""; closedQuote = false; };
  const record = () => { field(); if (row.some(cell => cell)) rows.push(row); row = []; };
  const input = csv.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { value += '"'; i++; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else value += char;
    } else if (char === ",") field();
    else if (char === "\n" || char === "\r") { record(); if (char === "\r" && input[i + 1] === "\n") i++; }
    else if (char === '"' && !value.trim() && !closedQuote) { value = ""; quoted = true; }
    else if (char === '"' || (closedQuote && char.trim())) throw new Error("Invalid CSV quoting. Use double quotes around fields containing commas or line breaks.");
    else if (!closedQuote) value += char;
  }
  if (quoted) throw new Error("Invalid CSV: a quoted field is not closed.");
  record();
  return rows;
}

const sectionName = (row: string[]) => row.length === 1 ? /^===\s*(.*?)\s*===$/.exec(row[0])?.[1].toUpperCase() : undefined;
const headerName = (value: string) => value.toLowerCase().replace(/[\s_-]/g, "");

/** Validate every bill before callers persist anything; other backup sections
 * are never interpreted as bills. Old backups retain their available fields. */
export function parseBillCsv(csv: string): ImportedBill[] {
  const records = csvRecords(csv);
  const sections = records.map(sectionName);
  let rows = records;
  if (sections.some(Boolean)) {
    const starts = sections.flatMap((section, index) => section === "BILLS" ? [index] : []);
    if (starts.length !== 1) throw new Error(starts.length ? "The backup contains more than one BILLS section." : "This backup has no BILLS section. Choose a bills CSV or a FlowLedger backup that includes bills.");
    const start = starts[0] + 1;
    const nextSection = sections.findIndex((section, index) => index >= start && Boolean(section));
    rows = records.slice(start, nextSection < 0 ? undefined : nextSection);
  }
  if (!rows.length) throw new Error("Could not find the bills CSV header. Include Name and Amount columns.");
  const headers = rows[0].map(headerName);
  if (new Set(headers).size !== headers.length) throw new Error("The bills CSV contains duplicate column headers.");
  if (!headers.includes("name") || !headers.includes("amount")) throw new Error("Could not find the bills CSV header. Include Name and Amount columns.");
  const column = new Map(headers.map((header, index) => [header, index]));
  return rows.slice(1).map((row, index) => {
    const invalid = (field: string): never => { throw new Error(`Bill row ${index + 1}: check ${field}. No bills were imported.`); };
    if (row.length !== headers.length) invalid("the number of columns and CSV quoting");
    const get = (name: string) => row[column.get(name) ?? -1] ?? "";
    const money = (name: string, fallback?: number): number => {
      const raw = get(name), value = raw ? parseMoneyInput(raw) : fallback;
      return value == null ? invalid(name) : value;
    };
    const integer = (name: string, fallback: number, min: number, max: number): number => {
      const raw = get(name);
      if (!raw) return fallback;
      const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
      return Number.isSafeInteger(value) && value >= min && value <= max ? value : invalid(name);
    };
    const bool = (name: string, fallback: boolean): boolean => {
      const raw = get(name).toLowerCase();
      return !raw ? fallback : raw === "true" ? true : raw === "false" ? false : invalid(name);
    };
    const date = (name: string): string | undefined => {
      const raw = get(name);
      if (!raw) return undefined;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return invalid(name);
      const parsed = new Date(`${raw}T00:00:00Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw ? raw : invalid(name);
    };
    const name = get("name");
    if (!name) invalid("name");
    const amount = money("amount");
    if (amount <= 0) invalid("amount (must be positive)");
    const frequency = get("frequency").toLowerCase() || "monthly";
    if (!["monthly", "quarterly", "biweekly", "weekly"].includes(frequency)) invalid("frequency");
    const rawRate = get("interestrate");
    const interestRate = rawRate ? parseDecimalInput(rawRate, 4) : 0;
    if (interestRate === null) invalid("interest rate");
    const startDate = date("startdate"), endDate = date("enddate"), nextPaymentDate = date("nextpaymentdate");
    if (startDate && endDate && endDate < startDate) invalid("end date (before start date)");
    const anchor = nextPaymentDate ?? startDate;
    if ((frequency === "quarterly" || frequency === "biweekly") && !anchor) invalid("NextPaymentDate or StartDate (required for this frequency)");
    if (frequency === "weekly" && !get("dayofweek") && !anchor) invalid("DayOfWeek or a payment/start date (required for weekly bills)");
    const dayOfWeek = get("dayofweek") ? integer("dayofweek", 0, 0, 6)
      : frequency === "weekly" && anchor ? new Date(`${anchor}T00:00:00Z`).getUTCDay() : undefined;
    const dueDay = integer("dueday", anchor ? Number(anchor.slice(8, 10)) : 1, 1, 31);
    return {
      name, amount, category: get("category") || "Other",
      priority: integer("priority", index + 1, 0, Number.MAX_SAFE_INTEGER),
      is_debt: bool("isdebt", false), balance: money("balance", 0), interest_rate: interestRate!,
      due_day: dueDay, is_recurring: bool("isrecurring", true),
      frequency: frequency as ImportedBill["frequency"],
      ...(dayOfWeek !== undefined ? { day_of_week: dayOfWeek } : {}),
      ...(nextPaymentDate ? { next_payment_date: nextPaymentDate } : {}),
      ...(startDate ? { start_date: startDate } : {}), ...(endDate ? { end_date: endDate } : {}),
    };
  });
}
