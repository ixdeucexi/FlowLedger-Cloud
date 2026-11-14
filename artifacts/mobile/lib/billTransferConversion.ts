import {
  BILL_EDITABLE_FIELDS,
  billEditableDbPatch,
  billEditableValuesEqual,
} from "./billEditPersistence";
import { normalizeBillRow } from "./financialProjectionInput";
import type { Bill } from "./financialProjectionTypes";
import {
  normalizePlannedTransfer,
  validPlannedTransferDate,
  type PlannedAccountTransfer,
  type PlannedTransferPatch,
} from "./plannedAccountTransfers";

// Conversion receipts intentionally keep their existing financial identity.
// Display classification is unrelated to transferring a bill's future schedule.
const TRANSFER_BILL_FIELDS = BILL_EDITABLE_FIELDS.filter(field => field !== "is_subscription");

export function billTransferCutoff(firstDate: string): string {
  if (!validPlannedTransferDate(firstDate)) throw new Error("Choose a valid first transfer date.");
  const date = new Date(`${firstDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function billTransferExpected(bill: Bill): Record<string, unknown> {
  return billEditableDbPatch(bill, TRANSFER_BILL_FIELDS);
}

/** This only checks the returned transaction; the database owns eligibility,
 * source identity, account validation and all history/concurrency guards. */
export function verifyBillTransferConversion(
  value: unknown,
  source: Bill,
  patch: PlannedTransferPatch,
  scope: { householdId: string; budgetId: string; userId: string },
): { bill: Bill; transfer: PlannedAccountTransfer } {
  const fail = () => { throw new Error("The bill transfer could not be verified. Refresh before trying again."); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const result = value as Record<string, unknown>;
  const rawBill = result.bill as Record<string, unknown> | null;
  if (!rawBill || rawBill.id !== source.id || rawBill.household_id !== scope.householdId
    || rawBill.budget_id !== scope.budgetId || !validPlannedTransferDate(patch.start_date)) return fail();
  const bill = normalizeBillRow(rawBill);
  const expected: Record<string, unknown> = { ...billTransferExpected(source), end_date: billTransferCutoff(patch.start_date) };
  const actual = billTransferExpected(bill);
  if (TRANSFER_BILL_FIELDS.some(field => !billEditableValuesEqual(field, actual[field], expected[field]))) return fail();
  let transfer: PlannedAccountTransfer;
  try { transfer = normalizePlannedTransfer(result.transfer); } catch { return fail(); }
  if (!/^bill-transfer-[a-f0-9]{32}$/.test(transfer.id)
    || transfer.household_id !== scope.householdId || transfer.budget_id !== scope.budgetId
    || transfer.created_by !== scope.userId || transfer.revision !== 1
    || transfer.source_bill_id !== source.id
    || transfer.deleted_at !== null || transfer.status !== "active"
    || Object.entries(patch).some(([key, value]) => transfer[key as keyof PlannedAccountTransfer] !== value)) return fail();
  return { bill, transfer };
}

/** The server freezes this retired source's cutoff. Publish only that owned
 * field, preserving other local fields and never recreating a missing row. */
export function mergeConvertedBill(current: readonly Bill[], source: Bill, saved: Bill): Bill[] {
  return current.map(row => row.id === source.id
    ? { ...row, end_date: saved.end_date }
    : row);
}
