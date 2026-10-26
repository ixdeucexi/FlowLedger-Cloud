import test from 'node:test';
import assert from 'node:assert/strict';
import { runFinancialAnalysis } from './analysisPlanner.ts';
import { currentBalanceAnalysis, isCurrentAccountReferenceQuestion, resolvePriorAccountReference } from './analysisAccounts.ts';
import { interpretedAccountPhrase } from './analysisSemantics.ts';
import { loadAnalysisSnapshot } from './analysisSnapshot.ts';
import { createPhaseTwoEvaluationClient, phaseTwoSequences, evaluationNow, evaluationHousehold } from '../../../scripts/flo-phase2-evaluation-fixture.ts';

for(const sequence of phaseTwoSequences) test(`fresh read-only multi-turn reference: ${sequence.id}`,async()=>{
  let context=[];
  for(const [turnIndex,turn] of sequence.turns.entries()) {
    if(turn.resetContextBefore)context=[];
    context.push(...(turn.injectedContext??[]));
    const base=createPhaseTwoEvaluationClient(sequence.id,turnIndex),reads=[];
    const client={from(table){reads.push(table);return base.from(table)}};
    const runtime={client,householdId:evaluationHousehold,userId:'fictional',now:evaluationNow,toolResults:[],toolResultNames:[],toolNames:[],toolCache:new Map()};
    const result=await runFinancialAnalysis({runtime,question:turn.question,apiKey:'unused',modelId:'unused',safetyIdentifier:'test',historyEnabled:false,transientContext:context});
    const facts=Object.assign({},...runtime.toolResults.flatMap(result=>result.records));
    for(const [key,value] of Object.entries(turn.expected)) {
      if(key==='noPickedBalance'){for(const field of ['recordedBalance','recordedLiabilityBalance','namedDebtBalance'])assert.equal(facts[field],undefined,`${sequence.id}: ${field}`);}
      else if(key==='clarification')assert.match(result.answer.answer,/Which|name|ambiguous/i);
      else assert.equal(facts[key],value,`${sequence.id}: ${key}`);
    }
    assert.equal(result.usage.inputTokens,0,'closed reference and explicit replacement grammar needs no model guess');
    assert.ok(!reads.includes('flo_messages'));assert.ok(!reads.includes('flo_conversations'));
    context.push({role:'user',content:turn.question},{role:'assistant',content:result.answer.answer});
  }
});

test('reference grammar handles phone punctuation but excludes explicit names dates groups and scenarios',()=>{
  for(const question of ['What is that account’s balance?','What’s its balance?','What is that one’s balance?','What is it’s balance?','And that card?'])assert.equal(isCurrentAccountReferenceQuestion(question),true,question);
  for(const question of ['What is Reserve 9’s balance?','What will that account balance be next Friday?','What is my savings balance?','What if I add $50 to that account?','What about that card and another account?'])assert.equal(isCurrentAccountReferenceQuestion(question),false,question);
});

test('reference provenance is separate from literal scope and cannot authorize another household or override current digits',async()=>{
  const snapshot=await loadAnalysisSnapshot(createPhaseTwoEvaluationClient('account-reference',0),evaluationHousehold,evaluationNow,['accounts','plaid_accounts','bills']);
  const prior=[{question:'What is my Cedar Daily Checking balance?',phrase:interpretedAccountPhrase('What is my Cedar Daily Checking balance?')}];
  const {reference}=resolvePriorAccountReference(snapshot,prior);
  const request={purpose:'current_balance',domain:'money',operation:'detail',startDate:null,endDate:null,dateEvent:'none',entity:reference.accountName,accountGroup:null,scenario:null};
  assert.equal(currentBalanceAnalysis(snapshot,request,'What is that account’s balance?',reference).facts.recordedBalance,700);
  assert.deepEqual(currentBalanceAnalysis(snapshot,request,'What is that account’s balance?',{...reference,householdId:'foreign'}).facts,{});
  assert.deepEqual(currentBalanceAnalysis(snapshot,request,'What is my Reserve 9 balance?',reference).facts,{});
  const assistantOnly=resolvePriorAccountReference(snapshot,[]);assert.ok(assistantOnly.clarification);assert.equal(assistantOnly.reference,undefined);
});

test('an inventory or unrelated latest user turn cannot revive an older account reference',async()=>{
  const snapshot=await loadAnalysisSnapshot(createPhaseTwoEvaluationClient('account-reference',0),evaluationHousehold,evaluationNow,['accounts','plaid_accounts','bills']);
  const named={question:'What is my Cedar Daily Checking balance?',phrase:'Cedar Daily Checking'};
  for(const barrier of ['What accounts can you see?','What is my savings balance?','How much is my next paycheck?'])assert.ok(resolvePriorAccountReference(snapshot,[named,{question:barrier,phrase:null}]).clarification);
  assert.ok(resolvePriorAccountReference(snapshot,[named,{question:'Thanks!',phrase:null}]).reference);
  assert.ok(resolvePriorAccountReference(snapshot,[{question:'Cedar balance?',phrase:interpretedAccountPhrase('Cedar balance?')},{question:'Thanks!',phrase:null}]).reference);
  snapshot.sources.plaid_accounts.complete=false;assert.ok(resolvePriorAccountReference(snapshot,[named]).clarification);
});
