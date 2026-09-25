import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisInterpreterPrompt, interpretAnalysisQuestion, validateRequestSemantics, validateAnalysisPlan, normalizeRelativeWeekdayPlan, explicitUnsupportedForecastScope, deterministicAnalysisPlan } from './analysisSemantics.ts';
import { calculateFinancialAnalysis } from './analysisPlanner.ts';
import { loadAnalysisSnapshot } from './analysisSnapshot.ts';
import { createFloEvaluationClient, evaluationHousehold, evaluationNow } from '../../../scripts/flo-evaluation-fixture.ts';

const incomeBalance=(patch={})=>({purpose:'forecast_balance',domain:'forecast',operation:'summary',amountRole:'none',amount:null,accountGroup:null,contribution:null,startDate:null,endDate:null,dateEvent:'after_payday',entity:'Salary',merchant:null,category:null,comparisonStart:null,comparisonEnd:null,target:'none',debtMethod:'snowball',scenario:null,...patch});

test('named income forecast is valid and preserves entity through language interpretation',async()=>{
  for(const question of ['What will I have after Salary arrives?','What will my balance be once Salary is deposited?','How much will remain when Salary comes in?']) {
    let calls=0;
    const interpreted=await interpretAnalysisQuestion(question,async()=>{calls++;return {legacy:false,requests:[incomeBalance()]};},'2026-09-10');
    assert.equal(calls,1,question);
    assert.equal(interpreted.requests[0].entity,'Salary');
    assert.equal(interpreted.requests[0].dateEvent,'after_payday');
    assert.equal(interpreted.requests[0].purpose,'forecast_balance');
    assert.equal(interpreted.requests[0].accountGroup,null);
  }
});

test('prompt distinguishes named income cutoff from allocation and named bank account scope',()=>{
  const prompt=analysisInterpreterPrompt({today:'2026-09-10',timeZone:'America/Chicago',debtMethod:'snowball'});
  assert.match(prompt,/entity then identifies the income event, NOT a bank account/);
  assert.match(prompt,/Do not replace a named income with the household's earliest other paycheck/);
  assert.match(prompt,/Use paycheck_allocation only for an explicit request to split or allocate income/);
  assert.match(prompt,/Ordinary named bank-account forecasts remain unsupported/);
  assert.equal(validateRequestSemantics(incomeBalance()),null);
  assert.match(validateRequestSemantics(incomeBalance({purpose:'paycheck_allocation',domain:'paycheck',operation:'plan'})),/household paycheck plan/);
});

test('named income determines cutoff even when another household income arrives first',async()=>{
  const snapshot=await loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow);
  snapshot.sources.incomes.rows.push({...snapshot.sources.incomes.rows[0],id:'other-income',name:'Side Gig',amount:100,frequency:'monthly',start_date:'2026-09-10',next_payment_date:'2026-09-10'});
  const named=calculateFinancialAnalysis(snapshot,incomeBalance());
  const generic=calculateFinancialAnalysis(snapshot,incomeBalance({entity:null}));
  assert.equal(named.facts.targetDate,'2026-09-11');
  assert.equal(named.facts.nextPayday,'2026-09-11');
  assert.equal(generic.facts.targetDate,'2026-09-10');
  assert.ok(named.facts.projectedBalance>generic.facts.projectedBalance);
  const before=calculateFinancialAnalysis(snapshot,incomeBalance({dateEvent:'before_payday'}));
  assert.equal(before.facts.targetDate,'2026-09-10');
  assert.ok(before.facts.projectedBalance<named.facts.projectedBalance);
});

test('income schedule misroute becomes a balance after the same named income, not a generic payday',async()=>{
  const r=incomeBalance({purpose:'general',domain:'income',operation:'detail',dateEvent:'next_payday'});
  const interpreted=await interpretAnalysisQuestion('What will I have after Salary arrives?',async()=>({legacy:false,requests:[r]}),'2026-09-10');
  assert.equal(interpreted.requests[0].domain,'forecast');assert.equal(interpreted.requests[0].purpose,'forecast_balance');
  assert.equal(interpreted.requests[0].dateEvent,'after_payday');assert.equal(interpreted.requests[0].entity,'Salary');
  const snapshot=await loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow);
  const answer=calculateFinancialAnalysis(snapshot,interpreted.requests[0]);
  assert.equal(answer.facts.projectedBalance,2000);assert.equal(answer.facts.targetDate,'2026-09-11');
  const incomeOnly=await interpretAnalysisQuestion('How much is my next Salary deposit?',async()=>({legacy:false,requests:[r]}),'2026-09-10');
  assert.equal(incomeOnly.requests[0].domain,'income');
});

test('missing income name cannot silently become all incomes or a named bank account forecast',async()=>{
  const snapshot=await loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow);
  const missing=calculateFinancialAnalysis(snapshot,incomeBalance({entity:'Not a recorded income'}));
  assert.match(missing.text,/exactly one recorded income source/);
  assert.equal(missing.facts.projectedBalance,undefined);
  assert.ok(missing.missing.length);
  const account=calculateFinancialAnalysis(snapshot,incomeBalance({entity:'Main Checking',dateEvent:'none'}));
  assert.match(account.text,/not an individual named account/);
  assert.equal(account.facts.projectedBalance,undefined);
});

test('unqualified pay reductions default once without changing the signed amount or payday cutoff',async()=>{
  const r=incomeBalance({entity:null,dateEvent:'next_payday',scenario:{kind:'income_change',amount:-200,amountMode:null,date:'2026-09-10',entity:null,repeat:'monthly'}});
  for(const question of ['What if my pay falls $200?','Suppose my salary is lower by $200 next month?','What if my paycheck drops by two hundred dollars?']) {
    assert.ok(validateAnalysisPlan(question,{legacy:false,requests:[r]},'2026-09-10').length);
    let calls=0;
    const interpreted=await interpretAnalysisQuestion(question,async()=>{calls++;return{legacy:false,requests:[r]};},'2026-09-10');
    assert.equal(calls,1);
    assert.equal(interpreted.requests[0].scenario.repeat,'once');
    assert.equal(interpreted.requests[0].scenario.amount,-200);
    assert.equal(interpreted.requests[0].dateEvent,'next_payday');
  }
  for(const question of ['What if my pay falls $200 every month?','What if my salary is lower by $200 going forward?','What if it falls again?']) {
    const interpreted=await interpretAnalysisQuestion(question,async()=>({legacy:false,requests:[r]}),'2026-09-10');
    assert.equal(interpreted.requests[0].scenario.repeat,'monthly',question);
  }
});

test('single bill date move does not inherit its monthly bill recurrence',async()=>{
  const r=incomeBalance({domain:'bills',entity:null,dateEvent:'none',scenario:{kind:'move_bill',amount:0,amountMode:null,date:'2026-09-20',sourceDate:'2026-09-15',entity:'Rent',repeat:'monthly'}});
  const interpreted=await interpretAnalysisQuestion('What if I move Rent from September 15 to September 20?',async()=>({legacy:false,requests:[r]}),'2026-09-10');
  assert.deepEqual(interpreted.requests[0].scenario,{...r.scenario,repeat:'once'});
  const snapshot=await loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow);
  const answer=calculateFinancialAnalysis(snapshot,interpreted.requests[0]);
  assert.equal(answer.scenario,true);
  assert.equal(answer.missing.some(s=>/single source occurrence/.test(s)),false);
  const repeated=await interpretAnalysisQuestion('What if I move Rent every month from the fifteenth to the twentieth?',async()=>({legacy:false,requests:[r]}),'2026-09-10');
  assert.equal(repeated.requests[0].scenario.repeat,'monthly');
  const unsupported=calculateFinancialAnalysis(snapshot,repeated.requests[0]);
  assert.match(unsupported.text,/Recurring date changes need individual dates/);
});

test('next-weekday future money balance corrects domain and date without dropping scope',async()=>{
  for(const dateEvent of ['none','next_payday']) {
    const r=incomeBalance({purpose:'general',domain:'money',entity:null,dateEvent,endDate:'2026-09-17'});
    const q='How much will I have next Friday?';
    assert.ok(validateAnalysisPlan(q,{legacy:false,requests:[r]},'2026-09-10').length);
    let calls=0;
    const interpreted=await interpretAnalysisQuestion(q,async()=>{calls++;return{legacy:false,requests:[r]};},'2026-09-10');
    assert.equal(calls,1);assert.equal(interpreted.requests[0].endDate,'2026-09-11');
    assert.equal(interpreted.requests[0].domain,'forecast');assert.equal(interpreted.requests[0].dateEvent,'none');
  }
  const named={legacy:false,requests:[incomeBalance({purpose:'general',domain:'money',entity:'Main Checking',dateEvent:'none',endDate:'2026-09-17'})]};
  const normalized=normalizeRelativeWeekdayPlan('How much will I have in Main Checking next Friday?',named,'2026-09-10');
  assert.equal(normalized.requests[0].entity,'Main Checking');assert.equal(normalized.requests[0].endDate,'2026-09-11');
  const savings={legacy:false,requests:[incomeBalance({domain:'money',accountGroup:'savings',entity:null,dateEvent:'none'})]};
  const scope=normalizeRelativeWeekdayPlan('What will my savings balance be next Friday?',savings,'2026-09-10');
  assert.equal(scope.requests[0].accountGroup,'savings');assert.match(validateRequestSemantics(scope.requests[0]),/not supported/);
  const qualified='How much will I have next Friday after payday?';
  assert.equal(normalizeRelativeWeekdayPlan(qualified,named,'2026-09-10'),named);
  const wrongPlan={legacy:false,requests:[incomeBalance({domain:'forecast',operation:'plan',entity:null,dateEvent:'none',accountGroup:'all',endDate:'2026-09-17'})]};
  const fixed=await interpretAnalysisQuestion('How much will I have next Friday?',async()=>wrongPlan,'2026-09-10');
  assert.equal(fixed.requests[0].operation,'summary');assert.equal(fixed.requests[0].accountGroup,null);assert.equal(fixed.requests[0].endDate,'2026-09-11');
});

test('literal timeline unit is preserved separately from target and contribution',async()=>{
  const r=incomeBalance({purpose:'buffer_timeline',domain:'buffer',operation:'plan',amount:1000,amountRole:'target_balance',entity:null,dateEvent:'none',timelineUnit:null});
  const count=await interpretAnalysisQuestion('How many paychecks until I have a $1000 buffer?',async()=>({legacy:false,requests:[r]}),'2026-09-10');
  assert.equal(count.requests[0].timelineUnit,'household_paydays');assert.equal(count.requests[0].contribution,null);assert.equal(count.requests[0].amount,1000);
  const months=await interpretAnalysisQuestion('How many months until I have a $1000 buffer saving $100 monthly?',async()=>({legacy:false,requests:[{...r,contribution:{amount:100,frequency:'monthly'}}]}),'2026-09-10');
  assert.equal(months.requests[0].timelineUnit,'months');assert.equal(months.requests[0].contribution.amount,100);
});

test('explicit future savings and combined groups cannot be dropped by a null model accountGroup',async()=>{
  for(const [question,expected] of [
    ['How much will I have in savings next Friday?','savings'],
    ['What will my savings balance be next month?','savings'],
    ['How much will I have across all my accounts next Friday?','all'],
    ['What will my checking and savings balance be next Friday?','all'],
  ]) {
    assert.equal(explicitUnsupportedForecastScope(question),expected);
    const wrong={legacy:false,requests:[incomeBalance({entity:null,dateEvent:'none',accountGroup:null})]};
    await assert.rejects(interpretAnalysisQuestion(question,async()=>wrong,'2026-09-10'),/structured_output_invalid/);
  }
  for(const q of ['What is my savings balance?','How long to reach my savings goal?','How much will I have next Friday?','How much will I have in savings next Friday and when will I pay off my debt?'])assert.equal(explicitUnsupportedForecastScope(q),null,q);
});

test('savings balance history retains its group without permitting mismatched or combined history',async()=>{
  const r=incomeBalance({purpose:'balance_history',domain:'savings',operation:'compare',entity:null,dateEvent:'none',accountGroup:'savings',startDate:'2026-06-01',endDate:'2026-09-10'});
  assert.equal(validateRequestSemantics(r),null);
  assert.match(validateRequestSemantics({...r,domain:'money'}),/not supported/);
  assert.match(validateRequestSemantics({...r,accountGroup:'all'}),/not supported/);
  assert.match(validateRequestSemantics({...r,purpose:'forecast_balance',domain:'forecast'}),/not supported/);
  const interpreted=await interpretAnalysisQuestion('Has my savings balance grown?',async()=>({legacy:false,requests:[r]}),'2026-09-10');
  assert.equal(interpreted.requests[0].domain,'savings');assert.equal(interpreted.requests[0].accountGroup,'savings');
});

test('explicit trailing month review cannot collapse to a current-month default or action-plan days',async()=>{
  const r=incomeBalance({purpose:'general',domain:'review',operation:'compare',entity:null,dateEvent:'none',planDays:90});
  for(const question of ['Am I improving over the past three months?','Review my financial progress over the last 3 months.']) {
    assert.ok(validateAnalysisPlan(question,{legacy:false,requests:[r]},'2026-09-10').some(s=>/trailing-month/.test(s)));
    const interpreted=await interpretAnalysisQuestion(question,async()=>({legacy:false,requests:[r]}),'2026-09-10');
    const request=interpreted.requests[0];
    assert.equal(request.startDate,'2026-06-11');assert.equal(request.endDate,'2026-09-10');assert.equal(request.planDays,null);
    assert.equal(request.comparisonEnd,'2026-06-10');
    assert.equal(Date.parse(request.endDate)-Date.parse(request.startDate),Date.parse(request.comparisonEnd)-Date.parse(request.comparisonStart));
    const snapshot=await loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow);
    const answer=calculateFinancialAnalysis(snapshot,request);
    assert.equal(answer.facts.review_startDate,'2026-06-11');assert.equal(answer.facts.review_endDate,'2026-09-10');
    assert.match(answer.text,/2026-06-11 through 2026-09-10/);
  }
  const endOfMonth=await interpretAnalysisQuestion('Review the past one month.',async()=>({legacy:false,requests:[r]}),'2026-03-31');
  assert.equal(endOfMonth.requests[0].startDate,'2026-03-01');assert.equal(endOfMonth.requests[0].endDate,'2026-03-31');
  const explicit=await interpretAnalysisQuestion('Review the last three complete calendar months.',async()=>({legacy:false,requests:[{...r,planDays:null,startDate:'2026-06-01',endDate:'2026-08-31'}]}),'2026-09-10');
  assert.equal(explicit.requests[0].startDate,'2026-06-01');assert.equal(explicit.requests[0].endDate,'2026-08-31');
});

test('full subscription cancellation covers future occurrences while explicit skips remain single',async()=>{
  const r=incomeBalance({entity:null,dateEvent:'none',scenario:{kind:'cancel_bill',amount:0,amountMode:null,date:'2026-09-10',sourceDate:'2026-09-24',entity:'Streaming',repeat:'once'}});
  const snapshot=await loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow);
  for(const [question,date,expected,dates] of [['What if I cancel Streaming?','2026-09-10',30,'2026-09-24, 2026-10-24'],['What if I unsubscribe from Streaming starting next month?','2026-10-01',30,'2026-10-24, 2026-11-24']]) {
    const dated={...r,scenario:{...r.scenario,date}};
    assert.ok(validateAnalysisPlan(question,{legacy:false,requests:[dated]},'2026-09-10').some(s=>/Full named subscription cancellation/.test(s)));
    const interpreted=await interpretAnalysisQuestion(question,async()=>({legacy:false,requests:[dated]}),'2026-09-10');
    assert.equal(interpreted.requests[0].scenario.repeat,'monthly');assert.equal(interpreted.requests[0].scenario.sourceDate,null);
    assert.equal(interpreted.requests[0].scenario.date,date);
    const answer=calculateFinancialAnalysis(snapshot,interpreted.requests[0]);
    assert.equal(answer.facts.scenarioEndBalance-answer.facts.baselineEndBalance,expected);
    assert.ok(answer.assumptions.join(' ').includes(dates));
  }
  for(const question of ['What if I skip Streaming this month?','What if I cancel Streaming for this month only?','What if I skip just one Streaming payment?']) {
    const interpreted=await interpretAnalysisQuestion(question,async()=>({legacy:false,requests:[{...r,scenario:{...r.scenario,repeat:'monthly'}}]}),'2026-09-10');
    assert.equal(interpreted.requests[0].scenario.repeat,'once');
    const answer=calculateFinancialAnalysis(snapshot,interpreted.requests[0]);
    assert.equal(answer.facts.scenarioEndBalance-answer.facts.baselineEndBalance,15);
    assert.match(answer.assumptions.join(' '),/one occurrence/);
  }
});

test('current health assessment retains forward and historical risk evidence, not a one-day checklist',async()=>{
  const prompt=analysisInterpreterPrompt({today:'2026-09-10',timeZone:'America/Chicago',debtMethod:'snowball'});
  assert.match(prompt,/ONE general\/health\/summary assessment, not action_plan/);
  assert.match(prompt,/not a one-day forecast/);
  assert.match(prompt,/independently requests both an assessment and an action plan, preserve both/);
  const health=incomeBalance({purpose:'general',domain:'health',entity:null,dateEvent:'none',planDays:null});
  const interpreted=await interpretAnalysisQuestion('How is my financial health, and what is my biggest risk right now?',async()=>({legacy:false,requests:[health]}),'2026-09-10');
  const snapshot=await loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow);
  const answer=calculateFinancialAnalysis(snapshot,interpreted.requests[0]);
  assert.equal(answer.facts.cashCushion,200);
  assert.equal(typeof answer.facts.minimumBalance,'number');assert.equal(typeof answer.facts.minimumDate,'string');
  assert.equal(answer.facts.nextPayday,'2026-09-11');assert.equal(answer.facts.nextPaycheck,1500);
  assert.equal(answer.facts.planStatus,undefined);assert.equal(answer.facts.startDate,undefined);
  assert.ok(answer.missing.some(s=>/recorded pre-payday balances|classified income and expenses/.test(s)));
  const action={...health,purpose:'action_plan',domain:'stability',operation:'plan',planDays:30};
  const compound=await interpretAnalysisQuestion('Assess my financial health and make a 30-day action plan.',async()=>({legacy:false,requests:[health,action]}),'2026-09-10');
  assert.equal(compound.requests.length,2);assert.equal(compound.requests[1].purpose,'action_plan');
});

test('purchase-date search rejects scenario precedence and repair preserves the earliest-date calculation',async()=>{
  const valid=incomeBalance({purpose:'affordability',domain:'purchase',operation:'plan',entity:null,dateEvent:'none',amount:250,amountRole:'purchase_amount'});
  const wrong={...valid,scenario:{kind:'purchase',amount:250,amountMode:null,date:'2026-09-10',sourceDate:null,entity:null,repeat:'once'}};
  assert.match(validateRequestSemantics(wrong),/purchase-date search requires purchase\/plan with scenario null/i);
  assert.match(validateRequestSemantics({...wrong,purpose:'general'}),/purchase-date search/);
  let calls=0;
  const interpreted=await interpretAnalysisQuestion('When is the earliest safe day to buy a $250 appliance?',async correction=>{
    calls++;if(calls===2)assert.match(correction,/scenario null/);
    return {legacy:false,requests:[calls===1?wrong:valid]};
  },'2026-09-10');
  assert.equal(calls,2);assert.equal(interpreted.requests[0].scenario,null);
  const snapshot=await loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow);
  const answer=calculateFinancialAnalysis(snapshot,interpreted.requests[0]);
  assert.ok(Object.hasOwn(answer.facts,'earliestProjectedPurchaseDate'));
  assert.equal(answer.facts.scenarioEndBalance,undefined);assert.equal(answer.scenario,false);
  assert.equal(validateRequestSemantics({...wrong,operation:'scenario'}),null);
});

test('condition assessments reject current money or a checklist but preserve independently requested plans',async()=>{
  const health=incomeBalance({purpose:'general',domain:'health',entity:null,dateEvent:'none',planDays:null});
  const action={...health,purpose:'action_plan',domain:'stability',operation:'plan',startDate:'2026-09-10',endDate:'2026-09-10'};
  for(const question of ['How is my financial health, and what is my biggest risk right now?','Am I still living paycheck to paycheck?']) {
    for(const wrong of [action,{...health,domain:'money'}])assert.ok(validateAnalysisPlan(question,{legacy:false,requests:[wrong]},'2026-09-10').some(s=>/financial-condition assessment/.test(s)));
    let calls=0;
    const interpreted=await interpretAnalysisQuestion(question,async()=>({legacy:false,requests:[++calls===1?action:health]}),'2026-09-10');
    assert.equal(calls,2);assert.equal(interpreted.requests[0].domain,'health');
  }
  assert.deepEqual(validateAnalysisPlan('Make me a plan to stop living paycheck to paycheck.',{legacy:false,requests:[{...action,startDate:null,endDate:null}]}),[]);
  assert.deepEqual(validateAnalysisPlan('Assess my financial health and make a plan.',{legacy:false,requests:[health,action]}),[]);
});

test('required debt minimums cannot masquerade as principal history, while compound history survives',async()=>{
  const debt=incomeBalance({purpose:'general',domain:'debt',entity:null,dateEvent:'none'});
  const history={...debt,purpose:'balance_history'};
  const question='What required minimum payments remain?';
  assert.ok(validateAnalysisPlan(question,{legacy:false,requests:[history]}).some(s=>/general\/debt/.test(s)));
  let calls=0;
  const interpreted=await interpretAnalysisQuestion(question,async()=>({legacy:false,requests:[++calls===1?history:debt]}),'2026-09-10');
  assert.equal(calls,2);assert.equal(interpreted.requests[0].purpose,'general');
  const snapshot=await loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow);
  const answer=calculateFinancialAnalysis(snapshot,interpreted.requests[0]);
  assert.match(answer.text,/required obligations total \$35\.00, with \$35\.00 remaining/i);assert.doesNotMatch(answer.text,/historical principal/i);
  const compound=await interpretAnalysisQuestion('What minimum payments remain, and how has my debt balance changed?',async()=>({legacy:false,requests:[debt,history]}),'2026-09-10');
  assert.equal(compound.requests.length,2);assert.equal(compound.requests[1].purpose,'balance_history');
});

test('merchant amount questions aggregate beyond the eight-row transaction display limit',async()=>{
  const total=incomeBalance({purpose:'general',domain:'spending',operation:'summary',entity:null,merchant:'Walmart',dateEvent:'none',startDate:'2026-08-01',endDate:'2026-08-31'});
  const search={...total,domain:'transactions',operation:'search'};
  const question='How much did I spend at Walmart last month?';
  assert.ok(validateAnalysisPlan(question,{legacy:false,requests:[search]}).some(s=>/spending aggregation/.test(s)));
  let calls=0;
  const interpreted=await interpretAnalysisQuestion(question,async()=>({legacy:false,requests:[++calls===1?search:total]}),'2026-09-10');
  assert.equal(calls,2);assert.equal(interpreted.requests[0].merchant,'Walmart');
  const snapshot=await loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow);
  for(let i=0;i<12;i++)snapshot.sources.transactions.rows.push({id:`extra-walmart-${i}`,date:`2026-08-${String(i+1).padStart(2,'0')}`,amount:-10,category:'Groceries',merchant_name:'Walmart',note:'Walmart',account_id:'checking'});
  const answer=calculateFinancialAnalysis(snapshot,interpreted.requests[0]);
  assert.equal(answer.facts.spending,520);assert.match(answer.text,/\$520\.00 in recorded net spending/);
  assert.equal(answer.facts.matchCount,undefined);
  assert.deepEqual(validateAnalysisPlan('Show my Walmart purchases last month.',{legacy:false,requests:[search]}),[]);
  const listed=calculateFinancialAnalysis(snapshot,search);
  assert.equal(listed.facts.matchCount,13);assert.match(listed.text,/eight most recent/);
  const compound=await interpretAnalysisQuestion('How much did I spend at Walmart last month, and show the purchases?',async()=>({legacy:false,requests:[total,search]}),'2026-09-10');
  assert.equal(compound.requests.length,2);
});

test('present buffer questions use the available-buffer assessment, never an unstated target timeline',async()=>{
  const current=incomeBalance({purpose:'general',domain:'buffer',operation:'summary',entity:null,dateEvent:'none',target:'none',contribution:null});
  const wrong={...current,purpose:'buffer_timeline',operation:'plan'};
  for(const question of ['What is my buffer now?','What is our current cash cushion?','How much buffer do I have right now?']) {
    assert.ok(validateAnalysisPlan(question,{legacy:false,requests:[wrong]}).some(s=>/present buffer\/cushion assessment/.test(s)));
    let calls=0;
    const interpreted=await interpretAnalysisQuestion(question,async()=>({legacy:false,requests:[++calls===1?wrong:current]}),'2026-09-10');
    assert.equal(calls,2);assert.equal(interpreted.requests[0].purpose,'general');assert.equal(interpreted.requests[0].amount,null);
    const snapshot=await loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow);
    const answer=calculateFinancialAnalysis(snapshot,interpreted.requests[0]);
    assert.ok(Object.hasOwn(answer.facts,'currentPlanBuffer'));assert.equal(answer.facts.timelineOutcome,undefined);
    assert.doesNotMatch(answer.text,/What cash-buffer amount do you want/);
  }
  const target={...wrong,amount:1000,amountRole:'target_balance'};
  const compound=await interpretAnalysisQuestion('What is my buffer now, and when can I build a $1000 buffer?',async()=>({legacy:false,requests:[current,target]}),'2026-09-10');
  assert.equal(compound.requests.length,2);assert.equal(compound.requests[1].purpose,'buffer_timeline');assert.equal(compound.requests[1].amount,1000);
  const followup=await interpretAnalysisQuestion('How long until that target?',async()=>({legacy:false,requests:[target]}),'2026-09-10');
  assert.equal(followup.requests[0].purpose,'buffer_timeline');assert.equal(followup.requests[0].amount,1000);
});

test('ordinary bill-price changes apply to the schedule while explicitly temporary changes apply once',async()=>{
  const snapshot=await loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow);
  for(const [change,amount,mode,perOccurrence] of [['by $100',100,'delta',100],['to $1200',1200,'absolute',300]]) {
    const question=`What if Rent rises ${change}?`;
    const direct=deterministicAnalysisPlan(question,'2026-09-10');
    const request=direct.requests[0];
    assert.equal(request.scenario.repeat,'monthly');assert.equal(request.scenario.sourceDate,null);
    assert.equal(request.scenario.amount,amount);assert.equal(request.scenario.amountMode,mode);
    const answer=calculateFinancialAnalysis(snapshot,request);
    assert.equal(answer.facts.baselineEndBalance-answer.facts.scenarioEndBalance,perOccurrence*2);
    assert.match(answer.assumptions.join(' '),/2026-09-15, 2026-10-15/);
    const mistaken={...request,scenario:{...request.scenario,repeat:'once',sourceDate:'2026-09-15'}};
    assert.ok(validateAnalysisPlan(question,{legacy:false,requests:[mistaken]},'2026-09-10').some(s=>/normal bill-price increase/.test(s)));
    const fixed=await interpretAnalysisQuestion(question,async()=>({legacy:false,requests:[mistaken]}),'2026-09-10');
    assert.equal(fixed.requests[0].scenario.repeat,'monthly');assert.equal(fixed.requests[0].scenario.sourceDate,null);
    for(const suffix of ['once','for the next payment','for this month only']) {
      const one=deterministicAnalysisPlan(`What if Rent rises ${change} ${suffix}?`,'2026-09-10').requests[0];
      assert.equal(one.scenario.repeat,'once');
      const limited=calculateFinancialAnalysis(snapshot,one);
      assert.equal(limited.facts.baselineEndBalance-limited.facts.scenarioEndBalance,perOccurrence);
      assert.match(limited.assumptions.join(' '),/one occurrence/);
    }
  }
  const scoped=incomeBalance({purpose:'forecast_balance',domain:'forecast',operation:'scenario',entity:null,dateEvent:'none',scenario:{kind:'bill_increase',amount:100,amountMode:'delta',date:'2026-10-01',sourceDate:'2026-10-15',entity:'Rent',repeat:'once'}});
  const explicit=await interpretAnalysisQuestion('What if my next Rent payment increases by $100 on October 15 only?',async()=>({legacy:false,requests:[scoped]}),'2026-09-10');
  assert.deepEqual(explicit.requests[0].scenario,scoped.scenario);
});
