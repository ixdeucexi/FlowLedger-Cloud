export interface BillMatchTransaction {
  date: string;
  amount: number;
  description: string;
  category?: string;
}

export interface BillMatchCandidate {
  billId: string;
  name: string;
  category: string;
  plannedAmount: number;
  occurrenceDates: string[];
}

export interface RankedBillMatch extends BillMatchCandidate {
  score: number;
  confidence: "strong" | "likely" | "possible";
  amountDifference: number;
  daysApart: number | null;
  nearestOccurrenceDate: string | null;
  reasons: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dateToUtcDay(value: string): number | null {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(token => token.length >= 3 && !["payment", "purchase", "debit", "online"].includes(token));
}

function nearestOccurrence(transactionDate: string, occurrenceDates: string[]): { date: string; distance: number } | null {
  const txDay = dateToUtcDay(transactionDate);
  if (txDay === null || occurrenceDates.length === 0) return null;
  return occurrenceDates.reduce<{ date: string; distance: number } | null>((nearest, date) => {
    const candidateDay = dateToUtcDay(date);
    if (candidateDay === null) return nearest;
    const distance = Math.abs(candidateDay - txDay);
    return nearest === null || distance < nearest.distance ? { date, distance } : nearest;
  }, null);
}

export function rankBillMatches(
  transaction: BillMatchTransaction,
  candidates: BillMatchCandidate[],
): RankedBillMatch[] {
  const actualAmount = Math.abs(Number(transaction.amount) || 0);
  const descriptionTokens = new Set(tokens(transaction.description));

  return candidates
    .filter(candidate => candidate.plannedAmount > 0 && candidate.occurrenceDates.length > 0)
    .map(candidate => {
      const plannedAmount = Math.abs(candidate.plannedAmount);
      const amountDifference = Math.abs(actualAmount - plannedAmount);
      const amountRatio = plannedAmount > 0 ? amountDifference / plannedAmount : 1;
      const nearest = nearestOccurrence(transaction.date, candidate.occurrenceDates);
      const daysApart = nearest?.distance ?? null;
      const nameTokens = tokens(candidate.name);
      const tokenMatches = nameTokens.filter(token => descriptionTokens.has(token)).length;
      const reasons: string[] = [];
      let score = 0;

      if (amountDifference <= 0.01) {
        score += 55;
        reasons.push("exact amount");
      } else if (amountRatio <= 0.03 || amountDifference <= 2) {
        score += 45;
        reasons.push("very close amount");
      } else if (amountRatio <= 0.1 || amountDifference <= 10) {
        score += 28;
        reasons.push("close amount");
      } else if (amountRatio <= 0.25) {
        score += 10;
      }

      if (daysApart !== null) {
        if (daysApart <= 2) {
          score += 25;
          reasons.push("near the due date");
        } else if (daysApart <= 7) {
          score += 18;
          reasons.push("within a week of the due date");
        } else if (daysApart <= 14) {
          score += 8;
        }
      }

      if (tokenMatches > 0) {
        score += Math.min(20, tokenMatches * 12);
        reasons.push("merchant name looks similar");
      }
      if (transaction.category && transaction.category === candidate.category) {
        score += 8;
        reasons.push("same category");
      }

      const boundedScore = Math.min(100, score);
      return {
        ...candidate,
        score: boundedScore,
        confidence: boundedScore >= 70 ? "strong" as const : boundedScore >= 48 ? "likely" as const : "possible" as const,
        amountDifference,
        daysApart,
        nearestOccurrenceDate: nearest?.date ?? null,
        reasons,
      };
    })
    .sort((left, right) =>
      right.score - left.score
      || left.amountDifference - right.amountDifference
      || (left.daysApart ?? Number.MAX_SAFE_INTEGER) - (right.daysApart ?? Number.MAX_SAFE_INTEGER)
      || left.name.localeCompare(right.name),
    );
}

export function isConfirmedBillMatch(transaction: { match_reason?: string | null }): boolean {
  return transaction.match_reason === "confirmed_bill_match";
}

export function canMatchExpenseToBill(transaction: {
  amount: number;
  source?: string | null;
  import_hash?: string | null;
  transfer_group_id?: string | null;
  linked_bill_id?: string | null;
  debt_applied_bill_id?: string | null;
  match_reason?: string | null;
}): boolean {
  if (!Number.isFinite(transaction.amount) || transaction.amount >= 0) return false;
  if (transaction.source === "plaid" || isConfirmedBillMatch(transaction)) return true;
  return !transaction.import_hash
    && !transaction.transfer_group_id
    && !transaction.linked_bill_id
    && !transaction.debt_applied_bill_id;
}

export function isMatchedPaymentLowerThanPlanned(transactionAmount: number, plannedAmount: number): boolean {
  if (!Number.isFinite(transactionAmount) || !Number.isFinite(plannedAmount) || plannedAmount <= 0) return false;
  return Math.abs(transactionAmount) + 0.005 < plannedAmount;
}

export function resolveMatchedBillBudget(plannedAmount: number, recurringBillAmount: number): number {
  const planned = Number.isFinite(plannedAmount) ? Math.max(0, plannedAmount) : 0;
  const recurring = Number.isFinite(recurringBillAmount) ? Math.max(0, recurringBillAmount) : 0;
  return Math.max(planned, recurring);
}

export function isActiveTransaction(transaction: { removed_at?: string | null; pending?: boolean | null }): boolean {
  return !transaction.removed_at && transaction.pending !== true;
}

/**
 * Keep unresolved bank activity visible without letting it change money totals
 * before the matching plan item is known.
 */
export function isCashFlowTransaction(transaction: {
  removed_at?: string | null;
  pending?: boolean | null;
  review_status?: string | null;
}): boolean {
  return isActiveTransaction(transaction)
    && transaction.review_status !== "needs_review"
    && transaction.review_status !== "transfer";
}
