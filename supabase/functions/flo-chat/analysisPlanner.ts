import { z } from "npm:zod@4.4.3";
import { generateText, Output } from "npm:ai@7.0.59";
import { createOpenAI } from "npm:@ai-sdk/openai@4.0.37";
import { loadAnalysisSnapshot, verifyAnalysisSnapshot } from "./analysisSnapshot.ts";
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
import { analysisInterpreterPrompt, interpretAnalysisQuestion, isTimelinePurpose, validateRequestSemantics } from "./analysisSemantics.ts";

const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const search=z.string().max(100).nullable();
const requestSchema=z.object({
  purpose:z.enum(["general","current_balance","forecast_balance","affordability","buffer_timeline","goal_timeline","debt_timeline"]),
  amountRole:z.enum(["none","target_balance","contribution_amount","payment_amount","purchase_amount","threshold"]),
  contribution:z.object({amount:z.number().positive().max(1e9),frequency:z.enum(["once","monthly","paycheck"])}).nullable().describe("Only a separately stated savings contribution and its explicit frequency; never derive from target amount."),
  domain:z.enum(["money","forecast","purchase","spending","bills","subscriptions","income","debt","credit","savings","emergency","budget","stability","buffer","paycheck","progress","transactions","unusual","fees","health","review"]),
  operation:z.enum(["summary","detail","compare","minimum","maximum","threshold","plan","scenario","search","average"]).describe("Raw current account-balance questions use money/detail (including named savings accounts); safe-to-spend uses money/summary. Future balances use forecast. Goal funding uses savings, not raw money. Only exact account names go in entity; generic checking/cash group leaves entity null."),
  groupBy:z.enum(["category","merchant","none"]),incomeTiming:z.enum(["received","expected"]),
  startDate:date.describe("Explicit requested start in household local calendar, otherwise null. Resolve this week/weekend/year and relative periods; do not default every question to this month."),
  endDate:date.describe("Requested end/date, otherwise null. Resolve next Friday, first of next month and days/weeks from now against the supplied local today."),
  dateEvent:z.enum(["none","next_payday","before_payday","after_payday","after_bill"]),
  merchant:search,category:search,entity:search.describe("Named bill/debt/goal/account, exactly as the user names it; never invent a record name."),
  amount:z.number().min(0).max(1e9).nullable().describe("Only an explicit user-provided currency amount/threshold, not a computed number or an example amount."),
  comparisonStart:date,comparisonEnd:date,
  target:z.enum(["none","paycheck_ahead","month_ahead","three_months","six_months"]),
  debtMethod:z.enum(["snowball","avalanche"]),
  scenario:z.object({kind:z.enum(["purchase","income_change","extra_debt","save","bill_increase","cancel_bill","move_bill"]),amount:z.number().min(-1e9).max(1e9),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),sourceDate:date.describe("For moving a bill, original occurrence date if specified; destination is date. Otherwise null selects the next unpaid occurrence."),entity:search,repeat:z.enum(["once","monthly","paycheck"])}).nullable().describe("Explicit what-if only, never a request to mutate data. income_change is signed (paycheck lower by 200 => -200). Other amounts are spending/contribution magnitudes. Use the user's stated frequency; default once."),
});
const schema=z.object({legacy:z.boolean().describe("True only for app navigation/how-to, saved-plan retrieval, connection help, explicit real-data change requests, or unrelated questions. Actual financial analysis is false."),requests:z.array(requestSchema).max(4)});

export function validateAnalysisRequest(request: AnalysisRequest, today: string): string | null {
  const semanticError=validateRequestSemantics(request);if(semanticError)return semanticError;
  for(const value of [request.startDate,request.endDate,request.comparisonStart,request.comparisonEnd,request.scenario?.date,request.scenario?.sourceDate]) if(value!==null&&value!==undefined&&!validDate(value)) return "The requested calendar date is invalid.";
  if(request.startDate&&request.endDate&&request.startDate>request.endDate) return "The start date is after the end date.";
  if(request.comparisonStart&&request.comparisonEnd&&request.comparisonStart>request.comparisonEnd) return "The comparison start date is after its end date.";
  if(request.scenario&&request.scenario.date<today) return "What-if changes must start today or later; historical records are not changed.";
  if(request.scenario&&request.endDate&&request.scenario.date>request.endDate) return "The scenario starts after the requested forecast window.";
  if(request.scenario&&request.scenario.kind!=="income_change"&&request.scenario.amount<0) return "Use a positive spending or contribution amount.";
  return null;
}

const projectionDomains=new Set(["money","forecast","purchase","bills","subscriptions","income","stability","buffer","paycheck","progress","health"]);
export function calculateFinancialAnalysis(snapshot: AnalysisSnapshot, request: AnalysisRequest): AnalysisResult {
  const invalid=validateAnalysisRequest(request,snapshot.today);
  if(invalid) return {text:invalid,facts:isTimelinePurpose(request)?{timelineOutcome:"not_estimable"}:{},sources:[],assumptions:[],missing:[invalid],scenario:Boolean(request.scenario)};
  if(request.purpose==="debt_timeline"&&request.entity)return {text:"I cannot yet establish an individual payoff date for that named debt. The available payoff date covers the whole included debt plan, so I will not present it as this debt's date.",facts:{timelineOutcome:"not_estimable"},sources:[],assumptions:[],missing:["Named-debt payoff timing is not available from the whole-plan result"],scenario:Boolean(request.scenario)};
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
      const date=result.facts.scenarioDebtFreeMonth;
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
export async function runFinancialAnalysis(options:{runtime:FloToolRuntime;question:string;apiKey:string;modelId:string;safetyIdentifier:string;conversationId?:string;historyEnabled?:boolean}) {
  const {runtime,question}=options;
  const {data:settings,error}=await runtime.client.from("household_settings").select("time_zone,payment_method").eq("household_id",runtime.householdId).maybeSingle();
  let timeZone=settings?.time_zone??"UTC";
  try { localDay(runtime.now,timeZone); } catch {timeZone="UTC";}
  const today=localDay(runtime.now,timeZone);
  const {data:priorRows}=options.historyEnabled&&options.conversationId?await runtime.client.from("flo_messages").select("content").eq("conversation_id",options.conversationId).eq("role","user").eq("status","completed").order("created_at",{ascending:false}).limit(4):{data:[]};
  const prior=(priorRows??[]).map((r:any)=>String(r.content).slice(0,800)).filter((q:string)=>q!==question).reverse();
  const interpret=(correction="")=>generateText({model:createOpenAI({apiKey:options.apiKey}).responses(options.modelId),output:Output.object({schema}),maxRetries:0,abortSignal:AbortSignal.timeout(correction?8000:12000),providerOptions:{openai:{store:false,safetyIdentifier:options.safetyIdentifier,reasoningEffort:"low",textVerbosity:"low"}},
    system:analysisInterpreterPrompt({today,timeZone,debtMethod:settings?.payment_method??"snowball",correction}),prompt:JSON.stringify({question,priorQuestions:prior})});
  const usage={inputTokens:0,outputTokens:0};
  const plan=await interpretAnalysisQuestion(question,async correction=>{
    const interpreted=await interpret(correction);
    usage.inputTokens+=interpreted.usage.inputTokens??0;usage.outputTokens+=interpreted.usage.outputTokens??0;
    return schema.parse(interpreted.output);
  });
  if(plan.legacy) return null;
  if(!plan.requests.length) throw new Error("structured_output_invalid");
  const snapshot=await loadAnalysisSnapshot(runtime.client,runtime.householdId,runtime.now);
  const results:AnalysisResult[]=[];
  for(const request of plan.requests) {
    try { results.push(calculateFinancialAnalysis(snapshot,request)); }
    catch { results.push({text:"I could not complete the requested calculation safely. Check the requested dates and the forecast horizon.",facts:{},sources:projectionSources,assumptions:[],missing:["The requested calculation could not be verified"],scenario:Boolean(request.scenario)}); }
  }
  if(plan.requests.some(r=>r.domain==="review"||(projectionDomains.has(r.domain)&&!["bills","subscriptions","income"].includes(r.domain))||r.scenario)) {
    const stable=await verifyAnalysisSnapshot(runtime.client,snapshot,projectionSources);
    if(!stable) return recordAnalysis(runtime,[{text:"Your plan changed while I was checking it. Ask again so I can calculate from the updated records.",facts:{},sources:projectionSources,assumptions:[],missing:["Financial records changed or could not be rechecked"],scenario:false}],snapshot,usage);
  }
  return recordAnalysis(runtime,results,snapshot,usage,plan.requests.map(r=>r.domain));
}

async function recordAnalysis(runtime:FloToolRuntime,results:AnalysisResult[],snapshot:AnalysisSnapshot,usage:any,domains:string[]=[]) {
  const sources:FloSourceRef[]=[];
  const payloads:FloToolEnvelope[]=[];
  for(const [index,result] of results.entries()) {
    const id=`financialAnalysis:${snapshot.hash.slice(0,16)}:${index}`;
    const asOf=oldestSourceAsOf(result.sources.flatMap(table=>(snapshot.sources[table]?.rows??[]).flatMap(r=>[r.updated_at,r.balance_as_of,r.observed_at,r.last_reviewed_at].filter(Boolean))));
    const domain=domains[index]??"forecast";
    const route=["spending","transactions","unusual","fees","review"].includes(domain)?"/(tabs)/transactions":["bills","subscriptions","credit"].includes(domain)?"/(tabs)/bills":domain==="debt"?"/snowball-plan":["savings","emergency"].includes(domain)?"/(tabs)/more?section=goals":domain==="income"?"/(tabs)/more?section=money":domain==="budget"?"/(tabs)/category-budget":"/(tabs)/monthly";
    const evidence:FloSourceRef={id,type:domain,label:result.scenario?"Read-only financial scenario":`${domain[0].toUpperCase()+domain.slice(1)} calculation`,asOf,freshness:asOf?freshness(asOf):"unknown",route};
    const payload:FloToolEnvelope={status:result.missing.length?"partial":"ok",dataAsOf:asOf,coverage:{complete:!result.missing.length,returned:1,limit:1,...(result.missing.length?{reason:"analysis_data_incomplete",exclusions:result.missing}: {})},evidence:[evidence],records:[{id,...result.facts}],summary:{snapshotHash:snapshot.hash,assumptions:result.assumptions},message:result.text};
    runtime.toolNames.push("analyzeFinances");runtime.toolResultNames.push("analyzeFinances");runtime.toolResults.push(payload);
    await runtime.onToolResult?.("analyzeFinances",payload,{domainCount:results.length});
    sources.push(evidence);payloads.push(payload);
  }
  const missing=[...new Set(results.flatMap(r=>r.missing))];
  const assumptions=[...new Set(results.flatMap(r=>r.assumptions))];
  const text=[...results.map(r=>r.text),...(missing.length?[`What I could not verify: ${missing.join("; ")}.`]:[]),...(assumptions.length?[`Assumptions: ${assumptions.join(" ")}`]:[])].join("\n\n");
  // The model's output never enters this answer. Only calculator-owned text and
  // bounded record labels are rendered; tool receipts retain all numeric facts.
  const answer:FloGroundedAnswer={answer:text,claims:[],caveat:missing.length?missing.join("; "):null,evidenceIds:sources.map(s=>s.id),followups:[]};
  return {answer,sources,aggregate:aggregateCoverage(payloads),usage};
}
