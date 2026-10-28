import test from 'node:test';
import assert from 'node:assert/strict';
import { incomeArithmeticClarification, deterministicAnalysisPlan } from './analysisSemantics.ts';
import { calculateFinancialAnalysis, runFinancialAnalysis } from './analysisPlanner.ts';
const actual='Add up my income for Salary, $500 monthly, first payday 2026-11-01.';

test('actual ambiguous arithmetic-income phrase returns a concise clarification without a model, scenario or creation',async()=>{
 const oldFetch=globalThis.fetch;let external=0,reads=0,writes=0;globalThis.fetch=async()=>{external++;throw Error('No network permitted');};
 try {
  const runtime={client:{from(){reads++;throw Error('No read needed for ambiguous scope');},rpc(){writes++;throw Error('No mutation permitted');}},householdId:'h',userId:'u',now:'2026-10-28T12:00:00Z',toolResults:[],toolResultNames:[],toolNames:[],toolCache:new Map()};
  const result=await runFinancialAnalysis({runtime,question:actual,apiKey:'unused',modelId:'unused',safetyIdentifier:'test',historyEnabled:false});
  assert.equal(result.answer.answer,'Should I total your saved income for a specific period, or just the amounts in your message?');assert.deepEqual(result.answer.claims,[]);assert.equal(result.answer.creation,undefined);assert.deepEqual(result.usage,{inputTokens:0,outputTokens:0});assert.equal(external,0);assert.equal(reads,0);assert.equal(writes,0);assert.deepEqual(runtime.toolResults[0].records.map(row=>Object.keys(row)),[['id']]);assert.doesNotMatch(result.answer.answer,/forecast|balance|\$|scenario/i);
 } finally {globalThis.fetch=oldFetch;}
});
test('clarifier is limited to unresolved income arithmetic, preserving clear-period saved sums and creation/forecast questions',()=>{
 for(const question of [actual,'Sum up my income, Salary 500 dollars monthly.','Total my paycheck income $500 weekly.'])assert.ok(incomeArithmeticClarification(question),question);
 for(const question of ['Add up my saved income for November 2026.','Total my income this month.','Add up my saved income from 2026-11-01 through 2026-11-30.','Add up my income for November 2026, Salary $500 monthly.','Add up my income this month, including $500 Salary.','Create income Salary $500 monthly first payday 2026-11-01.','What if my paycheck is $500 lower?','Add up $500 and $150.','What income sources do I have?'])assert.equal(incomeArithmeticClarification(question),null,question);
});


test('an explicit saved-income period still uses the canonical occurrence sum, without any baseline or literal-amount override',()=>{
 const question='Add up my saved income from 2026-11-01 through 2026-11-30.';
 assert.equal(incomeArithmeticClarification(question),null);
 const seed=deterministicAnalysisPlan('What income sources do I have?','2026-10-28').requests[0];
 const request={...seed,operation:'summary',startDate:'2026-11-01',endDate:'2026-11-30'};
 const snapshot={householdId:'h',today:'2026-10-28',capturedAt:'2026-10-28T12:00:00Z',timeZone:'UTC',hash:'test',sources:{household_settings:{complete:true,rows:[{time_zone:'UTC'}]},incomes:{complete:true,rows:[{id:'salary',name:'Salary',amount:1500,frequency:'biweekly',start_date:'2026-11-06',next_payment_date:'2026-11-06'}]}}};
 const r=calculateFinancialAnalysis(snapshot,request,question);assert.equal(r.facts.expectedIncome,3000);assert.equal(r.facts.expectedPaymentCount,2);assert.deepEqual(r.missing,[]);assert.equal(r.scenario,false);assert.equal(r.facts.projectedBalance,undefined);
});
