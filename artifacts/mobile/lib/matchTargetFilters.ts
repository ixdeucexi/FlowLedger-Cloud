export type MatchTargetKind = "bill" | "debt" | "manual" | "bucket" | "decision";

export const matchTargetKindLabels: Record<MatchTargetKind, string> = {
  bill: "Bill",
  debt: "Debt",
  manual: "Manual transaction",
  bucket: "Buckets",
  decision: "Calendar plans",
};

export type MatchTargetSelection = { scope: string; kind: MatchTargetKind } | null;

export function selectedMatchTargetKind(selection: MatchTargetSelection, scope: string): MatchTargetKind | null {
  return selection?.scope === scope ? selection.kind : null;
}

/** Filtering preserves the ranked objects and their reconciliation payloads. */
export function reviewTargetsForKind<T extends { type: string; isDebt?: boolean }>(targets: readonly T[], kind: MatchTargetKind | null): T[] {
  if (!kind) return [];
  return targets.filter(target => {
    if (kind === "manual") return target.type === "manual";
    if (kind === "bucket") return target.type === "goal";
    if (kind === "decision") return target.type === "decision";
    if (kind === "debt") return target.type === "snowball" || (target.type === "bill" && Boolean(target.isDebt));
    return target.type === "bill" && !target.isDebt;
  });
}

export function activityTargetsForKind<T extends { targetType: string; billId: string }>(
  targets: readonly T[], kind: MatchTargetKind | null, bills: readonly { id: string; is_debt: boolean }[],
): T[] {
  if (!kind || kind === "decision") return [];
  const currentBills = new Map(bills.map(bill => [bill.id, bill]));
  return targets.filter(target => {
    if (kind === "manual" || kind === "bucket") return target.targetType === kind;
    if (target.targetType !== "bill") return false;
    const bill = currentBills.get(target.billId);
    return Boolean(bill) && Boolean(bill?.is_debt) === (kind === "debt");
  });
}
