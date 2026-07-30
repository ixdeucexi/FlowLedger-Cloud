export type PendingPlanMatchStatus = "active" | "ready_review" | "completed" | "expired" | "cancelled";

export interface PendingPlanMatch {
  id: string;
  pending_plaid_transaction_id: string;
  pending_account_id?: string;
  target_type: "bill";
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

export function activePendingPlanMatches(
  matches: PendingPlanMatch[],
  pendingTransactions: PendingTransactionIdentity[],
): PendingPlanMatch[] {
  const livePendingIds = new Set(pendingTransactions.map(transaction => transaction.plaid_transaction_id));
  return matches.filter(match =>
    match.status === "ready_review"
    || (match.status === "active" && livePendingIds.has(match.pending_plaid_transaction_id)));
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
