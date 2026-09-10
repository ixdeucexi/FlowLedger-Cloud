import { spendingAnalysis, analyticTransactions, aggregateSpending } from "./analysisSpending.ts";
import { stabilityAnalysis } from "./analysisStability.ts";
import { wealthAnalysis } from "./analysisWealth.ts";
import { dollars, monthStart, type AnalysisRequest, type AnalysisResult, type AnalysisSnapshot } from "./analysisTypes.ts";

/** Historical outcomes and today's outlook are separate scopes. Never infer
 * changes in debt principal or goal savings from gross payment totals. */
export function reviewAnalysis(snapshot:AnalysisSnapshot,request:AnalysisRequest):AnalysisResult {
  const past=spendingAnalysis(snapshot,request);
  const end=request.endDate&&request.endDate<snapshot.today?request.endDate:snapshot.today;
  const start=request.startDate??monthStart(end);
  const posted=aggregateSpending(analyticTransactions(snapshot).rows,start,end);
  const bills=posted.rows.filter(r=>r.billId&&(r.kind==="spending"||r.kind==="repayment")&&r.amount<0);
  if(bills.length)past.text+=`\n\nRecorded bill-linked payments: ${bills.slice(0,5).map(r=>`${r.date}: ${r.merchant}, ${dollars(-r.amount)}`).join("; ")}. This is posted activity, not confirmation all scheduled bills settled.`;
  const sections=[past];
  try {
    const current=stabilityAnalysis(snapshot,{...request,domain:"health",operation:"summary",startDate:null,endDate:null,comparisonStart:null,comparisonEnd:null,entity:null,amount:null});
    current.text=`Current outlook (separate from the historical review):\n\n${current.text}`;
    sections.push(current);
  } catch {
    sections.push({text:"The current cash-flow outlook could not be verified. Refresh balances and review planned obligations before deciding what to spend.",facts:{},sources:[],assumptions:[],missing:["Current forecast inputs are incomplete"],scenario:false});
  }
  const budget=wealthAnalysis(snapshot,{...request,domain:"budget",operation:"summary",startDate:start,endDate:end,entity:null,amount:null});
  if(budget.text)sections.push(budget);
  const facts:AnalysisResult["facts"]={};
  sections.forEach((s,index)=>Object.entries(s.facts).forEach(([k,v])=>{facts[`${index===0?"review":"current"}_${k}`]=v;}));
  return {text:sections.map(s=>s.text).join("\n\n"),facts,sources:[...new Set(sections.flatMap(s=>s.sources))],missing:[...new Set(sections.flatMap(s=>s.missing))],assumptions:[...new Set([...sections.flatMap(s=>s.assumptions),"Debt-principal and savings changes require historical balance observations; payment totals are not substituted for those changes."])],scenario:false};
}
