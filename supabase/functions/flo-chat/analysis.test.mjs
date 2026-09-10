import assert from "node:assert/strict";
import test from "node:test";
import { analyticTransactions, aggregateSpending, spendingAnalysis } from "./analysisSpending.ts";
import { readAnalysisSource, analysisColumns } from "./analysisSnapshot.ts";
import { projectionInput, buildAnalysisForecast, forecastAnalysis } from "./analysisProjection.ts";
import { wealthAnalysis } from "./analysisWealth.ts";
import { scenarioAnalysis, stabilityAnalysis } from "./analysisStability.ts";
import { projectAnalystDebt } from "./analysisDebt.ts";
import { validateAnalysisRequest, calculateFinancialAnalysis } from "./analysisPlanner.ts";
import { localDay, validDate } from "./analysisTypes.ts";

const req=(extra={})=>({domain:"forecast",operation:"summary",startDate:null,endDate:"2026-09-20",dateEvent:"none",merchant:null,category:null,entity:null,amount:null,comparisonStart:null,comparisonEnd:null,target:"none",debtMethod:"snowball",scenario:null,...extra});
function snapshot(extra={}) {
 const sources=Object.fromEntries(Object.keys(analysisColumns).map(t=>[t,{rows:[],complete:true}]));
 sources.household_settings.rows=[{household_id:"h",starting_balance:1000,starting_balance_date:"2026-09-10",safety_floor:200,forecast_horizon_months:6,time_zone:"America/Chicago",payment_method:"snowball"}];
 sources.incomes.rows=[{id:"i",name:"Pay",amount:1000,frequency:"biweekly",start_date:"2026-09-11",next_payment_date:"2026-09-11",amount_history:[],excluded_dates:[]}];
 sources.bills.rows=[{id:"b",name:"Rent",amount:800,category:"Housing",priority:1,is_debt:false,balance:0,interest_rate:0,due_day:15,is_recurring:true,frequency:"monthly",created_at:"2026-08-01T00:00:00Z"}];
 for(const [table,rows] of Object.entries(extra)) sources[table]={rows,complete:true};
 return {householdId:"h",capturedAt:"2026-09-10T18:00:00Z",today:"2026-09-10",timeZone:"America/Chicago",hash:"test",sources};
}
test("calendar validation and household midnight",()=>{
 assert.equal(localDay("2026-10-01T02:00:00Z","America/Chicago"),"2026-09-30");
 assert.equal(validDate("2026-02-30"),false);
 assert.match(validateAnalysisRequest(req({endDate:"2026-02-30"}),"2026-09-10"),/invalid/);
});
test("forecast minimum and threshold lead with the requested result",()=>{
 const low=forecastAnalysis(snapshot(),req({operation:'minimum'}));
 assert.match(low.text,/^The lowest projected end balance/);
 const threshold=forecastAnalysis(snapshot(),req({operation:'threshold',amount:1500}));
 assert.match(threshold.text,/^The first projected end balance at or above \$1,500.00 is 2026-09-11/);
});
test("spending excludes transfers and credit repayments, refunds reduce spending",()=>{
 const s=snapshot({plaid_accounts:[{id:"credit",account_type:"credit",is_active:true}],transactions:[
 {id:"cash",date:"2026-09-10",amount:-50,category:"Food",note:"Grocer"},
 {id:"transfer",date:"2026-09-10",amount:-200,review_resolution:"transfer"},
 {id:"repay",date:"2026-09-10",amount:-100,category:"CREDIT_CARD_PAYMENT"}],plaid_transactions:[
 {id:"purchase",plaid_transaction_id:"p",plaid_account_id:"credit",transaction_date:"2026-09-10",amount:-100,category:"Shopping",name:"Store"},
 {id:"refund",plaid_transaction_id:"r",plaid_account_id:"credit",transaction_date:"2026-09-10",amount:20,category:"Shopping",name:"Store"}]});
 const totals=aggregateSpending(analyticTransactions(s).rows,"2026-09-01","2026-09-30");
 assert.equal(totals.spending,130); assert.equal(totals.income,0); assert.equal(totals.repayments,100);
});
test("established transaction links dedupe without discarding same-amount real purchases",()=>{
 const s=snapshot({transactions:[{id:"a",plaid_transaction_id:"p",date:"2026-09-10",amount:-10,category:"User category",note:"A"}],plaid_accounts:[{id:"check",account_type:"depository",account_subtype:"checking",is_active:true}],plaid_transactions:[{id:"p1",plaid_transaction_id:"p",flowledger_transaction_id:"a",plaid_account_id:"check",transaction_date:"2026-09-10",amount:-10,category:"Old"},{id:"p2",plaid_transaction_id:"p2",plaid_account_id:"check",transaction_date:"2026-09-10",amount:-10,category:"Food"}]});
 const a=analyticTransactions(s); assert.equal(a.rows.length,2); assert.equal(a.rows[0].category,"User category");
});
test("unknown accounts and positive unidentified inflows are not fabricated income",()=>{
 const s=snapshot({transactions:[{id:"a",date:"2026-09-10",amount:900,category:"Other"}],plaid_transactions:[{id:"x",transaction_date:"2026-09-10",amount:-300,plaid_account_id:"missing"}]});
 const a=aggregateSpending(analyticTransactions(s).rows,"2026-09-01","2026-09-30"); assert.equal(a.income,0);assert.equal(a.spending,0);assert.equal(a.unresolved,2);
});
test("forecast arithmetic uses expected paychecks and scheduled bills",()=>{
 const s=snapshot(); const f=buildAnalysisForecast(s,"2026-09-20");
 assert.equal(f.days.at(-1).balance,1200); assert.equal(f.current,1000);
 const a=forecastAnalysis(s,req());assert.equal(a.facts.expectedIncome,1000);assert.equal(a.facts.obligations,800);assert.equal(a.facts.projectedBalance,1200);
 assert.match(a.assumptions.join(" "),/No reliable three-month/);
});
test("missing balance and incomplete source fail closed rather than turn into zero",()=>{
 const s=snapshot();s.sources.household_settings.rows[0].starting_balance=null;
 assert.ok(projectionInput(s).missing.length);
 assert.deepEqual(calculateFinancialAnalysis(s,req()).facts,{});
 s.sources.household_settings.rows[0].starting_balance=1000;s.sources.bills.complete=false;
 assert.deepEqual(calculateFinancialAnalysis(s,req()).facts,{});
});
test("what-if calculations are immutable and conserve a one-time cash change",()=>{
 const s=snapshot();const before=JSON.stringify(s);
 const a=scenarioAnalysis(s,req({operation:"scenario",scenario:{kind:"purchase",amount:300,date:"2026-09-12",entity:null,repeat:"once"}}));
 assert.equal(a.facts.scenarioEndBalance,900);assert.equal(a.facts.baselineEndBalance,1200);assert.equal(JSON.stringify(s),before);
});
test("credit utilization requires positive limits; does not fabricate missing cards",()=>{
 const s=snapshot({plaid_accounts:[{id:"c",name:"Card",is_active:true,account_type:"credit",current_balance:500,credit_limit:1000}]});
 const a=wealthAnalysis(s,req({domain:"credit",amount:200}));assert.equal(a.facts.utilizationPercent,50);assert.equal(a.facts.afterPaymentUtilization,30);assert.equal(a.facts.paymentBelow30Percent,200.01);
 s.sources.plaid_accounts.rows[0].credit_limit=null;assert.equal(wealthAnalysis(s,req({domain:"credit"})).facts.utilizationPercent,undefined);
});
test("exact household predicate stays on every paginated read and mismatched rows fail",async()=>{
 const calls=[];const client={from(table){const q={select(){return q},eq(k,v){calls.push([table,k,v]);return q},order(){return q},limit(){return q},gt(){return q},then(resolve){resolve({data:[{id:"x",household_id:"other"}],error:null})}};return q}};
 const result=await readAnalysisSource(client,"h","transactions");assert.equal(result.complete,false);assert.deepEqual(result.rows,[]);assert.deepEqual(calls,[["transactions","household_id","h"]]);
});
test("fee matches and merchant searches preserve exact pennies",()=>{
 const s=snapshot({transactions:[{id:"1",date:"2026-09-08",amount:-35.01,category:"Fees",note:"Overdraft fee"},{id:"2",date:"2026-09-09",amount:-35.02,category:"Fees",note:"Late fee"}]});
 assert.equal(spendingAnalysis(s,req({domain:"fees"})).facts.fees,70.03);
});

test("moving a bill later changes the next occurrence, not the following month",()=>{
 const s=snapshot();const before=JSON.stringify(s);
 const result=scenarioAnalysis(s,req({scenario:{kind:"move_bill",amount:0,date:"2026-09-20",sourceDate:null,entity:"Rent",repeat:"once"}}));
 assert.equal(result.facts.scenarioEndBalance,result.facts.baselineEndBalance);
 assert.equal(JSON.stringify(s),before);
 const earlier=scenarioAnalysis(s,req({scenario:{kind:"move_bill",amount:0,date:"2026-09-12",sourceDate:"2026-09-15",entity:"Rent",repeat:"once"}}));
 assert.equal(earlier.facts.scenarioEndBalance,1200);
});
test("null goal funding and savings are unavailable, not zero",()=>{
 const s=snapshot({goals:[{id:"g",name:"Goal",target_amount:1000,current_amount:null,target_date:"2027-01-01",goal_type:"savings"}],accounts:[{id:"a",name:"Savings",account_type:"savings",current_balance:null,is_active:true,balance_as_of:"2026-09-10"}]});
 const r=wealthAnalysis(s,req({domain:"savings",entity:"Goal",amount:100}));
 assert.equal(r.facts.savingsBalance,null);assert.equal(r.facts.contributionPeriods,undefined);assert.ok(r.missing.length>=2);
});
test("expense baselines do not add card purchases and repayments together",()=>{
 const s=snapshot({transactions:[{id:"c",date:"2026-09-10",amount:-100,category:"Shopping"},{id:"p",date:"2026-09-10",amount:-100,category:"CREDIT_CARD_PAYMENT"}]});
 const r=aggregateSpending(analyticTransactions(s).rows,"2026-09-01","2026-09-30");
 assert.equal(r.spending+r.nonCardRepayments,100);assert.equal(r.repayments,100);
});
test("debt target respects exclusion and future start",()=>{
 const debt=(id,balance,extra={})=>({id,name:id,amount:35,balance,is_debt:true,interest_rate:12,due_day:15,frequency:"monthly",is_recurring:true,created_at:"2026-08-01T00:00:00Z",...extra});
 const s=snapshot({bills:[debt("Eligible",1000),debt("Excluded",10,{include_in_snowball:false}),debt("Future",1,{start_date:"2027-01-01"})]});
 assert.equal(wealthAnalysis(s,req({domain:"debt"})).facts.nextDebt,"Eligible");
});
test("monthly payoff preserves every minimum and delays future extra payments",()=>{
 const debts=[{id:"a",name:"A",balance:100,minimum:10,apr:0,dueDay:1,included:true},{id:"b",name:"B",balance:500,minimum:20,apr:0,dueDay:1,included:true}];
 const currentPlan={balances:new Map([["a",90],["b",480]]),rolledPayment:0,payoffOrder:[],paidOffNames:[]};
 const r=projectAnalystDebt({debts,method:"snowball",year:2026,month:8,currentPlan,targetId:"b",extra:(month,year)=>month===9&&year===2026?100:0});
 assert.equal(r.months[0].extra,0);assert.equal(r.months[1].extra,100);assert.equal(r.months[1].endingDebt,440);
 assert.equal(currentPlan.balances.get("b"),480);
});
test("paycheck income scenario keeps the named source filter",()=>{
 const s=snapshot();s.sources.incomes.rows.push({...s.sources.incomes.rows[0],id:"side",name:"Side",amount:100,next_payment_date:"2026-09-12",start_date:"2026-09-12"});
 const r=scenarioAnalysis(s,req({scenario:{kind:"income_change",amount:-200,date:"2026-09-10",entity:"Pay",repeat:"paycheck"}}));
 assert.equal(r.facts.baselineEndBalance-r.facts.scenarioEndBalance,200);
});
test("comparisons include categories that disappeared and merchant grouping",()=>{
 const s=snapshot({transactions:[{id:"old",date:"2026-08-05",amount:-100,category:"Shopping",note:"Old Store"},{id:"new",date:"2026-09-05",amount:-10,category:"Food",note:"New Store"}]});
 const r=spendingAnalysis(s,req({domain:"spending",operation:"compare",groupBy:"merchant",comparisonStart:"2026-08-01",comparisonEnd:"2026-08-20"}));
 assert.match(r.text,/Shopping:.*100/);assert.match(r.text,/Largest merchant totals: New Store/);
});
test("bill cancellation and increases start at their effective date, not earlier occurrences",()=>{
 const s=snapshot();
 for(const [kind,amount,expected] of [["cancel_bill",0,800],["bill_increase",100,-100]]) {
 const r=scenarioAnalysis(s,req({endDate:"2026-10-20",scenario:{kind,amount,date:"2026-10-01",entity:"Rent",repeat:"monthly"}}));
 assert.equal(r.facts.scenarioEndBalance-r.facts.baselineEndBalance,expected);
 }
});
test("emergency targets require activity in each of three completed months",()=>{
 const s=snapshot({transactions:[{id:"old",date:"2020-01-01",amount:-100,category:"Food"},{id:"recent",date:"2026-08-01",amount:-300,category:"Food"}]});
 const r=wealthAnalysis(s,req({domain:"emergency"}));assert.ok(r.missing.some(x=>/Three complete months/.test(x)));assert.equal(r.facts.monthsCovered,undefined);assert.equal(r.facts.monthlyExpenseBaseline,undefined);
});
test("pre-payday diagnosis deduplicates same-date paychecks and requires complete closes",()=>{
 const transactions=[6,7,8].flatMap(month=>[{id:`expense${month}`,date:`2026-0${month}-01`,amount:-300,category:"Food"},...Array.from({length:3},(_,i)=>({id:`pay${month}-${i}`,date:`2026-0${month}-10`,amount:50,category:"Income"}))]);
 const closes=[6,7,8].map(month=>({balance_date:`2026-0${month}-09`,checking_balance:0}));
 const s=snapshot({transactions,household_daily_checking_closes:closes});
 const good=stabilityAnalysis(s,req({domain:"stability"}));assert.match(good.text,/3 of 3 observed pre-payday/);assert.doesNotMatch(good.text,/9 of 9/);
 s.sources.household_daily_checking_closes.complete=false;
 const incomplete=stabilityAnalysis(s,req({domain:"stability"}));assert.doesNotMatch(incomplete.text,/observed pre-payday balances were below/);
});
test("unresolved prior comparison transactions prevent a definitive difference",()=>{
 const s=snapshot({transactions:[{id:"old",date:"2026-08-05",amount:-100,category:"Food",review_status:"needs_review"},{id:"new",date:"2026-09-05",amount:-10,category:"Food"}]});
 const r=spendingAnalysis(s,req({domain:"spending",operation:"compare",comparisonStart:"2026-08-01",comparisonEnd:"2026-08-20"}));assert.equal(r.facts.spendingChange,undefined);assert.ok(r.missing.length);assert.doesNotMatch(r.text,/spending is.*higher|spending is.*lower/);
});
test("multi-month budgets use each month's own transactions",()=>{
 const s=snapshot({category_budgets:[{id:"aug",month:7,year:2026,category:"Food",amount:200},{id:"sep",month:8,year:2026,category:"Food",amount:200}],transactions:[{id:"a",date:"2026-08-05",amount:-100,category:"Food"},{id:"s",date:"2026-09-05",amount:-20,category:"Food"}]});
 const r=wealthAnalysis(s,req({domain:"budget",startDate:"2026-08-01",endDate:"2026-09-30"}));assert.match(r.text,/2026-08 Food: \$100\.00/);assert.match(r.text,/2026-09 Food: \$20\.00/);assert.doesNotMatch(r.text,/Food: \$120\.00/);
});
test("safe-extra-debt calculator accepts nonempty app income history and exclusions without writes",()=>{
 const s=snapshot();s.sources.incomes.rows[0].amount_history=[{effective_from:"2026-09",amount:1200}];s.sources.incomes.rows[0].excluded_dates=["2026-09-11T12:00:00Z"];
 const before=JSON.stringify(s);
 const r=calculateFinancialAnalysis(s,req({domain:"purchase",operation:"scenario",scenario:{kind:"extra_debt",amount:100,date:"2026-09-12",entity:null,repeat:"once"}}));
 assert.equal(r.facts.baselineEndBalance,200);assert.equal(r.facts.scenarioEndBalance,100);assert.equal(r.scenario,true);assert.equal(JSON.stringify(s),before);assert.ok(!r.missing.some(x=>/income history|exclusion date/.test(x)));
});
