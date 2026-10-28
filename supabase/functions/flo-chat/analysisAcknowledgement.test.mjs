import test from 'node:test';
import assert from 'node:assert/strict';
import { orphanAnalysisAcknowledgement, runFinancialAnalysis } from './analysisPlanner.ts';

test('bare Yes without a resolvable question is a structured zero-claim clarification, with no reads/writes/provider calls',async()=>{
 const previousFetch=globalThis.fetch;let fetches=0;globalThis.fetch=async()=>{fetches++;throw Error('No external request is permitted');};
 try {
  for(const [historyEnabled,transientContext] of [[false,[]],[undefined,undefined],[true,undefined],[false,[{role:'user',content:'Hi!'},{role:'assistant',content:'How can I help?'}]]]){
   let reads=0,writes=0;const runtime={client:{from(){reads++;throw Error('No database read is needed');},rpc(){writes++;throw Error('No writes permitted');}},householdId:'h',userId:'u',now:'2026-09-10T15:00:00Z',toolResults:[],toolResultNames:[],toolNames:[],toolCache:new Map()};
   const result=await runFinancialAnalysis({runtime,question:'Yes',apiKey:'unused-no-network',modelId:'unused',safetyIdentifier:'test',historyEnabled,transientContext});
   assert.equal(result.answer.answer,'What would you like me to check or help you add?');assert.deepEqual(result.answer.claims,[]);assert.deepEqual(result.usage,{inputTokens:0,outputTokens:0});assert.ok(result.aggregate.coverage);assert.equal(reads,0);assert.equal(writes,0);assert.equal(fetches,0);assert.equal(runtime.toolResults.length,1);assert.deepEqual(runtime.toolResults[0].records.map(row=>Object.keys(row)),[['id']]);
  }
 } finally {globalThis.fetch=previousFetch;}
});
test('acknowledgement grammar is bounded and preserves potentially meaningful contextual follow-ups',()=>{
 for(const question of ['Yes','Yes please!','Okay.','Sure'])assert.ok(orphanAnalysisAcknowledgement(question,[]),question);
 const context=[{role:'user',content:'What is my savings balance?'},{role:'assistant',content:'Would you like me to check the recorded accounts?'}];
 assert.equal(orphanAnalysisAcknowledgement('Yes',context),null);
 for(const question of ['Yes, add income named Salary','What is my checking balance?','Yes my checking balance is $500'])assert.equal(orphanAnalysisAcknowledgement(question,[]),null,question);
});
test('unavailable saved context produces clarification for bare Yes instead of an empty interpreted plan',async()=>{
 let calls=0;const runtime={client:{from(table){calls++;const query={select(){return query},eq(){return query},neq(){return query},order(){return query},limit(){return query},maybeSingle:async()=>({data:null,error:new Error('Unavailable')}),then:resolve=>Promise.resolve({data:null,error:new Error('Unavailable')}).then(resolve)};return query;}},householdId:'h',userId:'u',now:'2026-09-10T15:00:00Z',toolResults:[],toolResultNames:[],toolNames:[],toolCache:new Map()};
 const r=await runFinancialAnalysis({runtime,question:'Yes',apiKey:'unused',modelId:'unused',safetyIdentifier:'test',historyEnabled:true,conversationId:'c'});assert.equal(r.answer.answer,'What would you like me to check or help you add?');assert.equal(r.usage.inputTokens,0);assert.equal(calls,2);
});
