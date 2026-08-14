export interface BillOccurrenceMatchLike {
  amount?: number;
  plannedAmount?: number;
  settlement?: string;
}
export interface BillOccurrencePaymentInput {
  occurrenceDate: string;
  scheduledAmount: number;
  frequency: string;
  match?: BillOccurrenceMatchLike;
  monthlyPaidAmount?: number;
  monthlyPaidDate?: string;
}

export interface BillOccurrencePaymentView {
  scheduledAmount: number;
  paidAmount: number;
  remainingAmount: number;
  isPaid: boolean;
  isPartial: boolean;
}

function currency(value: number | undefined): number {
  const safe = Math.max(0, Number(value) || 0);
  return Math.round((safe + Number.EPSILON) * 100) / 100;
}

/** Resolve one bill occurrence without leaking a month paid total to every date. */
export function resolveBillOccurrencePayment(input: BillOccurrencePaymentInput): BillOccurrencePaymentView {
  const scheduledAmount = currency(input.scheduledAmount);
  const matchedPaid = currency(input.match?.amount);
  const hasExactMatch = Boolean(input.match);
  const isMultiOccurrence = input.frequency === "weekly" || input.frequency === "biweekly";
  const legacyPaid = !hasExactMatch && input.monthlyPaidDate === input.occurrenceDate
    ? currency(input.monthlyPaidAmount)
    : 0;
  // Legacy weekly/biweekly overrides may contain a whole-month total. They can
  // settle their dated occurrence, but must not overstate or spill to another.
  const paidAmount = hasExactMatch
    ? matchedPaid
    : isMultiOccurrence
      ? Math.min(scheduledAmount, legacyPaid)
      : legacyPaid;
  const remainingAmount = currency(Math.max(0, scheduledAmount - paidAmount));
  const isPaid = scheduledAmount > 0.005 && paidAmount >= scheduledAmount - 0.005;

  return {
    scheduledAmount,
    paidAmount,
    remainingAmount,
    isPaid,
    isPartial: paidAmount > 0.005 && !isPaid,
  };
}
