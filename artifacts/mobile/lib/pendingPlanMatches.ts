import type { DebtSourceCommitment } from "./debtPlanDomain";

export type PendingPlanMatchStatus = "active" | "ready_review" | "completed" | "expired" | "cancelled";

export interface PendingPlanMatch {
  id: string;
  pending_plaid_transaction_id: string;
  pending_account_id?: string;
  target_type: "bill" | "manual";
  target_id: string;
  target_name: string;
  occurrence_date: string;
  planned_amount: number;
  pending_amount: number;
  pending_transaction_date: string;
  status: PendingPlanMatchStatus;
  posted_transaction_id?: string;
  posted_plaid_transaction_id?: string;
  posted_amount?: number;
  created_at: string;
  updated_at: string;
}

export interface PendingTransactionIdentity {
  plaid_transaction_id: string;
}

export interface PostedTransactionIdentity {
  id: string;
  plaid_transaction_id?: string;
  review_status?: string;
}

export interface DebtSourceIdentity {
  id: string;
  name?: string;
  balance: number;
  is_debt: boolean;
}

export function livePendingPlanMatchForOccurrence(
  matches: PendingPlanMatch[],
  pendingTransactions: PendingTransactionIdentity[],
  billId: string,
  occurrenceDate: string,
): PendingPlanMatch | undefined {
  const liveIds = new Set(pendingTransactions.map(transaction => transaction.plaid_transaction_id));
  return matches.find(match => match.status === "active"
    && match.target_type === "bill"
    && liveIds.has(match.pending_plaid_transaction_id)
    && match.target_id === billId
    && match.occurrence_date === occurrenceDate);
}

export function debtSourceCommitmentsFromPendingMatches(
  matches: PendingPlanMatch[],
  pendingTransactions: PendingTransactionIdentity[],
  postedTransactions: PostedTransactionIdentity[],
): DebtSourceCommitment[] {
  const livePendingIds = new Set(pendingTransactions.map(transaction => transaction.plaid_transaction_id));
  const postedIds = new Set(postedTransactions
    // A posted pending match protects the dated obligation only while the
    // replacement charge is waiting for review. Once the transaction is
    // resolved, its review allocation is authoritative; retaining the old
    // commitment would suppress the remaining partial balance a second time.
    .filter(transaction => transaction.review_status === undefined || transaction.review_status === "needs_review")
    .flatMap(transaction => [
      transaction.id,
      ...(transaction.plaid_transaction_id ? [transaction.plaid_transaction_id] : []),
    ]));
  const candidates = matches.flatMap<DebtSourceCommitment>(match => {
    if (match.target_type !== "bill") return [];
    if (match.status === "active" && livePendingIds.has(match.pending_plaid_transaction_id)) {
      return [{ sourceBillId: match.target_id, sourceBillName: match.target_name, date: match.occurrence_date, amount: match.pending_amount, state: "pending" as const }];
    }
    if (match.status === "ready_review"
      && Boolean(match.posted_transaction_id || match.posted_plaid_transaction_id)
      && (Boolean(match.posted_transaction_id && postedIds.has(match.posted_transaction_id))
        || Boolean(match.posted_plaid_transaction_id && postedIds.has(match.posted_plaid_transaction_id)))) {
      return [{ sourceBillId: match.target_id, sourceBillName: match.target_name, date: match.occurrence_date, amount: 0, state: "posted" as const }];
    }
    return [];
  });
  const grouped = new Map<string, DebtSourceCommitment[]>();
  candidates.forEach(commitment => {
    const key = `${commitment.sourceBillId}:${commitment.date}`;
    grouped.set(key, [...(grouped.get(key) ?? []), commitment]);
  });
  return Array.from(grouped.values(), commitments => {
    const posted = commitments.find(commitment => commitment.state === "posted");
    if (posted) return { ...posted, amount: 0, state: "posted" as const };
    const first = commitments[0]!;
    return {
      ...first,
      amount: Math.round(commitments.reduce((sum, commitment) => sum + Math.max(0, Number(commitment.amount) || 0), 0) * 100) / 100,
      state: "pending" as const,
    };
  }).sort((left, right) => left.date.localeCompare(right.date) || left.sourceBillId.localeCompare(right.sourceBillId));
}

/** Keeps ordinary matched bills out of the canonical debt-payment projection. */
export function debtSourceCommitmentsForDebts(
  matches: PendingPlanMatch[],
  pendingTransactions: PendingTransactionIdentity[],
  postedTransactions: PostedTransactionIdentity[],
  sources: DebtSourceIdentity[],
): DebtSourceCommitment[] {
  const debtById = new Map(sources
    .filter(source => source.is_debt)
    .map(source => [source.id, source]));

  return debtSourceCommitmentsFromPendingMatches(matches, pendingTransactions, postedTransactions)
    .flatMap(commitment => {
      const source = debtById.get(commitment.sourceBillId);
      if (!source) return [];
      return [{
        ...commitment,
        sourceBillName: commitment.sourceBillName || source.name,
        sourceBalance: source.balance,
      }];
    });
}

export function debtSourceCommitmentForOccurrence(
  matches: PendingPlanMatch[],
  pendingTransactions: PendingTransactionIdentity[],
  postedTransactions: PostedTransactionIdentity[],
  billId: string,
  occurrenceDate: string,
): DebtSourceCommitment | undefined {
  return debtSourceCommitmentsFromPendingMatches(matches, pendingTransactions, postedTransactions)
    .find(commitment => commitment.sourceBillId === billId && commitment.date === occurrenceDate);
}

export function activePendingPlanMatches(
  matches: PendingPlanMatch[],
  pendingTransactions: PendingTransactionIdentity[],
): PendingPlanMatch[] {
  const livePendingIds = new Set(pendingTransactions.map(transaction => transaction.plaid_transaction_id));
  return matches.filter(match =>
    match.status === "ready_review"
    || (match.status === "active" && livePendingIds.has(match.pending_plaid_transaction_id)));
}

export function unmatchedPendingTransactions<T extends PendingTransactionIdentity>(
  matches: PendingPlanMatch[],
  pendingTransactions: T[],
): T[] {
  const matchedPendingIds = new Set(
    activePendingPlanMatches(matches, pendingTransactions)
      .map(match => match.pending_plaid_transaction_id),
  );
  return pendingTransactions.filter(
    transaction => !matchedPendingIds.has(transaction.plaid_transaction_id),
  );
}

export function pendingPlanMatchForOccurrence(
  matches: PendingPlanMatch[],
  pendingTransactions: PendingTransactionIdentity[],
  billId: string,
  occurrenceDate: string,
): PendingPlanMatch | undefined {
  return activePendingPlanMatches(matches, pendingTransactions)
    .find(match =>
      match.target_type === "bill"
      && match.target_id === billId
      && match.occurrence_date === occurrenceDate);
}

export function pendingOccurrenceDatesForBill(
  matches: PendingPlanMatch[],
  pendingTransactions: PendingTransactionIdentity[],
  billId: string,
): string[] {
  return activePendingPlanMatches(matches, pendingTransactions)
    .filter(match => match.target_type === "bill" && match.target_id === billId)
    .map(match => match.occurrence_date);
}

export function pendingOccurrenceKeySet(
  matches: PendingPlanMatch[],
  pendingTransactions: PendingTransactionIdentity[],
): Set<string> {
  return new Set(activePendingPlanMatches(matches, pendingTransactions)
    .filter(match => match.target_type === "bill")
    .map(match => `${match.target_id}:${match.occurrence_date}`));
}

export function pendingMatchStatusLabel(match: PendingPlanMatch): string {
  return match.status === "ready_review" ? "REVIEW PAYMENT" : "PAYMENT PENDING";
}

export function prioritizePendingPlanTarget<T extends {
  type: string;
  id: string;
  occurrenceDate: string;
  score: number;
  reasons: string[];
}>(
  targets: T[],
  postedTransactionId: string,
  matches: PendingPlanMatch[],
): T[] {
  const linked = matches.find(match =>
    match.status === "ready_review"
    && match.posted_transaction_id === postedTransactionId);
  if (!linked) return targets;

  return targets
    .map(target => target.type === linked.target_type
      && target.id === linked.target_id
      && target.occurrenceDate === linked.occurrence_date
      ? {
          ...target,
          score: Math.max(target.score, 100),
          reasons: ["Matched while pending", ...target.reasons.filter(reason => reason !== "Matched while pending")],
        }
      : target)
    .sort((left, right) => right.score - left.score);
}
