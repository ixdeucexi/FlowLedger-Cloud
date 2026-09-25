import test from 'node:test';
import assert from 'node:assert/strict';
import { currentAccountBalanceGroup, deterministicAnalysisPlan, interpretAnalysisQuestion } from './analysisSemantics.ts';
import { calculateFinancialAnalysis, runFinancialAnalysis } from './analysisPlanner.ts';
import { analysisColumns } from './analysisSnapshot.ts';

const now='2026-09-25T15:00:00Z';
function fixture(){
  const rows=Object.fromEntries(Object.keys(analysisColumns).map(name=>[name,[]]));
  rows.household_settings=[{household_id:'h',time_zone:'America/Chicago',payment_method:'snowball',starting_balance:1000,starting_balance_date:'2026-09-25'}];
  rows.accounts=[{id:'c',household_id:'h',name:'Daily cash',account_type:'checking',current_balance:1000,balance_as_of:'2026-09-25',is_active:true},{id:'s',household_id:'h',name:'Rainy day',account_type:'savings',current_balance:300,balance_as_of:'2026-09-25',is_active:true}];
  const reads=[];
  const client={from(table){reads.push(table);const q={select(){return q},eq(){return q},order(){return q},limit(){return q},gt(){return q},maybeSingle:async()=>({data:rows[table][0]}),then:resolve=>Promise.resolve({data:rows[table],error:null}).then(resolve)};return q}};
  const snapshot={householdId:'h',today:'2026-09-25',timeZone:'America/Chicago',capturedAt:now,hash:'fixture',sources:Object.fromEntries(Object.entries(rows).map(([t,r])=>[t,{rows:r,complete:true}]))};
  return {client,reads,snapshot};
}
for(const question of ['How much money do I have in savings?','What is my savings account balance?','Show me my current savings balance'])test(`savings question reaches savings through the actual dispatcher: ${question}`,()=>{
  const plan=deterministicAnalysisPlan(question,'2026-09-25');
  assert.equal(plan.requests[0].accountGroup,'savings');
  assert.equal(calculateFinancialAnalysis(fixture().snapshot,plan.requests[0]).facts.recordedBalance,300);
});
test('generic savings model output cannot become checking',async()=>{
  const r=deterministicAnalysisPlan('What is my checking balance?','2026-09-25').requests[0];
  const plan=await interpretAnalysisQuestion('How much is in my savings?',async()=>({legacy:false,requests:[{...r,accountGroup:null}]}),'2026-09-25');
  assert.equal(plan.requests[0].accountGroup,'savings');
  assert.equal(calculateFinancialAnalysis(fixture().snapshot,plan.requests[0]).facts.recordedBalance,300);
});
test('qualified dates, spending, and named balances never use the raw balance shortcut',()=>{
  for(const question of ['How much money do I have in savings next Friday?','What is my savings balance after rent?','How much can I safely spend from savings?','What is my Rainy day balance?'])assert.equal(currentAccountBalanceGroup(question),null);
});
test('simple savings query completes without a model call or unrelated tables',async()=>{
  const {client,reads}=fixture();const runtime={client,householdId:'h',userId:'u',now,toolResults:[],toolResultNames:[],toolNames:[],toolCache:new Map()};
  const result=await runFinancialAnalysis({runtime,question:'How much money do I have in savings?',apiKey:'not-a-real-key',modelId:'not-a-real-model',safetyIdentifier:'test',historyEnabled:false});
  assert.match(result.answer.answer,/Savings: \$300.00/);
  assert.equal(result.aggregate.partial,false);
  assert.ok(reads.every(t=>['household_settings','accounts','plaid_accounts'].includes(t)));
});
