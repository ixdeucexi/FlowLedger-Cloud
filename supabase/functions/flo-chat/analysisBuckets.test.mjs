import test from 'node:test';
import assert from 'node:assert/strict';
import { bucketDetailsAnalysis } from './analysisBuckets.ts';
import { analysisTypedFollowups, analysisSourceRoute } from './analysisPresentation.ts';
import { runFinancialAnalysis, calculateFinancialAnalysis, validateAnalysisRequest } from './analysisPlanner.ts';
import { deterministicAnalysisPlan, interpretAnalysisQuestion, validateAnalysisPlan } from './analysisSemantics.ts';
import { analysisSourceDependencies, loadAnalysisSnapshot } from './analysisSnapshot.ts';
import { classifyFloV4SimpleIntent, floV4StaticIntentResult, runFloV4SimpleIntent } from '../flo-chat-v4/simpleIntents.ts';
import { loadAnalysisEntityCatalog } from './analysisContext.ts';
import { createPhaseThreeEvaluationClient, phaseThreeCases, evaluationNow, evaluationHousehold } from '../../../scripts/flo-phase3-evaluation-fixture.ts';

const request=(patch={})=>({purpose:'bucket_details',domain:'budget',operation:'detail',entity:'Christmas Shopping',dateEvent:'none',startDate:null,endDate:null,comparisonStart:null,comparisonEnd:null,scenario:null,amount:null,...patch});
const snapshot=async(id='bucket-summary')=>loadAnalysisSnapshot(createPhaseThreeEvaluationClient(id),evaluationHousehold,evaluationNow,['goals','transactions']);

for(const item of phaseThreeCases.filter(item=>!['bucket-natural','greeting','thanks','income-help','bucket-help'].includes(item.id)))test(`deterministic Phase3 receipt: ${item.id}`,async()=>{
  const base=createPhaseThreeEvaluationClient(item.id),reads=[],runtime={client:{from(table){reads.push(table);return base.from(table)}},householdId:evaluationHousehold,userId:'fictional',now:evaluationNow,toolResults:[],toolResultNames:[],toolNames:[],toolCache:new Map()};
  const result=await runFinancialAnalysis({runtime,question:item.question,apiKey:'unused',modelId:'unused',safetyIdentifier:'test',historyEnabled:false});
  const facts=Object.assign({},...runtime.toolResults.flatMap(result=>result.records));
  for(const [key,value] of Object.entries(item.expected)) {
    if(key==='noBucketBalance'){assert.equal(facts.bucketRemaining,undefined);assert.equal(facts.bucketSpent,undefined);}
    else if(key==='partial')assert.equal(result.aggregate.partial,value);
    else if(key==='clarification')assert.match(result.answer.answer,/Which spending bucket/);
    else if(key==='choices')value.forEach(question=>assert.ok(result.answer.followups.includes(question),question));
    else if(key==='route')assert.equal(result.sources[0].route,value);
    else if(key==='purchaseName')assert.equal(facts.purchase1Name,value);
    else assert.equal(facts[key],value,`${item.id}: ${key}`);
  }
  assert.ok(result.answer.followups.length<=3);assert.equal(result.usage.inputTokens,0);
  if(item.id.startsWith('bucket-'))assert.ok(reads.every(table=>['household_settings','goals','transactions'].includes(table)));
});

test('bucket math uses canonical saved spent including legacy spending, not visible purchase sum',async()=>{
  const result=bucketDetailsAnalysis(await snapshot(),request());
  assert.equal(result.facts.bucketSpent,125);assert.equal(result.facts.bucketHistoryAllocated,30);assert.equal(result.facts.bucketRemaining,375);assert.equal(result.facts.purchase1TransactionAmount,100);assert.equal(result.facts.purchase1Allocated,30);
  assert.match(result.text,/Saved toy store purchase/);assert.doesNotMatch(result.text,/Original bank merchant/);assert.match(result.text,/not spendable bank cash/);
  assert.ok(result.assumptions.some(text=>/not summed to replace/.test(text)));
  const mismatch=await snapshot();mismatch.sources.goals.rows[0].current_amount=10;
  const partial=bucketDetailsAnalysis(mismatch,request());assert.equal(partial.facts.bucketSpent,10);assert.ok(partial.missing.some(text=>/exceed the saved spent/.test(text)));
});

test('bucket raw money dates allocations and purpose cannot be coerced into fake zero or affordability',async()=>{
  for(const field of ['target_amount','current_amount'])for(const value of [null,'',false,{},-1,'NaN']) {
    const s=await snapshot();s.sources.goals.rows[0][field]=value;assert.deepEqual(bucketDetailsAnalysis(s,request()).facts,{},`${field}:${value}`);
  }
  for(const patch of [{target_date:'2026-02-30'},{closed_at:'bad'},{closed_at:'2027-01-01T00:00:00Z'}]) {
    const s=await snapshot();Object.assign(s.sources.goals.rows[0],patch);assert.deepEqual(bucketDetailsAnalysis(s,request()).facts,{});
  }
  for(const question of ['What will be left in Christmas Shopping next Friday?','Can I safely afford a purchase from Christmas Shopping?','What was left in Christmas Shopping last month?'])assert.deepEqual(bucketDetailsAnalysis(await snapshot(),request(),question).facts,{});
  for(const patch of [{entity:null},{domain:'money'},{operation:'summary'},{endDate:'2026-12-25'},{scenario:{kind:'purchase'}},{dateEvent:'next_payday'},{amount:100}])assert.ok(validateAnalysisRequest(request(patch),'2026-09-10'));
  for(const allocation of [{amount:200},{amount:null},{amount:30,type:'unknown'},{amount:30,source:'unknown'},{amount:30,occurrenceDate:'2026-02-30'}]) {
    const s=await snapshot();Object.assign(s.sources.transactions.rows[0].review_allocations[0],allocation);const result=bucketDetailsAnalysis(s,request());assert.equal(result.facts.bucketHistoryCount,0);assert.equal(result.facts.bucketSpent,125);assert.ok(result.missing.length);
  }
});

test('limited retained history is counted and labeled without truncating spending or hiding overage warnings',async()=>{
  const s=await snapshot();s.sources.goals.rows[0].current_amount=550;
  s.sources.transactions.rows=Array.from({length:7},(_,i)=>({...s.sources.transactions.rows[0],id:String(i)}));
  const result=bucketDetailsAnalysis(s,request());assert.equal(result.facts.bucketHistoryCount,7);assert.equal(result.facts.bucketHistoryShown,5);assert.equal(result.facts.bucketHistoryAllocated,210);assert.equal(result.facts.bucketSpent,550);assert.match(result.text,/showing 5 of 7/);assert.match(result.text,/over the planned amount/);
});

test('duplicate or truncated bucket names do not create looping ambiguity questions',async()=>{
  const s=await snapshot('bucket-ambiguous');s.sources.goals.rows.forEach(goal=>goal.name='Holiday');
  const numbered=await snapshot('bucket-ambiguous');numbered.sources.goals.rows=numbered.sources.goals.rows.filter(goal=>goal.name==='Holiday 1');
  assert.deepEqual(bucketDetailsAnalysis(numbered,request({entity:'Holiday'}),'Please inspect Holiday 2 bucket budget').facts,{});
  assert.deepEqual(bucketDetailsAnalysis(numbered,request({entity:'Holiday 1'}),'How much is left in my Holiday bucket?').facts,{});
  const result=bucketDetailsAnalysis(s,request({entity:'Holiday'}));assert.equal(result.choices,undefined);assert.deepEqual(analysisTypedFollowups([result],[request()],'What is left in Holiday?'),[]);
});

test('natural bucket question retains one typed read and goal catalog identifies buckets without exposing financial amounts',async()=>{
  const item=phaseThreeCases.find(item=>item.id==='bucket-natural');assert.equal(deterministicAnalysisPlan(item.question,'2026-09-10'),null);
  const plan=await interpretAnalysisQuestion(item.question,async()=>({legacy:false,requests:[request()]}),'2026-09-10');
  assert.equal(calculateFinancialAnalysis(await snapshot(),plan.requests[0]).facts.bucketRemaining,375);
  const catalog=await loadAnalysisEntityCatalog(createPhaseThreeEvaluationClient(),evaluationHousehold);assert.deepEqual(catalog.spending_buckets,['Christmas Shopping']);assert.ok(!JSON.stringify(catalog).includes('planned_expense'));assert.ok(!JSON.stringify(catalog).includes('125'));
  assert.deepEqual(analysisSourceDependencies(request()),['household_settings','goals','transactions']);
});

test('typed followups preserve exact numbered choices and suppress repeats partial promises and duplicate names',()=>{
  const result={text:'Never parse this $99999 text',facts:{},sources:[],assumptions:[],missing:['ambiguous'],scenario:false,choices:{kind:'account',names:['Reserve 1','Reserve 2']}};
  assert.deepEqual(analysisTypedFollowups([result],[{purpose:'current_balance',domain:'money'}],'Reserve?'),['What is my Reserve 1 balance?','What is my Reserve 2 balance?']);
  assert.deepEqual(analysisTypedFollowups([result],[{purpose:'current_balance',domain:'money'}],'What is my Reserve 1 balance?'),['What is my Reserve 2 balance?']);
  const generic={...result,choices:{kind:'account',names:['Checking','Savings','Cash','Current Checking','Total Account']}};
  assert.deepEqual(analysisTypedFollowups([generic],[{purpose:'current_balance',domain:'money'}],'Which account?'),['What accounts can you see?']);
  assert.deepEqual(analysisTypedFollowups([{...result,choices:{kind:'account',names:[]}}],[{purpose:'current_balance',domain:'money'}],'Which account?'),['What accounts can you see?']);
  assert.deepEqual(analysisTypedFollowups([{...result,choices:undefined}],[{purpose:'current_balance',domain:'money'}],'Reserve?'),[]);
  const bucket={...result,missing:[],choices:undefined,facts:{bucketName:'Christmas Shopping',bucketRemaining:375}};
  assert.deepEqual(analysisTypedFollowups([bucket],[request()],'Show my Christmas Shopping bucket purchases.'),['How do I add a purchase to a bucket?']);
  for(const facts of [{bucketName:'Christmas Shopping',bucketRemaining:0},{bucketName:'Christmas Shopping',bucketClosed:true,bucketRemaining:0}])assert.deepEqual(analysisTypedFollowups([{...bucket,facts}],[request()],'Show my Christmas Shopping bucket purchases.'),[]);
});

test('source mapping distinguishes observations liabilities bucket budgets forecasts and affordability',()=>{
  assert.equal(analysisSourceRoute({purpose:'current_balance',domain:'money'}),'/(tabs)/accounts');
  assert.equal(analysisSourceRoute({purpose:'forecast_balance',domain:'forecast'}),'/(tabs)/monthly');
  assert.equal(analysisSourceRoute({purpose:'affordability',domain:'money'}),'/(tabs)/monthly');
  assert.equal(analysisSourceRoute(request()),'/(tabs)/more?section=buckets');
  assert.equal(analysisSourceRoute({purpose:'current_balance',domain:'money'},{facts:{namedDebtBalance:1000}}),'/snowball-plan');
  assert.equal(analysisSourceRoute({purpose:'current_balance',domain:'money'},{facts:{accountType:'credit'}}),'/(tabs)/bills?view=debt');
  assert.equal(analysisSourceRoute({purpose:'current_balance',domain:'money'},{facts:{accountType:'credit_card'}}),'/(tabs)/accounts');
  assert.equal(analysisSourceRoute({purpose:'general',domain:'credit'},{facts:{cardBalance:400,creditLimit:2000,utilizationPercent:20}}),'/(tabs)/bills?view=debt');
});

test('pure friendly greeting thanks and help use the exact endpoint dispatcher without database calls',async()=>{
  for(const id of ['greeting','thanks','income-help','bucket-help']) {
    const item=phaseThreeCases.find(item=>item.id===id),intent=classifyFloV4SimpleIntent(item.question),direct=floV4StaticIntentResult(intent);
    assert.equal(intent.kind,item.expected.staticKind);const actual=await runFloV4SimpleIntent(intent,{client:{from(){throw Error('no data read')}},householdId:evaluationHousehold,now:evaluationNow,weatherConfig:null});assert.deepEqual(actual,direct);
    if(item.expected.route)assert.equal(actual.sources[0].route,item.expected.route);
  }
  for(const question of ['How much income do I need?','How much is left in my Christmas Shopping bucket?','Thanks, how much can I spend?','How do I add income and what is my balance?'])assert.equal(classifyFloV4SimpleIntent(question),null,question);
});


test('bucket calendar qualifiers cannot return current numbers when model omits date fields',async()=>{
  for(const question of ['What is left in my Christmas Shopping bucket in 2027?','What is left in my Christmas Shopping bucket in 1800?','What is left in my Christmas Shopping bucket in 3000?','What is left in my Christmas Shopping bucket on December 25?','Show my Christmas Shopping bucket balance at the end of this year.','What is left in my Christmas Shopping bucket last month?']) {
    const plan=await interpretAnalysisQuestion(question,async()=>({legacy:false,requests:[request()]}),'2026-09-10');
    const result=calculateFinancialAnalysis(await snapshot(),plan.requests[0],question);assert.deepEqual(result.facts,{});assert.ok(result.missing.length);assert.match(result.text,/different date or period/);
    assert.ok(validateAnalysisPlan(question,{legacy:false,requests:[{...request(),purpose:'general'}]},'2026-09-10').length,'other calculators cannot silently answer a named bucket period');
  }
  for(const name of ['Christmas 2027','December 25','May','End of Year 2027']) {
    const s=await snapshot();s.sources.goals.rows[0].name=name;
    const result=bucketDetailsAnalysis(s,request({entity:name}),`What is left in my ${name} bucket today?`);assert.equal(result.facts.bucketRemaining,375,name);
  }
  const s=await snapshot();s.sources.goals.rows[0].name='2027';
  assert.equal(bucketDetailsAnalysis(s,request({entity:'2027'}),'What is left in my 2027 bucket today?').facts.bucketRemaining,375);
  assert.deepEqual(bucketDetailsAnalysis(s,request({entity:'2027'}),'What is left in my 2027 bucket in 2027?').facts,{},'one saved-name mention must not erase the separate year qualifier');
});


test('noncurrent bucket qualifier grammar rejects a matrix of cutoffs and periods while literal calendar names remain current',async()=>{
  const qualifiers=['on 12/25','on 25 December','on Friday','by Friday','in two weeks','in 2 weeks','in a month','at Christmas','as of 9/1','during Q4','for the next month','from September 1 through September 30','in 1800','in 3000'];
  for(const qualifier of qualifiers) {
    const question=`What is left in my Christmas Shopping bucket ${qualifier}?`,r=request();
    const plan=await interpretAnalysisQuestion(question,async()=>({legacy:false,requests:[r]}),'2026-09-10');
    const result=calculateFinancialAnalysis(await snapshot(),plan.requests[0],question);assert.deepEqual(result.facts,{},qualifier);assert.ok(result.missing.length,qualifier);
  }
  for(const question of ['What is left in my Christmas Shopping bucket and how much have I used?','Show my Christmas Shopping bucket purchases and remaining budget.']) {
    const plan=await interpretAnalysisQuestion(question,async()=>({legacy:false,requests:[request()]}),'2026-09-10');
    const current=calculateFinancialAnalysis(await snapshot(),plan.requests[0],question);assert.equal(current.facts.bucketRemaining,375,question);assert.equal(current.facts.bucketSpent,125,question);
  }
  for(const [name,qualifier] of [['Friday','today'],['Q4','right now'],['Christmas 2027','as of today'],['25 December',''],['12/25','today'],['End of Year 2027','current details']]) {
    const s=await snapshot();s.sources.goals.rows[0].name=name;assert.equal(bucketDetailsAnalysis(s,request({entity:name}),`What is left in my ${name} bucket ${qualifier}?`).facts.bucketRemaining,375,`${name}: ${qualifier}`);
  }
});
