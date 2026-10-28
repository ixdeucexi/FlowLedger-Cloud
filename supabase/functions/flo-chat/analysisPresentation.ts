import { normalizeAccountName } from "./analysisAccounts.ts";
import { currentAccountBalanceGroup } from "./analysisSemantics.ts";
import { dollars, type AnalysisRequest, type AnalysisResult } from "./analysisTypes.ts";

export type AnalysisAnswerScope = Pick<AnalysisRequest, "domain" | "purpose"> & Partial<Pick<AnalysisRequest, "operation" | "entity" | "metric" | "dateEvent">>;
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

/** Default answers are built from typed calculator facts, never shortened by
 * slicing rendered money/date prose. The full calculator output stays in its
 * tool receipt. Explicit lists, comparisons and explanations keep that detail. */
export type AnalysisPresentation = { answer: string; caveat: string | null };
export function wantsAnalysisDetails(question: string): boolean {
  return /\b(?:details?|explain|breakdown|step[ -]by[ -]step|list|purchases|transactions|compare|which|what accounts)\b/i.test(question);
}

class MissingPresentationFact extends Error {}
function conciseResultFromFacts(result: AnalysisResult, scope: AnalysisAnswerScope | undefined, question: string): string {
  const f = result.facts;
  const n = (key: string): number | null => typeof f[key] === "number" && Number.isFinite(f[key]) ? f[key] as number : null;
  const s = (key: string): string | null => typeof f[key] === "string" && f[key] ? f[key] as string : null;
  const cash = (key: string) => { const value=n(key); if(value===null)throw new MissingPresentationFact(key); return dollars(value); };
  // Never rewrite a clarification or an unsupported/ambiguous result as a fact.
  if (result.choices || f.recordedPlanOnly === true || !Object.keys(f).length) return result.text;
  if (wantsAnalysisDetails(question)) return result.text;
  if (scope?.purpose === "debt_timeline" && (s("namedDebtPayoffMonth") || s("scenarioDebtFreeMonth"))) {
    return `${s("namedDebt") ?? "The included debt plan"} is projected to be paid off in ${s("namedDebtPayoffMonth") ?? s("scenarioDebtFreeMonth")} under the fixed-payment scenario (baseline: ${s("namedDebtBaselineMonth") ?? s("baselineDebtFreeMonth") ?? "not reached"}). This assumes unchanged payments and APRs; it does not establish that extra payments are affordable.`;
  }
  if (scope?.purpose === "debt_timeline" && f.timelineOutcome === "not_estimable" && n("totalDebt") !== null) return `The known configured debt-plan balance is ${cash("totalDebt")}; connected credit is separate. I cannot verify a payoff month from the recorded payments and terms; please check the missing debt-plan details.`;
  if (["buffer_timeline", "goal_timeline"].includes(scope?.purpose ?? "")) {
    const name = s("goalName") ?? "additional cash buffer";
    if (f.timelineOutcome === "duration" && n("timelineDuration") !== null) return `Scenario: ${name} reaches the target after ${f.timelineDuration} ${f.timelineUnit === "household_paydays" ? "household-payday contributions" : "months"}${n("explicitContribution") !== null ? ` at your stated ${cash("explicitContribution")} per contribution` : " under the checked contribution plan"}. This is not confirmation those contributions are affordable.`;
    if (f.timelineOutcome === "already_reached") return `Your recorded ${name} already reaches the target; no additional waiting is needed. This does not make earmarked money available for other spending.`;
    if (n("goalCurrent") !== null && n("goalTarget") !== null) return `${name}: ${cash("goalCurrent")} funded toward ${cash("goalTarget")}. ${f.timelineUnit === "household_paydays" ? "How much will you contribute per paycheck?" : "What contribution amount and frequency should I use?"} A contribution scenario does not establish affordability.`;
    if (scope?.purpose === "goal_timeline") return "Which saved goal do you mean? I need its recorded funding, target, and your planned contribution amount and frequency to estimate a timeline.";
    if (n("minimumBalance") !== null) return `The recorded plan's low is ${cash("minimumBalance")} on ${s("minimumDate")}. I need the available buffer and a contribution schedule before estimating when you will reach the target; scheduled balances alone do not establish spare cash.`;
  }
  if (result.scenario && n("scenarioEndBalance") !== null && n("baselineEndBalance") !== null) {
    return `Read-only scenario: the end balance would be ${cash("scenarioEndBalance")} versus ${cash("baselineEndBalance")} in the baseline. Through ${s("assessmentEndDate")}, its low is ${cash("scenarioLow")} on ${s("scenarioLowDate")}${n("cashCushion") !== null && n("scenarioLow")! < n("cashCushion")! ? `, below your ${cash("cashCushion")} cushion` : ""}; ${f.affordabilityVerified === true ? "this remains a projection, not guaranteed available funds" : f.everydaySpendingEstimated === false ? "everyday costs are not estimated, so affordability is unverified" : "available funds or older obligations remain unverified"}. Nothing was changed.`;
  }
  if (scope?.purpose === "bucket_details" && s("bucketName") && n("bucketRemaining") !== null) {
    return `${s("bucketName")} budget: ${f.bucketClosed === true ? `closed, ${cash("bucketReleased")} released and ${cash("bucketRemaining")} remaining` : `${cash("bucketRemaining")} remaining`} (${cash("bucketSpent")} spent of ${cash("bucketPlanned")}).${n("bucketOverage")! > 0 ? ` Over budget by ${cash("bucketOverage")}.` : ""}`;
  }
  if (scope?.purpose === "current_balance" && n("recordedBalance") !== null && (s("balanceAsOf") || s("oldestObservationDate") && s("newestObservationDate"))) {
    const asOf = s("balanceAsOf") ? `as of ${s("balanceAsOf")}` : `from ${s("oldestObservationDate")}–${s("newestObservationDate")} observations (not simultaneous)`;
    const name = s("accountName") ?? (s("accountType") === "savings" ? "Savings" : s("accountType") === "checking/cash" ? "Checking/cash" : "Checking/cash and savings");
    return `${name}: ${cash("recordedBalance")} recorded ${asOf}.`;
  }
  // Liability sign/date meanings are already narrowly generated by the account
  // calculator; preserve them instead of treating a negative balance as cash.
  if (scope?.purpose === "current_balance") return result.text;
  if (scope?.purpose === "affordability" && n("projectedBalance") !== null) {
    const available = n("safeToSpendUnderPlan");
    return available === null
      ? `The recorded plan's low is ${cash("affordabilityMinimumBalance")} on ${s("affordabilityMinimumDate")}. Everyday costs, available funds or older obligations still need checking before I can give a safe-to-spend amount.`
      : `${cash("safeToSpendUnderPlan")} of additional spending fits the checked plan through ${s("affordabilityAssessmentThrough")}, preserving your ${cash("cashCushion")} cushion. This is a projection, not guaranteed bank funds.`;
  }
  if (n("projectedBalance") !== null && s("targetDate") && scope?.domain !== "purchase" && !["compare", "minimum", "maximum", "threshold"].includes(scope?.operation ?? "") && !/\b(?:threshold|reach|highest|lowest|maximum|minimum)\b/i.test(question)) {
    const estimated = n("projectedAfterEstimatedSpending") !== null;
    const balance = estimated ? cash("projectedAfterEstimatedSpending") : cash("projectedBalance");
    const low = n("minimumProjectedBalance"); const floor = n("cashCushion");
    const risk = n("affordabilityMinimumBalance");
    const caution = low !== null && floor !== null && low < floor
      ? `The low is ${cash("minimumProjectedBalance")} on ${s("minimumDate")}, below your ${cash("cashCushion")} cushion.`
      : risk !== null && floor !== null && risk < floor
        ? `Later obligations take the balance to ${cash("affordabilityMinimumBalance")} on ${s("affordabilityMinimumDate")}, below your cushion.`
        : estimated ? "Expected income and spending can change; this is not guaranteed bank funds." : "Everyday spending is not estimated; this is the recorded schedule, not a safe-to-spend amount.";
    return `Projected checking/cash on ${s("targetDate")}: ${balance}${estimated ? " after estimated everyday spending" : " under the recorded schedule"}. ${caution}${!estimated && (low !== null && floor !== null && low < floor || risk !== null && floor !== null && risk < floor) ? " Everyday costs are not estimated, so this is not a safe-to-spend amount." : ""}`;
  }
  if (scope?.purpose === "budget_plan" && n("expectedIncome") !== null && n("recordedBillDebtReserve") !== null) {
    return `For ${s("startDate")}–${s("endDate")}: ${cash("expectedIncome")} expected income, ${cash("recordedBillDebtReserve")} bill/debt commitments and ${cash("otherPlanReserve")} other commitments. ${n("livingCostAllowance") === null ? "Everyday costs still need a budget; these commitments are not a complete spending allowance." : `${cash("livingCostAllowance")} is estimated for everyday costs.`}${n("householdCushionShortfall")! > 0 ? ` The forecast falls ${cash("householdCushionShortfall")} below your cushion.` : ""}`;
  }
  if (scope?.purpose === "action_plan" && n("dueAmountTotal") !== null) {
    return `Through ${s("endDate")}, protect ${cash("dueAmountTotal")} for ${f.dueOccurrenceCount} bill/debt occurrences against ${cash("expectedIncomeTotal")} expected income. ${n("householdCushionShortfall")! > 0 ? `Resolve the ${cash("householdCushionShortfall")} cushion shortfall before ${s("minimumDate")}.` : "Keep your bill reserve and cushion intact."} ${n("safeSharedCapacity") === null ? "Review everyday costs before assigning extra money." : `${cash("safeSharedCapacity")} is one shared optional capacity, not a separate allowance for each goal.`}`;
  }
  if (scope?.purpose === "paycheck_allocation" && n("expectedPaycheck") !== null) {
    return `Your next expected paycheck is ${cash("expectedPaycheck")} on ${s("payday")}. ${n("allocatedPaycheck") === null ? `Protect the recorded commitments first${n("cycleRecordedCommitments") !== null ? `: ${cash("cycleRecordedCommitments")} through ${s("cycleEnd")}` : ""}; everyday costs and your current funds still need checking before assigning the rest.` : `${cash("allocatedPaycheck")} is reserved and ${cash("unassignedPaycheck")} remains unassigned through ${s("cycleEnd")}.`}${n("paycheckOnlyGap")! > 0 ? ` The paycheck alone is ${cash("paycheckOnlyGap")} short; existing cash may cover it.` : n("allocatedPaycheck") !== null ? " Unassigned money is not automatically available to spend." : ""}`;
  }
  if (n("minimumBalance") !== null && s("minimumDate") && !scope?.purpose?.endsWith("timeline")) {
    return `The recorded plan reaches a low of ${cash("minimumBalance")} on ${s("minimumDate")}${n("cashCushion") !== null ? ` against your ${cash("cashCushion")} cushion` : ""}. ${n("currentPlanBuffer") !== null ? `${cash("currentPlanBuffer")} is the checked additional buffer.` : "Everyday costs or current funds still need checking, so this does not establish spare cash."}${n("nextPaycheck")! > 0 ? ` Your next expected paycheck is ${cash("nextPaycheck")} on ${s("nextPayday")}.` : ""}`;
  }
  if (scope?.domain === "review" && n("review_spending") !== null) return `For ${s("review_startDate")}–${s("review_endDate")}, recorded spending was ${cash("review_spending")} and confirmed recorded income was ${cash("review_income")}. ${n("current_minimumBalance") !== null ? `Separately, the current recorded plan reaches ${cash("current_minimumBalance")} on ${s("current_minimumDate")}${n("current_cashCushion") !== null && n("current_minimumBalance")! < n("current_cashCushion")! ? ", below your cushion" : ""}.` : "The current cash-flow outlook could not be verified."} ${n("current_currentPlanBuffer") === null ? "Current spare cash is unverified; payments alone do not establish debt-principal or savings growth." : "Recorded payments alone do not establish debt-principal or savings growth."}`;
  if (scope?.domain === "income" && n("income") !== null && n("paycheckCount") !== null && scope.operation !== "average") return `${cash("income")} in confirmed recorded income for ${s("startDate")}–${s("endDate")}, across ${f.paycheckCount} payments.${result.missing.length ? " Unchecked or unclassified records are excluded, so this may be incomplete." : ""}`;
  if (scope?.domain === "fees" && n("fees") !== null) return `${cash("fees")} in recorded fee-labeled charges for ${s("startDate")}–${s("endDate")}.${s("highestFeeAccount") ? ` Highest identified-account total: ${s("highestFeeAccount")}, ${cash("highestAccountFees")}.` : ""} These are label matches${result.missing.length ? " with incomplete account or activity coverage" : ""}, not proof every fee was identified.`;
  if (scope?.domain === "income" && n("expectedIncome") !== null && scope.operation !== "average") return `${cash("expectedIncome")} in expected scheduled income${s("startDate") ? ` for ${s("startDate")}–${s("endDate")}` : s("nextPayday") ? ` on ${s("nextPayday")}` : ""}. This is scheduled, not confirmed received income.`;
  if (["bills", "subscriptions"].includes(scope?.domain ?? "") && n("remainingObligations") !== null) return `${cash("remainingObligations")} remains across ${f.unpaidOccurrenceCount ?? f.occurrenceCount} recorded bill/debt occurrences for ${s("startDate")}–${s("endDate")}.${n("paymentStatusNeedsReviewCount")! > 0 ? ` ${f.paymentStatusNeedsReviewCount} other occurrences need payment review and are excluded.` : ""} Pending payments are not counted as paid.`;
  if (scope?.domain === "credit" && n("utilizationPercent") !== null && n("afterPaymentUtilization") === null && !/\b(?:below|under|pay|payment|reduce)\b/i.test(question)) return `Recorded utilization is ${f.utilizationPercent}%: ${cash("cardBalance")} owed against ${cash("creditLimit")} in verified limits.${result.missing.length ? " This covers only the cards with checked balances and limits." : ""}`;
  if (scope?.domain === "debt" && !scope.entity && n("totalDebt") !== null && !result.scenario && !scope.purpose?.endsWith("timeline") && !/\b(?:first|next|target|interest|apr|payment|payoff|plan)\b/i.test(question)) return `Your ${result.missing.length ? "known " : ""}configured debt-plan balance totals ${cash("totalDebt")} across ${f.debtCount} debts${result.missing.length ? " (other balances or plan details need checking)" : ""}; connected credit is separate, so this is not an all-debt total.${n("minimumRemaining") !== null ? ` ${cash("minimumRemaining")} remains on this month's configured required payments.` : ""}`;
  if (scope?.domain === "spending" && !["compare", "minimum", "maximum", "average"].includes(scope.operation ?? "") && n("spending") !== null && !/\b(?:more|less|average|most|least|over|under)\b/i.test(question)) return `${cash("spending")} in recorded consumption spending for ${s("startDate")}–${s("endDate")}.${result.missing.length ? " Unchecked or unclassified activity is excluded, so this may not be the complete total." : " Transfers and identified debt repayments are excluded."}`;
  return result.text;
}

function conciseResult(result: AnalysisResult, scope: AnalysisAnswerScope | undefined, question: string): string {
  try { return conciseResultFromFacts(result,scope,question); }
  catch(error) { if(error instanceof MissingPresentationFact)return result.text; throw error; }
}

export function presentFinancialAnalysis(results: readonly AnalysisResult[], scopes: readonly AnalysisAnswerScope[], question: string): AnalysisPresentation {
  const paragraphs = results.map((result, index) => conciseResult(result, scopes[index], question));
  return {
    answer: [...new Set(paragraphs)].join("\n\n"),
    caveat: [...new Set(results.flatMap(result => result.missing))].join("; ") || null,
  };
}
