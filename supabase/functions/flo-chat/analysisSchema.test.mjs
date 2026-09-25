import test from 'node:test';
import assert from 'node:assert/strict';
import { financialAnalysisSchema, financialAnalysisJsonSchema, parseFinancialAnalysisPlan } from './analysisSchema.ts';

const parameters=(patch={})=>({planDays:null,timelineUnit:null,metric:null,amountRole:'none',contribution:null,accountGroup:null,groupBy:'none',incomeTiming:'expected',startDate:null,endDate:null,dateEvent:'none',merchant:null,category:null,amount:null,comparisonStart:null,comparisonEnd:null,target:'none',debtMethod:'snowball',...patch});
const calculation=(patch={})=>({purpose:'general',domain:'spending',operation:'summary',entity:null,scenario:null,...patch});
const wire=(calc={},params={})=>({legacy:false,requests:[{calculation:calculation(calc),parameters:parameters(params)}]});
const scenario={kind:'income_change',amount:-200,amountMode:null,date:'2026-09-11',sourceDate:null,entity:'Salary',repeat:'once'};

test('provider schema forbids the incoherent purpose/domain combinations seen in real evaluations',()=>{
  for(const calc of [
    {purpose:'paycheck_allocation',domain:'paycheck',operation:'plan',entity:'Salary'},
    {purpose:'affordability',domain:'stability',operation:'summary'},
    {purpose:'affordability',domain:'paycheck',operation:'plan'},
    {purpose:'paycheck_allocation',domain:'purchase',operation:'plan'},
    {purpose:'forecast_balance',domain:'purchase',operation:'plan'},
    {purpose:'affordability',domain:'money',operation:'plan'},
    {purpose:'forecast_balance',domain:'forecast',operation:'plan'},
  ])assert.equal(financialAnalysisSchema.safeParse(wire(calc)).success,false,JSON.stringify(calc));
});

test('household-only purposes reject a named scope and hypothetical rather than dropping them',()=>{
  for(const [purpose,domain] of [['paycheck_allocation','paycheck'],['action_plan','stability'],['budget_plan','budget'],['allocation_choice','stability'],['buffer_timeline','buffer']]) {
    const calc={purpose,domain,operation:'plan'};
    assert.ok(financialAnalysisSchema.safeParse(wire(calc)).success,purpose);
    assert.equal(financialAnalysisSchema.safeParse(wire({...calc,entity:'Salary'})).success,false,purpose);
    assert.equal(financialAnalysisSchema.safeParse(wire({...calc,scenario})).success,false,purpose);
    assert.throws(()=>parseFinancialAnalysisPlan(wire({...calc,entity:'Salary'})));
  }
});

test('flattening validated wire format preserves all amounts dates scope and explicit repetition',()=>{
  const input=wire({purpose:'forecast_balance',domain:'forecast',operation:'scenario',entity:null,scenario},{dateEvent:'next_payday',accountGroup:'savings',startDate:'2026-09-10',endDate:'2026-10-31'});
  const before=structuredClone(input);
  const result=parseFinancialAnalysisPlan(input);
  assert.deepEqual(result.requests[0],{...input.requests[0].parameters,...input.requests[0].calculation});
  assert.deepEqual(input,before);
  assert.equal(result.requests[0].scenario.entity,'Salary');
  assert.equal(result.requests[0].scenario.amount,-200);
  // An unsupported but explicitly requested account group survives so the
  // semantic validator can explain the limitation, never answer checking.
  assert.equal(result.requests[0].accountGroup,'savings');
});

test('named income balance and actual income schedule remain distinct valid routes',()=>{
  const balance=parseFinancialAnalysisPlan(wire({purpose:'forecast_balance',domain:'forecast',operation:'summary',entity:'Salary'},{dateEvent:'after_payday'}));
  assert.equal(balance.requests[0].entity,'Salary');assert.equal(balance.requests[0].dateEvent,'after_payday');
  const income=parseFinancialAnalysisPlan(wire({purpose:'general',domain:'income',operation:'detail',entity:'Salary'},{dateEvent:'next_payday'}));
  assert.equal(income.requests[0].domain,'income');assert.equal(income.requests[0].entity,'Salary');
});

test('coherent specialized operations remain expressible without schema coercion',()=>{
  for(const calc of [
    {purpose:'current_balance',domain:'money',operation:'detail',entity:'Rainy Day Savings'},
    {purpose:'forecast_balance',domain:'forecast',operation:'minimum'},
    {purpose:'forecast_balance',domain:'forecast',operation:'compare'},
    {purpose:'forecast_balance',domain:'forecast',operation:'threshold'},
    {purpose:'affordability',domain:'purchase',operation:'plan'},
    {purpose:'affordability',domain:'money',operation:'summary'},
    {purpose:'debt_timeline',domain:'debt',operation:'plan',entity:'Test Card'},
    {purpose:'goal_timeline',domain:'savings',operation:'plan',entity:'Vacation'},
    {purpose:'transaction_last',domain:'transactions',operation:'detail'},
    {purpose:'balance_history',domain:'progress',operation:'compare'},
    {purpose:'bill_settlement',domain:'bills',operation:'summary'},
    {purpose:'bills_overdue',domain:'bills',operation:'detail'},
  ])assert.ok(financialAnalysisSchema.safeParse(wire(calc)).success,JSON.stringify(calc));
});

test('general route retains legitimate operations and scenarios; debt payoff accepts only extra-debt scenario',()=>{
  for(const [domain,operation] of [['spending','compare'],['transactions','search'],['income','average'],['credit','maximum'],['debt','minimum'],['subscriptions','search'],['review','summary']]) {
    assert.ok(financialAnalysisSchema.safeParse(wire({domain,operation})).success);
  }
  assert.ok(financialAnalysisSchema.safeParse(wire({domain:'income',operation:'scenario',scenario})).success);
  const debt={purpose:'debt_timeline',domain:'debt',operation:'scenario'};
  assert.equal(financialAnalysisSchema.safeParse(wire({...debt,scenario})).success,false);
  assert.ok(financialAnalysisSchema.safeParse(wire({...debt,scenario:{...scenario,kind:'extra_debt',amount:100,entity:'Test Card'}})).success);
});

test('earliest purchase-date schema cannot dispatch to a single purchase scenario',()=>{
  const purchase={...scenario,kind:'purchase',amount:250,entity:null,date:'2026-09-10'};
  const calc={purpose:'affordability',domain:'purchase',operation:'plan'};
  const params={amount:250,amountRole:'purchase_amount',startDate:'2026-09-15',endDate:'2026-10-31'};
  assert.ok(financialAnalysisSchema.safeParse(wire(calc,params)).success);
  assert.equal(financialAnalysisSchema.safeParse(wire({...calc,scenario:purchase},params)).success,false);
  assert.throws(()=>parseFinancialAnalysisPlan(wire({...calc,scenario:purchase},params)));
  const valid=parseFinancialAnalysisPlan(wire(calc,params));
  assert.equal(valid.requests[0].startDate,'2026-09-15');assert.equal(valid.requests[0].endDate,'2026-10-31');
  assert.equal(valid.requests[0].amount,250);assert.equal(valid.requests[0].scenario,null);
  assert.ok(financialAnalysisSchema.safeParse(wire({...calc,operation:'scenario',scenario:purchase},params)).success);
});

test('strict wire shape rejects flat output, injected dispatch fields and missing selectors',()=>{
  const valid=wire();
  assert.equal(financialAnalysisSchema.safeParse({legacy:false,requests:[{...valid.requests[0].calculation,...valid.requests[0].parameters}]}).success,false);
  assert.equal(financialAnalysisSchema.safeParse(wire({}, {entity:'Injected'})).success,false);
  assert.equal(financialAnalysisSchema.safeParse(wire({amount:900})).success,false);
  const omitted=wire();delete omitted.requests[0].calculation.entity;
  assert.equal(financialAnalysisSchema.safeParse(omitted).success,false);
});

test('JSON schema stays object-rooted and compact with nested purpose alternatives and required strict objects',()=>{
  const schema=financialAnalysisJsonSchema;
  assert.equal(schema.type,'object');assert.equal(schema.anyOf,undefined);
  const request=schema.properties.requests.items;
  assert.ok(request.properties.calculation.anyOf.length>=15);
  assert.equal(request.properties.parameters.type,'object');
  const serialized=JSON.stringify(schema);
  assert.doesNotMatch(serialized,/"oneOf"/);
  assert.ok(serialized.length<26000,`schema is ${serialized.length} bytes`);
  // Common financial parameters appear once, not once per purpose variant.
  assert.equal((serialized.match(/"timelineUnit":/g)??[]).length,1);
  function check(node) {
    if(!node||typeof node!=='object')return;
    if(node.type==='object') {assert.equal(node.additionalProperties,false);assert.deepEqual([...node.required].sort(),Object.keys(node.properties).sort());}
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(check);else check(value);
  }
  check(schema);
});
