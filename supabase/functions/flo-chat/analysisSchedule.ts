import { getIncomeOccurrenceDays, getEffectiveIncomeAmount } from "../../../artifacts/mobile/lib/schedule.ts";
import { createFinancialProjection } from "../../../artifacts/mobile/lib/financialProjection.ts";
import { normalizeSettingsRow, normalizeBillRow, normalizeMonthlyOverrideRow, normalizeBillDateMoveRow, normalizeTransactionRow } from "../../../artifacts/mobile/lib/financialProjectionInput.ts";
import { resolveDebtOccurrenceSettlement } from "../../../artifacts/mobile/lib/debtPlanDomain.ts";
import { occurrenceKey } from "../../../artifacts/mobile/lib/reviewCenter.ts";
import { dayAdd, dollars, label, monthEnd, monthStart, requireSources, round, shiftMonth, sum, validDate, type AnalysisRequest, type AnalysisResult, type AnalysisSnapshot } from "./analysisTypes.ts";

const money = (v: unknown): number | null => (typeof v === "number" || typeof v === "string" && /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(v.trim())) && Number.isFinite(Number(v)) ? Number(v) : null;
const exact = (name: unknown, query: string | null) => !query || String(name ?? "").trim().toLowerCase() === query.trim().toLowerCase();
const dateOf = (month: string, day: number) => `${month.slice(0,7)}-${String(day).padStart(2,"0")}`;
const unavailable = (sources: string[], missing: string[]): AnalysisResult => ({text:"I cannot reliably resolve that schedule from the available records.", facts:{}, sources, assumptions:[], missing:[...new Set(missing)], scenario:false});

/** Schedule-only reads deliberately never request a balance, APR, goals or a cash-flow forecast. */
export function scheduleAnalysis(snapshot: AnalysisSnapshot, request: AnalysisRequest): AnalysisResult {
  const incomeQuestion = request.domain === "income";
  const sources = incomeQuestion ? ["incomes"] : ["bills","monthly_overrides","bill_date_moves","transactions"];
  const missing = requireSources(snapshot,sources);
  const rows = (table: string) => snapshot.sources[table]?.rows ?? [];
  const start = request.startDate ?? snapshot.today;
  const end = request.endDate ?? (request.dateEvent !== "none" ? monthEnd(shiftMonth(start,11)) : monthEnd(start));
  if (!validDate(start) || !validDate(end) || end < start || end > monthEnd(shiftMonth(start,23))) return unavailable(sources,["Choose a valid schedule window of at most 24 months"]);
  if (!validDate(snapshot.today) || !Number.isFinite(Date.parse(snapshot.capturedAt))) return unavailable(sources,["The schedule clock is unavailable"]);
  if (request.dateEvent !== "none" && !incomeQuestion) return unavailable(sources,["Event-relative balance questions require a forecast"]);
  const selected = rows(incomeQuestion ? "incomes" : "bills").filter(row=>exact(row.name,request.entity));
  if (request.entity && selected.length !== 1) missing.push("Use the full name of exactly one recorded source");
  for (const row of selected) {
    if (money(row.amount) === null || Number(row.amount) < 0) missing.push("A scheduled amount is unavailable");
    if (!row.id || typeof row.name !== "string") missing.push("A scheduled source identity is unavailable");
    if (!["monthly","weekly","biweekly",...(!incomeQuestion ? ["quarterly"] : [])].includes(row.frequency)) missing.push("A schedule frequency is unavailable");
    for (const field of ["start_date","end_date","next_payment_date"]) if (row[field] != null && !validDate(row[field])) missing.push("A schedule anchor is invalid");
  }
  if (incomeQuestion) {
    for (const row of selected) {
      if (!validDate(row.start_date ?? row.next_payment_date)) missing.push("An income recurrence anchor is required");
      if (row.frequency !== "monthly" && !validDate(row.next_payment_date)) missing.push("A weekly or biweekly income payment anchor is required");
      if (!Array.isArray(row.amount_history ?? []) || (row.amount_history ?? []).some((r: any)=>money(r?.amount) === null || !validDate(r?.effective_from))) missing.push("An income amount history entry is invalid");
      if (!Array.isArray(row.excluded_dates ?? []) || (row.excluded_dates ?? []).some((date: any)=>!validDate(date))) missing.push("An income exclusion date is invalid");
    }
    if (missing.length) return unavailable(sources,missing);
    const events: {date:string;name:string;amount:number}[]=[];
    for (let month=monthStart(start);month<=end;month=shiftMonth(month,1)) for (const row of selected) {
      const income={...row,amount:Number(row.amount),amount_history:(row.amount_history??[]).map((r:any)=>({...r,amount:Number(r.amount)}))} as any;
      const m=Number(month.slice(5,7))-1,y=Number(month.slice(0,4));
      const amount=getEffectiveIncomeAmount(income,m,y);
      getIncomeOccurrenceDays(income,m,y).forEach(day=>{const date=dateOf(month,day);if(date>=start&&date<=end)events.push({date,name:row.name,amount});});
    }
    events.sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name));
    const next = events.find(e=>e.date>=snapshot.today && e.amount > 0);
    if (request.dateEvent !== "none") {
      if (!next) return unavailable(sources,["No matching upcoming paycheck is scheduled within this window"]);
      if (request.dateEvent === "after_bill") return unavailable(sources,["A bill-relative balance needs a forecast"]);
      const amount=sum(events.filter(e=>e.date===next.date).map(e=>e.amount));
      const target=request.dateEvent === "before_payday" ? dayAdd(next.date,-1) : next.date;
      return {text:`Your next expected ${request.entity ? label(request.entity) : "income"} date is ${next.date}, totaling ${dollars(amount)}. ${request.dateEvent === "before_payday" ? `The day before is ${target}. ` : ""}This is scheduled income, not confirmation of receipt or bank posting.`,facts:{nextPayday:next.date,expectedIncome:amount,targetDate:target},sources,assumptions:["Expected dates use recorded recurrence, amount history and excluded dates. No account balance or affordability is inferred."],missing:[],scenario:false};
    }
    const total=sum(events.map(e=>e.amount));
    return {text:[`${dollars(total)} of scheduled income across ${events.length} payment occurrences from ${start} through ${end}${request.entity ? ` for ${label(request.entity)}` : ""}.`,...events.slice(0,12).map(e=>`${e.date}: ${label(e.name)} — ${dollars(e.amount)}.`),events.length>12 ? "Showing the first 12 occurrences; totals include the full window." : ""].filter(Boolean).join("\n\n"),facts:{expectedIncome:total,expectedPaymentCount:events.length,averageExpectedPayment:events.length?round(total/events.length):null,nextPayday:next?.date??null,startDate:start,endDate:end},sources,assumptions:["These are scheduled amounts, including historical schedules when requested, not proof of received income. Recorded history and excluded dates control the schedule."],missing:[],scenario:false};
  }

  const ids=new Set(selected.map(r=>r.id));
  const overrides=rows("monthly_overrides").filter(r=>ids.has(r.bill_id));
  const moves=rows("bill_date_moves").filter(r=>ids.has(r.bill_id));
  // Only selected-bill payment allocations can affect these answers. Unknown
  // unrelated transactions must not block a bill's recurrence-only schedule.
  const transactions=rows("transactions").filter(r=>!r.deleted_at&&!r.pending&&!r.removed_at&&(ids.has(r.linked_bill_id)||(Array.isArray(r.review_allocations)&&r.review_allocations.some((a:any)=>ids.has(a?.targetId)))));
  for(const bill of selected) {
    if(typeof bill.is_debt!=="boolean"||typeof bill.is_recurring!=="boolean"||!Number.isInteger(money(bill.due_day))||bill.due_day<1||bill.due_day>31) missing.push("A bill recurrence or classification is invalid");
    if(["weekly","biweekly"].includes(bill.frequency)&&(!Number.isInteger(money(bill.day_of_week))||bill.day_of_week<0||bill.day_of_week>6)) missing.push("A weekly bill weekday is unavailable");
  }
  for(const row of overrides) {
    if(!Number.isInteger(money(row.month))||row.month<0||row.month>11||!Number.isInteger(money(row.year))||money(row.paid_amount)===null) missing.push("A monthly bill settlement is invalid");
    for(const field of ["custom_amount","planned_debt_amount","required_debt_amount","actual_amount","custom_due_day"])if(row[field]!=null&&money(row[field])===null)missing.push("A bill override amount is unavailable");
    if(row.paid_date!=null&&!validDate(row.paid_date))missing.push("A bill payment date is invalid");
  }
  for(const row of moves)if(!validDate(row.from_date)||!validDate(row.to_date))missing.push("A bill date move is invalid");
  for(const row of transactions) {
    if(money(row.amount)===null||!validDate(row.date))missing.push("A linked bill payment amount or date is invalid");
    if(row.review_allocations!=null&&(!Array.isArray(row.review_allocations)||row.review_allocations.some((a:any)=>money(a?.amount)===null||(a.plannedAmount!=null&&money(a.plannedAmount)===null)||(a.occurrenceDate!=null&&!validDate(a.occurrenceDate)))))missing.push("A reviewed bill allocation is invalid");
  }
  if(missing.length)return unavailable(sources,missing);
  const input:any={settings:normalizeSettingsRow({}),bills:selected.map(normalizeBillRow),overrides:overrides.map(r=>normalizeMonthlyOverrideRow({...r,custom_amount:r.custom_amount??null,custom_due_day:r.custom_due_day??null,actual_amount:r.actual_amount??null})),billDateMoves:moves.map(normalizeBillDateMoveRow),transactions:transactions.map(normalizeTransactionRow),deletedTransactions:[],incomes:[],goals:[],extraPayments:[],decisions:[],accounts:[],connectedBankAccounts:[],transactionAccountIdentities:[],pendingBankTransactions:[],pendingPlanMatches:[]};
  // Only occurrence/settlement readers are invoked: no balances, payoff sort,
  // APR calculation, cash-flow projection, or hidden default money is read.
  const engine=createFinancialProjection(input,{now:new Date(snapshot.capturedAt),timeZone:snapshot.timeZone});
  const events:{date:string;name:string;configured:number;paid:number;remaining:number;status:string}[]=[];
  for(let month=monthStart(start);month<=end;month=shiftMonth(month,1)) {
    const m=Number(month.slice(5,7))-1,y=Number(month.slice(0,4));
    for(const bill of engine.getMonthlyBills(m,y)) {
      if(request.domain==="subscriptions"&&!/subscription|entertainment|stream|software/i.test(bill.category))continue;
      const days=engine.getBillOccurrencesInMonth(bill,m,y);
      const override=engine.getOverride(bill.id,m,y);
      for(const day of days) {
        const date=dateOf(month,day);if(date<start||date>end)continue;
        let settled;
        if(bill.is_debt)settled=engine.getDebtMonthSettlements(m,y).get(bill.id)?.occurrences?.find(o=>o.occurrenceDate===date);
        else {
          const reviewed=engine.matchedAllocationIndexes.reviewedBillOccurrences.get(occurrenceKey(bill.id,date));
          if(!reviewed&&days.length>1&&(override?.paid_amount??0)>0) {missing.push(`The payment allocation across ${label(bill.name)} occurrences needs review`);continue;}
          settled=resolveDebtOccurrenceSettlement({occurrenceDate:date,configuredObligation:engine.getAmount(bill,m,y),reviewed,paidAmount:override?.actual_amount??override?.paid_amount??0});
        }
        if(settled)events.push({date,name:bill.name,configured:settled.configuredObligation,paid:settled.paidAmount,remaining:settled.remainingRequired,status:settled.status});
      }
    }
  }
  if(missing.length)return unavailable(sources,missing);
  events.sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name));
  return {text:[`${events.length} recorded ${request.domain==="subscriptions"?"subscription-category":"bill/debt"} occurrences from ${start} through ${end}; ${dollars(sum(events.map(e=>e.remaining)))} remains against recorded obligations.`,...events.slice(0,12).map(e=>`${e.date}: ${label(e.name)} — ${e.status}; ${dollars(e.remaining)} remaining (${dollars(e.paid)} recorded paid).`),events.length>12?"Showing the first 12 occurrences; totals cover the full window.":""].filter(Boolean).join("\n\n"),facts:{startDate:start,endDate:end,occurrenceCount:events.length,configuredObligations:sum(events.map(e=>e.configured)),recordedPaid:sum(events.map(e=>e.paid)),remainingObligations:sum(events.map(e=>e.remaining)),settledCount:events.filter(e=>e.status==="settled").length},sources,assumptions:["Payment status uses recorded reviewed settlements and overrides. Configured debt payments are not verified lender minimums. Pending payments are not treated as paid; no account balance or affordability is inferred.",...(request.domain==="subscriptions"?["Subscription selection uses recorded categories, not an inference that every recurring bill is a subscription."]:[])],missing:[],scenario:false};
}
