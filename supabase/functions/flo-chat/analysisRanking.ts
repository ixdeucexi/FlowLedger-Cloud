import { canonicalConnectedAccounts } from "../../../artifacts/mobile/lib/plaidActivity.ts";
import { dollars, label, numeric, requireSources, round, type AnalysisRequest, type AnalysisResult, type AnalysisSnapshot } from "./analysisTypes.ts";

/** Rank the complete scoped set, never a truncated display list. */
export function rankCreditOrDebt(snapshot:AnalysisSnapshot,request:AnalysisRequest & {metric?:string|null}):AnalysisResult {
  const credit=request.domain==="credit",sources=[credit?"plaid_accounts":"bills"];
  const missing=requireSources(snapshot,sources);
  const metric=request.metric;
  if(!metric||!["balance","apr",...(credit?["utilization"]:[])].includes(metric))return {text:"Should I compare balances, APRs, or credit-card utilization?",facts:{},sources,missing:["A supported comparison metric is required"],assumptions:[],scenario:false};
  const rows=credit?canonicalConnectedAccounts((snapshot.sources.plaid_accounts?.rows??[]).map(r=>({...r,id:String(r.id),is_active:r.is_active!==false}))).filter((r:any)=>r.account_type==="credit"):(snapshot.sources.bills?.rows??[]).filter(r=>r.is_debt&&(!r.end_date||r.end_date>=snapshot.today)&&(numeric(r.balance)===null||numeric(r.balance)!>0));
  const selected=rows.filter((r:any)=>!request.entity||String(r.display_name??r.name).trim().toLowerCase()===request.entity.trim().toLowerCase());
  const uncertainEligibility=!credit&&selected.some((r:any)=>numeric(r.balance)===null);
  if(uncertainEligibility)missing.push("Some debt balances are unavailable, so active positive-balance eligibility cannot be verified; known metrics from those candidates remain included");
  const values=selected.map((r:any)=>{
    const balance=numeric(credit?r.current_balance:r.balance),apr=numeric(credit?r.purchase_apr:r.interest_rate),limit=numeric(r.credit_limit);
    const value=metric==="balance"?balance:metric==="apr"?apr:balance!==null&&limit!==null&&limit>0?Math.max(0,balance)/limit*100:null;
    return {name:label(r.display_name??r.name),value};
  }).filter(r=>r.value!==null&&Number.isFinite(r.value)&&r.value>=0) as {name:string;value:number}[];
  if(values.length!==selected.length)missing.push(`Some ${metric} values are unavailable; this ranking covers verified values only`);
  if(!values.length)return {text:`No matching ${credit?"connected cards":"active debts"} have a verified ${metric} to compare.`,facts:{},sources,missing:[...missing,"No comparable records"],assumptions:[],scenario:false};
  const best=(request.operation==="minimum"?Math.min:Math.max)(...values.map(r=>r.value));
  const tied=values.filter(r=>Math.abs(r.value-best)<1e-9);
  return {text:`${tied.map(r=>r.name).join(", ")} ${tied.length===1?"has":"tie for"} the ${request.operation==="minimum"?"lowest":"highest"} ${metric} among ${values.length} checked ${credit?"connected cards":uncertainEligibility?"debt candidates (some balances unverified)":"active debts"}: ${metric==="balance"?dollars(best):`${round(best)}%`}.${missing.length?" Some records or their eligibility could not be fully verified; this is not a complete-account ranking.":""}`,facts:{rankedNames:tied.map(r=>r.name).join(", "),rankedValue:round(best),rankedCount:values.length,metric},sources,missing,assumptions:["Ranks recorded values, not live statement data. Ties are retained; credit limits are required only for utilization. A ranking alone does not establish which payment is affordable."],scenario:false};
}
