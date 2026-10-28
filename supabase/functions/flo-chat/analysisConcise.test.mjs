import test from 'node:test';
import assert from 'node:assert/strict';
import { presentFinancialAnalysis } from './analysisPresentation.ts';
import { calculateFinancialAnalysis, runFinancialAnalysis, requiresAnalysisSettings, requiresAnalysisConversation } from './analysisPlanner.ts';
import { analysisColumns } from './analysisSnapshot.ts';
const result=(facts,text='Full calculator details.',missing=[])=>({text,facts,missing,assumptions:['Complete internal assumption.'],sources:['accounts'],scenario:false});
const request=(patch={})=>({purpose:'general',domain:'forecast',operation:'summary',startDate:null,endDate:null,dateEvent:'none',merchant:null,category:null,entity:null,amount:null,comparisonStart:null,comparisonEnd:null,target:'none',debtMethod:'snowball',scenario:null,...patch});
function snapshot(){const sources=Object.fromEntries(Object.keys(analysisColumns).map(key=>[key,{rows:[],complete:true}]));sources.household_settings.rows=[{time_zone:'America/Chicago',starting_balance:500,starting_balance_date:'2026-09-10',safety_floor:200,forecast_horizon_months:6}];sources.incomes.rows=[{id:'pay',name:'Pay',amount:1000,frequency:'monthly',start_date:'2026-09-01',next_payment_date:'2026-09-15'}];sources.bills.rows=[{id:'rent',name:'Rent',amount:100,is_debt:false,is_recurring:true,frequency:'monthly',due_day:15,start_date:'2026-09-10'}];return {householdId:'h',today:'2026-09-10',capturedAt:'2026-09-10T15:00:00Z',timeZone:'America/Chicago',hash:'test',sources};}

test('default answer uses typed exact dates/money without duplicating assumptions or raw missing paragraphs',()=>{
 const r=result({recordedBalance:123.45,accountName:'Reserve 2',accountType:'savings',balanceAsOf:'2026-09-09'},'Long calculator body',['An internal coverage detail']);
 const p=presentFinancialAnalysis([r],[{domain:'money',purpose:'current_balance'}],'What is my Reserve 2 balance?');
 assert.equal(p.answer,'Reserve 2: $123.45 recorded as of 2026-09-09.');
 assert.equal(p.caveat,'An internal coverage detail');assert.doesNotMatch(p.answer,/Assumptions|What I could not verify|Full calculator/);assert.equal(r.text,'Long calculator body');
});
test('explicit detail, numeric account ambiguity and liability sign remain intact',()=>{
 const r=result({recordedBalance:125,accountName:'Reserve 2'},'Exact detailed original with $125 and $300.');
 assert.equal(presentFinancialAnalysis([r],[{domain:'money',purpose:'current_balance'}],'Explain the details').answer,r.text);
 const ambiguous={...result({},'Which Reserve 1 or Reserve 2?'),choices:{kind:'account',names:['Reserve 1','Reserve 2']}};
 assert.equal(presentFinancialAnalysis([ambiguous],[{domain:'money'}],'Reserve balance?').answer,ambiguous.text);
 const credit=result({recordedLiabilityBalance:-50},'$50 account credit, not debt owed or spendable cash.');
 assert.equal(presentFinancialAnalysis([credit],[{domain:'money',purpose:'current_balance'}],'Main Card balance?').answer,credit.text);
});
test('forecast preserves low/negative cushion warning and does not turn missing everyday costs into safe cash',()=>{
 const r=result({projectedBalance:1000,targetDate:'2026-09-30',minimumProjectedBalance:-25,minimumDate:'2026-09-15',cashCushion:200,projectedAfterEstimatedSpending:null});
 const p=presentFinancialAnalysis([r],[{domain:'forecast',purpose:'forecast_balance'}],'Balance at month end?');
 assert.match(p.answer,/\$1,000.00 under the recorded schedule/);assert.match(p.answer,/-\$25.00 on 2026-09-15, below your \$200.00 cushion/);
 const safe=presentFinancialAnalysis([{...r,facts:{...r.facts,affordabilityMinimumBalance:-25,affordabilityMinimumDate:'2026-09-15',safeToSpendUnderPlan:null}}],[{domain:'money',purpose:'affordability'}],'How much can I spend?');
 assert.match(safe.answer,/before I can give a safe-to-spend amount/);assert.doesNotMatch(safe.answer,/\$0.00.*fits/);
});
test('bucket summary preserves closed/released/overage semantics and keeps purchases on explicit request',()=>{
 const r=result({bucketName:'Trip 2027',bucketRemaining:0,bucketReleased:375,bucketSpent:125,bucketPlanned:500,bucketClosed:true,bucketOverage:0},'Purchase list: Hotel $95, Dinner allocation $30.');
 const p=presentFinancialAnalysis([r],[{domain:'budget',purpose:'bucket_details'}],'What is left in Trip 2027 bucket?');
 assert.match(p.answer,/closed, \$375.00 released and \$0.00 remaining/);assert.match(p.answer,/Trip 2027 budget/);assert.doesNotMatch(p.answer,/spendable bank cash/);
 assert.equal(presentFinancialAnalysis([r],[{domain:'budget',purpose:'bucket_details'}],'Show Trip 2027 purchases').answer,r.text);
});
test('available schedules survive missing balance without invented remaining cash or allocations',()=>{
 const s=snapshot();s.sources.household_settings.rows[0].starting_balance=null;
 for(const patch of [{},{purpose:'action_plan',domain:'stability',operation:'plan',planDays:30,endDate:'2026-10-09'},{purpose:'allocation_choice',domain:'stability',operation:'plan',amount:100,amountRole:'payment_amount'}]){
  const r=calculateFinancialAnalysis(s,request(patch));
  assert.equal(r.facts.safeSharedCapacity,null);assert.equal(r.facts.recordedPlanOnly,true);assert.equal(r.facts.expectedIncomeTotal,1000);assert.ok(r.facts.dueAmountTotal>=100);assert.match(r.text,/current dated checking balance/);assert.ok(r.missing.length);
 }
});
test('no-history forecast and paycheck guidance report schedule facts without requiring a history baseline first',()=>{
 const s=snapshot();const forecast=calculateFinancialAnalysis(s,request({endDate:'2026-09-30'}));assert.equal(forecast.facts.projectedBalance,1400);assert.equal(forecast.facts.safeToSpendUnderPlan,null);
 const pay=calculateFinancialAnalysis(s,request({domain:'paycheck',purpose:'paycheck_allocation',operation:'plan',endDate:'2026-10-09'}));
 assert.equal(pay.facts.expectedPaycheck,1000);assert.equal(pay.facts.safeSharedCapacity,null);assert.equal(pay.facts.cycleRecordedCommitments,100);assert.equal(pay.facts.allocatedPaycheck,undefined);
});
test('settings/context failures do not block a self-contained savings observation, but references and dated plans remain guarded',async()=>{
 const reads=[];const rows={accounts:[{id:'s',name:'Rainy day',account_type:'savings',current_balance:300,balance_as_of:'2026-09-09',is_active:true}],plaid_accounts:[]};
 const client={from(table){reads.push(table);const q={select(){return q},eq(){return q},order(){return q},limit(){return q},gt(){return q},neq(){return q},maybeSingle:async()=>({data:null,error:new Error('settings unavailable')}),then:resolve=>Promise.resolve({data:(rows[table]??[]).map(row=>({...row,household_id:'h'})),error:['household_settings','flo_messages'].includes(table)?new Error('unavailable'):null}).then(resolve)};return q}};
 const runtime={client,householdId:'h',userId:'u',now:'2026-09-10T15:00:00Z',toolResults:[],toolResultNames:[],toolNames:[],toolCache:new Map()};
 const r=await runFinancialAnalysis({runtime,question:'How much money do I have in savings?',apiKey:'unused',modelId:'unused',safetyIdentifier:'test',historyEnabled:true,conversationId:'c'});
 assert.match(r.answer.answer,/Savings: \$300.00/);assert.equal(r.aggregate.partial,false);assert.ok(reads.includes('flo_messages'));
 assert.equal(requiresAnalysisConversation('What is that account’s balance?'),true);assert.equal(requiresAnalysisConversation('How much money do I have in savings this month?'),false);
 assert.equal(requiresAnalysisSettings(request({purpose:'current_balance',domain:'money'})),false);assert.equal(requiresAnalysisSettings(request()),true);
 const reference=await runFinancialAnalysis({runtime,question:'What is that account’s balance?',apiKey:'unused',modelId:'unused',safetyIdentifier:'test',historyEnabled:true,conversationId:'c'});assert.match(reference.answer.answer,/Which account/);assert.equal(reference.aggregate.partial,true);
});

test('missing settings permits stored debt balance but never default-month obligations or dated debt scope',()=>{
 const s=snapshot();s.sources.household_settings.complete=false;s.sources.bills.rows=[{id:'card',name:'Card 2',is_debt:true,balance:1000,amount:50,interest_rate:10,is_recurring:true,frequency:'monthly',due_day:15}];
 const r=calculateFinancialAnalysis(s,request({domain:'debt'}));assert.equal(r.facts.totalDebt,1000);assert.equal(r.facts.minimumRemaining,undefined);assert.equal(r.facts.nextDebt,undefined);assert.deepEqual(r.sources,['bills']);
 assert.equal(requiresAnalysisSettings(request({domain:'debt',endDate:'2026-09-30'})),true);assert.equal(requiresAnalysisSettings(request({domain:'credit',dateEvent:'after_payday'})),true);
 const p=presentFinancialAnalysis([r],[request({domain:'debt'})],'How much debt do I owe?');assert.match(p.answer,/\$1,000.00/);assert.doesNotMatch(p.answer,/this month/);
});
test('non-summary metric requests preserve calculator answers instead of substituting a different typed total',()=>{
 for(const [scope,question,facts] of [
  [{domain:'credit'},'How much must I pay to get under 30%?',{cardBalance:400,creditLimit:1000,utilizationPercent:40,paymentBelow30Percent:100.01}],
  [{domain:'debt'},'Which debt should I pay first?',{totalDebt:1000,nextDebt:'Card 2'}],
  [{domain:'income',operation:'average'},'What is my average paycheck?',{expectedIncome:1000,averageExpectedPayment:500}],
  [{domain:'spending',operation:'compare'},'This month versus last month?',{spending:100,comparisonSpending:200}],
 ]){const r=result(facts,'The exact requested metric and its safety qualifications.');assert.equal(presentFinancialAnalysis([r],[scope],question).answer,r.text);}
});

test('partial schedule fallback and absent typed money never become a zero or lose the cash-anchor qualification',()=>{
 const fallback=result({recordedPlanOnly:true,dueAmountTotal:100,safeSharedCapacity:null},'I can verify $100 in bill commitments, but income could not be checked. A dated checking balance is needed before calculating remaining cash.',['incomes unavailable','checking observation missing']);
 assert.equal(presentFinancialAnalysis([fallback],[{domain:'stability',purpose:'action_plan'}],'Make an action plan').answer,fallback.text);
 for(const facts of [
  {dueAmountTotal:100,startDate:'2026-09-10',endDate:'2026-09-30'},
  {bucketName:'Trip',bucketRemaining:375},
  {projectedBalance:1000,targetDate:'2026-09-30',safeToSpendUnderPlan:100},
 ]){
  const scope=facts.bucketName?{domain:'budget',purpose:'bucket_details'}:facts.projectedBalance?{domain:'money',purpose:'affordability'}:{domain:'stability',purpose:'action_plan'};
  assert.equal(presentFinancialAnalysis([result(facts,'Full honest incomplete result')],[scope],'What can I do?').answer,'Full honest incomplete result');
 }
});
