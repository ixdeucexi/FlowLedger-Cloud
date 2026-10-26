/** Fixed fictional bucket/answer-quality corpus; no database or provider access. */
import { createPhaseOneEvaluationClient, evaluationNow, evaluationHousehold } from "./flo-phase1-evaluation-fixture.ts";
export { evaluationNow, evaluationHousehold };
export const phaseThreeCases = [
  { id: "bucket-summary", question: "What is left in my Christmas Shopping bucket?", expected: { bucketPlanned: 500, bucketSpent: 125, bucketRemaining: 375, route: "/(tabs)/more?section=buckets" } },
  { id: "bucket-natural", question: "Could you check what is still earmarked for Christmas Shopping and how much I have used from it?", expected: { bucketPlanned: 500, bucketSpent: 125, bucketRemaining: 375 } },
  { id: "bucket-purchases", question: "Show my Christmas Shopping bucket purchases.", expected: { bucketHistoryCount: 1, bucketHistoryAllocated: 30, purchaseName: "Saved toy store purchase" } },
  { id: "bucket-closed", question: "What is left in my Christmas Shopping bucket?", expected: { bucketRemaining: 0, bucketReleased: 375, bucketClosed: true } },
  { id: "bucket-overspent", question: "What is left in my Christmas Shopping bucket?", expected: { bucketSpent: 550, bucketRemaining: 0, bucketOverage: 50 } },
  { id: "bucket-pending-removed", question: "Show my Christmas Shopping bucket purchases.", expected: { bucketHistoryCount: 1, bucketHistoryAllocated: 30 } },
  { id: "bucket-null", question: "What is left in my Christmas Shopping bucket?", expected: { noBucketBalance: true, partial: true } },
  { id: "bucket-invalid-allocation", question: "Show my Christmas Shopping bucket purchases.", expected: { partial: true, bucketHistoryCount: 0 } },
  { id: "bucket-ambiguous", question: "What is left in my Holiday bucket?", expected: { noBucketBalance: true, clarification: true, choices: ["What is left in my Holiday 1 bucket?", "What is left in my Holiday 2 bucket?"] } },
  { id: "bucket-source-gap", question: "What is left in my Christmas Shopping bucket?", expected: { noBucketBalance: true, partial: true } },
  { id: "bucket-year-scope", question: "What is left in my Christmas Shopping bucket in 2027?", expected: { noBucketBalance: true, partial: true } },
  { id: "bucket-date-scope", question: "What is left in my Christmas Shopping bucket on December 25?", expected: { noBucketBalance: true, partial: true } },
  { id: "bucket-period-scope", question: "Show my Christmas Shopping bucket balance at the end of this year.", expected: { noBucketBalance: true, partial: true } },
  { id: "bucket-past-scope", question: "What is left in my Christmas Shopping bucket last month?", expected: { noBucketBalance: true, partial: true } },
  { id: "bucket-numeric-date", question: "What is left in my Christmas Shopping bucket on 12/25?", expected: { noBucketBalance: true, partial: true } },
  { id: "bucket-relative-period", question: "What is left in my Christmas Shopping bucket in two weeks?", expected: { noBucketBalance: true, partial: true } },
  { id: "inventory-followups", question: "What accounts can you see?", expected: { accountCount: 7, choices: ["What is my checking balance?", "What is my savings balance?"], route: "/(tabs)/accounts" } },
  { id: "credit-followup", question: "What is my Main Card balance?", expected: { recordedLiabilityBalance: 400, choices: ["What is my Main Card credit utilization?"], route: "/(tabs)/bills?view=debt" } },
  { id: "greeting", question: "Hi!", expected: { staticKind: "greeting" } },
  { id: "thanks", question: "Thanks, Flo!", expected: { staticKind: "thanks" } },
  { id: "income-help", question: "How do I add income?", expected: { staticKind: "app_help", route: "/(tabs)/more?section=money" } },
  { id: "bucket-help", question: "How do I add a purchase to a bucket?", expected: { staticKind: "app_help", route: "/(tabs)/more?section=buckets" } },
] as const;

export function createPhaseThreeEvaluationClient(caseId = "bucket-summary") {
  if (!phaseThreeCases.some(item => item.id === caseId)) throw new Error("Unknown fixed Phase 3 case");
  const base = createPhaseOneEvaluationClient(), h = evaluationHousehold;
  const bucket: Record<string, any> = { id: "christmas", household_id: h, name: "Christmas Shopping", goal_type: "planned_expense", target_amount: 500, current_amount: 125, target_date: "2026-12-25", created_at: "2026-06-01" };
  const purchase = { id: "purchase", household_id: h, date: "2026-09-09", amount: -100, note: "Saved toy store purchase", merchant_name: "Original bank merchant", user_edited_at: evaluationNow, category: "Shopping", source: "plaid", linked_plan_type: "goal", linked_plan_id: "christmas", review_status: "matched", review_resolution: "goal", review_allocations: [{ type: "planned_expense", source: "goal", targetId: "christmas", amount: 30 }, { type: "category", category: "Shopping", amount: 70 }] };
  const tables: Record<string, Record<string, any>[]> = { goals: [bucket], transactions: [purchase] };
  if (caseId === "bucket-closed") bucket.closed_at = evaluationNow;
  if (caseId === "bucket-overspent") bucket.current_amount = 550;
  if (caseId === "bucket-null") bucket.current_amount = null;
  if (caseId === "bucket-invalid-allocation") purchase.review_allocations[0].amount = null as any;
  if (caseId === "bucket-pending-removed") tables.transactions.push({ ...purchase, id: "pending", pending: true }, { ...purchase, id: "removed", removed_at: evaluationNow }, { ...purchase, id: "replaced-statement", source: "statement", deleted_at: evaluationNow });
  if (caseId === "bucket-ambiguous") tables.goals = [{ ...bucket, id: "holiday-1", name: "Holiday 1" }, { ...bucket, id: "holiday-2", name: "Holiday 2" }];
  return { from(table: string) {
    if (!Object.hasOwn(tables, table)) return base.from(table);
    let selected = [...tables[table]], take = Infinity;
    const query: any = {
      select() { return query; }, eq(key: string, value: unknown) { selected = selected.filter(row => row[key] === value); return query; },
      neq(key: string, value: unknown) { selected = selected.filter(row => row[key] !== value); return query; },
      gt(key: string, value: string) { selected = selected.filter(row => String(row[key]) > value); return query; },
      order(key: string, options?: { ascending?: boolean }) { selected.sort((a, b) => String(a[key] ?? "").localeCompare(String(b[key] ?? "")) * (options?.ascending === false ? -1 : 1)); return query; },
      limit(value: number) { take = value; return query; }, maybeSingle: async () => ({ data: selected[0] ?? null, error: null }),
      then(resolve: any) { return Promise.resolve(caseId === "bucket-source-gap" && table === "goals" ? { data: null, error: { message: "Fictional source unavailable" } } : { data: selected.slice(0, take), error: null }).then(resolve); },
    }; return query;
  } };
}
