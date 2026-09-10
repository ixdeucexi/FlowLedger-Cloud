import { validDate } from "./analysisTypes.ts";

/** IncomeModal stores month precision; the canonical income reader also accepts dates. */
export function validIncomeEffectiveFrom(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^\d{4}-\d{2}$/.test(value) ? validDate(`${value}-01`) : validDate(value);
}

/** Match canonical exclusion date-prefix semantics without accepting arbitrary suffixes. */
export function validIncomeExcludedDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 10) return validDate(value);
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return false;
  return validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}
