import { normalizeDebtPaymentPauses } from "./debtPaymentPause";

export const BILL_EDITABLE_FIELDS = [
  "name",
  "amount",
  "category",
  "priority",
  "is_debt",
  "balance",
  "interest_rate",
  "due_day",
  "day_of_week",
  "next_payment_date",
  "start_date",
  "end_date",
  "is_recurring",
  "frequency",
  "smart_priority",
  "include_in_snowball",
  "debt_payment_pauses",
  "funding_account_ref",
] as const;

export type BillEditableField = typeof BILL_EDITABLE_FIELDS[number];
export type BillEditableBaseline = Partial<Record<BillEditableField, unknown>>;

const NULLABLE_BILL_FIELDS = new Set<BillEditableField>([
  "day_of_week",
  "next_payment_date",
  "start_date",
  "end_date",
  "smart_priority",
  "funding_account_ref",
]);

export function changedBillEditableFields<T extends Partial<Record<BillEditableField, unknown>>>(
  baseline: T,
  submitted: T,
): BillEditableField[] {
  return BILL_EDITABLE_FIELDS.filter(field => !billEditableValuesEqual(field, baseline[field], submitted[field]));
}

/** JSONB equality does not depend on array identity or object key order. */
export function billEditableValuesEqual(field: BillEditableField, left: unknown, right: unknown): boolean {
  if (field === "funding_account_ref") return (left ?? null) === (right ?? null);
  return field === "debt_payment_pauses"
    ? JSON.stringify(normalizeDebtPaymentPauses(left)) === JSON.stringify(normalizeDebtPaymentPauses(right))
    : Object.is(left, right);
}

export function billEditablePatch<T extends Partial<Record<BillEditableField, unknown>>>(
  submitted: T,
  fields: readonly BillEditableField[],
): Partial<Record<BillEditableField, unknown>> {
  return Object.fromEntries(fields.map(field => [field, field === "debt_payment_pauses"
    ? normalizeDebtPaymentPauses(submitted[field]) : submitted[field]]));
}

export function normalizedBillEditableFields(fields: readonly BillEditableField[]): BillEditableField[] {
  const requested = new Set(fields);
  return BILL_EDITABLE_FIELDS.filter(field => requested.has(field));
}

/** Converts an owned UI patch to the exact sparse JSON shape persisted by SQL. */
export function billEditableDbPatch(
  submitted: BillEditableBaseline,
  fields: readonly BillEditableField[],
): Record<string, unknown> {
  return Object.fromEntries(normalizedBillEditableFields(fields).map(field => {
    const value = submitted[field];
    return [field, field === "debt_payment_pauses" ? normalizeDebtPaymentPauses(value)
      : NULLABLE_BILL_FIELDS.has(field) ? value ?? null : value];
  }));
}
