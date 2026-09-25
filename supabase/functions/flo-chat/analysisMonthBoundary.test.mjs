import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisColumns } from './analysisSnapshot.ts';
import { stabilityAnalysis } from './analysisStability.ts';
import { wealthAnalysis } from './analysisWealth.ts';
import { shiftMonth } from './analysisTypes.ts';

function snapshot(){
  const sources=Object.fromEntries(Object.keys(analysisColumns).map(table=>[table,{rows:[],complete:true}]));
  sources.household_settings.rows=[{starting_balance:5000,starting_balance_date:'2026-09-10',safety_floor:200,forecast_horizon_months:6}];
  sources.incomes.rows=[{id:'salary',name:'Salary',amount:1000,frequency:'monthly',start_date:'2026-06-01',next_payment_date:'2026-09-15'}];
  sources.transactions.rows=[6,7,8].flatMap(month=>[{id:`pay${month}`,date:`2026-0${month}-05`,amount:1000,category:'Income'},{id:`food${month}`,date:`2026-0${month}-06`,amount:-30,category:'Groceries'}]);
  return {householdId:'test',today:'2026-09-10',capturedAt:'2026-09-10T15:00:00Z',timeZone:'America/Chicago',sources};
}
const request=(patch={})=>({domain:'buffer',operation:'summary',purpose:'general',amount:null,amountRole:'none',contribution:null,startDate:null,endDate:null,dateEvent:'none',entity:null,merchant:null,category:null,target:'month_ahead',scenario:null,...patch});

test('shiftMonth resolves full calendar month boundaries from a mid-month day',()=>{
  assert.equal(shiftMonth('2026-09-10',-3),'2026-06-01');
  assert.equal(shiftMonth('2026-09-10',1),'2026-10-01');
});

test('buffer baseline retains June 5 income and next-month target retains October 1 and 5 bills',()=>{
  const s=snapshot();
  s.sources.bills.rows=[{id:'rent',name:'Rent',amount:900,category:'Housing',is_debt:false,is_recurring:true,frequency:'monthly',due_day:1,start_date:s.today},{id:'utilities',name:'Utilities',amount:50,category:'Utilities',is_debt:false,is_recurring:true,frequency:'monthly',due_day:5,start_date:s.today}];
  const result=stabilityAnalysis(s,request());
  assert.equal(result.facts.historicalMonthlySurplus,970);
  assert.equal(result.facts.oneMonthTarget,980.38);
  assert.equal(result.facts.target,980.38);
});

test('history-based budget draft includes early-month spending in all three complete months',()=>{
  const s=snapshot();
  s.sources.transactions.rows=[6,7,8].map((month,index)=>({id:`groceries${month}`,date:`2026-0${month}-01`,amount:-(index+1)*300,category:'Groceries'}));
  const result=wealthAnalysis(s,request({domain:'budget',operation:'plan',target:'none',category:'Groceries'}));
  assert.match(result.text,/History-based draft \(not saved\): Groceries \$600\.00\/month/);
  assert.ok(!result.missing.some(reason=>/each of the last three/.test(reason)));
});
