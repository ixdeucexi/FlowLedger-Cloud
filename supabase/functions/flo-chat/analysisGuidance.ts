import { buildAnalysisForecast, projectionInput, projectionSources } from "./analysisProjection.ts";
import { scheduleAnalysis } from "./analysisSchedule.ts";
import { analyticTransactions, aggregateSpending } from "./analysisSpending.ts";
import { dayAdd, dollars, label, monthEnd, monthStart, round, shiftMonth, sum, validDate, type AnalysisRequest, type AnalysisResult, type AnalysisSnapshot } from "./analysisTypes.ts";

export const isGuidancePurpose = (purpose: AnalysisRequest["purpose"]) => ["paycheck_allocation","action_plan","budget_plan","allocation_choice"].includes(purpose ?? "");

/** Read-only guidance built on the canonical forecast; reserves are not independent spending maxima. */
export function guidanceAnalysis(snapshot: AnalysisSnapshot, request: AnalysisRequest): AnalysisResult {
  const start=request.startDate??snapshot.today;
  const planDays=request.planDays??30;
  const end=request.endDate??dayAdd(start,planDays-1);
  if(!validDate(start)||!validDate(end)||start<snapshot.today||end<start)return {text:"Choose a current or future planning window.",facts:{},sources:[],assumptions:[],missing:["A valid planning window is required"],scenario:false};
  const normalized=projectionInput(snapshot);
  const assumptions=["Read-only draft: no payments, transfers, budgets or dates were changed. Expected deposits are not guaranteed bank funds.","The cash cushion is a balance reserve, not a monthly expense. Any spare capacity is one shared amount: choose between buffer, extra debt or other goals; do not add independent maxima."];
  if(normalized.missing.length) {
    if(request.purpose==="allocation_choice")return {text:"I cannot verify spare money for either option yet. Protect required bills, everyday spending and your cash cushion first; update the missing records before choosing debt or savings.",facts:{safeSharedCapacity:null,allocationChoice:"unverified"},sources:projectionSources,assumptions,missing:normalized.missing,scenario:false};
    const schedules=[scheduleAnalysis(snapshot,{...request,domain:"income",purpose:"general",operation:"summary",startDate:start,endDate:end,dateEvent:"none",entity:null}),scheduleAnalysis(snapshot,{...request,domain:"bills",purpose:"general",operation:"summary",startDate:start,endDate:end,dateEvent:"none",entity:null})];
    return {text:[`${start}: verify the checking observation, unresolved activity and missing plan inputs before committing money.`,...schedules.filter(r=>!r.missing.length).map(r=>r.text),`${end}: review posted payments and update the plan. A safe allocation cannot be calculated until the missing inputs are resolved.`].join("\n\n"),facts:{startDate:start,endDate:end,safeSharedCapacity:null,planStatus:"needs_review"},sources:projectionSources,assumptions,missing:[...normalized.missing,...schedules.flatMap(r=>r.missing)],scenario:false};
  }
  const configuredEnd=monthEnd(shiftMonth(snapshot.today,normalized.input.settings.forecast_horizon_months-1));
  if(end>configuredEnd)return {text:`The requested plan extends beyond the configured forecast ending ${configuredEnd}. Extend the forecast or choose a shorter period.`,facts:{safeSharedCapacity:null,startDate:start,endDate:end},sources:projectionSources,assumptions,missing:["The entire requested planning window must be forecastable"],scenario:false};
  // Read ahead to resolve the next complete pay cycle even if the requested
  // action checklist ends earlier. The user window itself is not rewritten.
  const readEnd=request.purpose==="paycheck_allocation"?[monthEnd(shiftMonth(start,2)),configuredEnd].sort()[0]:end;
  const forecast=buildAnalysisForecast(snapshot,readEnd);
  const missing=[...forecast.missing,...forecast.affordabilityMissing];
  if(!forecast.historyAvailable)missing.push("A classified three-month living-expense baseline is required before reserving safe spending amounts");
  if(forecast.anchorDate!==snapshot.today)missing.push("Refresh today's checking observation before using a numeric allocation");
  const history=analyticTransactions(snapshot);
  const billNames=new Set(normalized.input.bills.map(b=>b.name.trim().toLowerCase()));
  const overlap=history.rows.some(t=>!t.billId&&t.kind==="spending"&&billNames.has(t.merchant.trim().toLowerCase()));
  if(overlap)missing.push("Unlinked spending matches a configured bill; review links before combining scheduled bills with the living-cost allowance");
  const verified=forecast.historyAvailable&&forecast.anchorDate===snapshot.today&&forecast.availableNow!==null&&!missing.length;
  const allEvents=forecast.days.flatMap(d=>d.events).filter(e=>e.date>=start&&!["actual","applied","finalized"].includes(e.status));
  const windowDays=forecast.days.filter(d=>d.date>=start&&d.date<=end);
  const events=allEvents.filter(e=>e.date<=end);
  const low=forecast.days.filter(d=>d.date<=end).reduce((a,b)=>a.estimatedBalance<=b.estimatedBalance?a:b);
  const floor=normalized.input.settings.safety_floor;
  const capacity=verified?round(Math.max(0,Math.min(forecast.availableNow!,low.estimatedBalance)-floor)):null;
  const facts:AnalysisResult["facts"]={startDate:start,endDate:end,safeSharedCapacity:capacity,cashCushion:floor,minimumProjectedBalance:low.estimatedBalance,minimumDate:low.date,householdCushionShortfall:round(Math.max(0,floor-low.estimatedBalance)),planStatus:verified?"checked_draft":"needs_review"};
  const lines:string[]=[];
  if(request.purpose==="allocation_choice") {
    const amount=request.amount;
    if(amount===null||amount<=0)return {text:"How much are you considering putting toward debt or savings?",facts:{},sources:[],assumptions:[],missing:["An explicit positive amount is needed"],scenario:false};
    facts.proposedAllocation=amount;
    if(capacity===null){facts.allocationChoice="unverified";lines.push(`I cannot verify that ${dollars(amount)} is spare money for either option. Protect required bills, everyday spending and the cash cushion first; refresh the missing records before allocating it.`);}
    else if(amount>capacity){facts.allocationChoice="exceeds_capacity";facts.capacityShortfall=round(amount-capacity);lines.push(`Do not commit the full ${dollars(amount)} to either option based on this check. The one shared optional capacity is ${dollars(capacity)} through ${end}, so the proposed amount exceeds it by ${dollars(amount-capacity)}. Keep required bills, living costs and the cash cushion reserved.`);}
    else {facts.allocationChoice="priority_needed";lines.push(`The ${dollars(amount)} fits within one shared optional capacity of ${dollars(capacity)} through ${end} under the checked records. It is not ${dollars(amount)} for debt plus another ${dollars(amount)} for savings. Keeping it in accessible savings preserves cash for surprises; extra debt payment reduces the amount owed but leaves less cash available. I need your savings priority and the debt's verified terms to recommend which matters more; this check does not establish an optimal choice.`);}
  } else if(request.purpose==="paycheck_allocation") {
    const paydays=[...new Set(allEvents.filter(e=>e.kind==="scheduled_income"&&e.amount>0).map(e=>e.date))].sort();
    const payday=paydays[0],following=paydays[1];
    if(!payday||!following){missing.push("Two upcoming positive household paycheck dates are needed to bound the next pay cycle");facts.safeSharedCapacity=null;facts.planStatus="needs_review";}
    if(payday) {
      const paycheck=sum(allEvents.filter(e=>e.date===payday&&e.kind==="scheduled_income"&&e.amount>0).map(e=>e.amount));
      facts.payday=payday;facts.expectedPaycheck=paycheck;
      lines.push(`For the expected ${dollars(paycheck)} household paycheck on ${payday}${following?`, reserve through ${dayAdd(following,-1)}`:""}. Confirm it posts before allocating it.`);
      if(following&&verified) {
        const cycleEnd=dayAdd(following,-1),cycle=forecast.days.filter(d=>d.date>=payday&&d.date<=cycleEnd);
        const cycleEvents=allEvents.filter(e=>e.date>=payday&&e.date<=cycleEnd);
        const before=forecast.days.find(d=>d.date===dayAdd(payday,-1));
        const beforeBalance=before?.estimatedBalance??forecast.availableNow!;
        const repair=Math.max(0,-beforeBalance);
        const obligations=-sum(cycleEvents.filter(e=>e.amount<0).map(e=>e.amount));
        const living=round(Math.max(0,(cycle.at(-1)?.estimatedSpending??0)-(before?.estimatedSpending??0)));
        const cushionTopUp=round(Math.max(0,floor-Math.max(0,beforeBalance)));
        let left=paycheck;
        const take=(needed:number)=>{const reserved=round(Math.min(left,Math.max(0,needed)));left=round(left-reserved);return reserved;};
        const allocations=[{name:"existing projected overdraft",amount:take(repair)},{name:"recorded bills, debt and other existing plan commitments",amount:take(obligations)},{name:"estimated everyday living costs",amount:take(living)},{name:"cash-cushion top-up",amount:take(cushionTopUp)}];
        facts.allocatedPaycheck=sum(allocations.map(a=>a.amount));facts.unassignedPaycheck=left;facts.paycheckOnlyGap=round(Math.max(0,repair+obligations+living+cushionTopUp-paycheck));facts.cycleEnd=cycleEnd;
        const cycleLow=Math.min(...cycle.map(d=>d.estimatedBalance));
        facts.optionalSharedCapacity=Math.min(left,capacity??0,Math.max(0,round(cycleLow-floor)));
        lines.push(...allocations.filter(a=>a.amount>0).map(a=>`${dollars(a.amount)} reserved for ${a.name}.`),`${dollars(left)} remains unassigned from this paycheck. Keep it held until all reserves are checked; at most ${dollars(Number(facts.optionalSharedCapacity))} is part of the one shared optional capacity, not separate debt and savings allowances.`);
        if(Number(facts.paycheckOnlyGap)>0)lines.push(`This paycheck alone is ${dollars(Number(facts.paycheckOnlyGap))} short of those reserves. This is not automatically the household's shortfall: existing cash may cover it. The complete household forecast falls ${dollars(Number(facts.householdCushionShortfall))} below its cushion in the requested window.`);
      }
    }
    if(!verified||!following)lines.push("No numeric spending allocation is approved until the missing history, current balance, older obligations and pay-cycle dates are verified.");
  } else if(request.purpose==="budget_plan") {
    const income=sum(events.filter(e=>e.amount>0&&e.kind==="scheduled_income").map(e=>e.amount));
    const mandatory=-sum(events.filter(e=>e.amount<0&&["bill","debt_payment"].includes(e.kind)).map(e=>e.amount));
    const other=-sum(events.filter(e=>e.amount<0&&!["bill","debt_payment"].includes(e.kind)).map(e=>e.amount));
    const before=forecast.days.find(d=>d.date===dayAdd(start,-1));
    const living=verified?round(Math.max(0,(windowDays.at(-1)?.estimatedSpending??0)-(before?.estimatedSpending??0))):null;
    facts.expectedIncome=income;facts.recordedBillDebtReserve=mandatory||0;facts.otherPlanReserve=other||0;facts.livingCostAllowance=living;
    lines.push(`Budget draft for ${start}–${end}: ${dollars(income)} expected scheduled income; ${dollars(mandatory)} recorded bill/debt obligations; ${dollars(other)} other plan commitments.`);
    if(living!==null){
      facts.plannedOutflows=round(mandatory+other+living);facts.incomeOnlyDeficit=round(Math.max(0,Number(facts.plannedOutflows)-income));lines.push(`${dollars(living)} estimated living-cost allowance from classified non-bill-linked spending. Total planned outflows: ${dollars(Number(facts.plannedOutflows))}. ${Number(facts.incomeOnlyDeficit)>0?`Income alone is ${dollars(Number(facts.incomeOnlyDeficit))} short; no cuts or extra income have been invented.`:"Expected income covers these draft outflows, subject to the dated cash-flow check."}`);
      const prior=aggregateSpending(history.rows.filter(r=>!r.billId),shiftMonth(snapshot.today,-3),dayAdd(monthStart(snapshot.today),-1));
      const categories=prior.categories.filter(c=>c.amount!==0).sort((a,b)=>b.amount-a.amount||a.name.localeCompare(b.name));
      if(categories.some(c=>c.amount<0)||prior.unresolved||sum(categories.map(c=>c.amount))<=0&&living>0) {
        facts.livingCategoryDraftStatus="unavailable";
        missing.push("Category composition needs review: net refunds or missing category spending cannot be treated as recurring future income");
        lines.push("A category split is unavailable until refund offsets and category coverage are reviewed. The aggregate estimate is not a guessed set of category cuts.");
      } else {
        const weights=categories.slice(0,8);
        if(categories.length>8)weights.push({name:`Other recorded categories (${categories.length-8})`,amount:sum(categories.slice(8).map(c=>c.amount))});
        const weightTotal=sum(weights.map(c=>c.amount)),targetCents=Math.round(living*100);
        let cumulativeWeight=0,allocatedCents=0;
        const draft=weights.map((category,index)=>{cumulativeWeight+=Math.round(category.amount*100);const through=index===weights.length-1?targetCents:Math.round(targetCents*cumulativeWeight/Math.round(weightTotal*100));const amount=(through-allocatedCents)/100;allocatedCents=through;return {name:category.name,amount};});
        facts.livingCategoryDraftStatus="history_based";facts.livingCategoryCount=categories.length;facts.livingCategoryDraftTotal=sum(draft.map(c=>c.amount));
        draft.forEach((c,index)=>{facts[`livingCategory${index+1}`]=c.name;facts[`livingCategory${index+1}Amount`]=c.amount;});
        lines.push(`History-based category draft for this window: ${draft.length?draft.map(c=>`${label(c.name)} ${dollars(c.amount)}`).join("; "):"no additional living-cost allowance"}. These sum to ${dollars(Number(facts.livingCategoryDraftTotal))}, the same living-cost allowance above—not additional money.`);
        assumptions.push("Category shares come from the same three completed months of classified non-bill-linked consumption, net of merchant refunds; linked obligations and debt repayments are not allocated again. Rounded category amounts conserve the aggregate allowance to the cent. These are reviewable historical proportions, not mandatory cuts or assumed household priorities.");
      }
    }
    else lines.push("The living-cost allowance and a feasible combined total are unavailable until classification and any overlap with bill records are resolved.");
    lines.push(`Keep the ${dollars(floor)} cash cushion separate from monthly expenses. The household's dated cushion shortfall is ${dollars(Number(facts.householdCushionShortfall))}; existing cash and payment timing matter in addition to the income-only budget.`);
  } else {
    const actualDays=Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;
    lines.push(`${actualDays}-day action plan: ${start}–${end}. This is a dated checklist, not a promised escape-from-debt date.`,`${start}: reconcile checking, review pending payments and resolve older unpaid obligations before committing extra money.`);
    const due=events.filter(e=>e.amount<0&&["bill","debt_payment"].includes(e.kind)).sort((a,b)=>a.date.localeCompare(b.date));
    facts.dueOccurrenceCount=due.length;facts.dueAmountTotal=-sum(due.map(e=>e.amount))||0;facts.displayedDueCount=Math.min(10,due.length);
    lines.push(...due.slice(0,10).map(e=>`${e.date}: protect ${dollars(-e.amount)} for ${label(e.name)} under the recorded schedule.`));
    const paydays=[...new Set(events.filter(e=>e.kind==="scheduled_income"&&e.amount>0).map(e=>e.date))].sort();
    facts.expectedPaydayCount=paydays.length;facts.displayedPaydayCount=Math.min(4,paydays.length);facts.expectedIncomeTotal=sum(events.filter(e=>e.kind==="scheduled_income"&&e.amount>0).map(e=>e.amount));
    lines.push(`Full-window totals: ${due.length} bill/debt occurrences totaling ${dollars(Number(facts.dueAmountTotal))}, and ${paydays.length} expected household paydays totaling ${dollars(Number(facts.expectedIncomeTotal))}. Showing ${Math.min(10,due.length)} of ${due.length} due items and ${Math.min(4,paydays.length)} of ${paydays.length} paydays; open Forecast for every dated item.`);
    lines.push(...paydays.slice(0,4).map(date=>`${date}: after the expected income posts, review the next bill window and living-cost reserve before assigning extra money.`));
    if(Number(facts.householdCushionShortfall)>0)lines.push(`Before ${low.date}: resolve a projected ${dollars(Number(facts.householdCushionShortfall))} cushion shortfall by reviewing optional commitments, payment-date options or confirmed income. No essential bill has been removed automatically.`);
    if(capacity!==null)lines.push(`${dollars(capacity)} is the single shared additional capacity checked through ${end}. Choose its destination once—buffer or extra debt—not that amount for each.`);
    else lines.push("An extra-payment or savings amount is not yet verified; complete the missing checks first.");
    lines.push(`${end}: review actual posted spending, debt principal and the next forecast window, then revise this plan.`);
  }
  return {text:lines.join("\n\n"),facts,sources:projectionSources,assumptions,missing:[...new Set(missing)],scenario:false};
}
