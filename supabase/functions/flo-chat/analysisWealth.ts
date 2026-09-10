import { orderDebts } from "../../../artifacts/mobile/lib/snowball.ts";
import { projectAnalystDebt } from "./analysisDebt.ts";
import { rankCreditOrDebt } from "./analysisRanking.ts";
import { canonicalConnectedAccounts } from "../../../artifacts/mobile/lib/plaidActivity.ts";
import { createFinancialProjection } from "../../../artifacts/mobile/lib/financialProjection.ts";
import { isBillActiveForMonth } from "../../../artifacts/mobile/lib/schedule.ts";
import { requiredDebtPlanTotal } from "../../../artifacts/mobile/lib/debtPaymentPlan.ts";
import { recordedSnowballTarget } from "./snowballTarget.ts";
import { projectionInput, buildAnalysisForecast } from "./analysisProjection.ts";
import { analyticTransactions, aggregateSpending } from "./analysisSpending.ts";
import { dayAdd, dollars, label, matches, monthEnd, monthStart, numeric, requireSources, round, shiftMonth, sum, type AnalysisRequest, type AnalysisResult, type AnalysisSnapshot } from "./analysisTypes.ts";

export function wealthAnalysis(snapshot: AnalysisSnapshot, request: AnalysisRequest): AnalysisResult {
  if(["credit","debt"].includes(request.domain)&&["minimum","maximum"].includes(request.operation))return rankCreditOrDebt(snapshot,request);
  const rows = (name: string) => snapshot.sources[name]?.rows ?? [];
  const facts: AnalysisResult["facts"] = {};
  const lines: string[] = [];
  const assumptions: string[] = [];
  const missing: string[] = [];
  let sources: string[] = [];
  if (request.domain === "credit") {
    sources = ["plaid_accounts"];
    const cards = canonicalConnectedAccounts<Record<string,any>&{id:string;is_active:boolean}>(rows("plaid_accounts").map(r=>({...r,id:String(r.id),is_active:r.is_active!==false}))).filter(r=>r.account_type === "credit" && matches(r.display_name ?? r.name, request.entity));
    if (!cards.length) missing.push("No matching connected credit card with a verified credit limit is available. Manual debt records do not currently store limits.");
    const valid = cards.filter(r=>numeric(r.current_balance)!==null && numeric(r.credit_limit)! > 0);
    if (valid.length !== cards.length) missing.push("Some credit card balances or positive credit limits are unavailable; total utilization cannot be established");
    if (valid.length) {
      const balance = sum(valid.map(r=>Math.max(0,Number(r.current_balance))));
      const limit = sum(valid.map(r=>Number(r.credit_limit)));
      const percent = round(balance/limit*100);
      facts.cardBalance=balance; facts.creditLimit=limit; facts.utilizationPercent=percent;
      lines.push(`The ${valid.length} cards with verified limits use ${percent}% of their combined limit: ${dollars(balance)} of ${dollars(limit)}.`);
      for (const percentTarget of [30,10]) {
        const payment = round(Math.max(0,balance-limit*percentTarget/100+.01));
        facts[`paymentBelow${percentTarget}Percent`] = payment;
        lines.push(`${dollars(payment)} would bring the combined balance below ${percentTarget}%, assuming no new charges, interest, or limit changes.`);
      }
      if(request.amount!==null) { facts.afterPaymentUtilization=round(Math.max(0,balance-request.amount)/limit*100); lines.push(`Scenario: a ${dollars(request.amount)} payment would leave combined utilization near ${facts.afterPaymentUtilization}%. This does not establish payment affordability.`); }
      lines.push(...valid.slice(0,5).map(r=>`${label(r.display_name ?? r.name)}: ${dollars(Number(r.current_balance))}, APR ${numeric(r.purchase_apr)===null ? "unavailable" : `${r.purchase_apr}%`}.`));
    }
  } else if (request.domain === "debt") {
    sources=["bills","monthly_overrides","bill_date_moves","household_settings"];
    const raw=rows("bills").filter(r=>r.is_debt && numeric(r.balance)!>0 && (!r.end_date || r.end_date>=snapshot.today));
    const named=raw.filter(r=>!request.entity||String(r.name).trim().toLowerCase()===request.entity.trim().toLowerCase());
    if(request.entity && named.length!==1) missing.push("The debt name does not identify exactly one active debt; use its full name");
    if(rows("bills").some(r=>r.is_debt && numeric(r.balance)===null)) missing.push("A debt balance is missing");
    const total=sum(raw.map(r=>Number(r.balance)));
    facts.totalDebt=total; facts.debtCount=raw.length;
    lines.push(`Your recorded active debt is ${dollars(total)} across ${raw.length} debts.`);
    if(named.length) lines.push(...named.slice(0,6).map(r=>`${label(r.name)}: ${dollars(Number(r.balance))}; configured payment ${numeric(r.amount)===null ? "unavailable" : dollars(Number(r.amount))}; APR ${numeric(r.interest_rate)===null ? "unavailable" : `${r.interest_rate}%`}.`));
    assumptions.push("Configured payments are your FlowLedger plan, not independently verified lender minimums. Check the latest statement before changing a required payment.");
    if(raw.some(r=>numeric(r.amount)===null || numeric(r.interest_rate)===null || !["monthly",null,undefined].includes(r.frequency))) missing.push("A complete monthly payoff projection needs every debt's APR and monthly payment; nonmonthly debt schedules must be reviewed in the dated planner");
    else if(raw.length) {
      const normalized=projectionInput(snapshot);
      const engine=createFinancialProjection(normalized.input,{now:new Date(snapshot.capturedAt),timeZone:snapshot.timeZone});
      const month=Number(snapshot.today.slice(5,7))-1, year=Number(snapshot.today.slice(0,4));
      const eligible=normalized.input.bills.filter(b=>b.is_debt&&b.balance>0&&(isBillActiveForMonth(b,month,year)||engine.getBillOccurrencesInMonth(b,month,year).length>0));
      const debts=eligible.map(r=>({id:r.id,name:label(r.name),balance:r.balance,minimum:requiredDebtPlanTotal(r,engine.getBillOccurrencesInMonth(r,month,year).length),apr:r.interest_rate,dueDay:r.due_day,included:r.include_in_snowball!==false}));
      const recorded=recordedSnowballTarget(rows("bills"),{month,year},!requireSources(snapshot,sources).length,[...rows("monthly_overrides"),...rows("bill_date_moves")] as any);
      const target=request.debtMethod==="snowball"?debts.find(d=>d.id===recorded.targetId):orderDebts(debts.filter(d=>d.included),request.debtMethod)[0];
      const settlements=engine.getDebtMonthSettlements(month,year);
      facts.nextDebt=target?.name??null; facts.minimumPayments=sum(debts.map(d=>settlements.get(d.id)?.configuredObligation??d.minimum)); facts.minimumRemaining=sum(debts.map(d=>settlements.get(d.id)?.remainingRequired??d.minimum));facts.configuredOngoingPayments=sum(debts.map(d=>d.minimum));facts.monthlyInterestEstimate=round(sum(debts.map(d=>d.balance*d.apr/1200)));
      lines.push(target?`${request.debtMethod === "avalanche" ? "Highest-APR" : "Smallest-balance"} eligible target: ${target.name}. This month's recorded required obligations total ${dollars(Number(facts.minimumPayments))}, with ${dollars(Number(facts.minimumRemaining))} remaining. Preserve that required remainder before adding extra.`:"No included, currently eligible snowball target could be verified.");
      lines.push(`At today's balances and recorded APRs, one month's simple interest estimate is ${dollars(Number(facts.monthlyInterestEstimate))}. Actual statements may use daily balances and additional fees.`);
      if(["plan","scenario","compare"].includes(request.operation) && target && !normalized.missing.length) {
        const extra=request.scenario?.kind==="extra_debt" ? Math.max(0,request.scenario.amount) : Math.max(0,request.amount??0);
        const cadence=request.scenario?.repeat??"once";
        const extraDate=request.scenario?.date??snapshot.today;
        const namedExtra=request.scenario?.entity??request.entity;
        const selectedExtra=debts.filter(d=>matches(d.name,namedExtra));
        if(namedExtra&&(selectedExtra.length!==1||!selectedExtra[0].included)) return {text:lines.join("\n\n"),facts,sources,assumptions,missing:["Extra payment must identify exactly one included debt"],scenario:true};
        const currentPlan=engine.getDebtPlanForMonth(month,year);
        if(!currentPlan) return {text:lines.join("\n\n"),facts,sources,assumptions,missing:["The current canonical debt plan is unavailable"],scenario:false};
        const projection=(extraAmount:number)=> {
          return projectAnalystDebt({debts,method:request.debtMethod,year,month,currentPlan,targetId:namedExtra?selectedExtra[0].id:undefined,extra:(m,y)=>{
            const prefix=`${y}-${String(m+1).padStart(2,"0")}`;
            if(prefix<extraDate.slice(0,7))return 0;
            if(cadence==="once")return prefix===extraDate.slice(0,7)?extraAmount:0;
            if(cadence==="monthly")return extraAmount;
            const paydays=new Set(engine.getIncomeOccurrencesInMonth(m,y).filter(i=>i.effectiveAmount>0).flatMap(i=>i.days).map(day=>`${prefix}-${String(day).padStart(2,"0")}`).filter(date=>date>=extraDate));
            return round(extraAmount*paydays.size);
          }});
        };
        const base=projection(0); const scenario=projection(extra);
        facts.baselineDebtFreeMonth=base.debtFreeDate; facts.scenarioDebtFreeMonth=scenario.debtFreeDate;
        if(request.entity&&named.length===1) {
          const payoff=(result:typeof base)=>{const m=result.months.find(m=>m.paidOffIds.includes(named[0].id));return m?`${m.year}-${String(m.month+1).padStart(2,"0")}`:null;};
          facts.namedDebtPayoffMonth=payoff(scenario);facts.namedDebtBaselineMonth=payoff(base);facts.namedDebt=label(named[0].name);
          lines.unshift(facts.namedDebtPayoffMonth?`For ${label(named[0].name)}, the fixed-payment scenario projects payoff in ${facts.namedDebtPayoffMonth}; its baseline payoff month is ${facts.namedDebtBaselineMonth??"not reached"}. This is that debt's date, not the whole plan's debt-free date.`:`${label(named[0].name)} does not reach payoff within the modeled included-debt plan. I cannot substitute the whole plan's date for this debt.`);
          if(!facts.namedDebtPayoffMonth)missing.push("The named debt did not reach a verified payoff month within this scenario");
        }
        lines.push(`Fixed-payment scenario: ${extra ? `${dollars(extra)} extra ${cadence==="monthly"?"each month":cadence==="paycheck"?"on each scheduled household payday":"once"} beginning ${extraDate}` : "no additional payment"}${namedExtra?` toward ${label(namedExtra)}`:""}, with freed payments rolling forward. Estimated included-plan payoff month: ${scenario.debtFreeDate??"not reached within 30 years"}. Baseline: ${base.debtFreeDate??"not reached within 30 years"}. Excluded debts still receive their configured payments but are not counted as paid off by this plan.`);
        const next=scenario.months.find(m=>m.paidOffNames?.length);
        if(next) lines.push(`Next projected payoff: ${next.paidOffNames!.join(", ")} in ${next.year}-${String(next.month+1).padStart(2,"0")}.`);
        assumptions.push("This is a monthly fixed-payment hypothetical, not a verified affordable cash-flow plan. It starts from the canonical current-month settlement, then assumes unchanged payments and APRs, no new borrowing/fees, and no later overrides or schedule changes. Extra payments are applied in their specified month, not as an exact daily-interest quote. Required payments stay on every debt; freed payments roll to the next included debt.");
      }
    }
  } else if(request.domain === "budget") {
    sources=["category_budgets","transactions","plaid_transactions","plaid_accounts","bills","goals"];
    const activity=analyticTransactions(snapshot); missing.push(...activity.missing);
    const start=request.startDate??monthStart(snapshot.today), end=request.endDate??snapshot.today;
    const totals=aggregateSpending(activity.rows,start,end);
    const budgets=rows("category_budgets").filter(r=>{const date=`${r.year}-${String(Number(r.month)+1).padStart(2,"0")}-01`;return date>=monthStart(start)&&date<=monthStart(end)&&matches(r.category,request.category);});
    if(!budgets.length) missing.push("No matching category budget is recorded for that month");
    for(const b of budgets.slice(0,10)) {
      const budgetStart=`${b.year}-${String(Number(b.month)+1).padStart(2,"0")}-01`,budgetEnd=monthEnd(budgetStart)<end?monthEnd(budgetStart):end;
      const monthly=aggregateSpending(activity.rows,budgetStart,budgetEnd);
      const spent=monthly.categories.find(c=>c.name.toLowerCase()===String(b.category).toLowerCase())?.amount??0;
      if(numeric(b.amount)===null) { missing.push(`Budget amount unavailable for ${label(b.category)}`); continue; }
      lines.push(`${budgetStart.slice(0,7)} ${label(b.category)}: ${dollars(spent)} classified spending of ${dollars(Number(b.amount))}; ${monthly.unresolved||activity.missing.length?"remaining unavailable until activity is fully classified":`${dollars(Number(b.amount)-spent)} remaining`} (month start through ${budgetEnd}).`);
    }
    if(request.operation==="plan") {
      const priorStart=shiftMonth(snapshot.today,-3), priorEnd=dayAdd(monthStart(snapshot.today),-1);
      const prior=aggregateSpending(activity.rows,priorStart,priorEnd);
      const baselinePresent=[1,2,3].every(offset=>activity.rows.some(r=>r.date>=shiftMonth(snapshot.today,-offset)&&r.date<=monthEnd(shiftMonth(snapshot.today,-offset))));
      if(baselinePresent&&!prior.unresolved&&!activity.missing.length)lines.push(`History-based draft (not saved): ${prior.categories.filter(c=>matches(c.name,request.category)).slice(0,8).map(c=>`${c.name} ${dollars(c.amount/3)}/month`).join("; ") || "not enough spending history"}.`);
      else missing.push("A budget draft needs classified spending in each of the last three completed months");
      assumptions.push("Draft divides recorded spending in the previous three completed months by three. Missing transaction history understates the result; check complete coverage before adopting it.");
    }
    if(totals.unresolved) missing.push("Unreviewed transactions are excluded; budget remaining may be overstated");
  } else {
    sources=["accounts","plaid_accounts","goals","transactions","plaid_transactions","bills"];
    const normalized=projectionInput(snapshot);
    const invalidSavings=rows("accounts").some(r=>r.is_active!==false&&r.account_type==="savings"&&numeric(r.current_balance)===null) || rows("plaid_accounts").some(r=>r.is_active!==false&&r.account_subtype==="savings"&&numeric(r.current_balance)===null);
    const savings=invalidSavings ? null : normalized.savings;
    if(invalidSavings) missing.push("A savings balance is missing; it must not be treated as zero");
    facts.savingsBalance=savings;
    lines.push(savings===null ? "I could not verify a savings-account balance." : `Your recorded savings-account balance is ${dollars(savings)}. Goal earmarks are not added again.`);
    const goals=rows("goals").filter(r=>!r.closed_at&&!r.archived_at&&r.goal_type!=="planned_expense"&&matches(r.name,request.entity));
    if(goals.some(g=>numeric(g.current_amount)===null||numeric(g.target_amount)===null))missing.push("Goal target or current funding is unavailable");
    lines.push(...goals.slice(0,5).map(g=>`${label(g.name)}: ${numeric(g.current_amount)===null ? "unavailable" : dollars(Number(g.current_amount))} toward ${numeric(g.target_amount)===null ? "unavailable" : dollars(Number(g.target_amount))}${g.target_date?` by ${g.target_date}`:""}.`));
    if(request.domain==="emergency") {
      const activity=analyticTransactions(snapshot); const start=shiftMonth(snapshot.today,-3), end=dayAdd(monthStart(snapshot.today),-1);
      const prior=aggregateSpending(activity.rows,start,end);
      const monthly=round((prior.spending+prior.nonCardRepayments)/3);
      missing.push(...activity.missing);
      const baselinePresent=[1,2,3].every(offset=>activity.rows.some(r=>r.date>=shiftMonth(snapshot.today,-offset)&&r.date<=monthEnd(shiftMonth(snapshot.today,-offset))));
      if(!baselinePresent||activity.missing.length||prior.unresolved||prior.unclassifiedDebt||monthly<=0) missing.push("Three complete months of classified expenses and identified loan/card repayments are needed for a reliable emergency-fund target");
      else {
        facts.monthlyExpenseBaseline=monthly; facts.threeMonthTarget=round(monthly*3); facts.sixMonthTarget=round(monthly*6);
        lines.push(`Using ${dollars(monthly)}/month of recorded consumption plus debt repayments, three months is ${dollars(monthly*3)} and six months is ${dollars(monthly*6)}.`);
        if(savings!==null) {facts.monthsCovered=round(savings/monthly); lines.push(`Savings cover approximately ${facts.monthsCovered} months of that baseline; ${dollars(Math.max(0,monthly*(request.target==="six_months"?6:3)-savings))} remains for the selected target.`);}
        assumptions.push("This estimate uses all recorded expenses, not an inferred essential-only budget. Any earmarked or inaccessible savings should be deducted before treating it as an emergency fund.");
      }
    }
    if(request.amountRole==="contribution_amount" && request.amount!==null && request.amount>0 && goals.length===1) {
      const goalTarget=numeric(goals[0].target_amount),goalCurrent=numeric(goals[0].current_amount);
      if(goalTarget!==null&&goalCurrent!==null) {const periods=Math.ceil(Math.max(0,goalTarget-goalCurrent)/request.amount); facts.contributionPeriods=periods; lines.push(`At ${dollars(request.amount)} per contribution, that goal needs ${periods} contributions. This is a contribution scenario, not confirmation the amount is affordable.`);}
      else missing.push("Goal target or current funding is unavailable; a contribution count cannot be calculated");
    }
    if(request.purpose==="goal_timeline" || request.domain==="savings"&&request.operation==="plan") {
      facts.timelineOutcome="not_estimable";facts.timelineDuration=null;
      const exactGoals=goals.filter(g=>!request.entity||String(g.name).trim().toLowerCase()===request.entity.trim().toLowerCase());
      const goal=request.entity&&exactGoals.length===1?exactGoals[0]:null;
      const current=goal?numeric(goal.current_amount):null;
      const goalTarget=request.amountRole==="target_balance"?request.amount:goal?numeric(goal.target_amount):null;
      const contribution=request.contribution;
      if(!goal||current===null||goalTarget===null) {
        lines.unshift("I cannot estimate that goal's timeline until one specific goal and its recorded funding and target are known. A total savings balance is not the same as that goal's earmarked funds.");
        missing.push("A unique goal with known funding and target is required for its timeline");
      } else if(current>=goalTarget) {
        facts.timelineOutcome="already_reached";facts.timelineDuration=0;
        lines.unshift(`Your recorded ${label(goal.name)} funding already reaches the ${dollars(goalTarget)} target; no additional waiting time is needed.`);
      } else if(contribution&&contribution.frequency!=="once") {
        const periods=Math.ceil((goalTarget-current)/contribution.amount);
        facts.timelineOutcome="duration";facts.timelineDuration=periods;facts.timelineUnit=contribution.frequency==="monthly"?"months":"household_paydays";
        lines.unshift(`Scenario: ${label(goal.name)} needs ${periods} ${contribution.frequency==="monthly"?"monthly contributions":"household-payday contributions"} at your stated ${dollars(contribution.amount)} to reach ${dollars(goalTarget)} from its ${dollars(current)} earmarked funding. This is not confirmation those contributions are affordable.`);
      } else {
        lines.unshift(`I cannot estimate when ${label(goal.name)} will reach ${dollars(goalTarget)} without a contribution amount and frequency. Its ${dollars(goalTarget-current)} remaining target is not a per-contribution amount.`);
        missing.push("State a contribution amount and frequency for a goal timeline");
      }
    }
  }
  missing.push(...requireSources(snapshot,sources));
  return {text:lines.join("\n\n"),facts,sources,assumptions,missing:[...new Set(missing)],scenario:request.operation==="scenario" || request.scenario!==null};
}
