import { financialAnalysisProviderSchema as schema, parseFinancialAnalysisPlan } from "./analysisSchema.ts";
import { generateText, Output } from "npm:ai@7.0.59";
import { createOpenAI } from "npm:@ai-sdk/openai@4.0.37";
import { analysisSourceDependencies, loadAnalysisSnapshot, verifyAnalysisSnapshot } from "./analysisSnapshot.ts";
import { loadAnalysisConversation, loadAnalysisEntityCatalog } from "./analysisContext.ts";
import { explainFinancialAnalysis } from "./analysisExplanation.ts";
import { forecastAnalysis, projectionInput, projectionSources } from "./analysisProjection.ts";
import { spendingAnalysis } from "./analysisSpending.ts";
import { wealthAnalysis } from "./analysisWealth.ts";
import { scenarioAnalysis, stabilityAnalysis } from "./analysisStability.ts";
import { recurringAnalysis } from "./analysisRecurring.ts";
import { scheduleAnalysis } from "./analysisSchedule.ts";
import { reviewAnalysis } from "./analysisReview.ts";
import { currentBalanceAnalysis } from "./analysisAccounts.ts";
import { localDay, validDate, type AnalysisRequest, type AnalysisResult, type AnalysisSnapshot } from "./analysisTypes.ts";
import { aggregateCoverage, freshness, oldestSourceAsOf, type FloGroundedAnswer, type FloToolEnvelope, type FloSourceRef } from "./contract.ts";
import type { FloToolRuntime } from "./tools.ts";
import { analysisInterpreterPrompt, analysisInterpretationError, deterministicAnalysisPlan, explicitUnsupportedForecastScope, interpretAnalysisQuestion, interpretationAttemptMs, isTimelinePurpose, isWholeDebtTotalQuestion, unresolvedContributionClarification, validateRequestSemantics } from "./analysisSemantics.ts";
import { guidanceAnalysis, isGuidancePurpose } from "./analysisGuidance.ts";
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

const projectionDomains=new Set(["money","forecast","purchase","bills","subscriptions","income","stability","buffer","paycheck","progress","health"]);
export function calculateFinancialAnalysis(snapshot: AnalysisSnapshot, request: AnalysisRequest): AnalysisResult {
  const invalid=validateAnalysisRequest(request,snapshot.today);
  if(invalid) return {text:invalid,facts:isTimelinePurpose(request)?{timelineOutcome:"not_estimable"}:{},sources:[],assumptions:[],missing:[invalid],scenario:Boolean(request.scenario)};
  if(isGuidancePurpose(request.purpose))return guidanceAnalysis(snapshot,request);
  if(request.purpose==="balance_history")return historyAnalysis(snapshot,request);
  if(request.domain==="money"&&request.operation==="detail"&&!request.scenario&&request.dateEvent==="none")return currentBalanceAnalysis(snapshot,request);
  const historicalBills=request.domain==="bills"&&request.endDate!==null&&request.endDate<snapshot.today;
  const receivedIncome=request.domain==="income"&&request.incomeTiming==="received";
  const scheduleOnly=["bills","subscriptions","income"].includes(request.domain)&&!request.scenario;
  if((projectionDomains.has(request.domain)&&!historicalBills&&!receivedIncome&&!scheduleOnly)||request.scenario) {
    const missing=projectionInput(snapshot).missing;
    if(missing.length) return {text:isTimelinePurpose(request)?"I cannot estimate when you will reach that target yet: the current plan or balance cannot be verified.":"I cannot reliably calculate that projection from the available records yet.",facts:isTimelinePurpose(request)?{timelineOutcome:"not_estimable"}:{},sources:projectionSources,assumptions:[],missing,scenario:Boolean(request.scenario)};
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
  const {data:settings,error}=await runtime.client.from("household_settings").select("time_zone,payment_method").eq("household_id",runtime.householdId).maybeSingle();
  if(error)return recordAnalysis(runtime,[{text:"I could not verify your household's planning settings. Please retry before I calculate dates or choose a payoff method; I will not assume a different timezone or debt method.",facts:{},sources:[],assumptions:[],missing:["Household planning settings could not be verified"],scenario:false}],null,{inputTokens:0,outputTokens:0});
  let timeZone=settings?.time_zone??"UTC";
  try { localDay(runtime.now,timeZone); } catch {timeZone="UTC";}
  const today=localDay(runtime.now,timeZone);
  let conversation;
  try {conversation=await loadAnalysisConversation({client:runtime.client,householdId:runtime.householdId,conversationId:options.conversationId,historyEnabled:options.historyEnabled,userMessageId:options.userMessageId,transientContext:options.transientContext});}
  catch {return recordAnalysis(runtime,[{text:"I could not retrieve this conversation's context. Please retry or repeat the full question, including the account, goal or payoff method you mean, so I do not assume a different scope.",facts:{},sources:[],assumptions:[],missing:["Conversation context could not be verified"],scenario:false}],null,{inputTokens:0,outputTokens:0});}
  const prior=conversation.filter(turn=>turn.role==="user").map(turn=>turn.content);
  const unsupportedForecastScope=explicitUnsupportedForecastScope(question);
  if(unsupportedForecastScope)return recordAnalysis(runtime,[{
    text:`I cannot reliably project ${unsupportedForecastScope==="savings"?"your savings balance":"the combined balance of all your accounts"} yet. The forecast tracks household checking cash flow, but it does not have the account-by-account future allocations needed for this question. I can show your recorded balances or project your household checking cash flow instead.`,
    facts:{forecastScope:unsupportedForecastScope},sources:[],assumptions:[],missing:["Future income, transfers and payments allocated to each requested account"],scenario:false,
  }],null,{inputTokens:0,outputTokens:0});
  const clarification=unresolvedContributionClarification(question,prior);
  if(clarification)return recordAnalysis(runtime,[clarification],null,{inputTokens:0,outputTokens:0});
  const interpretationStartedAt=performance.now();
  const candidate=deterministicAnalysisPlan(question,today,settings?.payment_method==="avalanche"?"avalanche":"snowball");
  const directPlan=!prior.length||candidate?.requests.every(r=>r.purpose==="current_balance"&&r.accountGroup)?candidate:null;
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
  const requestedSources=[...new Set(plan.requests.flatMap(analysisSourceDependencies))];
  const snapshot=await loadAnalysisSnapshot(runtime.client,runtime.householdId,runtime.now,requestedSources);
  const results:AnalysisResult[]=[];
  for(const request of plan.requests) {
    try { results.push(requestedDebtCoverage(question,calculateFinancialAnalysis(snapshot,request))); }
    catch { results.push({text:"I could not complete the requested calculation safely. Check the requested dates and the forecast horizon.",facts:{},sources:projectionSources,assumptions:[],missing:["The requested calculation could not be verified"],scenario:Boolean(request.scenario)}); }
  }
  if(plan.requests.some(r=>r.domain==="review"||(projectionDomains.has(r.domain)&&!["bills","subscriptions","income"].includes(r.domain))||r.scenario)) {
    // Evidence labels are not a dependency graph: debt scenarios also consume
    // income, transactions and cash-flow inputs not listed in their prose.
    const stable=await verifyAnalysisSnapshot(runtime.client,snapshot,requestedSources.filter(table=>snapshot.sources[table]?.complete));
    if(!stable) return recordAnalysis(runtime,[{text:"Your plan changed while I was checking it. Ask again so I can calculate from the updated records.",facts:{},sources:projectionSources,assumptions:[],missing:["Financial records changed or could not be rechecked"],scenario:false}],snapshot,usage);
  }
  // Explanation is optional and shares the existing answer deadline. The
  // calculator's complete answer survives slow or malformed model synthesis.
  const explanationBudget=Math.min(5000,26000-(performance.now()-analysisStartedAt));
  const explanation=!directPlan&&explanationBudget>=1500?await explainFinancialAnalysis({question,conversation,results,apiKey:options.apiKey,modelId:options.modelId,safetyIdentifier:options.safetyIdentifier,timeoutMs:explanationBudget}):null;
  if(explanation){usage.inputTokens+=explanation.usage.inputTokens;usage.outputTokens+=explanation.usage.outputTokens;}
  return recordAnalysis(runtime,results,snapshot,usage,plan.requests.map(r=>r.domain),explanation);
}

async function recordAnalysis(runtime:FloToolRuntime,results:AnalysisResult[],snapshot:AnalysisSnapshot|null,usage:any,domains:string[]=[],explanation:{explanation:string;followups:string[]}|null=null) {
  const sources:FloSourceRef[]=[];
  const payloads:FloToolEnvelope[]=[];
  for(const [index,result] of results.entries()) {
    const id=`financialAnalysis:${snapshot?.hash.slice(0,16)??"clarification"}:${index}`;
    const asOf=oldestSourceAsOf(result.sources.flatMap(table=>(snapshot?.sources[table]?.rows??[]).flatMap(r=>[r.updated_at,r.balance_as_of,r.observed_at,r.last_reviewed_at].filter(Boolean))));
    const domain=domains[index]??"forecast";
    const route=["spending","transactions","unusual","fees","review"].includes(domain)?"/(tabs)/transactions":["bills","subscriptions","credit"].includes(domain)?"/(tabs)/bills":domain==="debt"?"/snowball-plan":["savings","emergency"].includes(domain)?"/(tabs)/more?section=goals":domain==="income"?"/(tabs)/more?section=money":domain==="budget"?"/(tabs)/category-budget":"/(tabs)/monthly";
    const evidence:FloSourceRef={id,type:snapshot?domain:"help",label:!snapshot?"Clarification needed":result.scenario?"Read-only financial scenario":`${domain[0].toUpperCase()+domain.slice(1)} calculation`,asOf,freshness:asOf?freshness(asOf):"unknown",route};
    const payload:FloToolEnvelope={status:result.missing.length?"partial":"ok",dataAsOf:asOf,coverage:{complete:!result.missing.length,returned:1,limit:1,...(result.missing.length?{reason:"analysis_data_incomplete",exclusions:result.missing}: {})},evidence:[evidence],records:[{id,...result.facts}],summary:{...(snapshot?{snapshotHash:snapshot.hash}:{}),assumptions:result.assumptions},message:result.text};
    runtime.toolNames.push("analyzeFinances");runtime.toolResultNames.push("analyzeFinances");runtime.toolResults.push(payload);
    await runtime.onToolResult?.("analyzeFinances",payload,{domainCount:results.length});
    sources.push(evidence);payloads.push(payload);
  }
  const missing=[...new Set(results.flatMap(r=>r.missing))];
  const assumptions=[...new Set(results.flatMap(r=>r.assumptions))];
  const text=distinctAnalysisParagraphs([...results.map(r=>r.text),...(missing.length?[`What I could not verify: ${missing.join("; ")}.`]:[]),...(assumptions.length?[`Assumptions: ${assumptions.join(" ")}`]:[]),...(explanation?.explanation?[explanation.explanation]:[])]).join("\n\n");
  // The model's output never enters this answer. Only calculator-owned text and
  // bounded record labels are rendered; tool receipts retain all numeric facts.
  const answer:FloGroundedAnswer={answer:text,claims:[],caveat:missing.length?missing.join("; "):null,evidenceIds:sources.map(s=>s.id),followups:explanation?.followups??[]};
  return {answer,sources,aggregate:aggregateCoverage(payloads),usage};
}
