export interface SnowballFundingSourceLike {
  type: "manual" | "bill_surplus";
  amount: number;
  billId?: string;
  billName?: string;
  reviewTransactionId?: string;
  pendingBalanceApply?: boolean;
}

export interface BillSurplusFundingSource extends SnowballFundingSourceLike {
  type: "bill_surplus";
  billId: string;
}

function cents(value: number): number {
  return Math.max(0, Math.round((Number(value) || 0) * 100));
}

/**
 * Replaces one bill's contribution while keeping the result in the dedicated
 * snowball funding trail. A legacy payment without sources is preserved as
 * manual funding instead of being dropped.
 */
export function replaceBillSurplusFundingSource(
  sources: readonly SnowballFundingSourceLike[] | undefined,
  existingPaymentAmount: number,
  replacement: BillSurplusFundingSource,
): SnowballFundingSourceLike[] {
  const existing = sources ?? (cents(existingPaymentAmount) > 0
    ? [{ type: "manual" as const, amount: cents(existingPaymentAmount) / 100 }]
    : []);
  return [
    ...existing.filter(source => !(
      source.type === "bill_surplus"
      && source.billId === replacement.billId
      && !source.reviewTransactionId
    )),
    { ...replacement, amount: cents(replacement.amount) / 100 },
  ].filter(source => cents(source.amount) > 0);
}

/**
 * Keeps a snowball payment's original funding trail when its amount changes.
 * Reductions release the newest funding first; increases become manual extra money.
 */
export function resizeSnowballFundingSources<T extends SnowballFundingSourceLike>(
  sources: readonly T[] | undefined,
  nextAmount: number,
): SnowballFundingSourceLike[] {
  let remaining = cents(nextAmount);
  if (remaining === 0) return [];

  const resized: SnowballFundingSourceLike[] = [];
  for (const source of sources ?? []) {
    if (remaining === 0) break;
    const used = Math.min(remaining, cents(source.amount));
    if (used === 0) continue;
    resized.push({ ...source, amount: used / 100 });
    remaining -= used;
  }

  if (remaining > 0) {
    const manual = resized.find(source => source.type === "manual" && !source.billId && !source.reviewTransactionId);
    if (manual) manual.amount = (cents(manual.amount) + remaining) / 100;
    else resized.push({ type: "manual", amount: remaining / 100 });
  }

  return resized;
}
