import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { explainFinancialAnalysis, renderAnalysisExplanation } from './analysisExplanation.ts';

const result = (overrides={}) => ({text:'Your projected balance is $742.00 on 2026-10-03.\n\nThe lowest projected balance is $318.00 on 2026-09-28.',facts:{projectedBalance:742,minimumProjectedBalance:318,minimumDate:'2026-09-28',cashCushion:500},sources:['accounts','bills','income_sources'],assumptions:['Scheduled income is not a guarantee of receipt.'],missing:[],scenario:false,...overrides});
const selection = (overrides={}) => ({segments:[{resultIndex:0,paragraphIndex:1,insight:'below_cushion'}],followups:[{resultIndex:0,kind:'upcoming_bills'}],...overrides});
const options = (overrides={}) => ({question:'Can I afford this purchase?',results:[result()],apiKey:'unused-test-key',modelId:'unused-test-model',safetyIdentifier:'test',timeoutMs:1000,...overrides});

test('adds a fact-gated relationship without duplicating or mutating the authoritative answer',()=>{
  const source=result(),before=structuredClone(source);
  const answer=renderAnalysisExplanation(selection(),[source],'Can I afford this purchase?');
  assert.match(answer.explanation,/projected low point is below your recorded cash cushion/);
  assert.match(answer.explanation,/before considering extra spending or extra debt payments/);
  assert.deepEqual(source,before);
  assert.deepEqual(answer.followups,['What bills are due before my next paycheck?']);
  assert.doesNotMatch(answer.explanation,/\$742|\$318|2026/);
});

test('model cannot invent numbers dates statuses or reinterpret a real number as spendable',()=>{
  for(const payload of [
    {...selection(),explanation:'You can safely spend $318.00.'},
    {...selection(),segments:[{resultIndex:0,paragraphIndex:1,insight:'below_cushion',text:'You are financially secure.'}]},
    {...selection(),segments:[{resultIndex:0,paragraphIndex:99,insight:'below_cushion'}]},
    {...selection(),segments:[{resultIndex:3,paragraphIndex:0,insight:'below_cushion'}]},
    {...selection(),segments:[{resultIndex:0,paragraphIndex:0,interpretation:'You can safely spend $318.00.'}]},
  ])assert.equal(renderAnalysisExplanation(payload,[result()],'Can I afford it?'),null);
});

test('can prioritize compound relationships only within each referenced result',()=>{
  const savings=result({text:'Your savings balance is $300.00.',facts:{savingsBalance:300},assumptions:['Goal earmarks are not added again.']});
  const answer=renderAnalysisExplanation({segments:[{resultIndex:1,paragraphIndex:0,insight:'savings_commitment'},{resultIndex:0,paragraphIndex:1,insight:'below_cushion'}],followups:[]},[result(),savings],'How should I think about savings versus spending?');
  assert.ok(answer.explanation.indexOf('A savings target')<answer.explanation.indexOf('The projected low point'));
  assert.equal(renderAnalysisExplanation({segments:[{resultIndex:1,paragraphIndex:0,insight:'below_cushion'}],followups:[]},[result(),savings],'How should I think about savings?'),null);
});

test('partial data cannot acquire full-data recommendations or hypothetical certainty',()=>{
  const partial=result({missing:['Current checking observation is unavailable'],scenario:true});
  assert.equal(renderAnalysisExplanation(selection(),[partial],'Can I spend?'),null);
  const answer=renderAnalysisExplanation({segments:[{resultIndex:0,paragraphIndex:1,insight:'missing_data'},{resultIndex:0,paragraphIndex:0,insight:'scenario_not_change'}],followups:[]},[partial],'Can I spend?');
  assert.match(answer.explanation,/what-if comparison, not a change/);
  assert.match(answer.explanation,/before drawing a stronger conclusion/);
});

test('recorded balance cannot become permission to spend while neutral interpretation survives',()=>{
  const balance=result({text:'Checking: $1000.00 recorded. This is not safe-to-spend money.',facts:{recordedBalance:1000,safeToSpend:null},assumptions:[]});
  assert.equal(renderAnalysisExplanation({segments:[{resultIndex:0,paragraphIndex:0,interpretation:'You can spend the balance.'}],followups:[]},[balance],'How much money?'),null);
  const answer=renderAnalysisExplanation({segments:[{resultIndex:0,paragraphIndex:0,insight:'recorded_not_spendable'}],followups:[]},[balance],'How much money?');
  assert.match(answer.explanation,/not a spending allowance/);
  assert.match(answer.explanation,/check upcoming obligations/);
});

test('SENTINEL adverse prose cannot cross the strict typed relationship boundary',()=>{
  const negative=result({text:'The lowest projected checking balance is -$250.00 on 2026-10-03.',facts:{minimumProjectedBalance:-250},missing:[],assumptions:[]});
  for(const text of ['Every obligation fits comfortably within existing cash.','No overdraft risk remains.','Repay everything now.','Nothing to worry about financially.','Plenty of room for discretionary purchases.','You have spare money.','The forecast changed by 20%.']) {
    assert.equal(renderAnalysisExplanation({segments:[{resultIndex:0,paragraphIndex:0,insight:'negative_forecast',interpretation:text}],followups:[]},[negative],'How am I doing?'),null,text);
    assert.equal(renderAnalysisExplanation({segments:[{resultIndex:0,paragraphIndex:0,insight:text}],followups:[]},[negative],'How am I doing?'),null,text);
  }
  const answer=renderAnalysisExplanation({segments:[{resultIndex:0,paragraphIndex:0,insight:'negative_forecast'}],followups:[]},[negative],'How am I doing?');
  assert.match(answer.explanation,/forecast includes a negative checking balance/);
  assert.equal(renderAnalysisExplanation({...selection(),followups:[{resultIndex:0,kind:'debt_plan'}]},[result()],'How am I doing?'),null);
});

test('positive or unverified forecasts cannot acquire a shortfall relationship',()=>{
  for(const facts of [{minimumProjectedBalance:600,cashCushion:500},{minimumProjectedBalance:null,cashCushion:500},{minimumProjectedBalance:NaN,cashCushion:500},{minimumProjectedBalance:318,cashCushion:null}]) {
    assert.equal(renderAnalysisExplanation(selection({followups:[]}),[result({facts})],'How am I doing?'),null);
  }
  assert.equal(renderAnalysisExplanation({segments:[{resultIndex:0,paragraphIndex:0,insight:'negative_forecast'}],followups:[]},[result()],'How am I doing?'),null);
});

test('no useful insight leaves only relevant followups and duplicate insights render once',()=>{
  const answer=renderAnalysisExplanation(selection({segments:[{resultIndex:0,paragraphIndex:0,insight:null}]}),[result()],'How am I doing?');
  assert.equal(answer.explanation,'');assert.equal(answer.followups.length,1);
  assert.equal(renderAnalysisExplanation({segments:[{resultIndex:0,paragraphIndex:0,insight:null}],followups:[]},[result()],'How am I doing?'),null);
  const dedup=renderAnalysisExplanation(selection({segments:[{resultIndex:0,paragraphIndex:0,insight:'below_cushion'},{resultIndex:0,paragraphIndex:1,insight:'below_cushion'}]}),[result()],'How am I doing?');
  assert.equal(dedup.explanation.match(/projected low point/g).length,1);
});

test('followups do not re-ask the current question or include unsupported free-form questions',()=>{
  const answer=renderAnalysisExplanation(selection(),[result()],'Which bills are due before payday?');
  assert.deepEqual(answer.followups,[]);
  assert.equal(renderAnalysisExplanation({segments:[],followups:[{resultIndex:0,kind:'Send $318 to debt now'}]},[result()],'How am I doing?'),null);
  assert.equal(renderAnalysisExplanation({segments:[],followups:[{resultIndex:0,kind:'cash_low'}]},[result()],'When will my projected balance be lowest?'),null);
});

test('never clips a paragraph ending in a financial restriction',()=>{
  const long=result({text:'A'.repeat(1700)+' This is not affordable.'});
  assert.equal(renderAnalysisExplanation({segments:[{resultIndex:0,paragraphIndex:0,insight:'below_cushion'}],followups:[]},[long],'Can I buy it?'),null);
});

test('one bounded composition receives current evidence and both conversation roles',async()=>{
  let calls=0;
  const answer=await explainFinancialAnalysis(options({conversation:[{role:'user',content:'What is the low point?'},{role:'assistant',content:'An old answer is not current evidence.'}]}),async input=>{
    calls++;
    const prompt=JSON.parse(input.prompt);
    assert.deepEqual(prompt.conversation.map(t=>t.role),['user','assistant']);
    assert.equal(prompt.evidence[0].facts.minimumProjectedBalance,318);
    assert.match(input.system,/old answers are not current financial evidence/);
    assert.equal(input.abortSignal.aborted,false);
    return {output:selection(),usage:{inputTokens:123,outputTokens:45}};
  });
  assert.equal(calls,1);
  assert.deepEqual(answer.usage,{inputTokens:123,outputTokens:45});
});

test('timeout aborts a stalled composer and preserves the caller budget',async()=>{
  let signal;
  const start=performance.now();
  const answer=await explainFinancialAnalysis(options({timeoutMs:15}),input=>{signal=input.abortSignal;return new Promise(()=>{});});
  assert.equal(answer,null);
  assert.equal(signal.aborted,true);
  assert.ok(performance.now()-start<500);
});

test('provider failures and ungrounded selections return null without retrying or modifying results',async()=>{
  const source=result();const saved=structuredClone(source);let calls=0;
  assert.equal(await explainFinancialAnalysis(options({results:[source]}),async()=>{calls++;throw new Error('provider unavailable');}),null);
  assert.equal(calls,1);assert.deepEqual(source,saved);
  assert.equal(await explainFinancialAnalysis(options(),async()=>({output:{explanation:'You can spend $500'}})),null);
  assert.equal(await explainFinancialAnalysis(options({timeoutMs:0}),async()=>{throw new Error('must not call');}),null);
});

test('spending comparison insight requires an actual comparison, not common spending fields on other tools',()=>{
  const proposed={segments:[{resultIndex:0,paragraphIndex:0,insight:'spending_comparison'}],followups:[]};
  assert.equal(renderAnalysisExplanation(proposed,[result({facts:{spending:35,income:1500,fees:0}})],'How much income did I receive?'),null);
  assert.ok(renderAnalysisExplanation(proposed,[result({facts:{spending:35,previousSpending:20,spendingChange:15}})],'Am I spending more?'));
});

test('production composition uses existing provider model no storage no retry and strict structured selection',()=>{
  const source=readFileSync(new URL('./analysisExplanation.ts',import.meta.url),'utf8');
  assert.match(source,/responses\(options\.modelId\)/);
  assert.match(source,/maxRetries: 0/);
  assert.match(source,/store: false/);
  assert.match(source,/Output\.object\(\{ schema: selectionSchema \}\)/);
  assert.match(source,/Math\.min\(options\.timeoutMs, 5000\)/);
});
