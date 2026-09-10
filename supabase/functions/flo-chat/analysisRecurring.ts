import { scheduleAnalysis } from "./analysisSchedule.ts";
import { analyticTransactions } from "./analysisSpending.ts";
import { dayAdd, dollars, label, matches, monthStart, numeric, requireSources, round, shiftMonth, sum, type AnalysisRequest, type AnalysisResult, type AnalysisSnapshot } from "./analysisTypes.ts";

/** Recurring-charge detection is evidence of a pattern, not proof of an active
 * subscription or a duplicate service. Never cancel or mutate from this read. */
export function recurringAnalysis(snapshot:AnalysisSnapshot,request:AnalysisRequest):AnalysisResult {
  const rows=(name:string)=>snapshot.sources[name]?.rows??[];
  const history=analyticTransactions(snapshot);
  if(request.domain==="bills"&&request.endDate&&request.endDate<snapshot.today) {
    const start=request.startDate??monthStart(request.endDate),end=request.endDate;
    const paid=rows("monthly_overrides").filter(r=>r.paid_date&&r.paid_date>=start&&r.paid_date<=end&&numeric(r.paid_amount)!>0).flatMap(r=>{const bill=rows("bills").find(b=>b.id===r.bill_id);return bill&&matches(bill.name,request.entity)?[{bill,paid_amount:Number(r.paid_amount),paid_date:String(r.paid_date)}]:[];});
    const missing=requireSources(snapshot,["monthly_overrides","bills"]);
    return {text:`${paid.length} monthly bill records have recorded payments in ${start}–${end}.\n\n${paid.slice(0,8).map(r=>`${label(r.bill.name)}: ${dollars(Number(r.paid_amount))}, payment date ${r.paid_date}.`).join("\n")}`,facts:{recordedPaymentCount:paid.length,recordedPayments:sum(paid.map(r=>Number(r.paid_amount)))},sources:["monthly_overrides","bills"],assumptions:["This reports reviewed monthly payment records; it does not claim every normal bill was paid or sum bank transactions a second time."],missing,scenario:false};
  }
  let scheduleRequest={...request};
  if(request.dateEvent==="after_bill")return {text:"For a balance after a bill, ask how much will remain after that named bill is paid. For a bill list, provide the end date to check.",facts:{},sources:["bills"],assumptions:[],missing:["A bill-list cutoff relative to another bill needs an explicit date"],scenario:false};
  if(request.dateEvent!=="none") {
    const payday=scheduleAnalysis(snapshot,{...request,domain:"income",entity:null,dateEvent:"next_payday"});
    const next=payday.facts.nextPayday;
    if(typeof next!=="string"||payday.missing.length)return payday;
    scheduleRequest={...request,dateEvent:"none",endDate:request.dateEvent==="before_payday"?dayAdd(next,-1):next};
  }
  const base=scheduleAnalysis(snapshot,scheduleRequest);
  if(base.missing.length)return base;
  if(!request.startDate||request.startDate===snapshot.today) {
    const overdueEnd=dayAdd(snapshot.today,-1);
    if(overdueEnd>=monthStart(snapshot.today)) {
      const overdue=scheduleAnalysis(snapshot,{...scheduleRequest,startDate:monthStart(snapshot.today),endDate:overdueEnd,dateEvent:"none"});
      const amount=overdue.facts.remainingObligations;
      if(typeof amount==="number"&&amount>0)base.text+=`\n\nAlso review ${dollars(amount)} still recorded unpaid from earlier this month. This is separate from the upcoming due-date total and may include payments awaiting review.`;
      if(overdue.missing.length)base.missing.push("Earlier-month unpaid obligations could not be fully checked");
    }
  }
  if(request.domain!=="subscriptions"&&request.operation!=="compare")return base;
  const groups=new Map<string,typeof history.rows>();
  for(const transaction of history.rows.filter(r=>r.kind==="spending"&&r.date>=shiftMonth(snapshot.today,-6)&&r.date<=snapshot.today)) {
    const key=transaction.merchant.toLowerCase().trim();if(!key||key==="unnamed record")continue;
    const group=groups.get(key)??[];group.push(transaction);groups.set(key,group);
  }
  const candidates=[];
  for(const [merchant,group] of groups) {
    const sorted=[...group].sort((a,b)=>a.date.localeCompare(b.date));
    if(sorted.length<3||!matches(merchant,request.entity??request.merchant))continue;
    const recent=sorted.slice(-4);
    const gaps=recent.slice(1).map((r,i)=>(Date.parse(r.date)-Date.parse(recent[i].date))/86400000);
    const cadence=gaps.every(n=>n>=26&&n<=35)?"monthly":gaps.every(n=>n>=6&&n<=8)?"weekly":null;
    if(!cadence)continue;
    const latest=-recent.at(-1)!.amount,prior=-recent.at(-2)!.amount;
    candidates.push({name:recent.at(-1)!.merchant,cadence,latest,prior,monthly:round(latest*(cadence==="weekly"?52/12:1)),date:recent.at(-1)!.date});
  }
  if(candidates.length) base.text+=`\n\nRecurring merchant patterns to review: ${candidates.slice(0,6).map(c=>`${c.name}: ${dollars(c.latest)} ${c.cadence}, last posted ${c.date}${c.latest>c.prior?`, up ${dollars(c.latest-c.prior)} from its previous charge`:""}`).join("; ")}.`;
  if(request.domain==="subscriptions") {
    const configured=rows("bills").filter(b=>!b.is_debt&&b.is_recurring&&(!b.end_date||b.end_date>=snapshot.today)&&(!b.start_date||b.start_date<=snapshot.today)&&/subscription|entertainment|stream|software/i.test(b.category??"")&&matches(b.name,request.entity));
    const valid=configured.filter(b=>numeric(b.amount)!==null);
    const cost=sum(valid.map(b=>round(Number(b.amount)*(b.frequency==="weekly"?52/12:b.frequency==="biweekly"?26/12:b.frequency==="quarterly"?1/3:1))));
    base.facts.configuredSubscriptionMonthlyCost=cost;
    base.text+=`\n\nConfigured subscription-category bills total about ${dollars(cost)}/month at their current rates. Canceling one would avoid its future charges only after the provider confirms cancellation; do not remove its next bill before then.`;
    if(valid.length!==configured.length)base.missing.push("A configured subscription amount is missing");
    const names=new Map<string,number>();configured.forEach(b=>names.set(String(b.name).trim().toLowerCase(),(names.get(String(b.name).trim().toLowerCase())??0)+1));
    const repeated=[...names].filter(([,count])=>count>1);
    if(repeated.length)base.text+=`\n\nRepeated configured names to review: ${repeated.map(([name,count])=>`${label(name)} (${count} records)`).join(", ")}. Matching names are not proof of duplicate services.`;
    base.assumptions.push("Merchant patterns are possible recurring charges, not confirmed subscriptions. They are not added to the configured subscription total, which avoids counting the same bill twice.");
  }
  base.sources=[...new Set([...base.sources,"transactions","plaid_transactions","plaid_accounts","goals"])];base.missing.push(...history.missing);
  return base;
}
