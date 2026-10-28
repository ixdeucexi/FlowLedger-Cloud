import test from 'node:test';
import assert from 'node:assert/strict';
import { isIncomeSourceInventoryQuestion, deterministicAnalysisPlan, interpretAnalysisQuestion, validateAnalysisPlan, isAccountInventoryQuestion } from './analysisSemantics.ts';
import { calculateFinancialAnalysis, runFinancialAnalysis } from './analysisPlanner.ts';
const now='2026-09-10T15:00:00.000Z';
const question='What income sources do I have?';
function fixture(){
 const rows={household_settings:[{household_id:'h',time_zone:'UTC',payment_method:'snowball'}],incomes:[{id:'salary',household_id:'h',name:'Salary',amount:1500,frequency:'weekly',start_date:'2026-09-11',next_payment_date:'2026-09-11'},{id:'future',household_id:'h',name:'Future Contract',amount:500,frequency:'monthly',start_date:'2026-12-01',next_payment_date:'2026-12-01'}]};
 const reads=[];const client={from(table){reads.push(table);const q={select(){return q},eq(key,value){assert.equal(key,'household_id');assert.equal(value,'h');return q},order(){return q},gt(){return q},limit(){return q},maybeSingle:async()=>({data:rows[table]?.[0]??null,error:null}),then:resolve=>Promise.resolve({data:rows[table]??[],error:null}).then(resolve)};return q;}};
 return {rows,reads,client,snapshot:{householdId:'h',today:'2026-09-10',capturedAt:now,timeZone:'UTC',hash:'fictional',sources:Object.fromEntries(Object.entries(rows).map(([table,data])=>[table,{rows:data,complete:true}]))}};
}
test('actual failed income-sources phrase deterministically selects saved income, never account inventory',()=>{
 for(const text of [question,'Which sources of income do we have?','Show me my recorded income sources.','List our income sources']){
  assert.equal(isIncomeSourceInventoryQuestion(text),true,text);assert.equal(isAccountInventoryQuestion(text),false,text);
  const plan=deterministicAnalysisPlan(text,'2026-09-10');assert.equal(plan.requests[0].domain,'income');assert.equal(plan.requests[0].operation,'detail');assert.equal(plan.requests[0].purpose,'general');assert.deepEqual(validateAnalysisPlan(text,plan,'2026-09-10'),[]);
 }
 for(const text of ['What accounts can you see?','Can you show me my income?','What income did I receive last month?','What will my income be after retirement?','What income sources do I have and how much can I spend?','Create a new income source'])assert.equal(isIncomeSourceInventoryQuestion(text),false,text);
 const account=deterministicAnalysisPlan('What accounts can you see?','2026-09-10');assert.equal(account.requests[0].purpose,'account_inventory');
});
test('schema-valid model account-inventory mistake is normalized and cannot satisfy the income-source question',async()=>{
 const wrong=deterministicAnalysisPlan('What accounts can you see?','2026-09-10');
 assert.ok(validateAnalysisPlan(question,wrong,'2026-09-10').some(issue=>/income-source/.test(issue)));
 const interpreted=await interpretAnalysisQuestion(question,async()=>wrong,'2026-09-10');
 assert.equal(interpreted.requests[0].domain,'income');assert.equal(interpreted.requests[0].purpose,'general');
 const result=calculateFinancialAnalysis(fixture().snapshot,interpreted.requests[0],question);
 assert.equal(result.text,'Your recorded income sources: Salary; Future Contract.');assert.equal(result.facts.incomeSourceCount,2);assert.equal(result.facts.accountCount,undefined);assert.deepEqual(result.sources,['incomes']);assert.equal(result.facts.expectedIncome,undefined,'A source list is not a deposit total');
});
test('no-context/history-off income inventory completes without a model, balance, spending history or current-month deposit',async()=>{
 for(const transientContext of [[],[{role:'user',content:'What accounts can you see?'},{role:'assistant',content:'A previous answer is not evidence.'}]]){
  const {client,reads}=fixture();const runtime={client,householdId:'h',userId:'u',now,toolResults:[],toolResultNames:[],toolNames:[],toolCache:new Map()};
  const result=await runFinancialAnalysis({runtime,question,apiKey:'unused-no-provider-call',modelId:'unused',safetyIdentifier:'test',historyEnabled:false,transientContext});
  assert.equal(result.answer.answer,'Your recorded income sources: Salary; Future Contract.');assert.equal(result.aggregate.partial,false);assert.equal(result.usage.inputTokens,0);assert.equal(result.usage.outputTokens,0);assert.ok(reads.every(table=>['household_settings','incomes'].includes(table)),reads.join(','));assert.equal(result.sources[0].route,'/(tabs)/more?section=money');assert.ok(result.answer.answer.split(/\s+/).length<30);
 }
});
test('unavailable income source read remains unknown, not an empty or account-backed inventory',()=>{
 const f=fixture(),request=deterministicAnalysisPlan(question,'2026-09-10').requests[0];f.snapshot.sources.incomes.complete=false;const r=calculateFinancialAnalysis(f.snapshot,request,question);assert.ok(r.missing.length);assert.equal(r.facts.incomeSourceCount,undefined);assert.doesNotMatch(r.text,/No named income|accounts/);
});
