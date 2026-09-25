import test from 'node:test';
import assert from 'node:assert/strict';
import { runFinancialAnalysis } from './analysisPlanner.ts';

for(const [question,scope] of [['What will my savings balance be next Friday?','savings'],['What will my combined balance be next Friday?','all']]) {
  test(`unsupported ${scope} forecast explains the limit without model or financial data reads`,async()=>{
    const reads=[];
    const query={select(){return this},eq(){return this},async maybeSingle(){return {data:{time_zone:'America/Chicago',payment_method:'snowball'},error:null}}};
    const runtime={client:{from(table){reads.push(table);assert.equal(table,'household_settings');return query}},householdId:'fictional',now:new Date('2026-09-10T12:00:00Z'),toolNames:[],toolResultNames:[],toolResults:[]};
    const result=await runFinancialAnalysis({runtime,question,apiKey:'not-a-key',modelId:'unused',safetyIdentifier:'test',historyEnabled:false});
    assert.match(result.answer.answer,/cannot reliably project/);
    assert.match(result.answer.answer,/account-by-account/);
    assert.equal(result.usage.inputTokens,0);
    assert.equal(runtime.toolResults[0].records[0].forecastScope,scope);
    assert.equal(runtime.toolResults[0].status,'partial');
    assert.deepEqual(reads,['household_settings']);
  });
}
