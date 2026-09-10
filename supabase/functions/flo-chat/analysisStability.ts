import { buildAnalysisForecast, projectionSources } from "./analysisProjection.ts";
import { aggregateSpending, analyticTransactions } from "./analysisSpending.ts";
import { dayAdd, dollars, label, matches, monthEnd, monthStart, numeric, round, shiftMonth, sum, type AnalysisRequest, type AnalysisResult, type AnalysisSnapshot } from "./analysisTypes.ts";

export function stabilityAnalysis(snapshot: AnalysisSnapshot, request: AnalysisRequest): AnalysisResult {
  const forecast=buildAnalysisForecast(snapshot,request.endDate??monthEnd(shiftMonth(snapshot.today,2)));
  const missing=[...forecast.missing,...forecast.affordabilityMissing];
  const assumptions=["This plan uses recorded obligations and expected paychecks. Estimated spending is included only when a three-month baseline is available. No balances or plans are changed."];
  const days=forecast.days, floor=forecast.input.settings.safety_floor;
  const events=days.flatMap(d=>d.events).filter(e=>e.date>=snapshot.today&&!["actual","applied","finalized"].includes(e.status));
  const income=events.filter(e=>e.kind==="scheduled_income"&&e.amount>0);
  const payDates=[...new Set(income.map(e=>e.date))].sort();
  const nextDate=payDates[0];
  const nextPay=sum(income.filter(e=>e.date===nextDate).map(e=>e.amount));
  const low=days.reduce((a,b)=>a.estimatedBalance<=b.estimatedBalance?a:b);
  const scheduledBuffer=round(Math.max(0,Math.min(forecast.availableNow??0,low.estimatedBalance)-floor));
  const bufferVerified=forecast.historyAvailable&&forecast.anchorDate===snapshot.today&&forecast.availableNow!==null&&!missing.length;
  const free=bufferVerified?scheduledBuffer:null;
  const activity=analyticTransactions(snapshot);
  const priorStart=shiftMonth(snapshot.today,-3), priorEnd=dayAdd(monthStart(snapshot.today),-1);
  const prior=aggregateSpending(activity.rows,priorStart,priorEnd);
  const monthlyIncome=round(prior.income/3), monthlyExpense=round((prior.spending+prior.nonCardRepayments)/3);
  const nextMonth=shiftMonth(snapshot.today,1), nextMonthEnd=monthEnd(nextMonth);
  const nextMonthObligations=-sum(events.filter(e=>e.amount<0&&e.date>=nextMonth&&e.date<=nextMonthEnd).map(e=>e.amount));
  const monthTarget=round(nextMonthObligations+forecast.dailyEstimate*Number(nextMonthEnd.slice(-2)));
  const target=request.amount??(request.target==="month_ahead"?monthTarget:nextPay);
  const remaining=free===null?null:round(Math.max(0,target-free));
  const facts:AnalysisResult["facts"]={currentPlanBuffer:free,cashCushion:floor,nextPayday:nextDate??null,nextPaycheck:nextPay,oneMonthTarget:monthTarget,target,remaining,minimumBalance:low.estimatedBalance,minimumDate:low.date};
  const lines=[free===null?`Your available cash buffer cannot yet be verified. The recorded plan's lowest projected balance is ${dollars(low.estimatedBalance)} on ${low.date}, with a ${dollars(floor)} cushion.`:`Your checked plan has ${dollars(free)} of additional cash buffer above the ${dollars(floor)} cushion. Its lowest projected balance is ${dollars(low.estimatedBalance)} on ${low.date}.`];
  if(!forecast.historyAvailable) missing.push("A full classified spending baseline is missing, so these buffer amounts are scheduled-plan estimates only");
  if(!nextDate) missing.push("An expected paycheck date and amount are needed for a paycheck-ahead plan");
  const nextEnd=payDates[1]?dayAdd(payDates[1],-1):nextMonthEnd;
  const committed=-sum(events.filter(e=>e.amount<0&&e.date>=(nextDate??snapshot.today)&&e.date<=nextEnd).map(e=>e.amount));
  if(nextPay>0) {
    facts.paycheckCommitted=committed; facts.paycheckCommittedPercent=round(committed/nextPay*100);
    lines.push(`Your next expected paycheck is ${dollars(nextPay)} on ${nextDate}. ${dollars(committed)} (${facts.paycheckCommittedPercent}%) of that amount corresponds to recorded obligations through ${nextEnd}, before additional everyday spending.`);
  }
  if(["buffer","stability","paycheck","health"].includes(request.domain)) {
    lines.push(`A ${request.target==="month_ahead"?"month-ahead":"paycheck/buffer"} target is ${dollars(target)}${remaining===null?"; the remaining amount cannot be verified until the available buffer is known":`, needing another ${dollars(remaining)} beyond that available buffer`}.`);
    const monthsOfHistory=[1,2,3].every(offset=>activity.rows.some(r=>r.date>=shiftMonth(snapshot.today,-offset)&&r.date<=monthEnd(shiftMonth(snapshot.today,-offset))))&&!activity.missing.length&&!prior.unresolved&&!prior.unclassifiedDebt;
    if(monthsOfHistory) {
      const surplus=round(monthlyIncome-monthlyExpense);
      facts.historicalMonthlySurplus=surplus;
      if(free!==null&&monthlyExpense>0){facts.daysAhead=round(free/(monthlyExpense/30.4375));lines.push(`Your available buffer covers about ${facts.daysAhead} days at the recorded expense pace. This is an average-spending measure, not a guarantee bills arrive evenly.`);}
      lines.push(`Recorded monthly average: ${dollars(monthlyIncome)} confirmed income versus ${dollars(monthlyExpense)} consumption and debt payments, leaving ${dollars(surplus)} before other unclassified flows.`);
      if(surplus>0&&remaining!==null&&remaining>0) {
        const monthlyCapacity=Math.min(surplus,Math.max(0,low.estimatedBalance-floor));
        if(monthlyCapacity>0) {
          const months=Math.ceil(remaining/monthlyCapacity);
          facts.monthsToTargetScenario=months;
          lines.push(`Scenario: setting aside ${dollars(monthlyCapacity)}/month would need about ${months} months. Recheck each payday; the current forecast does not guarantee that surplus indefinitely.`);
          facts.targetMonthScenario=shiftMonth(snapshot.today,months).slice(0,7);
          const historicalPaydays=[...new Set(activity.rows.filter(r=>r.kind==="income"&&r.date>=priorStart&&r.date<=priorEnd).map(r=>r.date))];
          if(historicalPaydays.length){const perPay=round(monthlyCapacity/(historicalPaydays.length/3));facts.contributionPerPaydayScenario=perPay;facts.paydaysToTargetScenario=perPay>0?Math.ceil(remaining/perPay):null;lines.push(`That is roughly ${dollars(perPay)} per payday at your recorded payday frequency, targeting ${facts.targetMonthScenario}. This assumes that contribution remains affordable; pause it if the cash-flow check drops below your cushion.`);}
        } else lines.push("Do not commit a recurring savings amount yet: the forecast has no spare capacity above your cushion.");
      }
      const needed=Math.max(0,-surplus);
      if(needed>0) lines.push(`Closing the recorded shortfall would require approximately ${dollars(needed/4.345)} less spending or more income each week.`);
      const top=prior.categories.filter(c=>!/rent|mortgage|utilities|insurance|debt/i.test(c.name)).slice(0,3);
      if(top.length) lines.push(`Categories to review first (not automatically nonessential): ${top.map(c=>`${c.name} ${dollars(c.amount/3)}/month`).join("; ")}.`);
    } else missing.push("At least three months of classified income and expenses are needed to estimate a sustainable contribution and target date");
    lines.push(low.estimatedBalance<floor ? "Next steps: protect essentials and required payments first, resolve the upcoming cash shortfall, then rebuild the checking cushion before adding extra debt payments." : "Next steps: leave the bill reserve and cushion untouched, review everyday-spending needs, then direct verified spare cash toward your chosen buffer or debt target.");
  }
  const closes=(snapshot.sources.household_daily_checking_closes?.rows??[]).filter(r=>r.balance_date>=priorStart&&r.balance_date<=priorEnd&&numeric(r.checking_balance)!==null);
  const lows=Object.entries(Object.groupBy(closes,r=>String(r.balance_date).slice(0,7))).map(([month,values])=>({month,low:Math.min(...values!.map(r=>Number(r.checking_balance))),days:values!.length})).sort((a,b)=>a.month.localeCompare(b.month));
  if(request.domain==="progress"||request.domain==="stability"||request.domain==="health") {
    if(lows.length>=2) lines.push(`Observed monthly lows: ${lows.slice(-3).map(m=>`${m.month} ${dollars(m.low)} (${m.days} recorded days)`).join("; ")}.`);
    const historicalPaydays=[...new Set(activity.rows.filter(r=>r.kind==="income"&&r.date>=priorStart&&r.date<=priorEnd).map(r=>r.date))];
    const before=historicalPaydays.map(date=>closes.find(c=>c.balance_date===dayAdd(date,-1))).filter(Boolean);
    const tight=before.filter(c=>Number(c!.checking_balance)<floor).length;
    if(snapshot.sources.household_daily_checking_closes?.complete && before.length>=3 && new Set(before.map(c=>String(c!.balance_date).slice(0,7))).size>=2 && prior.income>0 && !prior.unresolved && !prior.unclassifiedDebt) lines.push(`${tight} of ${before.length} observed pre-payday balances were below your cushion. Combined with income, expenses and the forecast, ${tight>=Math.ceil(before.length/2)&&monthlyIncome<=monthlyExpense ? "this is evidence of paycheck-to-paycheck pressure" : "this does not by itself establish persistent paycheck-to-paycheck dependence"}.`);
    else missing.push("Not enough recorded pre-payday balances for a reliable paycheck-to-paycheck diagnosis; a single low balance is not enough");
    assumptions.push("Historical progress uses recorded daily closes only, never today's forecast rewritten as past actuals. Debt principal changes cannot be reconstructed from payments alone.");
  }
  return {text:lines.join("\n\n"),facts,sources:[...projectionSources,"household_daily_checking_closes"],assumptions,missing:[...new Set(missing)],scenario:false};
}

export function scenarioAnalysis(snapshot: AnalysisSnapshot, request: AnalysisRequest): AnalysisResult {
  const scenario=request.scenario;
  if(!scenario) throw new Error("A scenario change is required");
  const end=request.endDate??(scenario.repeat==="once"?scenario.date:monthEnd(shiftMonth(scenario.date,1)));
  const configuredEnd=monthEnd(shiftMonth(snapshot.today,Number(snapshot.sources.household_settings?.rows[0]?.forecast_horizon_months??1)-1));
  const obligationWindow=monthEnd(shiftMonth(scenario.date,1));
  const assessmentEnd=(obligationWindow>end?obligationWindow:end)>configuredEnd?configuredEnd:(obligationWindow>end?obligationWindow:end);
  if(end>configuredEnd)throw new Error("Requested scenario exceeds the configured forecast");
  const forecast=buildAnalysisForecast(snapshot,assessmentEnd);
  const missing=[...forecast.missing];
  const original=forecast.days.flatMap(d=>d.events);
  const changes: {date:string;amount:number}[]=[];
  const named=original.filter(e=>e.date>=(scenario.kind==="move_bill"?snapshot.today:scenario.date)&&(!scenario.sourceDate||e.date===scenario.sourceDate)&&matches(e.name,scenario.entity)&&["scheduled","planned"].includes(e.status)).sort((a,b)=>a.date.localeCompare(b.date));
  if(["cancel_bill","move_bill","bill_increase"].includes(scenario.kind)) {
    const billIds=new Set(named.filter(e=>e.kind==="bill").map(e=>e.sourceId));
    if(!scenario.entity||billIds.size!==1) missing.push("The scenario must identify exactly one scheduled bill");
    else {
      const selected=named.filter(e=>e.kind==="bill"&&e.amount<0).slice(0,scenario.repeat==="once"?1:undefined);
      if(!selected.length) missing.push("No matching unpaid scheduled bill occurrence exists in the checked window");
      if(scenario.kind==="move_bill"&&scenario.repeat!=="once") return {text:"Choose one bill occurrence and its new date. Recurring date changes need individual dates to avoid stacking payments on one day.",facts:{},sources:projectionSources,assumptions:[],missing:["A single source occurrence is required for a bill-date scenario"],scenario:true};
      for(const event of selected) {
        if(scenario.kind==="bill_increase") changes.push({date:event.date,amount:-scenario.amount});
        else { changes.push({date:event.date,amount:-event.amount}); if(scenario.kind==="move_bill") changes.push({date:scenario.date,amount:event.amount}); }
      }
    }
  } else {
    let dates=[scenario.date];
    if(scenario.repeat==="paycheck") {
      const incomeSource=scenario.kind==="income_change"?scenario.entity:null;
      const paychecks=original.filter(e=>e.kind==="scheduled_income"&&e.amount>0&&e.date>=scenario.date&&(!incomeSource||matches(e.name,incomeSource)));
      if(incomeSource&&new Set(paychecks.map(e=>e.sourceId)).size!==1) missing.push("The paycheck source must identify exactly one income schedule");
      if(!paychecks.length) missing.push("No matching future paycheck dates were found");
      dates=[...new Set(paychecks.map(e=>e.date))];
    }
    else if(scenario.repeat==="monthly") { dates=[]; for(let month=monthStart(scenario.date);month<=assessmentEnd;month=shiftMonth(month,1)) dates.push(`${month.slice(0,7)}-${String(Math.min(Number(scenario.date.slice(-2)),Number(monthEnd(month).slice(-2)))).padStart(2,"0")}`); }
    const amount=scenario.kind==="income_change" ? scenario.amount : -Math.abs(scenario.amount);
    dates.forEach(date=>changes.push({date,amount}));
  }
  if(missing.length) return {text:"I could not safely calculate that scenario from the available records.",facts:{},sources:projectionSources,assumptions:[],missing,scenario:true};
  let delta=0;
  const altered=forecast.days.map(d=>{delta=round(delta+sum(changes.filter(c=>c.date===d.date).map(c=>c.amount))); return {...d,scenarioBalance:round(d.estimatedBalance+delta)};});
  const lowest=altered.reduce((a,b)=>a.scenarioBalance<=b.scenarioBalance?a:b);
  const baseLow=forecast.days.reduce((a,b)=>a.estimatedBalance<=b.estimatedBalance?a:b);
  const last=altered.find(d=>d.date===end)!;
  missing.push(...forecast.affordabilityMissing);
  if(forecast.anchorDate!==snapshot.today)missing.push("Refresh the balance observation before judging this scenario affordable");
  const safety=lowest.scenarioBalance<forecast.input.settings.safety_floor ? "This scenario falls below your configured cash cushion." : forecast.historyAvailable&&!missing.length ? "The scenario stays above the configured cushion under the checked assumptions, but this is not a guarantee of affordability." : "Recorded flows stay above the cushion, but affordability cannot be confirmed until everyday spending, current funds, and older obligations are verified.";
  return {text:`Scenario only — nothing was changed.\n\nBy ${end}, the projected balance would be ${dollars(last.scenarioBalance)}, compared with ${dollars(last.estimatedBalance)} in the baseline. Looking beyond the change through ${assessmentEnd}, the scenario's lowest balance is ${dollars(lowest.scenarioBalance)} on ${lowest.date}; the baseline low is ${dollars(baseLow.estimatedBalance)}.\n\n${safety}`,facts:{scenarioEndBalance:last.scenarioBalance,baselineEndBalance:last.estimatedBalance,scenarioLow:lowest.scenarioBalance,scenarioLowDate:lowest.date,assessmentEndDate:assessmentEnd},sources:projectionSources,assumptions:["Changes are applied to a copy of the canonical forecast. Savings transfers reduce checking but do not reduce net worth. Extra debt payments here show cash impact; interest/payoff changes require the separate debt projection.",forecast.historyAvailable?`Additional spending estimate: ${dollars(forecast.dailyEstimate)}/day.`:"No reliable everyday-spending baseline is available."],missing,scenario:true};
}
