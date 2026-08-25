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
] as const;

export type BillEditableField = typeof BILL_EDITABLE_FIELDS[number];
export type BillEditableBaseline = Partial<Record<BillEditableField, unknown>>;

const NULLABLE_BILL_FIELDS = new Set<BillEditableField>([
  "day_of_week",
  "next_payment_date",
  "start_date",
  "end_date",
  "smart_priority",
]);

export function changedBillEditableFields<T extends Partial<Record<BillEditableField, unknown>>>(
  baseline: T,
  submitted: T,
): BillEditableField[] {
  return BILL_EDITABLE_FIELDS.filter(field => !Object.is(baseline[field], submitted[field]));
}

export function billEditablePatch<T extends Partial<Record<BillEditableField, unknown>>>(
  submitted: T,
  fields: readonly BillEditableField[],
): Partial<Record<BillEditableField, unknown>> {
  return Object.fromEntries(fields.map(field => [field, submitted[field]]));
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
    return [field, NULLABLE_BILL_FIELDS.has(field) ? value ?? null : value];
  }));
}
