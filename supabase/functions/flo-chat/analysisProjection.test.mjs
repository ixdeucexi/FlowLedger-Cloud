import test from 'node:test';
import assert from 'node:assert/strict';
import { projectionInput, projectionSources, forecastAnalysis, buildAnalysisForecast } from './analysisProjection.ts';

function snapshot() {
  const sources = Object.fromEntries(projectionSources.map(name=>[name,{rows:[],complete:true}]));
  sources.household_settings.rows=[{starting_balance:5000,starting_balance_date:'2026-09-10',safety_floor:200,forecast_horizon_months:6,debtPayoffEnabled:false}];
  sources.bills.rows=[{id:'rent',name:'Rent',amount:900,category:'Housing',priority:1,is_debt:false,balance:0,interest_rate:0,due_day:15,is_recurring:true,frequency:'monthly',start_date:'2026-08-01',created_at:'2026-08-01T12:00:00Z'}];
  sources.monthly_overrides.rows=[{id:'aug-paid',bill_id:'rent',month:7,year:2026,paid_amount:900,actual_amount:900,paid_date:'2026-08-15',custom_amount:null,custom_due_day:null}];
  sources.incomes.rows=[{id:'pay',name:'Salary',amount:1500,frequency:'biweekly',start_date:'2026-09-11',next_payment_date:'2026-09-11',amount_history:[],excluded_dates:[]}];
  return {householdId:'test',today:'2026-09-10',capturedAt:'2026-09-10T15:00:00Z',timeZone:'America/Chicago',hash:'test',sources};
}
const request = (patch={}) => ({domain:'forecast',operation:'summary',startDate:null,endDate:'2026-09-30',dateEvent:'none',entity:null,merchant:null,category:null,amount:null,...patch});

test('complete snapshot uses canonical engine and preserves observed versus projected balance',()=>{
 const s=snapshot(); assert.deepEqual(projectionInput(s).missing,[]);
 const result=forecastAnalysis(s,request()); assert.equal(result.facts.observedBalance,5000); assert.notEqual(result.facts.projectedBalance,5000);
 assert.match(result.text,/recorded checking\/cash balance/); assert.equal(result.facts.safeToSpendUnderPlan,null); assert.doesNotMatch(result.text,/purchase fits/);
});
test('requested start filters totals and minimum search, never clamps historical windows',()=>{
 const s=snapshot(); const r=forecastAnalysis(s,request({startDate:'2026-09-20'})); assert.equal(r.facts.obligations,0); assert.equal(r.facts.expectedIncome,1500); assert.ok(r.facts.minimumDate>='2026-09-20');
 assert.throws(()=>forecastAnalysis(s,request({startDate:'2026-08-01',endDate:'2026-08-31'})),/historical/);
});
test('named incomes resolve exactly, and date-relative questions honor named source',()=>{
 const s=snapshot(); s.sources.incomes.rows.push({...s.sources.incomes.rows[0],id:'second',name:'Side job',amount:100,next_payment_date:'2026-09-12',start_date:'2026-09-12'});
 const r=forecastAnalysis(s,request({domain:'income',entity:'Salary'})); assert.equal(r.facts.expectedIncome,3000); assert.equal(r.facts.averageExpectedPayment,1500); assert.doesNotMatch(r.text,/Side job/);
 assert.equal(forecastAnalysis(s,request({dateEvent:'next_payday',entity:'Side job'})).facts.targetDate,'2026-09-12');
 assert.deepEqual(forecastAnalysis(s,request({domain:'income',entity:'Sal'})).facts,{});
});
test('after-bill excludes unrelated outflows and exact matches are required',()=>{
 const s=snapshot(); assert.equal(forecastAnalysis(s,request({dateEvent:'after_bill',entity:'Rent'})).facts.targetDate,'2026-09-15');
 assert.deepEqual(forecastAnalysis(s,request({dateEvent:'after_bill',entity:'Ren'})).facts,{});
});
test('strict raw money guards reject null, blanks, booleans and objects before normalization',()=>{
 for(const value of [null,' ',false,[],{},'NaN']) { const s=snapshot(); s.sources.bills.rows[0].amount=value; assert.ok(projectionInput(s).missing.length); assert.throws(()=>buildAnalysisForecast(s,'2026-09-30')); }
 const s=snapshot(); s.sources.bills.rows[0].amount=0; assert.deepEqual(projectionInput(s).missing,[]);
});
test('override, allocation, income history and goal amounts cannot silently default',()=>{
 for(const [table,row] of [['monthly_overrides',{paid_amount:null,month:8,year:2026}],['transactions',{id:'t',amount:-20,date:'2026-09-10',review_allocations:[{amount:false}]}],['incomes',{id:'bad',amount:10,frequency:'weekly',start_date:'2026-09-11',amount_history:[{effective_from:'2026-09-01',amount:null}]}],['goals',{target_amount:null,current_amount:0,target_date:'2026-09-20'}]]) {const s=snapshot();s.sources[table].rows.push(row); assert.ok(projectionInput(s).missing.length,table);}
});
test('invalid dates and horizons fail closed, and 24 months is supported',()=>{
 for(const end of ['2026-02-30','2026-09-09','2029-01-01']) assert.throws(()=>buildAnalysisForecast(snapshot(),end));
 const s=snapshot();s.sources.household_settings.rows[0].forecast_horizon_months=24;assert.equal(buildAnalysisForecast(s,'2026-09-30').horizonEnd,'2028-08-31');
 s.sources.household_settings.rows[0].forecast_horizon_months=0;assert.ok(projectionInput(s).missing.length);
});
test('missing history cannot affirm a purchase or advertise a numeric safe amount',()=>{
 const r=forecastAnalysis(snapshot(),request({domain:'purchase',amount:1}));assert.equal(r.facts.safeToSpendUnderPlan,null);assert.match(r.text,/cannot confirm/);
});
test('incomplete source coverage blocks projection',()=>{const s=snapshot();s.sources.bill_date_moves.complete=false;assert.throws(()=>buildAnalysisForecast(s,'2026-09-30'));});
test('safe spending is capped by observed available funds after pending outflows, never future paychecks',()=>{
 const s=snapshot();s.sources.plaid_accounts.rows=[{id:'bank',plaid_account_id:'provider',name:'Checking',account_type:'depository',account_subtype:'checking',current_balance:500,available_balance:400,is_active:true,updated_at:s.capturedAt}];
 s.sources.plaid_transactions.rows=[{id:'p',plaid_transaction_id:'p',plaid_account_id:'bank',pending:true,amount:-100,transaction_date:s.today,name:'Pending purchase',category:'Shopping'}];
 s.sources.transactions.rows=[6,7,8].map(m=>({id:String(m),date:`2026-0${m}-01`,amount:-30,category:'Food',note:'Grocer'}));
 s.sources.bills.rows=[];
 const input=projectionInput(s);assert.deepEqual(input.missing,[]);assert.equal(input.availableNow,400);
 const r=forecastAnalysis(s,request({domain:'purchase',amount:201}));assert.ok(r.facts.safeToSpendUnderPlan<=200);assert.match(r.text,/cannot confirm/);
});
test('paid overrides remove settled obligations and future-only windows exclude earlier bills',()=>{
 const s=snapshot();s.sources.monthly_overrides.rows=[{id:'paid',bill_id:'rent',month:8,year:2026,paid_amount:900,custom_amount:null,custom_due_day:null,actual_amount:900,paid_date:'2026-09-10'}];
 const r=forecastAnalysis(s,request({domain:'bills'}));assert.equal(r.facts.obligations,0);
});
test('no next paycheck is not silently replaced by end of month',()=>{
 const s=snapshot();s.sources.incomes.rows=[];const r=forecastAnalysis(s,request({dateEvent:'next_payday'}));assert.deepEqual(r.facts,{});assert.ok(r.missing.length);
});
test('a single old transaction cannot establish a three-month baseline',()=>{
 const s=snapshot();s.sources.transactions.rows=[{id:'old',date:'2026-06-01',amount:-30,category:'Food'}];assert.equal(buildAnalysisForecast(s,'2026-09-30').historyAvailable,false);
});
test('purchase planning waits for a date that survives later obligations, without spending savings',()=>{
 const s=snapshot();s.sources.household_settings.rows[0].starting_balance=500;
 s.sources.transactions.rows=[6,7,8].map(m=>({id:String(m),date:`2026-0${m}-01`,amount:-30,category:'Food',note:'Grocer'}));
 s.sources.accounts.rows=[{id:'savings',name:'Savings',account_type:'savings',is_active:true,current_balance:50000,balance_as_of:s.today}];
 const r=forecastAnalysis(s,request({domain:'purchase',operation:'plan',amount:1000}));
 assert.equal(r.facts.earliestProjectedPurchaseDate,'2026-09-25');
 assert.ok(r.facts.afterPurchaseLow>=200);assert.ok(r.facts.safeToSpendUnderPlan<1000);
 assert.match(r.text,/projected future ability/);assert.match(r.assumptions.join(' '),/not savings/);
 const today=forecastAnalysis(s,request({domain:'purchase',amount:1000}));assert.match(today.text,/cannot confirm/);
});
test('purchase planning cannot affirm without history or a fresh observation',()=>{
 for(const stale of [false,true]) {const s=snapshot();if(stale){s.sources.household_settings.rows[0].starting_balance_date='2026-09-09';s.sources.transactions.rows=[6,7,8].map(m=>({id:String(m),date:`2026-0${m}-01`,amount:-30,category:'Food'}));}
 const r=forecastAnalysis(s,request({domain:'purchase',operation:'plan',amount:1}));assert.equal(r.facts.earliestProjectedPurchaseDate,null);assert.equal(r.facts.afterPurchaseLow,null);assert.match(r.text,/cannot identify/);}
});
test('purchase planning respects requested horizon and reports no suitable date',()=>{
 const s=snapshot();s.sources.household_settings.rows[0].starting_balance=500;s.sources.transactions.rows=[6,7,8].map(m=>({id:String(m),date:`2026-0${m}-01`,amount:-30,category:'Food'}));
 const r=forecastAnalysis(s,request({domain:'purchase',operation:'plan',amount:1000,endDate:'2026-09-24'}));assert.equal(r.facts.earliestProjectedPurchaseDate,null);assert.match(r.text,/No purchase date/);
});
test('response leads with the requested current or target balance',()=>{
 assert.match(forecastAnalysis(snapshot(),request({domain:'money',operation:'detail'})).text,/^Your recorded checking/);
 assert.match(forecastAnalysis(snapshot(),request()).text,/^Your projected end-of-day account balance on 2026-09-30/);
});
test('single-date balance keeps target amount but reports today-to-target context',()=>{
 const s=snapshot();s.sources.household_settings.rows[0].starting_balance=500;
 const r=forecastAnalysis(s,request({domain:'forecast',operation:'summary',startDate:'2026-09-20',endDate:'2026-09-20'}));
 assert.equal(r.facts.projectedBalance,1100);assert.equal(r.facts.minimumProjectedBalance,500);assert.equal(r.facts.expectedIncome,1500);assert.equal(r.facts.obligations,900);
 assert.equal(r.facts.startDate,'2026-09-20');assert.equal(r.facts.contextStartDate,'2026-09-10');assert.match(r.text,/Between 2026-09-10 and 2026-09-20/);
});
test('explicit single-day minimum and multi-day ranges keep only requested context',()=>{
 const s=snapshot();s.sources.household_settings.rows[0].starting_balance=500;
 for(const query of [{operation:'minimum',startDate:'2026-09-20',endDate:'2026-09-20'},{operation:'summary',startDate:'2026-09-19',endDate:'2026-09-20'}]){
 const r=forecastAnalysis(s,request(query));assert.equal(r.facts.minimumProjectedBalance,1100);assert.equal(r.facts.expectedIncome,0);assert.equal(r.facts.obligations,0);assert.equal(r.facts.contextStartDate,query.startDate);assert.match(r.text,new RegExp(`Between ${query.startDate} and 2026-09-20`));}
});
test('older unpaid obligations suppress spending approval without rewriting forecast balances',()=>{
 const s=snapshot();s.sources.monthly_overrides.rows=[];s.sources.transactions.rows=[6,7,8].map(m=>({id:String(m),date:`2026-0${m}-01`,amount:-30,category:'Food'}));
 const r=forecastAnalysis(s,request({domain:'purchase',amount:1}));assert.equal(r.facts.safeToSpendUnderPlan,null);assert.match(r.text,/cannot confirm/);assert.ok(r.missing.some(x=>/Older bill obligations/.test(x)));assert.equal(typeof r.facts.projectedBalance,'number');
});
test('short weekend or pre-payday purchase windows check later rent risk too',()=>{
 const s=snapshot();s.sources.household_settings.rows[0].starting_balance=1500;s.sources.bills.rows[0].amount=3000;s.sources.bills.rows[0].start_date='2026-09-01';s.sources.incomes.rows[0].amount=1000;
 s.sources.transactions.rows=[6,7,8].map(m=>({id:String(m),date:`2026-0${m}-01`,amount:-30,category:'Food'}));
 for(const query of [{endDate:'2026-09-13'},{endDate:null},{operation:'plan',startDate:'2026-09-12',endDate:'2026-09-13'}]){
 const r=forecastAnalysis(s,request({domain:'purchase',amount:100,...query}));assert.equal(r.facts.purchaseRiskAssessmentThrough,'2026-10-31');assert.ok(r.facts.safeToSpendUnderPlan===0||r.facts.safeToSpendUnderPlan===null);assert.doesNotMatch(r.text,/purchase fits this projection|earliest projected purchase date/);
 }
});
test('maximum answers the requested peak early with its actual date',()=>{
 const r=forecastAnalysis(snapshot(),request({operation:'maximum',startDate:'2026-09-10',endDate:'2026-09-20'}));assert.equal(r.facts.maximumProjectedBalance,6500);assert.equal(r.facts.maximumDate,'2026-09-11');assert.match(r.text,/^The highest projected end balance/);
});
test('future window comparison reports each end and low with differences',()=>{
 const r=forecastAnalysis(snapshot(),request({operation:'compare',startDate:'2026-09-10',endDate:'2026-09-14',comparisonStart:'2026-09-15',comparisonEnd:'2026-09-20'}));assert.equal(r.facts.comparisonEndBalance,5600);assert.equal(r.facts.comparisonMinimumBalance,5600);assert.equal(r.facts.endBalanceDifference,900);assert.equal(r.facts.minimumBalanceDifference,-600);assert.match(r.text,/^Forecast comparison:/);
});
test('historical or invalid comparator is unavailable rather than a generic projection',()=>{
 for(const comparison of [{comparisonStart:'2026-08-01',comparisonEnd:'2026-08-31'},{comparisonStart:'2026-09-20',comparisonEnd:'2026-09-11'},{}]){const r=forecastAnalysis(snapshot(),request({operation:'compare',...comparison}));assert.deepEqual(r.facts,{});assert.match(r.text,/recorded closing balances/);}
});
test('named-account forecast cannot silently become household forecast',()=>{
 for(const domain of ['money','forecast']){const r=forecastAnalysis(snapshot(),request({domain,entity:'Savings'}));assert.deepEqual(r.facts,{});assert.match(r.text,/not an individual named account/);}
});
test('creation day does not hide an earlier unpaid canonical occurrence in the same month',()=>{
 const s=snapshot();s.sources.bills.rows=[{...s.sources.bills.rows[0],amount:35,due_day:1,start_date:undefined,created_at:'2026-09-09T12:00:00Z'}];s.sources.monthly_overrides.rows=[];
 const f=buildAnalysisForecast(s,'2026-09-20');assert.deepEqual(f.engine.getBillOccurrencesInMonth(f.input.bills[0],8,2026),[1]);assert.ok(f.affordabilityMissing.some(x=>/Older bill obligations/.test(x)));
 s.sources.bills.rows[0].start_date='2026-09-09';
 const explicit=buildAnalysisForecast(s,'2026-09-20');assert.deepEqual(explicit.engine.getBillOccurrencesInMonth(explicit.input.bills[0],8,2026),[]);assert.deepEqual(explicit.affordabilityMissing,[]);
});
