import { normalizeMerchant, type SubscriptionCandidate } from "./competitiveGrowth";

export type SavedSubscriptionStatus = "review" | "keep" | "cancel_manually" | "convert_to_bill" | "not_subscription";

export interface ImportedSubscriptionCandidate extends SubscriptionCandidate {
  savedCandidateId: string;
  savedStatus: SavedSubscriptionStatus;
  initialImportItemId: string;
  sourcePlaidTransactionIds: string[];
  persistedTransactionIds: string[];
  evidenceOnly: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = new Set<SavedSubscriptionStatus>(["review", "keep", "cancel_manually", "convert_to_bill", "not_subscription"]);

function ids(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.trim().length > 0 && id.length <= 200))] : [];
}

/** New-profile rows are read separately from the unchanged legacy detector. */
export function parseImportedSubscriptionCandidates(rows: readonly unknown[], householdId: string): ImportedSubscriptionCandidate[] {
  return rows.flatMap(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    if (row.household_id !== householdId || row.initial_import_version !== 1
      || typeof row.id !== "string" || !UUID.test(row.id)
      || typeof row.initial_import_item_id !== "string" || !UUID.test(row.initial_import_item_id)
      || typeof row.merchant !== "string" || !normalizeMerchant(row.merchant)
      || !statuses.has(row.status as SavedSubscriptionStatus)) return [];
    const averageAmount = Number(row.average_amount);
    const monthlyEquivalent = Number(row.monthly_equivalent);
    const yearlyEquivalent = Number(row.yearly_equivalent);
    if (![averageAmount, monthlyEquivalent, yearlyEquivalent].every(amount => Number.isFinite(amount) && amount >= 0) || averageAmount <= 0) return [];
    if (!Array.isArray(row.source_transaction_ids) || row.source_transaction_ids.some(id => typeof id !== "string" || !id.trim() || id.length > 200)) return [];
    const persistedTransactionIds = [...row.source_transaction_ids] as string[];
    const transactionIds = ids(persistedTransactionIds);
    const sourcePlaidTransactionIds = ids(row.source_plaid_transaction_ids);
    if (!transactionIds.length && !sourcePlaidTransactionIds.length) return [];
    return [{
      savedCandidateId: row.id,
      savedStatus: row.status as SavedSubscriptionStatus,
      initialImportItemId: row.initial_import_item_id,
      merchant: row.merchant,
      cadence: ["weekly", "monthly", "annual"].includes(String(row.cadence)) ? row.cadence as "weekly" | "monthly" | "annual" : "unknown",
      averageAmount,
      lastAmount: averageAmount,
      monthlyEquivalent,
      yearlyEquivalent,
      transactionIds,
      persistedTransactionIds,
      sourcePlaidTransactionIds,
      evidenceOnly: transactionIds.length === 0,
      confidence: ["low", "medium", "high"].includes(String(row.confidence)) ? row.confidence as "low" | "medium" | "high" : "low",
      priceIncrease: false,
      duplicateRisk: false,
    }];
  });
}

/** Merchant identity is shared with existing saved decisions and bill links. */
export function mergeImportedSubscriptionCandidates(local: readonly SubscriptionCandidate[], imported: readonly ImportedSubscriptionCandidate[]): SubscriptionCandidate[] {
  const merged = new Map(local.map(candidate => [normalizeMerchant(candidate.merchant), candidate]));
  for (const saved of imported) {
    const key = normalizeMerchant(saved.merchant);
    const existing = merged.get(key);
    if (saved.savedStatus === "not_subscription") { merged.delete(key); continue; }
    if (!existing && saved.savedStatus !== "review") continue;
    const transactionIds = [...new Set([...(existing?.transactionIds ?? []), ...saved.transactionIds])];
    merged.set(key, {
      ...saved,
      ...(existing ?? {}),
      savedCandidateId: saved.savedCandidateId,
      savedStatus: saved.savedStatus,
      initialImportItemId: saved.initialImportItemId,
      sourcePlaidTransactionIds: saved.sourcePlaidTransactionIds,
      persistedTransactionIds: saved.persistedTransactionIds,
      transactionIds,
      evidenceOnly: saved.persistedTransactionIds.length === 0,
    } as ImportedSubscriptionCandidate);
  }
  return [...merged.values()];
}

export function importedSubscriptionMetadata(candidate: SubscriptionCandidate): ImportedSubscriptionCandidate | null {
  const imported = candidate as Partial<ImportedSubscriptionCandidate>;
  return typeof imported.savedCandidateId === "string" && UUID.test(imported.savedCandidateId)
    && typeof imported.initialImportItemId === "string" && UUID.test(imported.initialImportItemId)
    ? candidate as ImportedSubscriptionCandidate : null;
}

/** Review choices never overwrite saved provenance, evidence, or linked bills. */
export function importedSubscriptionDecisionUpdate(status: SavedSubscriptionStatus, now: string, actorId: string) {
  return { user_id: actorId, status, last_reviewed_at: now, updated_at: now };
}
