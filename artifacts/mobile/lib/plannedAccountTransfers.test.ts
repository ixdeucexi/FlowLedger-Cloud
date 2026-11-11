import { forecastItemTypeLabel } from "./forecastDisplay";
import assert from "node:assert/strict";
import test from "node:test";
import { buildAccountForecast, buildForecastAccountCatalog, resolveForecastAccountReference, type ForecastAccountRef } from "./accountForecasts";
import { createFinancialProjection } from "./financialProjection";
import type { ConnectedBankAccount, FinancialProjectionSnapshot } from "./financialProjectionTypes";
import { validPlannedTransferDate, plannedTransferScheduledDate, plannedTransferOccurrenceDates, plannedTransferMonthProjection, mergePlannedTransferRows, normalizePlannedTransferData, type PlannedAccountTransfer, type PlannedTransferOccurrence } from "./plannedAccountTransfers";
const from = "bank:00000000-0000-4000-8000-000000000001" as ForecastAccountRef;
const other = "bank:00000000-0000-4000-8000-000000000002" as ForecastAccountRef;
const to = "bank:00000000-0000-4000-8000-000000000003" as ForecastAccountRef;
function transfer(patch: Partial<PlannedAccountTransfer> = {}): PlannedAccountTransfer {
  return { id:"plan-a",household_id:"hh",budget_id:"budget",name:"Monthly saving",amount:100,from_account_ref:from,to_account_ref:to,frequency:"monthly",start_date:"2027-01-31",end_date:null,status:"active",deleted_at:null,revision:1,created_at:"2027-01-01",updated_at:"2027-01-01",created_by:"editor",...patch };
}
function occurrence(patch: Partial<PlannedTransferOccurrence> = {}): PlannedTransferOccurrence {
  return { id:"state-a",transfer_id:"plan-a",household_id:"hh",budget_id:"budget",occurrence_date:"2027-01-31",scheduled_date_snapshot:"2027-01-31",skipped:false,from_reflected:false,to_reflected:false,from_balance_as_of:null,to_balance_as_of:null,amount_snapshot:100,from_account_ref_snapshot:from,to_account_ref_snapshot:to,template_revision_snapshot:1,revision:1,created_at:"2027-01-31",updated_at:"2027-01-31",...patch };
}
function fixture(): FinancialProjectionSnapshot {
  const bank = (ref:ForecastAccountRef,type:string,balance:number):ConnectedBankAccount => ({id:ref.slice(5),household_id:"hh",plaid_account_id:`provider${ref.slice(-1)}`,name:`Bank ${type}`,display_name:type==="savings"?"Rainy day":"My bills",account_type:"depository",account_subtype:type,current_balance:balance,available_balance:balance,is_active:true,updated_at:"2027-01-01T12:00:00Z"});
  const banks=[bank(from,"checking",1000),bank(other,"checking",500),bank(to,"savings",2000)];
  return {settings:{zeroBasedBudgetEnabled:false,debtPayoffEnabled:false,paymentMethod:"snowball",starting_balance:1500,starting_balance_date:"2027-01-01",safety_floor:200,forecast_horizon_months:12,onboarding_completed:true},bills:[],overrides:[],billDateMoves:[],transactions:[],deletedTransactions:[],incomes:[],goals:[],extraPayments:[],decisions:[],accounts:[],connectedBankAccounts:banks,transactionAccountIdentities:banks,pendingBankTransactions:[],pendingPlanMatches:[],plannedAccountTransfers:[transfer()],plannedTransferOccurrences:[]};
}
function catalog(snapshot=fixture()) {return buildForecastAccountCatalog({accounts:snapshot.accounts,bankAccounts:snapshot.transactionAccountIdentities,timeZone:"UTC"});}
function projected(snapshot=fixture(),month=0,year=2027) {
  const accounts=catalog(snapshot);
  return plannedTransferMonthProjection({transfers:snapshot.plannedAccountTransfers!,occurrences:snapshot.plannedTransferOccurrences!,accounts,resolveAccount:ref=>resolveForecastAccountReference(ref,accounts),month,year});
}
function own(snapshot:FinancialProjectionSnapshot,ref:ForecastAccountRef,month=0,year=2027,apy?:number) {
  const accounts=catalog(snapshot).map(row=>row.ref===to&&apy!==undefined?{...row,savingsApy:apy}:row);
  const engine=createFinancialProjection(snapshot,{now:new Date("2027-01-01T12:00:00Z"),timeZone:"UTC"});
  return buildAccountForecast({ref,month,year,snapshot,accounts,getEvents:engine.getUnanchoredCashEvents});
}
test("monthly anchor clips February and restores original day, inclusive end and one-off",()=>{
  assert.deepEqual([0,1,2,3].map(month=>plannedTransferScheduledDate(transfer(),month,2027)),["2027-01-31","2027-02-28","2027-03-31","2027-04-30"]);
  assert.equal(plannedTransferScheduledDate(transfer({start_date:"2028-01-31"}),1,2028),"2028-02-29");
  assert.equal(plannedTransferScheduledDate(transfer({end_date:"2027-02-28"}),1,2027),"2027-02-28");
  assert.equal(plannedTransferScheduledDate(transfer({end_date:"2027-02-28"}),2,2027),null);
  assert.equal(plannedTransferScheduledDate(transfer({frequency:"once"}),1,2027),null);
  for(const date of ["0000-01-01","2027-02-29","2027-04-31","bad"]) assert.equal(validPlannedTransferDate(date),false,date);
});
test("stable virtual two-leg IDs, custom names and all-cash conservation",()=>{
  const result=projected();assert.equal(result.issues.length,0);assert.equal(result.events.length,2);
  assert.deepEqual(result.events.map(row=>row.id),["planned-transfer:plan-a:2027-01-31:from","planned-transfer:plan-a:2027-01-31:to"]);
  assert.equal(result.events.reduce((sum,row)=>sum+row.amount,0),0);assert.equal(result.events[1].kind,"transaction_income");assert.equal(result.events[0].name,"Transfer to Rainy day");
});
test("per-account monthly carry, Savings/operating separation and no synthetic income/spend",()=>{
  const snapshot=fixture();const engine=createFinancialProjection(snapshot,{now:new Date("2027-01-01T12:00:00Z"),timeZone:"UTC"});
  for(let month=0;month<3;month++) {
    assert.equal(own(snapshot,from,month).endingBalance,1000-100*(month+1));assert.equal(own(snapshot,to,month).endingBalance,2000+100*(month+1));assert.equal(own(snapshot,other,month).endingBalance,500);
    assert.equal(engine.getDailyBalances(month,2027).at(-1)?.balance,1500-100*(month+1));assert.equal(engine.getCashFlow(month,2027).remaining,-100);
    for(const day of engine.getDailyBalances(month,2027)) {assert.equal(day.income,0);assert.equal(day.expense,0);}
    for(const day of own(snapshot,to,month).days) {assert.equal(day.income,0);assert.equal(day.expense,0);}
  }
  snapshot.plannedAccountTransfers![0].to_account_ref=other;
  assert.equal(createFinancialProjection(snapshot,{now:new Date("2027-01-01T12:00:00Z"),timeZone:"UTC"}).getDailyBalances(2,2027).at(-1)?.balance,1500);
});
test("Savings APY applies to prospective transferred cash without actual Activity/Goals",()=>{
  const snapshot=fixture();const withTransfer=own(snapshot,to,2,2027,5);snapshot.plannedAccountTransfers=[];
  const without=own(snapshot,to,2,2027,5);assert.ok(withTransfer.endingBalance!>without.endingBalance!+300);
  assert.equal(snapshot.transactions.length,0);assert.equal(snapshot.incomes.length,0);assert.equal(snapshot.goals.length,0);
});
test("skip/reflected affect one occurrence; same-day plan never absorbed by bank gap",()=>{
  const snapshot=fixture();snapshot.plannedTransferOccurrences=[occurrence({skipped:true})];assert.equal(projected(snapshot).events.length,0);assert.equal(projected(snapshot,1).events.length,2);
  snapshot.plannedTransferOccurrences=[occurrence({from_reflected:true,to_reflected:true,from_balance_as_of:"2027-01-01",to_balance_as_of:"2027-01-01"})];assert.equal(projected(snapshot).events.length,0);
  snapshot.plannedTransferOccurrences=[];snapshot.plannedAccountTransfers=[transfer({start_date:"2027-01-01"})];assert.equal(own(snapshot,to).endingBalance,2100);assert.equal(own(snapshot,from).endingBalance,900);
});
test("past ordinary plans do not replay before each account asof",()=>{
  const snapshot=fixture();snapshot.transactionAccountIdentities.forEach(row=>row.updated_at="2027-02-05T12:00:00Z");
  assert.equal(own(snapshot,to,1).endingBalance,2100);assert.equal(own(snapshot,from,1).endingBalance,900);
});
test("partial snapshots survive pause/delete/schedule/endpoint changes; carry outstanding leg once",()=>{
  const snapshot=fixture();snapshot.transactionAccountIdentities.forEach(row=>row.updated_at="2027-02-05T12:00:00Z");
  snapshot.plannedTransferOccurrences=[occurrence({from_reflected:true,from_balance_as_of:"2027-02-05"})];
  snapshot.plannedAccountTransfers=[transfer({amount:250,start_date:"2027-01-15",to_account_ref:other,end_date:"2027-01-15",status:"paused",deleted_at:"2027-02-01",revision:2})];
  const feb=projected(snapshot,1);assert.equal(feb.events.length,1);assert.equal(feb.events[0].date,"2027-02-05");assert.equal(feb.events[0].transferOccurrenceDate,"2027-01-31");assert.equal(feb.events[0].amount,100);assert.equal(feb.events[0].accountRef,to);
  assert.equal(projected(snapshot,2).events.length,0);assert.equal(own(snapshot,to,2).endingBalance,2100);
});
test("reviewed monthly date supersedes edited anchor without duplicate or skipped resurrection",()=>{
  const snapshot=fixture();snapshot.plannedAccountTransfers=[transfer({start_date:"2027-01-15",amount:250,revision:2})];snapshot.plannedTransferOccurrences=[occurrence()];
  assert.deepEqual(plannedTransferOccurrenceDates(snapshot.plannedAccountTransfers[0],snapshot.plannedTransferOccurrences,0,2027),["2027-01-31"]);
  assert.deepEqual(projected(snapshot).events.map(row=>row.amount),[-100,100]);snapshot.plannedTransferOccurrences=[occurrence({skipped:true})];assert.equal(projected(snapshot).events.length,0);
});
test("invalid/foreign/inactive/same-account/stale reflection fails honestly without single leg",()=>{
  for(const patch of [{to_account_ref:from},{to_account_ref:"manual:foreign" as ForecastAccountRef},{amount:Number.NaN},{amount:0},{amount:1.001}]) {
    const snapshot=fixture();snapshot.plannedAccountTransfers=[transfer(patch)];const result=projected(snapshot);assert.equal(result.events.length,0);assert.equal(result.issues.length,1);assert.equal(own(snapshot,from).complete,false);
  }
  const snapshot=fixture();snapshot.transactionAccountIdentities[2].is_active=false;assert.equal(projected(snapshot).events.length,0);assert.equal(projected(snapshot).issues.length,1);
  const stale=fixture();stale.plannedTransferOccurrences=[occurrence({from_reflected:true,from_balance_as_of:"2027-02-05"})];assert.equal(projected(stale).events.length,0);assert.equal(projected(stale).issues.length,1);
});
test("explicit bank/manual alias cannot transfer to itself",()=>{
  const snapshot=fixture();snapshot.accounts=[{id:"linked",name:"Local",account_type:"checking",current_balance:1000,balance_as_of:"2027-01-01",is_active:true,created_at:"2027-01-01"}];
  snapshot.transactionAccountIdentities[0].flowledger_account_id="linked";snapshot.plannedAccountTransfers=[transfer({to_account_ref:"manual:linked"})];assert.equal(projected(snapshot).events.length,0);assert.equal(projected(snapshot).issues.length,1);
});
test("revision merge preserves newer rows/tombstones; scope/duplicate-month data rejected",()=>{
  const latest=transfer({revision:3,amount:300,deleted_at:"2027-02-01"});assert.deepEqual(mergePlannedTransferRows([latest],[transfer()]),[latest]);assert.deepEqual(mergePlannedTransferRows([latest],[]),[latest]);
  assert.equal(mergePlannedTransferRows([latest],[transfer({id:"new"})]).length,2);assert.throws(()=>normalizePlannedTransferData({transfers:[latest],occurrences:[]},"foreign","budget"));
  assert.throws(()=>normalizePlannedTransferData({transfers:[latest],occurrences:[occurrence(),occurrence({id:"second",occurrence_date:"2027-01-15"})]},"hh","budget"));
});

test("reset keeps review key but snapshots new effective date durably across later series edits",()=>{
  const snapshot=fixture();snapshot.transactionAccountIdentities.forEach(row=>row.updated_at="2027-01-20T12:00:00Z");
  snapshot.plannedAccountTransfers=[transfer({start_date:"2027-01-28",amount:250,revision:3})];
  snapshot.plannedTransferOccurrences=[occurrence({occurrence_date:"2027-01-05",scheduled_date_snapshot:"2027-01-25",amount_snapshot:125,template_revision_snapshot:2})];
  const result=projected(snapshot);assert.equal(result.events.length,2);assert.deepEqual(result.events.map(row=>row.date),["2027-01-25","2027-01-25"]);
  assert.equal(result.events[0].transferOccurrenceDate,"2027-01-05");assert.equal(result.events[0].id,"planned-transfer:plan-a:2027-01-05:from");
  assert.equal(own(snapshot,from).endingBalance,875);assert.equal(own(snapshot,to).endingBalance,2125);
});

test("explicit reviewed past unreflected sides reserve once after reset/clear without replaying ordinary past",()=>{
  const snapshot=fixture();snapshot.transactionAccountIdentities.forEach(row=>row.updated_at="2027-02-20T12:00:00Z");
  snapshot.plannedAccountTransfers=[transfer({start_date:"2027-01-05",revision:2})];
  snapshot.plannedTransferOccurrences=[occurrence({occurrence_date:"2027-01-05",scheduled_date_snapshot:"2027-01-05",template_revision_snapshot:2})];
  assert.equal(own(snapshot,from,1).endingBalance,900);assert.equal(own(snapshot,to,1).endingBalance,2100);
  assert.equal(own(snapshot,from,2).endingBalance,800);assert.equal(own(snapshot,to,2).endingBalance,2200);
  const feb=projected(snapshot,1).events.filter(row=>row.transferOccurrenceDate==="2027-01-05");assert.equal(feb.length,2);assert.equal(feb[0].date,"2027-02-20");
  assert.equal(projected(snapshot,2).events.filter(row=>row.transferOccurrenceDate==="2027-01-05").length,0);
  assert.ok(plannedTransferOccurrenceDates(snapshot.plannedAccountTransfers[0],snapshot.plannedTransferOccurrences,1,2027).includes("2027-01-05"));
  snapshot.plannedTransferOccurrences=[];assert.equal(own(snapshot,from,1).endingBalance,1000);assert.equal(own(snapshot,to,1).endingBalance,2000);
});

test("planned transfers are labeled as transfer plans rather than income or actual Activity",()=>{
  const events=projected().events;for(const event of events)assert.equal(forecastItemTypeLabel(event),"Transfer plan");
});
