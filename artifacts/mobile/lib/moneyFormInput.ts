/** A blank balance is missing information, not a zero balance. */
export function parseAccountBalance(raw: string): number | null {
  if (!raw.trim()) return null;
  const amount = Number(raw);
  return Number.isFinite(amount) ? amount : null;
}

/** Blank assignments inherit the planned bills; explicit zero overrides them. */
export function parseCategoryAssignments(drafts: Record<string, string>): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [category, raw] of Object.entries(drafts)) {
    if (!raw.trim()) continue;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`Enter a valid nonnegative assignment for ${category}, or leave it blank to use planned bills.`);
    next[category] = amount;
  }
  return next;
}

export function reportIncomeUsage(income: number, spending: number) {
  const percent = income > 0 ? Math.round(spending / income * 100) : null;
  return {
    label: percent === null ? (spending > 0 ? "No recorded income" : "No activity") : `${percent}%`,
    barPercent: percent === null ? (spending > 0 ? 100 : 0) : Math.max(0, Math.min(100, percent)),
    overIncome: spending > income,
    watch: percent !== null && percent > 85,
  };
}

/** Parse the entire field, including only correctly grouped thousands and bounded decimal precision. */
export function parseDecimalInput(raw: string, decimalPlaces = 2): number | null {
  const value = raw.trim();
  const decimal = `(?:\\.\\d{1,${decimalPlaces}})?`;
  if (!new RegExp(`^(?:\\d+|\\d{1,3}(?:,\\d{3})+)${decimal}$|^\\.\\d{1,${decimalPlaces}}$`).test(value)) return null;
  const amount = Number(value.replace(/,/g, ""));
  return Number.isFinite(amount) && amount <= Number.MAX_SAFE_INTEGER / (10 ** decimalPlaces) ? amount : null;
}

export function parseMoneyInput(raw: string): number | null {
  return parseDecimalInput(raw, 2);
}
