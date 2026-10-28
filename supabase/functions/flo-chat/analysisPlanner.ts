import { financialAnalysisProviderSchema as schema, parseFinancialAnalysisPlan } from "./analysisSchema.ts";
import { generateText, Output } from "npm:ai@7.0.59";
import { createOpenAI } from "npm:@ai-sdk/openai@4.0.37";
import { analysisSourceDependencies, loadAnalysisSnapshot, verifyAnalysisSnapshot } from "./analysisSnapshot.ts";
import { boundedAnalysisConversation, loadAnalysisConversation, loadAnalysisEntityCatalog, type AnalysisTurn } from "./analysisContext.ts";
import { explainFinancialAnalysis } from "./analysisExplanation.ts";
import { availablePlanAnalysis, forecastAnalysis, projectionInput, projectionSources } from "./analysisProjection.ts";
import { spendingAnalysis } from "./analysisSpending.ts";
import { wealthAnalysis } from "./analysisWealth.ts";
import { scenarioAnalysis, stabilityAnalysis } from "./analysisStability.ts";
import { recurringAnalysis } from "./analysisRecurring.ts";
import { incomeSourceInventoryAnalysis, scheduleAnalysis } from "./analysisSchedule.ts";
import { reviewAnalysis } from "./analysisReview.ts";
import { accountInventoryAnalysis, currentBalanceAnalysis, isCurrentAccountReferenceQuestion, resolvePriorAccountReference, type AccountReferenceProvenance } from "./analysisAccounts.ts";
import { localDay, validDate, type AnalysisRequest, type AnalysisResult, type AnalysisSnapshot } from "./analysisTypes.ts";
import { aggregateCoverage, freshness, oldestSourceAsOf, type FloGroundedAnswer, type FloToolEnvelope, type FloSourceRef } from "./contract.ts";
import type { FloToolRuntime } from "./tools.ts";
import { analysisInterpreterPrompt, analysisInterpretationError, deterministicAnalysisPlan, explicitUnsupportedForecastScope, interpretAnalysisQuestion, interpretationAttemptMs, isTimelinePurpose, incomeArithmeticClarification, isIncomeSourceInventoryQuestion, isWholeDebtTotalQuestion, interpretedAccountPhrase, unresolvedContributionClarification, validateRequestSemantics } from "./analysisSemantics.ts";
import { guidanceAnalysis, isGuidancePurpose } from "./analysisGuidance.ts";
import { analysisSourceRoute, analysisTypedFollowups, presentFinancialAnalysis, wantsAnalysisDetails, type AnalysisAnswerScope } from "./analysisPresentation.ts";
import { bucketDetailsAnalysis } from "./analysisBuckets.ts";
import { historyAnalysis } from "./analysisHistory.ts";

export function validateAnalysisRequest(request: AnalysisRequest, today: string): string | null {
  const semanticError=validateRequestSemantics(request);if(semanticError)return semanticError;
  for(const value of [request.startDate,request.endDate,request.comparisonStart,request.comparisonEnd,request.scenario?.date,request.scenario?.sourceDate]) if(value!==null&&value!==undefined&&!validDate(value)) return "The requested calendar date is invalid.";
  if(request.startDate&&request.endDate&&request.startDate>request.endDate) return "The start date is after the end date.";
  if(request.purpose==="action_plan"&&request.planDays!=null&&request.endDate) {
    const days=(Date.parse(request.endDate)-Date.parse(request.startDate??today))/86400000+1;
    if(days!==request.planDays)return "The action-plan date range must match its inclusive requested day count.";
  }
  if(request.comparisonStart&&request.comparisonEnd&&request.comparisonStart>request.comparisonEnd) return "The comparison start date is after its end date.";
  if(request.scenario&&request.scenario.date<today) return "What-if changes must start today or later; historical records are not changed.";
  if(request.scenario&&request.endDate&&request.scenario.date>request.endDate) return "The scenario starts after the requested forecast window.";
  if(request.scenario&&request.scenario.kind!=="income_change"&&request.scenario.amount<0) return "Use a positive spending or contribution amount.";
  return null;
}

/** A verified plan subtotal is not evidence for an all-account debt total. */
export function requestedDebtCoverage(question:string,result:AnalysisResult):AnalysisResult {
  if(result.facts.debtScope!=="configured_plan_only")return result;
  if(!isWholeDebtTotalQuestion(question))return result;
  return {...result,missing:[...new Set([...result.missing,"A reconciled total across configured debts and connected credit accounts has not been verified"]) ]};
}

/** Remove only byte-identical repeated paragraphs; never summarize away facts. */
export function distinctAnalysisParagraphs(texts:readonly string[]):string[] {
  return [...new Set(texts.flatMap(text=>text.split(/\n\s*\n/).map(part=>part.trim()).filter(Boolean)))];
}

/** Missing history blocks only genuine references, never a new complete question. */
export function requiresAnalysisConversation(question: string): boolean {
  return isCurrentAccountReferenceQuestion(question) || /^(?:(?:and|what about|how about)\s+)?(?:that (?:debt|goal|payment|amount)|the same (?:debt|goal|payment|amount)|it|them|those)[?.!\s]*$/i.test(question.trim());
}
/** An acknowledgement alone supplies no question or financial authorization.
 * Creation drafts are handled by the creation dispatcher before this reader. */
export function orphanAnalysisAcknowledgement(question: string, conversation: readonly AnalysisTurn[]): AnalysisResult | null {
  const acknowledgement=(value:string)=>/^(?:yes|yeah|yep|sure|ok(?:ay)?)(?:,?\s+please)?[.!?]*$/i.test(value.trim());
  if(!acknowledgement(question))return null;
  const hasPriorQuestion=conversation.some(turn=>turn.role==="user"&&!acknowledgement(turn.content)&&! /^(?:hi|hello|hey|thanks|thank you)[.!?]*$/i.test(turn.content.trim()));
  if(hasPriorQuestion)return null;
  return {text:"What would you like me to check or help you add?",facts:{},sources:[],assumptions:[],missing:["A question or specific action is needed; an acknowledgement alone does not supply one"],scenario:false};
}
export function requiresAnalysisSettings(request: AnalysisRequest, question=""): boolean {
  if(request.domain==="income"&&isIncomeSourceInventoryQuestion(question))return false;
  if (["current_balance", "account_inventory", "bucket_details"].includes(request.purpose ?? "")) return false;
  if (["credit", "debt"].includes(request.domain) && [undefined, "general"].includes(request.purpose) && !request.scenario && request.dateEvent === "none" && !request.startDate && !request.endDate && !request.comparisonStart && !request.comparisonEnd && ["summary", "detail", "minimum", "maximum"].includes(request.operation)) return false;
  return true;
}

const projectionDomains=new Set(["money","forecast","purchase","bills","subscriptions","income","stability","buffer","paycheck","progress","health"]);
export function calculateFinancialAnalysis(snapshot: AnalysisSnapshot, request: AnalysisRequest, question?: string, reference?: AccountReferenceProvenance): AnalysisResult {
  const invalid=validateAnalysisRequest(request,snapshot.today);
  if(invalid) return {text:invalid,facts:isTimelinePurpose(request)?{timelineOutcome:"not_estimable"}:{},sources:[],assumptions:[],missing:[invalid],scenario:Boolean(request.scenario)};
  if(isGuidancePurpose(request.purpose))return guidanceAnalysis(snapshot,request);
  if(request.purpose==="bucket_details")return bucketDetailsAnalysis(snapshot,request,question);
  if(request.purpose==="account_inventory")return accountInventoryAnalysis(snapshot,request);
  if(request.domain==="income"&&request.operation==="detail"&&isIncomeSourceInventoryQuestion(question??""))return incomeSourceInventoryAnalysis(snapshot);
  if(request.purpose==="balance_history")return historyAnalysis(snapshot,request);
  if(request.domain==="money"&&request.operation==="detail"&&!request.scenario&&request.dateEvent==="none")return currentBalanceAnalysis(snapshot,request,question,reference);
  const historicalBills=request.domain==="bills"&&request.endDate!==null&&request.endDate<snapshot.today;
  const receivedIncome=request.domain==="income"&&request.incomeTiming==="received";
  const scheduleOnly=["bills","subscriptions","income"].includes(request.domain)&&!request.scenario;
  if((projectionDomains.has(request.domain)&&!historicalBills&&!receivedIncome&&!scheduleOnly)||request.scenario) {
    const missing=projectionInput(snapshot).missing;
    if(missing.length) {
      const available=availablePlanAnalysis(snapshot,request,missing);
      if(isTimelinePurpose(request))return {...available,text:`I cannot estimate when you will reach that target yet. ${available.text}`,facts:{...available.facts,timelineOutcome:"not_estimable"}};
      return available;
    }
  }
  if(request.scenario && !(request.domain==="debt"&&request.scenario.kind==="extra_debt")) return scenarioAnalysis(snapshot,request);
  if(request.domain==="review")return reviewAnalysis(snapshot,request);
  if(["spending","transactions","unusual","fees"].includes(request.domain)||receivedIncome) return spendingAnalysis(snapshot,request);
  if(["debt","credit","savings","emergency","budget"].includes(request.domain)) {
    const result=wealthAnalysis(snapshot,request);
    if(request.purpose==="debt_timeline") {
      const date=request.entity?result.facts.namedDebtPayoffMonth:result.facts.scenarioDebtFreeMonth;
      if(typeof date==="string"&&!result.missing.length){result.facts.timelineOutcome="duration";result.facts.timelineTargetMonth=date;}
      else {result.facts.timelineOutcome="not_estimable";result.text=`I cannot establish a reliable payoff timeline from the available plan.\n\n${result.text}`;result.missing.push("A verified payoff date is unavailable for this request");}
    }
    return result;
  }
  if(["stability","buffer","paycheck","progress","health"].includes(request.domain)) return stabilityAnalysis(snapshot,request);
  if(["bills","subscriptions"].includes(request.domain))return recurringAnalysis(snapshot,request);
  if(request.domain==="income")return scheduleAnalysis(snapshot,request);
  return forecastAnalysis(snapshot,request);
}

/** One model call interprets the question; financial math and final factual
 * sentences are generated by typed calculators, not by model arithmetic. */
export async function runFinancialAnalysis(options:{runtime:FloToolRuntime;question:string;apiKey:string;modelId:string;safetyIdentifier:string;conversationId?:string;historyEnabled?:boolean;userMessageId?:string;transientContext?:unknown}) {
  const analysisStartedAt=performance.now();
  const {runtime,question}=options;
  const incomeArithmetic=incomeArithmeticClarification(question);
  if(incomeArithmetic)return recordAnalysis(runtime,[incomeArithmetic],null,{inputTokens:0,outputTokens:0});
  const immediateContext=options.historyEnabled&&options.conversationId?null:options.historyEnabled?[]:boundedAnalysisConversation(options.transientContext);
  const immediateAcknowledgement=immediateContext===null?null:orphanAnalysisAcknowledgement(question,immediateContext);
  if(immediateAcknowledgement)return recordAnalysis(runtime,[immediateAcknowledgement],null,{inputTokens:0,outputTokens:0});
  let settings: Record<string, any> | null = null;
  let settingsUnavailable = false;
  try {
    const result=await runtime.client.from("household_settings").select("time_zone,payment_method").eq("household_id",runtime.householdId).maybeSingle();
    settings=result.data;settingsUnavailable=Boolean(result.error)||!settings?.time_zone;
  } catch { settingsUnavailable=true; }
  let timeZone=settings?.time_zone??"UTC";
  try { localDay(runtime.now,timeZone); } catch {timeZone="UTC";settingsUnavailable=true;}
  const today=localDay(runtime.now,timeZone);
  let conversation: AnalysisTurn[] = [];
  let contextUnavailable = false;
  try {conversation=await loadAnalysisConversation({client:runtime.client,householdId:runtime.householdId,conversationId:options.conversationId,historyEnabled:options.historyEnabled,userMessageId:options.userMessageId,transientContext:options.transientContext});}
  catch { contextUnavailable = true; }
  if(contextUnavailable && requiresAnalysisConversation(question))return recordAnalysis(runtime,[{text:"Which account, goal or payment do you mean? Please include its saved name so I can check it without the earlier conversation.",facts:{},sources:[],assumptions:[],missing:["Conversation context could not be verified for this reference"],scenario:false}],null,{inputTokens:0,outputTokens:0});
  const acknowledgement=orphanAnalysisAcknowledgement(question,conversation);
  if(acknowledgement)return recordAnalysis(runtime,[acknowledgement],null,{inputTokens:0,outputTokens:0});
  const prior=conversation.filter(turn=>turn.role==="user").map(turn=>turn.content);
  const unsupportedForecastScope=explicitUnsupportedForecastScope(question);
  if(unsupportedForecastScope)return recordAnalysis(runtime,[{
    text:`I cannot reliably project ${unsupportedForecastScope==="savings"?"your savings balance":"the combined balance of all your accounts"} yet. The forecast tracks household checking cash flow, but it does not have the account-by-account future allocations needed for this question. I can show your recorded balances or project your household checking cash flow instead.`,
    facts:{forecastScope:unsupportedForecastScope},sources:[],assumptions:[],missing:["Future income, transfers and payments allocated to each requested account"],scenario:false,
  }],null,{inputTokens:0,outputTokens:0});
  const clarification=unresolvedContributionClarification(question,prior);
  if(clarification)return recordAnalysis(runtime,[clarification],null,{inputTokens:0,outputTokens:0});
  if (isCurrentAccountReferenceQuestion(question)) {
    const snapshot = await loadAnalysisSnapshot(runtime.client,runtime.householdId,runtime.now,["accounts","plaid_accounts","bills"]);
    const resolved = resolvePriorAccountReference(snapshot,conversation.filter(turn=>turn.role==="user").map(turn=>({question:turn.content,phrase:interpretedAccountPhrase(turn.content)})));
    if (!resolved.reference) return recordAnalysis(runtime,[resolved.clarification!],snapshot,{inputTokens:0,outputTokens:0},["money"],null,[{domain:"money",purpose:"current_balance"}],question);
    const seed = deterministicAnalysisPlan("What is my checking balance?",today)!.requests[0];
    const request: AnalysisRequest = {...seed,entity:resolved.reference.accountName,accountGroup:null};
    const result = calculateFinancialAnalysis(snapshot,request,question,resolved.reference);
    const stable = await verifyAnalysisSnapshot(runtime.client,snapshot,["household_settings","accounts","plaid_accounts","bills"].filter(table=>snapshot.sources[table]?.complete));
    if (!stable) return recordAnalysis(runtime,[{text:"Your account records changed while I checked. Please ask again so I can use the latest balance.",facts:{},sources:result.sources,assumptions:[],missing:["Account records changed or could not be rechecked"],scenario:false}],snapshot,{inputTokens:0,outputTokens:0},["money"],null,[{domain:"money",purpose:"current_balance"}],question);
    return recordAnalysis(runtime,[result],snapshot,{inputTokens:0,outputTokens:0},["money"],null,[{domain:"money",purpose:"current_balance"}],question);
  }
  const interpretationStartedAt=performance.now();
  const candidate=deterministicAnalysisPlan(question,today,settings?.payment_method==="avalanche"?"avalanche":"snowball");
  const directPlan=!prior.length||candidate?.requests.every(r=>r.purpose==="bucket_details"||r.purpose==="account_inventory"||r.purpose==="current_balance")||isIncomeSourceInventoryQuestion(question)?candidate:null;
  const catalog=directPlan?{}:await loadAnalysisEntityCatalog(runtime.client,runtime.householdId);
  const interpret=(correction="")=>generateText({model:createOpenAI({apiKey:options.apiKey}).responses(options.modelId),output:Output.object({schema}),maxRetries:0,abortSignal:AbortSignal.timeout(interpretationAttemptMs(interpretationStartedAt,performance.now(),Boolean(correction))),providerOptions:{openai:{store:false,safetyIdentifier:options.safetyIdentifier,reasoningEffort:"low",textVerbosity:"low"}},
    system:analysisInterpreterPrompt({today,timeZone,debtMethod:settings?.payment_method??"snowball",correction}),prompt:JSON.stringify({question,conversation,availableRecordNames:catalog})});
  const usage={inputTokens:0,outputTokens:0};
  const plan=directPlan??await interpretAnalysisQuestion(question,async correction=>{
    const interpreted=await interpret(correction);
    usage.inputTokens+=interpreted.usage.inputTokens??0;usage.outputTokens+=interpreted.usage.outputTokens??0;
    try {return parseFinancialAnalysisPlan(interpreted.output);}
    catch {throw analysisInterpretationError(["schema_shape"]);}
  },today);
  if(plan.legacy) return null;
  if(!plan.requests.length) throw new Error("structured_output_invalid");
  if(settingsUnavailable && plan.requests.some(request=>requiresAnalysisSettings(request,question)))return recordAnalysis(runtime,[{text:"I can check recorded balances, but I need your household timezone and planning settings before calculating this dated plan. Please retry that check.",facts:{},sources:[],assumptions:[],missing:["Household planning settings could not be verified for the requested dated calculation"],scenario:false}],null,usage);
  const requestedSources=[...new Set(plan.requests.flatMap(analysisSourceDependencies))];
  const snapshot=await loadAnalysisSnapshot(runtime.client,runtime.householdId,runtime.now,requestedSources);
  const results:AnalysisResult[]=[];
  for(const request of plan.requests) {
    try {
      const calculationSnapshot=settingsUnavailable&&request.domain==="debt"&&!requiresAnalysisSettings(request,question)
        ? {...snapshot,sources:{...snapshot.sources,household_settings:{...snapshot.sources.household_settings,complete:false}}}
        : snapshot;
      results.push(requestedDebtCoverage(question,calculateFinancialAnalysis(calculationSnapshot,request,question)));
    }
    catch { results.push({text:"I could not complete the requested calculation safely. Check the requested dates and the forecast horizon.",facts:{},sources:projectionSources,assumptions:[],missing:["The requested calculation could not be verified"],scenario:Boolean(request.scenario)}); }
  }
  if(plan.requests.some(r=>r.purpose==="bucket_details"||r.domain==="review"||(r.purpose!=="account_inventory"&&projectionDomains.has(r.domain)&&!["bills","subscriptions","income"].includes(r.domain))||r.scenario)) {
    // Evidence labels are not a dependency graph: debt scenarios also consume
    // income, transactions and cash-flow inputs not listed in their prose.
    const stable=await verifyAnalysisSnapshot(runtime.client,snapshot,requestedSources.filter(table=>snapshot.sources[table]?.complete));
    if(!stable) return recordAnalysis(runtime,[{text:"Your plan changed while I was checking it. Ask again so I can calculate from the updated records.",facts:{},sources:projectionSources,assumptions:[],missing:["Financial records changed or could not be rechecked"],scenario:false}],snapshot,usage);
  }
  // Explanation is optional and shares the existing answer deadline. The
  // calculator's complete answer survives slow or malformed model synthesis.
  const explanationBudget=Math.min(5000,26000-(performance.now()-analysisStartedAt));
  const explanation=wantsAnalysisDetails(question)&&!directPlan&&explanationBudget>=1500?await explainFinancialAnalysis({question,conversation,results,apiKey:options.apiKey,modelId:options.modelId,safetyIdentifier:options.safetyIdentifier,timeoutMs:explanationBudget}):null;
  if(explanation){usage.inputTokens+=explanation.usage.inputTokens;usage.outputTokens+=explanation.usage.outputTokens;}
  return recordAnalysis(runtime,results,snapshot,usage,plan.requests.map(r=>r.domain),explanation,plan.requests,question);
}

async function recordAnalysis(runtime:FloToolRuntime,results:AnalysisResult[],snapshot:AnalysisSnapshot|null,usage:any,domains:string[]=[],explanation:{explanation:string;followups:string[]}|null=null,scopes:AnalysisAnswerScope[]=[],question="") {
  const sources:FloSourceRef[]=[];
  const payloads:FloToolEnvelope[]=[];
  for(const [index,result] of results.entries()) {
    const id=`financialAnalysis:${snapshot?.hash.slice(0,16)??"clarification"}:${index}`;
    const asOf=oldestSourceAsOf(result.sources.flatMap(table=>(snapshot?.sources[table]?.rows??[]).flatMap(r=>[r.updated_at,r.balance_as_of,r.observed_at,r.last_reviewed_at].filter(Boolean))));
    const domain=domains[index]??"forecast";
    const scope = scopes[index] ?? {domain:domain as AnalysisRequest["domain"]};
    const route = analysisSourceRoute(scope,result);
    const evidence:FloSourceRef={id,type:snapshot?domain:"help",label:!snapshot?"Clarification needed":result.scenario?"Read-only financial scenario":scope.purpose === "bucket_details" ? "Spending bucket details" : scope.purpose === "account_inventory" ? "Recorded accounts" : scope.purpose === "current_balance" ? "Recorded account balance" : `${domain[0].toUpperCase()+domain.slice(1)} calculation`,asOf,freshness:asOf?freshness(asOf):"unknown",route};
    const payload:FloToolEnvelope={status:result.missing.length?"partial":"ok",dataAsOf:asOf,coverage:{complete:!result.missing.length,returned:1,limit:1,...(result.missing.length?{reason:"analysis_data_incomplete",exclusions:result.missing}: {})},evidence:[evidence],records:[{id,...result.facts}],summary:{...(snapshot?{snapshotHash:snapshot.hash}:{}),assumptions:result.assumptions},message:result.text};
    runtime.toolNames.push("analyzeFinances");runtime.toolResultNames.push("analyzeFinances");runtime.toolResults.push(payload);
    await runtime.onToolResult?.("analyzeFinances",payload,{domainCount:results.length});
    sources.push(evidence);payloads.push(payload);
  }
  const presentation=presentFinancialAnalysis(results,scopes,question);
  const answer:FloGroundedAnswer={answer:presentation.answer,claims:[],caveat:presentation.caveat,evidenceIds:sources.map(s=>s.id),followups:[...new Set([...analysisTypedFollowups(results,scopes,question),...(explanation?.followups??[])])].slice(0,3)};
  return {answer,sources,aggregate:aggregateCoverage(payloads),usage};
}
