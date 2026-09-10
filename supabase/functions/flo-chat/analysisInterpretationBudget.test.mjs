import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spendingAnalysis } from './analysisSpending.ts';
import { interpretationAttemptMs, analysisInterpreterPrompt, validateAnalysisPlan, interpretAnalysisQuestion, safeAnalysisFailureCodes, analysisInterpretationError, SEMANTIC_FAILURE_CODES, relativeWeekdayTarget, normalizeRelativeWeekdayPlan, currentSpendingComparison, deterministicAnalysisPlan, unresolvedContributionClarification } from './analysisSemantics.ts';
import { validateAnalysisRequest } from './analysisPlanner.ts';

test('initial valid interpretation can use existing repair allowance without enlarging total budget',()=>{
  assert.equal(interpretationAttemptMs(100,100,false),20000);
  assert.equal(interpretationAttemptMs(100,13100,false),7000);
  assert.equal(interpretationAttemptMs(100,13100,true),7000);
  assert.equal(interpretationAttemptMs(100,1100,true),19000);
  assert.equal(interpretationAttemptMs(100,7100,true),13000);
  assert.throws(()=>interpretationAttemptMs(100,20100,true),{name:'TimeoutError'});
  assert.throws(()=>interpretationAttemptMs(100,25100,false),{name:'TimeoutError'});
});

test('integrated allocation instruction preserves independent compound analyses',()=>{
  const prompt=analysisInterpreterPrompt({today:'2026-09-10',timeZone:'America/Chicago',debtMethod:'snowball'});
  assert.match(prompt,/normally ONE/);
  assert.match(prompt,/bills, spending, saving and debt is ONE integrated allocation/);
  assert.match(prompt,/independently asked question, such as a named debt payoff date/);
});

const allocation={purpose:'paycheck_allocation',domain:'paycheck',operation:'plan',amountRole:'none',amount:null,entity:null,scenario:null};
test('one allocation remains one call and independent named payoff survives validation',async()=>{
  let calls=0;
  const result=await interpretAnalysisQuestion('How should I split my next paycheck between bills, spending, saving and debt?',async()=>{calls++;return{legacy:false,requests:[allocation]};});
  assert.equal(calls,1);assert.equal(result.requests.length,1);
  const debt={...allocation,purpose:'debt_timeline',domain:'debt',entity:'CORE Test Card'};
  const compound=await interpretAnalysisQuestion('Split my next paycheck between bills and savings, and when will I pay off CORE Test Card?',async()=>({legacy:false,requests:[allocation,debt]}));
  assert.equal(compound.requests.length,2);assert.equal(compound.requests[1].entity,'CORE Test Card');
});

test('provider timeout is not retried as a semantic repair',async()=>{
  let calls=0;
  await assert.rejects(interpretAnalysisQuestion('Split my next paycheck',async()=>{calls++;throw new DOMException('answer_timeout','TimeoutError');}),{name:'TimeoutError'});
  assert.equal(calls,1);
});

test('fee cost question rejects generic transaction output and accepts classified fees',()=>{
  const question='What accounts cost me the most in fees?';
  assert.ok(validateAnalysisPlan(question,{legacy:false,requests:[{...allocation,purpose:'general',domain:'transactions',operation:'detail'}]}).length);
  assert.deepEqual(validateAnalysisPlan(question,{legacy:false,requests:[{...allocation,purpose:'general',domain:'fees',operation:'summary'}]}),[]);
});

test('ninety-day action plan is inclusive and does not accept a ninety-one-day window',()=>{
  const r={...allocation,purpose:'action_plan',domain:'stability',planDays:90,startDate:null,endDate:'2026-12-09'};
  assert.match(validateAnalysisRequest(r,'2026-09-10'),/inclusive/);
  assert.equal(validateAnalysisRequest({...r,endDate:'2026-12-08'},'2026-09-10'),null);
  assert.equal(validateAnalysisRequest({...r,endDate:null},'2026-09-10'),null);
  assert.ok(validateAnalysisPlan('What should I do over the next 90 days to get ahead?',{legacy:false,requests:[r]},'2026-09-10').length);
  assert.ok(validateAnalysisPlan('What should I do over the next 90 days to get ahead?',{legacy:false,requests:[{...r,planDays:30}]}).length);
});

test('scenario amount does not require an outer amount and forecast extrema are not timelines',()=>{
  const scenario={...allocation,purpose:'affordability',domain:'purchase',operation:'scenario',scenario:{kind:'purchase',amount:300,date:'2026-09-12',sourceDate:null,entity:null,repeat:'once'}};
  assert.deepEqual(validateAnalysisPlan('What if I spend $300 this weekend?',{legacy:false,requests:[scenario]}),[]);
  const lowest={...allocation,purpose:'forecast_balance',domain:'forecast',operation:'minimum',startDate:'2026-10-01',endDate:'2026-10-31'};
  assert.deepEqual(validateAnalysisPlan('What is my lowest balance next month?',{legacy:false,requests:[lowest]}),[]);
});

test('explicit checking threshold is not an additional buffer above cushion',()=>{
  const buffer={...allocation,purpose:'buffer_timeline',domain:'buffer',amount:1000,amountRole:'target_balance'};
  assert.ok(validateAnalysisPlan('When will checking reach $1000?',{legacy:false,requests:[buffer]}).length);
  const threshold={...buffer,purpose:'forecast_balance',domain:'forecast',operation:'threshold',amountRole:'threshold'};
  assert.deepEqual(validateAnalysisPlan('When will checking reach $1000?',{legacy:false,requests:[threshold]}),[]);
  assert.deepEqual(validateAnalysisPlan('When will I reach it?',{legacy:false,requests:[buffer]}),[]);
});

test('today plan preserves a one-day window while independent future requests remain possible',()=>{
  const question="Give me today's financial plan.";
  const r={...allocation,purpose:'action_plan',domain:'stability',planDays:30,startDate:null,endDate:null};
  assert.ok(validateAnalysisPlan(question,{legacy:false,requests:[r]},'2026-09-10').length);
  const today={...r,planDays:null,startDate:'2026-09-10',endDate:'2026-09-10'};
  assert.deepEqual(validateAnalysisPlan(question,{legacy:false,requests:[today]},'2026-09-10'),[]);
  assert.deepEqual(validateAnalysisPlan("Give me today's plan and a plan for the next 90 days",{legacy:false,requests:[today,{...r,planDays:90}]},'2026-09-10'),[]);
});

test('a start-only dated balance cannot become a month-end forecast',()=>{
  const r={...allocation,purpose:'forecast_balance',domain:'forecast',operation:'summary',dateEvent:'none',startDate:'2026-09-11',endDate:null};
  assert.match(validateAnalysisRequest(r,'2026-09-10'),/single forecast target/);
  assert.equal(validateAnalysisRequest({...r,startDate:null,endDate:'2026-09-11'},'2026-09-10'),null);
  assert.equal(validateAnalysisRequest({...r,operation:'minimum'},'2026-09-10'),null);
});

test('balance observation date is not an unrelated last-payment request',()=>{
  const balance={...allocation,purpose:'current_balance',domain:'money',operation:'detail'};
  const last={...allocation,purpose:'transaction_last',domain:'transactions',operation:'detail'};
  assert.ok(validateAnalysisPlan('What is my checking account balance, and when was it last updated?',{legacy:false,requests:[balance,last]}).length);
  assert.deepEqual(validateAnalysisPlan('What is my checking account balance, and when was it last updated?',{legacy:false,requests:[balance]}),[]);
  assert.deepEqual(validateAnalysisPlan('What is my checking balance and when was my last payment?',{legacy:false,requests:[balance,last]}),[]);
});

test('before-paycheck cutoff must exclude payday income without suppressing after-payday compound',()=>{
  const r={...allocation,purpose:'forecast_balance',domain:'forecast',operation:'summary',dateEvent:'next_payday',startDate:null,endDate:null};
  const q='What will be left before my next paycheck?';
  assert.ok(validateAnalysisPlan(q,{legacy:false,requests:[r]}).length);
  assert.deepEqual(validateAnalysisPlan(q,{legacy:false,requests:[{...r,dateEvent:'before_payday'}]}),[]);
  assert.deepEqual(validateAnalysisPlan('What is left before my next paycheck and after payday?',{legacy:false,requests:[{...r,dateEvent:'before_payday'},{...r,dateEvent:'after_payday'}]}),[]);
});

test('bill due cutoff cannot be consumed by elapsed settlement and next paycheck facts need income schedule',()=>{
  const bills={...allocation,purpose:'bill_settlement',domain:'bills',operation:'summary',dateEvent:'before_payday'};
  assert.ok(validateAnalysisPlan('What bills are due before payday?',{legacy:false,requests:[bills]}).length);
  assert.deepEqual(validateAnalysisPlan('What bills are due before payday?',{legacy:false,requests:[{...bills,purpose:'general'}]}),[]);
  assert.ok(validateAnalysisPlan('When and how much is my next paycheck?',{legacy:false,requests:[allocation]}).length);
  assert.deepEqual(validateAnalysisPlan('When and how much is my next paycheck?',{legacy:false,requests:[{...allocation,purpose:'general',domain:'income',operation:'summary',incomeTiming:'expected',dateEvent:'next_payday'}]}),[]);
});

test('minimum payments and last-month merchant totals preserve their own readers',()=>{
  const last={...allocation,purpose:'transaction_last',domain:'transactions',operation:'detail'};
  assert.ok(validateAnalysisPlan('How much did I spend at Walmart last month?',{legacy:false,requests:[last]}).length);
  assert.deepEqual(validateAnalysisPlan('How much did I spend at Walmart last month?',{legacy:false,requests:[{...last,purpose:'general',operation:'summary',merchant:'Walmart'}]}),[]);
  assert.ok(validateAnalysisPlan('What required minimum payments remain?',{legacy:false,requests:[{...last,domain:'bills',purpose:'bill_settlement'}]}).length);
  assert.deepEqual(validateAnalysisPlan('What required minimum payments remain?',{legacy:false,requests:[{...last,domain:'debt',purpose:'general',operation:'summary'}]}),[]);
});

test('built-in utilization threshold and transaction dollar filter do not become payment scenarios',()=>{
  const credit={...allocation,purpose:'general',domain:'credit',operation:'summary',entity:'Main Card'};
  assert.deepEqual(validateAnalysisPlan('What payment gets Main Card below 30%?',{legacy:false,requests:[credit]}),[]);
  assert.ok(validateAnalysisPlan('What payment gets Main Card below 30%?',{legacy:false,requests:[{...credit,amount:30,amountRole:'threshold'}]}).length);
  assert.deepEqual(validateAnalysisPlan('Find the $35 transaction',{legacy:false,requests:[{...allocation,purpose:'general',domain:'transactions',operation:'search',amount:35,amountRole:'threshold'}]}),[]);
});

test('semantic failure telemetry exports only bounded static codes, never model or question text',async()=>{
  let failure;
  try {await interpretAnalysisQuestion('How long to build a $1000 buffer?',async()=>({legacy:false,requests:[{...allocation,purpose:'general',domain:'savings',operation:'summary'}]}));}catch(error){failure=error;}
  assert.equal(failure.message,'structured_output_invalid');
  assert.ok(safeAnalysisFailureCodes(failure).length);
  assert.ok(safeAnalysisFailureCodes(failure).every(code=>SEMANTIC_FAILURE_CODES.includes(code)));
  assert.deepEqual(safeAnalysisFailureCodes({semanticFailureCodes:['secret user question',35,null,'schema_shape','schema_shape']}),['schema_shape']);
  assert.deepEqual(safeAnalysisFailureCodes(new Error('raw provider response')),[]);
  assert.deepEqual(safeAnalysisFailureCodes(analysisInterpretationError(['schema_shape'])),['schema_shape']);
  assert.ok(safeAnalysisFailureCodes({semanticFailureCodes:[...SEMANTIC_FAILURE_CODES,...SEMANTIC_FAILURE_CODES]}).length<=12);
});

test('bill amount rising to a new total cannot be passed as an added delta',()=>{
  const r={...allocation,purpose:'general',domain:'bills',scenario:{kind:'bill_increase',amount:1200,amountMode:'delta',date:'2026-10-01',entity:'Rent',repeat:'monthly'}};
  assert.ok(validateAnalysisPlan('What if rent rises to $1200?',{legacy:false,requests:[r]}).length);
  assert.deepEqual(validateAnalysisPlan('What if rent rises to $1200?',{legacy:false,requests:[{...r,scenario:{...r.scenario,amountMode:'absolute'}}]}),[]);
  assert.deepEqual(validateAnalysisPlan('What if rent rises by $100?',{legacy:false,requests:[{...r,scenario:{...r.scenario,amount:100}}]}),[]);
});

test('undated lower paycheck applies at payday while explicit future income keeps its date',()=>{
  const r={...allocation,purpose:'general',domain:'income',dateEvent:'none',scenario:{kind:'income_change',amount:-200,amountMode:null,date:'2026-09-10',entity:null,repeat:'once'}};
  assert.ok(validateAnalysisPlan('What if my paycheck is $200 lower?',{legacy:false,requests:[r]}).length);
  assert.deepEqual(validateAnalysisPlan('What if my paycheck is $200 lower?',{legacy:false,requests:[{...r,dateEvent:'next_payday'}]}),[]);
  assert.deepEqual(validateAnalysisPlan('What if my paycheck is $200 lower next month?',{legacy:false,requests:[{...r,scenario:{...r.scenario,date:'2026-10-01'}}]}),[]);
});

test('weekly financial review uses shared review and seven inclusive dates',()=>{
  const q='Give me a weekly financial review';
  const r={...allocation,purpose:'general',domain:'review',operation:'summary',startDate:'2026-09-03',endDate:'2026-09-10'};
  assert.ok(validateAnalysisPlan(q,{legacy:false,requests:[r]},'2026-09-10').length);
  assert.ok(validateAnalysisPlan(q,{legacy:false,requests:[{...r,domain:'spending',startDate:'2026-09-04'}]},'2026-09-10').length);
  assert.deepEqual(validateAnalysisPlan(q,{legacy:false,requests:[{...r,startDate:'2026-09-04'}]},'2026-09-10'),[]);
});

test('last-month review retains full historical window and independent focus; specific reviews untouched',()=>{
  const q='Review last month and tell me what to focus on';
  const r={...allocation,purpose:'general',domain:'review',operation:'summary',startDate:'2026-08-01',endDate:'2026-08-31'};
  assert.ok(validateAnalysisPlan(q,{legacy:false,requests:[{...r,purpose:'balance_history',domain:'money'}]},'2026-09-10').length);
  assert.deepEqual(validateAnalysisPlan(q,{legacy:false,requests:[r,{...allocation,purpose:'action_plan',domain:'stability'}]},'2026-09-10'),[]);
  assert.deepEqual(validateAnalysisPlan('Review my bill',{legacy:false,requests:[{...r,domain:'bills',entity:'Rent'}]},'2026-09-10'),[]);
});

test('next weekday uses deterministic household-calendar dates across week month and leap boundaries',()=>{
  assert.equal(relativeWeekdayTarget('What will my balance be next Friday?','2026-09-10'),'2026-09-11');
  assert.equal(relativeWeekdayTarget('Balance next Friday?','2026-09-11'),'2026-09-18');
  assert.equal(relativeWeekdayTarget('Balance next Friday?','2026-12-31'),'2027-01-01');
  assert.equal(relativeWeekdayTarget('Balance next Thursday?','2024-02-28'),'2024-02-29');
  for(const q of ['Balance between next Friday and Monday?','Balance next Friday, September 18?','Balance next Friday 9/18?','Balance next Friday of next week?','Balance next Friday after rent?','Compare next Friday versus Saturday'])assert.equal(relativeWeekdayTarget(q,'2026-09-10'),null);
});

test('runtime corrects wrong weekday without another model call and preserves request filters',async()=>{
  const r={...allocation,purpose:'forecast_balance',domain:'forecast',operation:'summary',dateEvent:'none',startDate:null,endDate:'2026-09-17',entity:'Checking One'};
  const q='What will my balance be next Friday?';
  assert.ok(validateAnalysisPlan(q,{legacy:false,requests:[r]},'2026-09-10').length);
  let calls=0;const plan=await interpretAnalysisQuestion(q,async()=>{calls++;return{legacy:false,requests:[r]};},'2026-09-10');
  assert.equal(calls,1);assert.equal(plan.requests[0].endDate,'2026-09-11');assert.equal(plan.requests[0].entity,'Checking One');
  const compound={legacy:false,requests:[r,{...r,operation:'minimum'}]};
  assert.equal(normalizeRelativeWeekdayPlan(q,compound,'2026-09-10'),compound);
  const generic={...r,purpose:'general'};
  assert.ok(validateAnalysisPlan(q,{legacy:false,requests:[generic]},'2026-09-10').length);
  const genericPlan=await interpretAnalysisQuestion(q,async()=>({legacy:false,requests:[generic]}),'2026-09-10');
  assert.equal(genericPlan.requests[0].endDate,'2026-09-11');assert.equal(genericPlan.requests[0].purpose,'forecast_balance');
});

test('generic checking threshold is not an invented named account; exact account names remain',async()=>{
  const r={...allocation,purpose:'forecast_balance',domain:'forecast',operation:'threshold',amount:1000,amountRole:'threshold',entity:'checking'};
  const plan=await interpretAnalysisQuestion('When will my checking balance reach $1000?',async()=>({legacy:false,requests:[r]}),'2026-09-10');
  assert.equal(plan.requests[0].entity,null);
  const named=await interpretAnalysisQuestion('When will my checking balance reach $1000 in the account named Checking One?',async()=>({legacy:false,requests:[{...r,entity:'Checking One'}]}),'2026-09-10');
  assert.equal(named.requests[0].entity,'Checking One');
  const wrongDomain={...r,domain:'money',purpose:'forecast_balance',amountRole:'none',amount:null};
  let calls=0;const corrected=await interpretAnalysisQuestion('When will my checking balance reach $1000?',async()=>{calls++;return{legacy:false,requests:[wrongDomain]};},'2026-09-10');
  assert.equal(calls,1);assert.equal(corrected.requests[0].domain,'forecast');assert.equal(corrected.requests[0].operation,'threshold');assert.equal(corrected.requests[0].amount,1000);assert.equal(corrected.requests[0].amountRole,'threshold');assert.equal(corrected.requests[0].entity,null);
});

test('future month-edge comparison rejects elapsed review and preserves deterministic two-window dates',async()=>{
  const q='Compare the last week this month with the first week next month.';
  const r={...allocation,purpose:'general',domain:'review',operation:'summary'};
  assert.ok(validateAnalysisPlan(q,{legacy:false,requests:[r]},'2026-09-10').length);
  let calls=0;const plan=await interpretAnalysisQuestion(q,async correction=>{calls++;return{legacy:false,requests:[correction?{...r,domain:'forecast',purpose:'forecast_balance',operation:'compare',startDate:'2026-09-23',endDate:'2026-09-30',comparisonStart:'2026-10-01',comparisonEnd:'2026-10-08'}:r]};},'2026-09-10');
  assert.equal(calls,2);
  const answer=plan.requests[0];assert.equal(answer.startDate,'2026-09-24');assert.equal(answer.endDate,'2026-09-30');assert.equal(answer.comparisonStart,'2026-10-01');assert.equal(answer.comparisonEnd,'2026-10-07');
});

test('unambiguous current spending comparison uses corresponding elapsed days without a repair call',async()=>{
  const question='Am I spending more than last month?';
  const r={...allocation,purpose:'general',domain:'spending',operation:'summary',startDate:'2026-08-01',endDate:'2026-08-31',comparisonStart:'2026-07-01',comparisonEnd:'2026-07-31'};
  let calls=0;const plan=await interpretAnalysisQuestion(question,async()=>{calls++;return{legacy:false,requests:[r]};},'2026-09-10');
  assert.equal(calls,1);const result=plan.requests[0];
  assert.equal(result.operation,'compare');assert.equal(result.startDate,'2026-09-01');assert.equal(result.endDate,'2026-09-10');assert.equal(result.comparisonStart,'2026-08-01');assert.equal(result.comparisonEnd,'2026-08-10');
  assert.equal(currentSpendingComparison(question,'2026-03-31').comparisonEnd,'2026-02-28');
  assert.equal(currentSpendingComparison(question,'2024-03-31').comparisonEnd,'2024-02-29');
  for(const q of ['Compare August with July','Am I spending more on groceries than last month?','Am I spending more than last month from September 5 through September 9?'])assert.equal(currentSpendingComparison(q,'2026-09-10'),null);
});

test('exact transaction amount lookup repairs incompatible last-purpose locally without losing filters',async()=>{
  for(const [question,amount] of [['Find the $35 transaction.',35],['What was this $74 charge?',74]]) {
    const r={...allocation,purpose:'transaction_last',domain:'transactions',operation:'search',amount:999,amountRole:'threshold',merchant:'Kept merchant',startDate:'2026-08-01',endDate:'2026-08-31'};
    let calls=0;const plan=await interpretAnalysisQuestion(question,async()=>{calls++;return{legacy:false,requests:[r]};},'2026-09-10');
    assert.equal(calls,1);assert.equal(plan.requests[0].purpose,'general');assert.equal(plan.requests[0].amount,amount);assert.equal(plan.requests[0].operation,'search');assert.equal(plan.requests[0].merchant,r.merchant);assert.equal(plan.requests[0].startDate,r.startDate);
  }
});

test('repair timeout keeps timeout identity and only the safe first-pass violation codes',async()=>{
  const error=new DOMException('answer_timeout','TimeoutError');let calls=0;
  await assert.rejects(interpretAnalysisQuestion('Find the $35 transaction.',async()=>{if(++calls===2)throw error;return{legacy:false,requests:[{...allocation,purpose:'general',domain:'spending',operation:'summary'}]};}),caught=>{
    assert.equal(caught,error);assert.equal(caught.name,'TimeoutError');assert.ok(safeAnalysisFailureCodes(caught).length);assert.ok(safeAnalysisFailureCodes(caught).every(code=>SEMANTIC_FAILURE_CODES.includes(code)));return true;
  });
  assert.equal(calls,2);
});

test('built-in credit utilization payment is not a debt timeline and preserves named card',async()=>{
  const r={...allocation,purpose:'debt_timeline',domain:'credit',entity:'Main Card',amount:30,amountRole:'threshold'};
  let calls=0;const plan=await interpretAnalysisQuestion('How much should I pay Main Card to get below 30% utilization?',async()=>{calls++;return{legacy:false,requests:[r]};});
  assert.equal(calls,1);assert.equal(plan.requests[0].purpose,'general');assert.equal(plan.requests[0].domain,'credit');assert.equal(plan.requests[0].entity,'Main Card');assert.equal(plan.requests[0].amount,null);assert.equal(plan.requests[0].amountRole,'none');
});

test('existing remaining category budget is not a new household budget draft',async()=>{
  for(const category of ['Groceries','Transport']) {
    const r={...allocation,purpose:'budget_plan',domain:'budget',category,startDate:'2026-09-01',endDate:'2026-09-30'};
    const plan=await interpretAnalysisQuestion(`How much is left in my ${category} budget?`,async()=>({legacy:false,requests:[r]}));
    assert.equal(plan.requests[0].purpose,'general');assert.equal(plan.requests[0].category,category);assert.equal(plan.requests[0].startDate,r.startDate);
    assert.deepEqual(validateAnalysisPlan(`Create a new budget using my remaining money`,{legacy:false,requests:[r]}),[]);
  }
});

test('bill move forecast purpose is compatible with canonical scenario dispatch but calendar guards remain',()=>{
  const r={...allocation,purpose:'forecast_balance',domain:'bills',operation:'scenario',startDate:null,endDate:'2026-09-20',dateEvent:'none',scenario:{kind:'move_bill',amount:0,amountMode:null,date:'2026-09-20',sourceDate:'2026-09-15',entity:'CORE Test Rent',repeat:'once'}};
  assert.equal(validateAnalysisRequest(r,'2026-09-10'),null);
  assert.deepEqual(validateAnalysisPlan('What if I move CORE Test Rent from September 15 to September 20?',{legacy:false,requests:[r]},'2026-09-10'),[]);
  assert.match(validateAnalysisRequest({...r,scenario:{...r.scenario,sourceDate:'2026-02-30'}},'2026-09-10'),/invalid/);
  assert.match(validateAnalysisRequest({...r,scenario:{...r.scenario,date:'2026-09-09'}},'2026-09-10'),/today or later/);
  assert.match(validateAnalysisRequest({...r,scenario:null},'2026-09-10'),/forecast calculator/);
  assert.match(validateAnalysisRequest({...r,domain:'debt',scenario:{...r.scenario,kind:'extra_debt'}},'2026-09-10'),/forecast calculator/);
});

test('emergency reserve months never become dollar amounts or contribution schedules',async()=>{
  for(const amountRole of ['threshold','contribution_amount']) {
    const r={...allocation,purpose:'general',domain:'emergency',operation:'summary',amount:3,amountRole,contribution:{amount:3,frequency:'monthly'}};
    let calls=0;const both=await interpretAnalysisQuestion('How much do I need for three and six months of emergency savings?',async()=>{calls++;return{legacy:false,requests:[r]};});
    assert.equal(calls,1);assert.equal(both.requests[0].amount,null);assert.equal(both.requests[0].amountRole,'none');assert.equal(both.requests[0].contribution,null);assert.equal(both.requests[0].target,'none');
    const six=await interpretAnalysisQuestion('How much do I need for 6 months of emergency savings?',async()=>({legacy:false,requests:[r]}));
    assert.equal(six.requests[0].target,'six_months');
  }
});

test('self-contained deterministic plans preserve typed intent slots and avoid dependence on model output',()=>{
  const cases=[['What will my balance be next Friday?','forecast'],['When will my checking balance reach $1000?','forecast'],['Compare the last week this month with the first week next month.','forecast'],['Am I spending more than last month?','spending'],['Find the $35 transaction.','transactions'],['How much do I need for three and six months of emergency savings?','emergency'],['What if CORE Test Rent increases to $1200?','forecast'],['What if my paycheck is $200 lower?','forecast'],['Should I put $100 toward debt or savings?','stability'],['What if I pay an extra $100 toward debt every month?','debt']];
  for(const [question,domain] of cases){const plan=deterministicAnalysisPlan(question,'2026-09-10','avalanche');assert.ok(plan,question);assert.equal(plan.requests[0].domain,domain);assert.equal(validateAnalysisRequest(plan.requests[0],'2026-09-10'),null,question);assert.equal(plan.requests[0].debtMethod,'avalanche');}
  const rent=deterministicAnalysisPlan(cases[6][0],'2026-09-10').requests[0];assert.equal(rent.scenario.amountMode,'absolute');assert.equal(rent.scenario.entity,'CORE Test Rent');assert.equal(rent.scenario.repeat,'once');
  const pay=deterministicAnalysisPlan(cases[7][0],'2026-09-10').requests[0];assert.equal(pay.scenario.amount,-200);assert.equal(pay.dateEvent,'next_payday');
  const add=deterministicAnalysisPlan('What if I add $100 per month toward my debt?','2026-09-10','avalanche').requests[0];assert.equal(add.scenario.amount,100);assert.equal(add.scenario.repeat,'monthly');assert.equal(add.debtMethod,'avalanche');
  for(const question of ['What will my Main Checking balance be next Friday?','What if Rent increases to $1200 monthly starting October 1?','What if my rent increases by $100?','What if our rent increases by $100?','What if the rent increases by $100?','What if "CORE Test Rent" increases by $100?','Should I put $100 toward debt or savings next month?','Find the $35 transaction at Walmart last month','What if I pay an extra $100 toward Main Card debt every month?'])assert.equal(deterministicAnalysisPlan(question,'2026-09-10'),null,question);
});

test('runtime skips direct grammar plans when conversation context exists and clarifies orphan before interpretation',()=>{
  const source=readFileSync(new URL('./analysisPlanner.ts',import.meta.url),'utf8');
  assert.match(source,/prior\.length===0\?deterministicAnalysisPlan\(question,today,settings\?\.payment_method/);
  assert.ok(source.indexOf('if(clarification)return recordAnalysis')<source.indexOf('const interpret='));
  assert.match(source,/if\(clarification\)return recordAnalysis\(runtime,\[clarification\],null,\{inputTokens:0,outputTokens:0\}\)/);
  assert.match(source,/data:priorRows,error:historyError/);
  assert.ok(source.indexOf('if(historyError)return recordAnalysis')<source.indexOf('const prior='));
  assert.ok(source.indexOf('if(historyError)return recordAnalysis')<source.indexOf('const interpret='));
  assert.match(source,/Conversation context could not be verified/);
  assert.ok(source.indexOf('if(error)return recordAnalysis')<source.indexOf('let timeZone='));
  assert.match(source,/Household planning settings could not be verified/);
  assert.match(source,/:\{data:\[\],error:null\}/);
});

test('orphan contribution asks its target without invented financial facts and preserves conversation followups',()=>{
  const question='I can contribute $100 per paycheck.';
  const result=unresolvedContributionClarification(question,[]);assert.ok(result);assert.match(result.text,/cash buffer, a savings goal, or debt/);assert.deepEqual(result.facts,{});assert.deepEqual(result.sources,[]);
  assert.equal(unresolvedContributionClarification(question,['How long to build a $1000 buffer?']),null);
  assert.equal(unresolvedContributionClarification('I can contribute $100 per paycheck toward my Trip goal.',[]),null);
});

test('bare contribution followup adds literal cadence while preserving model-resolved target and named goal',async()=>{
  for(const [domain,purpose,entity] of [['buffer','buffer_timeline',null],['savings','goal_timeline','Trip']]) {
    const r={...allocation,domain,purpose,entity,amount:1000,amountRole:'target_balance',contribution:{amount:1000,frequency:'monthly'}};
    const plan=await interpretAnalysisQuestion('I can contribute $100 per paycheck.',async()=>({legacy:false,requests:[r]}),'2026-09-10');
    assert.equal(plan.requests[0].amount,1000);assert.equal(plan.requests[0].entity,entity);assert.deepEqual(plan.requests[0].contribution,{amount:100,frequency:'paycheck'});
  }
});

test('after-bill balance uses canonical bill selector and current purchase safety is not a future date search',async()=>{
  const after=deterministicAnalysisPlan('What will remain after Rent is paid?','2026-09-10').requests[0];assert.equal(after.domain,'forecast');assert.equal(after.dateEvent,'after_bill');assert.equal(after.entity,'Rent');
  const corrected=await interpretAnalysisQuestion('What will remain after Rent is paid?',async()=>({legacy:false,requests:[{...allocation,domain:'forecast',purpose:'forecast_balance',operation:'summary',dateEvent:'none',entity:'Rent'}]}),'2026-09-10');assert.equal(corrected.requests[0].dateEvent,'after_bill');
  const current=deterministicAnalysisPlan('Can I afford a $250 purchase?','2026-09-10').requests[0];assert.equal(current.operation,'summary');assert.equal(current.amount,250);assert.equal(current.startDate,'2026-09-10');assert.equal(current.endDate,'2026-09-10');
  const future={...current,operation:'plan',startDate:null,endDate:null};assert.deepEqual(validateAnalysisPlan('When can I afford a $250 purchase?',{legacy:false,requests:[future]}),[]);assert.equal(deterministicAnalysisPlan('When can I afford a $250 purchase?','2026-09-10'),null);
});

test('undated average income defaults complete months and incomplete history still stays unavailable',()=>{
  const sources=Object.fromEntries(['transactions','plaid_transactions','plaid_accounts','bills','goals'].map(t=>[t,{rows:[],complete:true}]));sources.transactions.rows=[6,7,8].map(m=>({id:`pay${m}`,date:`2026-0${m}-10`,amount:1200,category:'Income'}));const s={today:'2026-09-10',sources};
  const plan=deterministicAnalysisPlan('What is my average monthly income?',s.today);assert.equal(plan.requests[0].startDate,'2026-06-01');assert.equal(plan.requests[0].endDate,'2026-08-31');
  const r=spendingAnalysis(s,{...plan.requests[0],startDate:null,endDate:null});assert.equal(r.facts.averageMonthlyIncome,1200);assert.equal(r.facts.startDate,'2026-06-01');assert.equal(r.facts.endDate,'2026-08-31');assert.deepEqual(r.missing,[]);
  sources.transactions.rows=[];const absent=spendingAnalysis(s,plan.requests[0]);assert.equal(absent.facts.averageMonthlyIncome,undefined);assert.ok(absent.missing.some(x=>/does not cover/.test(x)));
});

test('where spending rose comparison never overlaps current and previous windows',async()=>{
  const q='Where did spending rise compared with last month?';const r={...allocation,purpose:'general',domain:'spending',operation:'compare',groupBy:'category',startDate:'2026-09-01',endDate:'2026-09-10',comparisonStart:'2026-08-01',comparisonEnd:'2026-09-10'};
  const plan=await interpretAnalysisQuestion(q,async()=>({legacy:false,requests:[r]}),'2026-09-10');assert.equal(plan.requests[0].comparisonEnd,'2026-08-10');assert.equal(plan.requests[0].groupBy,'category');
  const direct=deterministicAnalysisPlan(q,'2026-09-10');assert.equal(direct.requests[0].comparisonEnd,'2026-08-10');assert.equal(direct.requests[0].groupBy,'category');
});

test('orphan how-much-faster contribution asks for target but retains existing conversation path',()=>{
  const q='How much faster if I add $100 each month?';assert.ok(unresolvedContributionClarification(q,[]));assert.equal(unresolvedContributionClarification(q,['When will my debt be paid off?']),null);assert.equal(deterministicAnalysisPlan(q,'2026-09-10'),null);
});

test('generic bill-protected safe spending uses affordability, not a timeline, without dropping contextual scope',async()=>{
  const question='What can I spend without touching my bill money?';
  for(const q of [question,'How much can I safely spend now?','How much uncommitted cash do I have?']){const direct=deterministicAnalysisPlan(q,'2026-09-10');assert.ok(direct,q);assert.equal(direct.requests[0].purpose,'affordability');assert.equal(direct.requests[0].domain,'money');assert.equal(direct.requests[0].operation,'summary');assert.equal(direct.requests[0].endDate,'2026-09-10');}
  const contextual={...allocation,purpose:'buffer_timeline',domain:'buffer',amount:1000,amountRole:'target_balance',entity:'Named Account',startDate:'2026-09-20',endDate:'2026-09-25',dateEvent:'none'};
  const result=await interpretAnalysisQuestion(question,async()=>({legacy:false,requests:[contextual]}),'2026-09-10');assert.equal(result.requests[0].purpose,'affordability');assert.equal(result.requests[0].entity,'Named Account');assert.equal(result.requests[0].startDate,'2026-09-20');assert.equal(result.requests[0].endDate,'2026-09-25');
  for(const q of ['What can I spend tomorrow without touching my bill money?','How much can I safely spend from Main Checking?','What can I spend without touching my bill money and when will I be debt free?'])assert.equal(deterministicAnalysisPlan(q,'2026-09-10'),null,q);
});

test('generic safe extra-debt capacity has no invented payment and retains qualified fallback scopes',async()=>{
  for(const q of ['Can I send extra money to debt safely?','How much extra can I safely pay toward my debt?']){
    const direct=deterministicAnalysisPlan(q,'2026-09-10').requests[0];assert.equal(direct.purpose,'affordability');assert.equal(direct.domain,'money');assert.equal(direct.amount,null);assert.equal(direct.amountRole,'none');assert.equal(direct.scenario,null);
    const model={...allocation,purpose:'debt_timeline',domain:'debt',amount:100,amountRole:'payment_amount'};const normalized=await interpretAnalysisQuestion(q,async()=>({legacy:false,requests:[model]}),'2026-09-10');assert.equal(normalized.requests[0].amount,null);assert.equal(normalized.requests[0].purpose,'affordability');
  }
  for(const q of ['Can I send $100 extra money to debt safely?','Can I send extra money to Main Card debt safely?','Can I send extra money to debt safely next month?'])assert.equal(deterministicAnalysisPlan(q,'2026-09-10'),null,q);
});

test('null outer amount coherently uses none while nested scenario amount and missing target safeguards survive',async()=>{
  const r={...allocation,purpose:'forecast_balance',domain:'forecast',operation:'scenario',amount:null,amountRole:'payment_amount',scenario:{kind:'extra_debt',amount:100,date:'2026-09-10',entity:null,repeat:'monthly'}};
  const result=await interpretAnalysisQuestion('What if I add a hundred dollars to debt monthly?',async()=>({legacy:false,requests:[r]}),'2026-09-10');assert.equal(result.requests[0].amount,null);assert.equal(result.requests[0].amountRole,'none');assert.equal(result.requests[0].scenario.amount,100);
  await assert.rejects(interpretAnalysisQuestion('How long to build a $1000 buffer?',async()=>({legacy:false,requests:[{...allocation,purpose:'buffer_timeline',domain:'buffer',amount:null,amountRole:'target_balance'}]})),/structured_output_invalid/);
});
