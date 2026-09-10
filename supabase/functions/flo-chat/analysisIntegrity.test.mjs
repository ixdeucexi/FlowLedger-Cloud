import assert from "node:assert/strict";
import test from "node:test";
import { analysisColumns } from "./analysisSnapshot.ts";
import { analyticTransactions, spendingAnalysis } from "./analysisSpending.ts";
import { wealthAnalysis } from "./analysisWealth.ts";
const request=(extra={})=>({domain:"spending",operation:"summary",startDate:"2026-09-01",endDate:"2026-09-30",dateEvent:"none",merchant:null,category:null,entity:null,amount:null,comparisonStart:null,comparisonEnd:null,target:"none",debtMethod:"snowball",scenario:null,...extra});
const snapshot=(extra={})=>({householdId:"h",today:"2026-09-10",capturedAt:"2026-09-10T18:00:00Z",timeZone:"America/Chicago",hash:"integrity",sources:Object.fromEntries(Object.keys(analysisColumns).map(t=>[t,{complete:true,rows:extra[t]??(t==="household_settings"?[{starting_balance:500,starting_balance_date:"2026-09-10",safety_floor:100,forecast_horizon_months:6,time_zone:"America/Chicago"}]:[])}]))});
test("future planned income is not received income",()=>{
 const s=snapshot({transactions:[{id:"past",date:"2026-09-09",amount:20,category:"Income"},{id:"future",date:"2026-09-11",amount:1000,category:"Income"}]});
 const r=spendingAnalysis(s,request({domain:"income",incomeTiming:"received"}));
 assert.equal(r.facts.income,20);assert.equal(r.facts.endDate,"2026-09-10");
});
test("unbalanced split cannot become verified consumption",()=>{
 const s=snapshot({transactions:[{id:"split",date:"2026-09-09",amount:-100,category:"Food",review_allocations:[{amount:10,category:"Food"}]}]});
 assert.equal(analyticTransactions(s).rows[0].kind,"unresolved");
 assert.ok(analyticTransactions(s).missing.length);
});
test("linked savings contributions are not consumption and ambiguous savings need review",()=>{
 const s=snapshot({goals:[{id:"g",goal_type:"savings"}],transactions:[{id:"linked",date:"2026-09-09",amount:-25,category:"Savings",linked_plan_type:"goal",linked_plan_id:"g"},{id:"unknown",date:"2026-09-09",amount:-50,category:"Savings"}]});
 const r=analyticTransactions(s);assert.equal(r.rows[0].kind,"transfer");assert.equal(r.rows[1].kind,"unresolved");
 assert.equal(spendingAnalysis(s,request()).facts.spending,0);
});
test("missing linked goal is unresolved even with a user-edited category",()=>{
 const s=snapshot({transactions:[{id:"unknown",date:"2026-09-09",amount:-25,category:"Other",linked_plan_type:"goal",linked_plan_id:"missing"}]});
 assert.equal(analyticTransactions(s).rows[0].kind,"unresolved");
 assert.equal(spendingAnalysis(s,request()).facts.spending,0);
 s.sources.goals.complete=false;assert.ok(analyticTransactions(s).missing.some(m=>m.includes("goals")));
});
test("weekly review compares equal elapsed periods",()=>{
 const s=snapshot({transactions:[{id:"last",date:"2026-09-04",amount:-20,category:"Food"},{id:"now",date:"2026-09-08",amount:-10,category:"Food"}]});
 const r=spendingAnalysis(s,request({domain:"review",startDate:"2026-09-07",endDate:"2026-09-10"}));
 assert.equal(r.facts.previousSpending,20);assert.equal(r.facts.spendingChange,-10);assert.match(r.text,/2026-09-03–2026-09-06/);
});
test("monthly required snapshot stays distinct from ongoing extra plan",()=>{
 const s=snapshot({bills:[{id:"d",name:"Debt",amount:100,balance:1000,is_debt:true,is_recurring:true,frequency:"monthly",due_day:15,interest_rate:10,created_at:"2026-09-01T00:00:00Z"}],monthly_overrides:[{id:"o",bill_id:"d",month:8,year:2026,required_debt_amount:35,planned_debt_amount:100,paid_amount:35,actual_amount:null,custom_amount:null,custom_due_day:null,paid_date:"2026-09-09"}]});
 const r=wealthAnalysis(s,request({domain:"debt"}));
 assert.equal(r.facts.minimumPayments,35);assert.equal(r.facts.minimumRemaining,0);assert.equal(r.facts.configuredOngoingPayments,100);
});
