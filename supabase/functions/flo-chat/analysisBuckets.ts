import { spendingBucketSummary } from "../../../artifacts/mobile/lib/spendingBuckets.ts";
import { bucketPurchaseHistory } from "../../../artifacts/mobile/lib/bucketPurchases.ts";
import { transactionDisplayName } from "../../../artifacts/mobile/lib/reviewCenter.ts";
import type { Transaction } from "../../../artifacts/mobile/lib/financialProjectionTypes.ts";
import { bucketQuestionHasUnsupportedScope } from "./analysisBucketScope.ts";
import { normalizeAccountName, omittedAccountNumber, resolveAccountName } from "./analysisAccounts.ts";
import { dollars, label, numeric, requireSources, round, sum, validDate, type AnalysisRequest, type AnalysisResult, type AnalysisSnapshot } from "./analysisTypes.ts";

/** Read the saved bucket balance, then explain retained canonical purchase
 * allocations. History never reconstructs or replaces the stored spent value. */
export function bucketDetailsAnalysis(snapshot: AnalysisSnapshot, request: AnalysisRequest, question?: string): AnalysisResult {
  const sources = ["goals", "transactions"], missing = requireSources(snapshot, sources);
  const assumptions = ["Bucket money left is planned budget headroom, not bank cash or permission to spend. Check the household cash-flow plan before a new purchase.", "Spent comes from the bucket’s saved spent amount. Retained linked purchases can be incomplete and are not summed to replace it. Pending, deleted and removed activity is excluded from purchase history."];
  const unavailable = (reason: string): AnalysisResult => ({ text: reason, facts: {}, sources, assumptions, missing: [...new Set([...missing, reason])], scenario: false });
  if (request.domain !== "budget" || request.operation !== "detail" || !request.entity || request.scenario || request.dateEvent !== "none" || [request.startDate, request.endDate, request.comparisonStart, request.comparisonEnd].some(date => date != null) || request.amount != null || request.contribution || request.accountGroup) return unavailable("Please name a spending bucket for its recorded budget and purchases. This view does not project future balances or establish purchase affordability.");
  if (missing.length) return unavailable("I could not fully check the bucket and its linked purchases. Please retry before relying on its numbers.");
  if (question) {
    const words = normalizeAccountName(question).split(" ");
    if (omittedAccountNumber(question,request.entity) || !normalizeAccountName(request.entity).split(" ").every(token=>words.includes(token))) return unavailable("Please confirm the full saved bucket name, including its number. I can’t choose a different or expanded name for you.");
  }
  const buckets = (snapshot.sources.goals?.rows ?? []).filter(goal => goal.goal_type === "planned_expense" && !goal.archived_at).map(goal => ({ ...goal, target_amount: goal.target_amount, current_amount: goal.current_amount, target_date: goal.target_date, closed_at: goal.closed_at, id: String(goal.id), name: label(goal.name), identityKnown: typeof goal.id === "string" && Boolean(goal.id.trim()) && typeof goal.name === "string" && Boolean(goal.name.trim()), aliases: [String(goal.name ?? "")] }));
  const resolved = resolveAccountName(buckets, request.entity);
  if (!resolved.selected) {
    const names = resolved.candidates.filter(candidate => normalizeAccountName(candidate.name) === normalizeAccountName(candidate.aliases[0]) && resolveAccountName(buckets, candidate.name).selected?.id === candidate.id).map(candidate => candidate.name);
    return { ...unavailable(resolved.candidates.length ? `Which spending bucket do you mean: ${resolved.candidates.map(goal => goal.name).join("; ")}?` : "I couldn’t find an active saved spending bucket with that name. Savings goals and archived buckets are separate."), choices: names.length ? { kind: "bucket", names } : undefined };
  }
  const bucket = resolved.selected;
  if (question && bucketQuestionHasUnsupportedScope(question,[bucket.aliases[0],request.entity])) return unavailable("I can show this bucket’s current recorded budget and purchases. I can’t establish its balance for a different date or period, project a future bucket balance, or confirm purchase affordability from its remaining budget.");
  const planned = numeric(bucket.target_amount), spent = numeric(bucket.current_amount);
  const closedDate = bucket.closed_at == null ? null : typeof bucket.closed_at === "string" ? Date.parse(bucket.closed_at) : NaN;
  if (!bucket.identityKnown || planned === null || spent === null || planned < 0 || spent < 0 || !validDate(bucket.target_date) || closedDate !== null && (!Number.isFinite(closedDate) || closedDate > Date.parse(snapshot.capturedAt))) return unavailable("This bucket has a missing or invalid planned amount, spent amount, target date or close date. I can’t treat missing values as zero.");
  const summary = spendingBucketSummary({ target_amount: planned, current_amount: spent, closed_at: bucket.closed_at });
  const valid: Transaction[] = [];
  for (const row of snapshot.sources.transactions?.rows ?? []) {
    if (row.linked_plan_type !== "goal" || row.linked_plan_id !== bucket.id || row.pending === true || row.removed_at || row.deleted_at) continue;
    const amount = numeric(row.amount);
    const allocations = row.review_allocations;
    if (amount === null || amount >= 0 || !validDate(row.date) || row.date > snapshot.today || row.pending != null && typeof row.pending !== "boolean" || !Array.isArray(allocations) || allocations.some(allocation => !allocation || typeof allocation !== "object" || numeric(allocation.amount) === null || numeric(allocation.amount)! < 0 || !["bill","income","planned_expense","category","transfer","extra_principal"].includes(allocation.type) || allocation.type === "planned_expense" && (typeof allocation.targetId !== "string" || !allocation.targetId || allocation.source != null && !["goal","decision","transaction"].includes(allocation.source)) || allocation.occurrenceDate != null && !validDate(allocation.occurrenceDate)) || sum(allocations.map(allocation => Number(allocation.amount))) > Math.abs(amount) + .005) {
      missing.push("Some linked purchase amounts, dates or allocations could not be verified; the purchase history is incomplete");
      continue;
    }
    valid.push({ ...row, id: String(row.id), amount, date: row.date, category: typeof row.category === "string" ? row.category : "Other", note: typeof row.note === "string" ? row.note : "", merchant_name: typeof row.merchant_name === "string" ? row.merchant_name : undefined, review_allocations: allocations.map(allocation => ({ ...allocation, amount: Number(allocation.amount) })) } as Transaction);
  }
  const history = bucketPurchaseHistory(valid, bucket.id), shown = history.slice(0, 5);
  if (sum(history.map(purchase=>purchase.allocated)) > summary.spent + .005) missing.push("Retained linked allocations exceed the saved spent amount; review these bucket records before relying on the history");
  const facts: AnalysisResult["facts"] = { bucketId: bucket.id, bucketName: bucket.name, bucketPlanned: summary.planned, bucketSpent: summary.spent, bucketRemaining: summary.remaining, bucketReleased: summary.released, bucketClosed: summary.closed, bucketOverage: round(Math.max(0, summary.spent - summary.planned)), bucketTargetDate: bucket.target_date, bucketHistoryCount: history.length, bucketHistoryShown: shown.length, bucketHistoryAllocated: sum(history.map(purchase => purchase.allocated)), safeToSpend: null };
  const lines = shown.map(({ transaction, allocated }, index) => {
    const name = label(transactionDisplayName(transaction));
    facts[`purchase${index + 1}Name`] = name; facts[`purchase${index + 1}Allocated`] = allocated; facts[`purchase${index + 1}TransactionAmount`] = Math.abs(transaction.amount); facts[`purchase${index + 1}Date`] = transaction.date;
    return `${transaction.date} · ${name}: ${dollars(allocated)} assigned to this bucket${Math.abs(transaction.amount) > allocated + .005 ? ` from a ${dollars(Math.abs(transaction.amount))} transaction` : ""}.`;
  });
  const state = summary.closed ? `This bucket is closed: ${dollars(summary.remaining)} left in the bucket and ${dollars(summary.released)} of unused budget released.` : `${dollars(summary.remaining)} left in the bucket.`;
  const overage = Number(facts.bucketOverage) > 0 ? ` Spending is ${dollars(Number(facts.bucketOverage))} over the planned amount.` : "";
  const purchases = lines.length ? `Recent linked purchases (showing ${shown.length} of ${history.length} retained purchases):\n${lines.join("\n")}` : missing.length ? "No linked purchases could be verified from the available history." : "No retained linked purchases are shown. Earlier spending may not have linked purchase records.";
  return { text: `${bucket.name}: ${state}\n\nPlanned ${dollars(summary.planned)} · Spent ${dollars(summary.spent)}.${overage}\n\n${purchases}\n\nThis is bucket budget headroom, not spendable bank cash.`, facts, sources, assumptions, missing: [...new Set(missing)], scenario: false };
}
