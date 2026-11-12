import type { ForecastAccountDescriptor, ForecastAccountRef } from "./accountForecasts";
import type { FinancialEvent } from "./forecast";

/** Planning metadata only. These rows never initiate a bank transfer or settle Activity. */
export interface PlannedAccountTransfer {
  id: string;
  household_id: string;
  budget_id: string;
  name: string;
  amount: number;
  from_account_ref: ForecastAccountRef;
  to_account_ref: ForecastAccountRef;
  frequency: "once" | "monthly";
  start_date: string;
  end_date: string | null;
  status: "active" | "paused";
  deleted_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  /** Read-only origin for a retired Bill; only the atomic conversion sets it. */
  source_bill_id?: string | null;
}

export type PlannedTransferPatch = Partial<Pick<PlannedAccountTransfer,
  "name" | "amount" | "from_account_ref" | "to_account_ref" | "frequency" | "start_date" | "end_date" | "status">>;

export interface PlannedTransferOccurrence {
  id: string;
  transfer_id: string;
  household_id: string;
  budget_id: string;
  occurrence_date: string;
  scheduled_date_snapshot: string;
  skipped: boolean;
  from_reflected: boolean;
  to_reflected: boolean;
  from_balance_as_of: string | null;
  to_balance_as_of: string | null;
  amount_snapshot: number;
  from_account_ref_snapshot: ForecastAccountRef;
  to_account_ref_snapshot: ForecastAccountRef;
  template_revision_snapshot: number;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface PlannedTransferOccurrencePatch {
  skipped?: boolean;
  from_reflected?: boolean;
  to_reflected?: boolean;
  from_balance_as_of?: string | null;
  to_balance_as_of?: string | null;
  use_current_plan?: boolean;
}

export interface PlannedTransferIssue {
  transferId: string;
  occurrenceDate?: string;
  accountRefs: string[];
  message: string;
}

export function validPlannedTransferDate(value: unknown): value is string {
  if (typeof value !== "string" || (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0,4)) < 1)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const numeric = (value: unknown) => (typeof value === "number" || typeof value === "string" && /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) ? Number(value) : Number.NaN;
const validAmount = (value: number) => Number.isFinite(value) && value > 0 && value <= 1e9
  && Math.abs(value * 100 - Math.round(value * 100)) < 0.0001;
const partial = (row: PlannedTransferOccurrence) => !row.skipped && row.from_reflected !== row.to_reflected;
export const plannedTransferHasOutstandingReview = (transfer: PlannedAccountTransfer, row: PlannedTransferOccurrence): boolean =>
  !row.skipped && !(row.from_reflected && row.to_reflected) && (transfer.status === "active" && !transfer.deleted_at || partial(row));
const prefixFor = (month: number, year: number) => `${year}-${String(month + 1).padStart(2, "0")}`;

/** Recalculate every month from the ORIGINAL day, rather than from February's clipped date. */
export function plannedTransferScheduledDate(transfer: PlannedAccountTransfer, month: number, year: number): string | null {
  if (!validPlannedTransferDate(transfer.start_date) || !Number.isInteger(month) || month < 0 || month > 11
    || !Number.isInteger(year) || year < 1 || year > 9999) return null;
  if (transfer.end_date !== null && !validPlannedTransferDate(transfer.end_date)) return null;
  const prefix = prefixFor(month, year);
  if (transfer.frequency === "once") return transfer.start_date.startsWith(prefix)
    && (!transfer.end_date || transfer.start_date <= transfer.end_date) ? transfer.start_date : null;
  if (transfer.frequency !== "monthly") return null;
  const day = Math.min(Number(transfer.start_date.slice(8)), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  const date = `${prefix}-${String(day).padStart(2, "0")}`;
  return date >= transfer.start_date && (!transfer.end_date || date <= transfer.end_date) ? date : null;
}

/** The shared UI date list uses the same reviewed-month replacement rule as the engine. */
export function plannedTransferOccurrenceDates(transfer: PlannedAccountTransfer, occurrences: readonly PlannedTransferOccurrence[], month: number, year: number): string[] {
  const prefix = prefixFor(month, year);
  const reviewed = occurrences.filter(row => row.transfer_id === transfer.id && row.occurrence_date.startsWith(prefix));
  const dates = new Set(reviewed.map(row => row.occurrence_date));
  for (const row of occurrences) if (row.transfer_id === transfer.id && plannedTransferHasOutstandingReview(transfer,row)
    && row.scheduled_date_snapshot.slice(0,7) <= prefix) dates.add(row.occurrence_date);
  const scheduled = transfer.status === "active" && !transfer.deleted_at ? plannedTransferScheduledDate(transfer, month, year) : null;
  if (scheduled && reviewed.length === 0) dates.add(scheduled);
  return [...dates].sort();
}

/** Revision merges retain tombstones and reject late reads/saves repainting newer planning rows. */
export function mergePlannedTransferRows<T extends { id: string; revision: number }>(current: readonly T[], incoming: readonly T[]): T[] {
  const rows = new Map(current.map(row => [row.id, row]));
  for (const row of incoming) {
    const existing = rows.get(row.id);
    if (!existing || row.revision > existing.revision) rows.set(row.id, row);
  }
  return [...rows.values()];
}

export function normalizePlannedTransfer(row: unknown): PlannedAccountTransfer {
  const value = row as PlannedAccountTransfer;
  if (!value || typeof value.id !== "string" || !value.id || typeof value.household_id !== "string"
    || typeof value.budget_id !== "string" || typeof value.name !== "string"
    || !validAmount(numeric(value.amount)) || !validPlannedTransferDate(value.start_date)
    || value.end_date !== null && (!validPlannedTransferDate(value.end_date) || value.end_date < value.start_date)
    || value.frequency !== "once" && value.frequency !== "monthly"
    || value.status !== "active" && value.status !== "paused"
    || !Number.isSafeInteger(Number(value.revision)) || Number(value.revision) < 1
    || typeof value.from_account_ref !== "string" || typeof value.to_account_ref !== "string"
    || value.source_bill_id != null && (typeof value.source_bill_id !== "string" || !value.source_bill_id))
    throw new Error("The saved planned transfers could not be read. Refresh and try again.");
  return { ...value, amount: Number(value.amount), revision: Number(value.revision) };
}

export function normalizePlannedTransferOccurrence(row: unknown): PlannedTransferOccurrence {
  const value = row as PlannedTransferOccurrence;
  if (!value || typeof value.id !== "string" || typeof value.transfer_id !== "string"
    || typeof value.household_id !== "string" || typeof value.budget_id !== "string"
    || !validPlannedTransferDate(value.occurrence_date) || !validPlannedTransferDate(value.scheduled_date_snapshot)
    || value.scheduled_date_snapshot.slice(0,7) !== value.occurrence_date.slice(0,7) || !validAmount(numeric(value.amount_snapshot))
    || !Number.isSafeInteger(Number(value.revision)) || Number(value.revision) < 1
    || !Number.isSafeInteger(Number(value.template_revision_snapshot)) || Number(value.template_revision_snapshot) < 1
    || typeof value.skipped !== "boolean" || typeof value.from_reflected !== "boolean" || typeof value.to_reflected !== "boolean"
    || typeof value.from_account_ref_snapshot !== "string" || typeof value.to_account_ref_snapshot !== "string"
    || value.from_reflected && !validPlannedTransferDate(value.from_balance_as_of)
    || value.to_reflected && !validPlannedTransferDate(value.to_balance_as_of))
    throw new Error("The saved transfer adjustments could not be read. Refresh and try again.");
  return { ...value, amount_snapshot: Number(value.amount_snapshot), revision: Number(value.revision), template_revision_snapshot: Number(value.template_revision_snapshot) };
}

export function normalizePlannedTransferData(value: unknown, householdId: string, budgetId: string): {
  transfers: PlannedAccountTransfer[]; occurrences: PlannedTransferOccurrence[];
} {
  const data = value as { transfers?: unknown[]; occurrences?: unknown[] };
  if (!data || !Array.isArray(data.transfers) || !Array.isArray(data.occurrences))
    throw new Error("Planned transfers could not be loaded. Refresh and try again.");
  const transfers = data.transfers.map(normalizePlannedTransfer);
  const occurrences = data.occurrences.map(normalizePlannedTransferOccurrence);
  const ids = new Set(transfers.map(row => row.id));
  if (ids.size !== transfers.length || [...transfers, ...occurrences].some(row => row.household_id !== householdId || row.budget_id !== budgetId)
    || occurrences.some(row => !ids.has(row.transfer_id)))
    throw new Error("The household changed while reading planned transfers. Refresh and try again.");
  const monthKeys = occurrences.map(row => `${row.transfer_id}:${row.occurrence_date.slice(0, 7)}`);
  if (new Set(monthKeys).size !== monthKeys.length) throw new Error("Conflicting transfer adjustments need review.");
  return { transfers, occurrences };
}

/** Pure paired cash planning, using ONLY the central strict alias resolver supplied by the caller. */
export function plannedTransferMonthProjection(input: {
  transfers: readonly PlannedAccountTransfer[];
  occurrences: readonly PlannedTransferOccurrence[];
  accounts: readonly ForecastAccountDescriptor[];
  resolveAccount: (ref: string) => ForecastAccountRef | null;
  month: number;
  year: number;
  carryNotBefore?: string;
}): { events: FinancialEvent[]; issues: PlannedTransferIssue[] } {
  const events: FinancialEvent[] = [], issues: PlannedTransferIssue[] = [];
  const prefix = prefixFor(input.month, input.year);
  const accounts = new Map(input.accounts.map(row => [row.ref, row]));
  for (const transfer of input.transfers) {
    if (transfer.status === "active" && !transfer.deleted_at && (!validPlannedTransferDate(transfer.start_date)
      || transfer.end_date !== null && (!validPlannedTransferDate(transfer.end_date) || transfer.end_date < transfer.start_date)
      || transfer.frequency !== "once" && transfer.frequency !== "monthly")) {
      issues.push({transferId:transfer.id,accountRefs:[transfer.from_account_ref,transfer.to_account_ref],message:"Fix this planned transfer's schedule before using its forecast."});
      continue;
    }
    const reviewed = input.occurrences.filter(row => row.transfer_id === transfer.id);
    const active = transfer.status === "active" && !transfer.deleted_at;
    const scheduled = active ? plannedTransferScheduledDate(transfer, input.month, input.year) : null;
    const inMonth = reviewed.filter(row => row.occurrence_date.startsWith(prefix));
    const candidates = new Map<string, PlannedTransferOccurrence | null>();
    if (scheduled && !inMonth.length) candidates.set(scheduled, null);
    for (const row of reviewed) {
      // Partial reviewed occurrences must survive schedule changes and inactive parents.
      if (partial(row) || active) candidates.set(row.occurrence_date, row);
    }
    for (const [date, state] of candidates) {
      if (state?.skipped || state?.from_reflected && state.to_reflected) continue;
      const amount = state?.amount_snapshot ?? transfer.amount;
      const fromRaw = state?.from_account_ref_snapshot ?? transfer.from_account_ref;
      const toRaw = state?.to_account_ref_snapshot ?? transfer.to_account_ref;
      const fromRef = input.resolveAccount(fromRaw), toRef = input.resolveAccount(toRaw);
      const from = fromRef ? accounts.get(fromRef) : undefined, to = toRef ? accounts.get(toRef) : undefined;
      const issue = (message: string) => issues.push({ transferId: transfer.id, occurrenceDate: date, accountRefs: [fromRaw, toRaw], message });
      const scheduledDate = state?.scheduled_date_snapshot ?? date;
      const carryDate = (leg: "from" | "to") => {
        const account = leg === "from" ? from : to;
        return state ? [scheduledDate, account?.asOfDate ?? scheduledDate, input.carryNotBefore ?? scheduledDate].sort().at(-1)! : scheduledDate;
      };
      const relevant = (!state?.from_reflected && carryDate("from").startsWith(prefix))
        || (!state?.to_reflected && carryDate("to").startsWith(prefix));
      const invalid = !validAmount(amount) || !validPlannedTransferDate(date) || !validPlannedTransferDate(scheduledDate) || !from || !to || !from.active || !to.active
        || fromRef === toRef || from.unavailableReason || to.unavailableReason;
      if (!relevant && !(state && invalid && scheduledDate.slice(0,7) <= prefix)) continue;
      if (!validAmount(amount) || !validPlannedTransferDate(date) || !validPlannedTransferDate(scheduledDate) || !from || !to || !from.active || !to.active
        || fromRef === toRef || from.unavailableReason || to.unavailableReason) {
        issue("Choose two different available cash accounts for this planned transfer. No transfer has been projected.");
        continue;
      }
      if (state?.from_reflected && (!from.asOfDate || from.asOfDate < state.from_balance_as_of!)
        || state?.to_reflected && (!to.asOfDate || to.asOfDate < state.to_balance_as_of!)) {
        issue("Refresh the account balances before using this transfer's already-reflected adjustment.");
        continue;
      }
      for (const leg of ["from", "to"] as const) {
        if (state?.[`${leg}_reflected`]) continue;
        const eventDate = carryDate(leg);
        if (!eventDate.startsWith(prefix)) continue;
        events.push({ id: `planned-transfer:${transfer.id}:${date}:${leg}`, sourceType: "planned_transfer", sourceId: transfer.id,
          date: eventDate, kind: leg === "from" ? "transaction_expense" : "transaction_income", amount: leg === "from" ? -amount : amount,
          status: "planned", transfer: true, accountRef: leg === "from" ? fromRef! : toRef!,
          name: leg === "from" ? `Transfer to ${to.name}` : `Transfer from ${from.name}`,
          plannedTransferId: transfer.id, transferOccurrenceDate: date, transferLeg: leg });
      }
    }
  }
  return { events, issues };
}
