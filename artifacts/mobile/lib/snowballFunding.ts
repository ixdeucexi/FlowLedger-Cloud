export interface SnowballFundingSourceLike {
  type: "manual" | "bill_surplus" | "bucket_remainder";
  amount: number;
  billId?: string;
  billName?: string;
  reviewTransactionId?: string;
  bucketId?: string;
  bucketName?: string;
  availableDate?: string;
  pendingBalanceApply?: boolean;
}

export interface BillSurplusFundingSource extends SnowballFundingSourceLike {
  type: "bill_surplus";
  billId: string;
}

export interface BucketRemainderFundingSource extends SnowballFundingSourceLike {
  type: "bucket_remainder";
  bucketId: string;
  bucketName: string;
  availableDate: string;
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

export function replaceBucketRemainderFundingSource(
  sources: readonly SnowballFundingSourceLike[] | undefined,
  existingPaymentAmount: number,
  replacement: BucketRemainderFundingSource,
): SnowballFundingSourceLike[] {
  const existing = sources ?? (cents(existingPaymentAmount) > 0
    ? [{ type: "manual" as const, amount: cents(existingPaymentAmount) / 100 }]
    : []);
  return [
    ...existing.filter(source => !(source.type === "bucket_remainder" && source.bucketId === replacement.bucketId)),
    { ...replacement, amount: cents(replacement.amount) / 100 },
  ].filter(source => cents(source.amount) > 0);
}

export function removeBucketRemainderFundingSource(
  sources: readonly SnowballFundingSourceLike[] | undefined,
  bucketId: string,
): SnowballFundingSourceLike[] {
  return (sources ?? []).filter(source => !(source.type === "bucket_remainder" && source.bucketId === bucketId));
}

export function latestBucketRemainderAvailableDate(
  sources: readonly SnowballFundingSourceLike[] | undefined,
): string | undefined {
  return (sources ?? [])
    .filter(source => source.type === "bucket_remainder" && /^\d{4}-\d{2}-\d{2}$/.test(source.availableDate ?? ""))
    .reduce<string | undefined>((latest, source) => !latest || source.availableDate! > latest ? source.availableDate : latest, undefined);
}

export function hasBucketRemainderFunding(
  sources: readonly SnowballFundingSourceLike[] | undefined,
): boolean {
  return (sources ?? []).some(source => source.type === "bucket_remainder" && cents(source.amount) > 0);
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
  const bucketSources = (sources ?? []).filter(source => source.type === "bucket_remainder");
  const lockedBucketCents = bucketSources.reduce((sum, source) => sum + cents(source.amount), 0);
  if (remaining < lockedBucketCents) {
    throw new Error("Reopen a routed spending bucket before reducing this Snowball payment below its remainder.");
  }
  if (remaining === 0) return [];

  const resized: SnowballFundingSourceLike[] = bucketSources.map(source => ({
    ...source,
    amount: cents(source.amount) / 100,
  }));
  remaining -= lockedBucketCents;
  for (const source of (sources ?? []).filter(item => item.type !== "bucket_remainder")) {
    if (remaining === 0) break;
    const used = Math.min(remaining, cents(source.amount));
    if (used === 0) continue;
    resized.push({ ...source, amount: used / 100 });
    remaining -= used;
  }

  if (remaining > 0) {
    const manual = resized.find(source => source.type === "manual" && !source.billId && !source.reviewTransactionId && !source.bucketId);
    if (manual) manual.amount = (cents(manual.amount) + remaining) / 100;
    else resized.push({ type: "manual", amount: remaining / 100 });
  }

  return resized;
}
