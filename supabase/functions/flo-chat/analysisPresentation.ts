import { normalizeAccountName } from "./analysisAccounts.ts";
import { currentAccountBalanceGroup } from "./analysisSemantics.ts";
import type { AnalysisRequest, AnalysisResult } from "./analysisTypes.ts";

export type AnalysisAnswerScope = Pick<AnalysisRequest, "domain" | "purpose">;
export function analysisSourceRoute(scope: AnalysisAnswerScope, result?: AnalysisResult): string {
  if (scope.purpose === "bucket_details") return "/(tabs)/more?section=buckets";
  if (scope.purpose === "current_balance" && typeof result?.facts.namedDebtBalance === "number") return "/snowball-plan";
  if (scope.purpose === "current_balance" && result?.facts.accountType === "credit") return "/(tabs)/bills?view=debt";
  if (scope.purpose === "current_balance" || scope.purpose === "account_inventory") return "/(tabs)/accounts";
  const domain = scope.domain;
  if (domain === "credit") return "/(tabs)/bills?view=debt";
  return ["spending", "transactions", "unusual", "fees", "review"].includes(domain) ? "/(tabs)/transactions" : ["bills", "subscriptions", "credit"].includes(domain) ? "/(tabs)/bills" : domain === "debt" ? "/snowball-plan" : ["savings", "emergency"].includes(domain) ? "/(tabs)/more?section=goals" : domain === "income" ? "/(tabs)/more?section=money" : domain === "budget" ? "/(tabs)/category-budget" : "/(tabs)/monthly";
}

/** Questions are application-owned templates over typed facts/choices. They do
 * not parse rendered prose, calculate money, or shorten saved numeric names. */
export function analysisTypedFollowups(results: readonly AnalysisResult[], scopes: readonly AnalysisAnswerScope[], question: string): string[] {
  const questions: string[] = [];
  const name = (value: unknown) => typeof value === "string" && value.trim() && value.length < 80 ? value : null;
  results.forEach((result, index) => {
    const scope = scopes[index], f = result.facts;
    if (result.choices) {
      const before = questions.length;
      result.choices.names.forEach(value => {
        if (!name(value)) return;
        const candidate = result.choices!.kind === "bucket" ? `What is left in my ${value} bucket?` : `What is my ${value} balance?`;
        if (result.choices!.kind !== "account" || currentAccountBalanceGroup(candidate) === null) questions.push(candidate);
      });
      if (result.choices.kind === "account" && questions.length === before) questions.push("What accounts can you see?");
      return;
    }
    if (result.missing.length) return;
    if (scope?.purpose === "account_inventory") questions.push("What is my checking balance?", "What is my savings balance?");
    else if (scope?.purpose === "bucket_details" && name(f.bucketName)) {
      questions.push(`Show my ${f.bucketName} bucket purchases.`);
      if (f.bucketClosed !== true && typeof f.bucketRemaining === "number" && f.bucketRemaining > .005) questions.push("How do I add a purchase to a bucket?");
    }
    else if (f.accountType === "credit" && name(f.accountName) && typeof f.recordedLiabilityBalance === "number") questions.push(`What is my ${f.accountName} credit utilization?`);
    else if (typeof f.namedDebtBalance === "number" && name(f.accountName)) questions.push(`When will ${f.accountName} be paid off?`);
    else if (typeof f.recordedBalance === "number" && f.safeToSpend === null) questions.push("What bills are due before my next paycheck?", "How much can I safely spend?");
  });
  return [...new Set(questions)].filter(value => normalizeAccountName(value) !== normalizeAccountName(question)).slice(0, 3);
}
