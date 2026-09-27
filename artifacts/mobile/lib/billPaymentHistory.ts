import { dateOnlyToLocalDate } from "./dateLabels";
import { ownsLegacyPersonalRows, type HouseholdDataScope } from "./householdDataScope";

export type PaymentHistoryRow = Record<string, unknown>;
export type BillPaymentHistoryEntry = {
  id: string;
  kind: "payment" | "monthly_record";
  date: string | null;
  amount: number;
  source: string;
  status: string;
  occurrenceDates: string[];
  cycle: string | null;
};
export type BillPaymentHistory = {
  entries: BillPaymentHistoryEntry[];
  paymentCount: number;
  monthlyRecordCount: number;
  recordedPaidTotal: number | null;
  notices: string[];
};
export type PaymentHistoryScope = HouseholdDataScope & { userId: string; householdId: string };

const string = (value: unknown) => typeof value === "string" ? value : "";
const date = (value: unknown) => typeof value === "string" && dateOnlyToLocalDate(value) ? value : null;
function cents(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value))) return null;
  const amount = Number(value), result = Math.round(amount * 100);
  return Number.isFinite(amount) && Number.isSafeInteger(result) ? result : null;
}
function allocations(row: PaymentHistoryRow): PaymentHistoryRow[] {
  return Array.isArray(row.review_allocations)
    ? row.review_allocations.filter((value): value is PaymentHistoryRow => Boolean(value) && typeof value === "object" && !Array.isArray(value)) : [];
}
function linked(row: PaymentHistoryRow, billId: string) {
  return row.linked_bill_id === billId || row.debt_applied_bill_id === billId
    || allocations(row).some(a => ["bill", "extra_principal"].includes(string(a.type)) && a.targetId === billId);
}
export function paymentHistoryRowInScope(row: PaymentHistoryRow, scope: PaymentHistoryScope): boolean {
  return row.household_id === scope.householdId
    || ownsLegacyPersonalRows(scope) && row.household_id == null && row.user_id === scope.userId;
}

/** Read-only presentation of recorded payments, not another settlement engine.
 * Allocation shares win over direct links. Monthly snapshots never get added to
 * detailed payments in the same cycle, and ambiguous overlap suppresses totals. */
export function buildBillPaymentHistory(input: {
  billId: string; today: string; transactions: readonly PaymentHistoryRow[];
  overrides: readonly PaymentHistoryRow[]; scope?: PaymentHistoryScope;
}): BillPaymentHistory {
  const entries: BillPaymentHistoryEntry[] = [], notices = new Set<string>();
  const occupiedCycles = new Set<string>(), hiddenMonths = new Set<string>(), seenRows = new Set<string>();
  const providerRows = new Map<string, { signature: string; entry: BillPaymentHistoryEntry }>();
  const regularCoverage = new Map<string, Map<string, number>>();
  let unknownCycle = false, hiddenUnknownCycle = false, totalSafe = true;
  const scopedRows = input.transactions.filter(row => !input.scope || paymentHistoryRowInScope(row, input.scope));
  const byId = new Map(scopedRows.map(row => [string(row.id), row]));
  const candidateRows: PaymentHistoryRow[] = [];
  for (const row of scopedRows) {
    const original = byId.get(string(row.linked_plan_id));
    if (allocations(row).some(a => ["bill", "extra_principal"].includes(string(a.type)) && a.targetId === input.billId)
      || !original || row.match_reason !== "confirmed_manual_match") { if (linked(row, input.billId)) candidateRows.push(row); continue; }
    if (!original || !linked(original, input.billId) || !original.removed_at || original.match_reason !== "replaced_by_posted_transaction"
      || row.linked_plan_type !== "transaction" || row.review_resolution !== "manual" || row.review_status !== "matched" || row.match_reason !== "confirmed_manual_match") continue;
    const originalParts = allocations(original).filter(a => ["bill", "extra_principal"].includes(string(a.type)));
    const identities = new Set([...originalParts.map(a => string(a.targetId)), string(original.linked_bill_id), string(original.debt_applied_bill_id)].filter(Boolean));
    const parts = allocations(row), amount = cents(row.amount);
    const exactReplacement = parts.length > 0 && parts.every(a => a.type === "planned_expense" && a.source === "transaction" && a.targetId === original.id && (cents(a.amount) ?? 0) > 0)
      && parts.reduce((sum, a) => sum + (cents(a.amount) ?? 0), 0) === -(amount ?? 0);
    if (identities.size !== 1 || !exactReplacement) {
      totalSafe = false; unknownCycle = true; notices.add("A reconciled bank payment needs its bill allocation reviewed before it can be included."); continue;
    }
    const originalDates = [...new Set(originalParts.map(a => date(a.occurrenceDate)).filter(Boolean))];
    candidateRows.push({ ...row, linked_bill_id: input.billId, review_allocations: parts.map(a => ({ ...a, type: "bill", targetId: input.billId,
      occurrenceDate: originalDates.length === 1 ? originalDates[0] : date(original.matched_occurrence_date), settlement: a.settlement ?? "regular" })) });
  }
  for (const row of candidateRows) {
    const id = string(row.id);
    if (!id || seenRows.has(id)) continue;
    seenRows.add(id);
    if (row.source === "snowball_plan") continue;
    const paidDate = date(row.date), amount = cents(row.amount);
    if (row.pending === true || row.review_status === "transfer" || row.review_resolution === "transfer" || row.transfer_group_id
      || paidDate && paidDate > input.today || amount !== null && amount >= 0) continue;
    const parts = allocations(row), matching = parts.filter(a => ["bill", "extra_principal"].includes(string(a.type)) && a.targetId === input.billId);
    const occurrenceDates = [...new Set((matching.length ? matching.map(a => date(a.occurrenceDate)) : [date(row.matched_occurrence_date)]).filter((v): v is string => Boolean(v)))].sort();
    // Even a hidden/removed record must not reappear as a monthly fallback.
    if (row.removed_at || row.deleted_at) {
      if (occurrenceDates.length) occurrenceDates.forEach(d => occupiedCycles.add(d.slice(0, 7)));
      else if (paidDate) hiddenMonths.add(paidDate.slice(0, 7)); else hiddenUnknownCycle = true;
      continue;
    }
    if (!paidDate || amount === null) {
      totalSafe = false; notices.add("Some linked records have an invalid amount or missing payment date and are not included."); continue;
    }
    const bank = Boolean(row.plaid_transaction_id || row.plaid_account_id || row.source === "plaid");
    if (row.review_status === "needs_review" || bank && !["matched", "legacy_reviewed"].includes(string(row.review_status))) continue;
    if (occurrenceDates.length) occurrenceDates.forEach(d => occupiedCycles.add(d.slice(0, 7)));
    else unknownCycle = true;
    let paid = -amount;
    if (row.review_allocations != null && (!Array.isArray(row.review_allocations) || parts.length !== row.review_allocations.length)) {
      totalSafe = false; notices.add("Some linked allocations need review before their payment amount can be included."); continue;
    }
    if (parts.length) {
      const amounts = parts.map(a => cents(a.amount));
      if (row.review_status !== "matched" || amounts.some(a => a === null || a <= 0) || amounts.reduce<number>((sum, a) => sum + (a ?? 0), 0) !== -amount || !matching.length) {
        totalSafe = false; notices.add("Some linked allocations need review before their payment amount can be included."); continue;
      }
      paid = matching.reduce((sum, a) => sum + cents(a.amount)!, 0);
    }
    if (paid <= 0) continue;
    const entry: BillPaymentHistoryEntry = {
      id: `transaction:${id}`, kind: "payment", date: paidDate, amount: paid / 100,
      source: bank ? "Bank payment" : row.source && row.source !== "manual" ? "Imported payment" : "Manual payment",
      status: matching.some(a => a.settlement === "partial") ? "Partial payment" : matching.some(a => a.type === "extra_principal") ? "Includes extra principal" : "Recorded payment",
      occurrenceDates, cycle: null,
    };
    const provider = string(row.plaid_transaction_id) || (string(row.import_hash).startsWith("plaid:") ? string(row.import_hash).slice(6) : "");
    if (provider) {
      const signature = JSON.stringify([entry.date, paid, occurrenceDates, entry.status]);
      const prior = providerRows.get(provider);
      if (prior) {
        if (prior.signature !== signature) {
          totalSafe = false; notices.add("A bank payment has conflicting linked records. Review it in Activity before relying on a total.");
          const index = entries.indexOf(prior.entry); if (index >= 0) entries.splice(index, 1);
        }
        continue;
      }
      providerRows.set(provider, { signature, entry });
    }
    const coverage = new Map<string, number>();
    if (matching.length) matching.filter(a => a.type === "bill" && a.settlement !== "extra_principal").forEach(a => {
      const occurrence = date(a.occurrenceDate); if (!occurrence) return;
      const cycle = occurrence.slice(0, 7); coverage.set(cycle, (coverage.get(cycle) ?? 0) + cents(a.amount)!);
    });
    else if (occurrenceDates.length === 1) coverage.set(occurrenceDates[0].slice(0, 7), paid);
    regularCoverage.set(entry.id, coverage);
    entries.push(entry);
  }
  const overrides = new Map<string, PaymentHistoryRow[]>();
  input.overrides.forEach(row => {
    if (row.bill_id !== input.billId || input.scope && !paymentHistoryRowInScope(row, input.scope)) return;
    const month = Number(row.month), year = Number(row.year);
    if (!Number.isInteger(month) || month < 0 || month > 11 || !Number.isInteger(year) || year < 1900 || year > 9999) return;
    const cycle = `${year}-${String(month + 1).padStart(2, "0")}`;
    overrides.set(cycle, [...(overrides.get(cycle) ?? []), row]);
  });
  for (const [cycle, rows] of overrides) {
    if (hiddenMonths.has(cycle) || hiddenUnknownCycle) continue;
    if (occupiedCycles.has(cycle)) {
      const detailed = entries.filter(entry => regularCoverage.get(entry.id)?.has(cycle));
      const covered = detailed.reduce((sum, entry) => sum + (regularCoverage.get(entry.id)?.get(cycle) ?? 0), 0);
      const hasPayments = entries.some(entry => entry.occurrenceDates.some(value => value.startsWith(cycle)));
      if (hasPayments && rows.some(row => cents(row.paid_amount) === null || (cents(row.paid_amount) ?? 0) > covered)) {
        totalSafe = false; notices.add("A monthly paid total is higher than its detailed payment records. It is not added again; review the cycle in Activity before relying on an overall total.");
      }
      continue;
    }
    if (rows.length !== 1) { totalSafe = false; notices.add("Conflicting monthly records need review and are not included."); continue; }
    const row = rows[0], paid = cents(row.paid_amount), paidDate = date(row.paid_date);
    if (paid === null) { totalSafe = false; notices.add("A monthly payment record has an invalid amount and is not included."); continue; }
    if (paid <= 0 || paidDate && paidDate > input.today || !paidDate && cycle > input.today.slice(0, 7)) continue;
    if (unknownCycle) { totalSafe = false; notices.add("Some payments do not identify their bill cycle. Monthly records may overlap, so an overall paid total is unavailable."); }
    if (!paidDate) { totalSafe = false; notices.add("Some monthly records do not include a payment date, so an overall paid total is unavailable."); }
    entries.push({ id: `monthly:${string(row.id) || cycle}`, kind: "monthly_record", date: paidDate, amount: paid / 100, source: "Monthly payment record", status: unknownCycle ? "Cycle total · may overlap payments" : "Cycle total · not an individual payment", occurrenceDates: [], cycle });
  }
  entries.sort((a, b) => (b.date ?? `${b.cycle}-00`).localeCompare(a.date ?? `${a.cycle}-00`) || a.id.localeCompare(b.id));
  return { entries, paymentCount: entries.filter(e => e.kind === "payment").length, monthlyRecordCount: entries.filter(e => e.kind === "monthly_record").length,
    recordedPaidTotal: totalSafe ? entries.reduce((sum, entry) => sum + Math.round(entry.amount * 100), 0) / 100 : null, notices: [...notices] };
}

/** Only authenticated client SELECTs, scoped exactly as BudgetContext's personal
 * legacy policy. Separate equality/contains queries avoid raw JSON OR syntax. */
export async function loadBillPaymentHistoryRows(client: { from(table: string): any }, input: {
  billId: string; scope: PaymentHistoryScope; signal?: AbortSignal; pageSize?: number;
}): Promise<{ transactions: PaymentHistoryRow[]; overrides: PaymentHistoryRow[] }> {
  const { billId, scope, signal } = input, pageSize = input.pageSize ?? 500;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!billId.trim() || billId.length > 200 || ![scope.householdId, scope.userId].every(value => uuid.test(value)) || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new Error("Payment history scope is unavailable.");
  const scoped = (query: any) => ownsLegacyPersonalRows(scope)
    ? query.or(`household_id.eq.${scope.householdId},and(household_id.is.null,user_id.eq.${scope.userId})`)
    : query.eq("household_id", scope.householdId);
  async function read(table: string, filter: (query: any) => any): Promise<PaymentHistoryRow[]> {
    const rows: PaymentHistoryRow[] = [], ids = new Set<string>(); let cursor: string | null = null;
    for (let page = 0; page < 2000; page++) {
      if (signal?.aborted) throw new Error("Payment history loading was cancelled.");
      let query = filter(scoped(client.from(table).select("*"))).order("id", { ascending: true }).limit(pageSize);
      if (cursor) query = query.gt("id", cursor);
      if (signal) query = query.abortSignal(signal);
      const result = await query;
      if (signal?.aborted) throw new Error("Payment history loading was cancelled.");
      if (result.error) throw new Error("Payment history could not be loaded. Please try again.");
      const batch: PaymentHistoryRow[] = result.data ?? [];
      if (batch.length > pageSize) throw new Error("Payment history changed while loading. Please try again.");
      for (const row of batch) {
        const id = string(row.id);
        if (!id || ids.has(id) || !paymentHistoryRowInScope(row, scope)) throw new Error("Payment history could not be verified for this household.");
        ids.add(id); rows.push(row);
      }
      if (batch.length < pageSize) return rows;
      cursor = string(batch[batch.length - 1].id);
    }
    throw new Error("Payment history is too large to load safely. Please try again.");
  }
  const [direct, debt, allocated, extraPrincipal, overrides] = await Promise.all([
    read("transactions", query => query.eq("linked_bill_id", billId)),
    read("transactions", query => query.eq("debt_applied_bill_id", billId)),
    // This column is JSONB. A JS array selects the SDK's Postgres-array
    // serializer (cs.{[object Object]}), so pass a serialized JSON array.
    read("transactions", query => query.contains("review_allocations", JSON.stringify([{ type: "bill", targetId: billId }]))),
    read("transactions", query => query.contains("review_allocations", JSON.stringify([{ type: "extra_principal", targetId: billId }]))),
    read("monthly_overrides", query => query.eq("bill_id", billId)),
  ]);
  const unique = new Map<string, PaymentHistoryRow>();
  const addRows = (rows: PaymentHistoryRow[]) => rows.forEach(row => {
    const prior = unique.get(string(row.id));
    if (prior && JSON.stringify(prior) !== JSON.stringify(row)) throw new Error("Payment history changed while loading. Please try again.");
    unique.set(string(row.id), row);
  });
  addRows([...direct, ...debt, ...allocated, ...extraPrincipal]);
  const replaced = [...unique.values()].filter(row => row.removed_at && row.match_reason === "replaced_by_posted_transaction").map(row => string(row.id));
  for (let index = 0; index < replaced.length; index += 100) addRows(await read("transactions", query => query
    .in("linked_plan_id", replaced.slice(index, index + 100)).eq("linked_plan_type", "transaction").eq("review_resolution", "manual")));
  return { transactions: [...unique.values()], overrides };
}
