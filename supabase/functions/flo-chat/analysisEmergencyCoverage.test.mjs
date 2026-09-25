import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAnalysisSnapshot, analysisSourceDependencies } from './analysisSnapshot.ts';
import { wealthAnalysis } from './analysisWealth.ts';
import { createFloEvaluationClient, evaluationHousehold, evaluationNow } from '../../../scripts/flo-evaluation-fixture.ts';

const request={domain:'emergency',purpose:'general',operation:'summary',entity:null,amount:null,target:'three_months'};
test('emergency target does not ignore paid bills absent from transaction history',async()=>{
  const s=await loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow,analysisSourceDependencies(request));
  const result=wealthAnalysis(s,request);
  assert.ok(result.missing.some(m=>m.includes('not reconciled')));
  assert.equal(result.facts.threeMonthTarget,undefined);
  assert.equal(result.facts.monthsCovered,undefined);
});
test('matched bill payments are counted once and complete-month boundaries retain early spending',async()=>{
  const s=await loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow,analysisSourceDependencies(request));
  s.sources.monthly_overrides.rows=s.sources.monthly_overrides.rows.filter(r=>r.bill_id==='rent');
  for(const month of ['06','07','08'])s.sources.transactions.rows.push({id:`rent-${month}`,date:`2026-${month}-05`,amount:-900,category:'Housing',linked_bill_id:'rent',account_id:'checking'});
  const result=wealthAnalysis(s,request);
  assert.deepEqual(result.missing,[]);
  assert.equal(result.facts.monthlyExpenseBaseline,1305);
  assert.equal(result.facts.threeMonthTarget,3915);
});

test('bill-linked transfers cannot reconcile expense obligations excluded from the baseline',async()=>{
  const s=await loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow,analysisSourceDependencies(request));
  s.sources.monthly_overrides.rows=s.sources.monthly_overrides.rows.filter(r=>r.bill_id==='rent');
  for(const month of ['06','07','08'])s.sources.transactions.rows.push({id:`transfer-${month}`,date:`2026-${month}-05`,amount:-900,category:'Housing',linked_bill_id:'rent',account_id:'checking',review_resolution:'transfer'});
  const result=wealthAnalysis(s,request);
  assert.ok(result.missing.some(reason=>/not reconciled/.test(reason)));
  assert.equal(result.facts.monthlyExpenseBaseline,undefined);assert.equal(result.facts.threeMonthTarget,undefined);
});

test('bill-linked unresolved charges and refunds are not proof of expense settlement',async()=>{
  for(const patch of [{amount:-900,review_status:'needs_review'},{amount:900,category:'Refund'}]){
    const s=await loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow,analysisSourceDependencies(request));
    s.sources.monthly_overrides.rows=s.sources.monthly_overrides.rows.filter(r=>r.bill_id==='rent');
    for(const month of ['06','07','08'])s.sources.transactions.rows.push({id:`unverified-${month}`,date:`2026-${month}-05`,category:'Housing',linked_bill_id:'rent',account_id:'checking',...patch});
    const result=wealthAnalysis(s,request);
    assert.ok(result.missing.some(reason=>/not reconciled/.test(reason)));assert.equal(result.facts.monthlyExpenseBaseline,undefined);
  }
});

test('invalid in-window settlement money cannot disappear because actual payment is present',async()=>{
  for(const patch of [{paid_amount:'NaN',actual_amount:900},{paid_amount:null,actual_amount:900},{paid_amount:900,actual_amount:'NaN'}]){
    const s=await loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow,analysisSourceDependencies(request));
    s.sources.monthly_overrides.rows=s.sources.monthly_overrides.rows.filter(r=>r.bill_id==='rent');
    for(const month of ['06','07','08'])s.sources.transactions.rows.push({id:`rent-${month}`,date:`2026-${month}-05`,amount:-900,category:'Housing',linked_bill_id:'rent',account_id:'checking'});
    Object.assign(s.sources.monthly_overrides.rows[0],patch);
    const result=wealthAnalysis(s,request);
    assert.ok(result.missing.some(reason=>/settlement amount is invalid/.test(reason)));assert.equal(result.facts.threeMonthTarget,undefined);assert.equal(result.facts.monthsCovered,undefined);
  }
});

test('invalid settlement period cannot silently fall outside the expense window',async()=>{
  const s=await loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow,analysisSourceDependencies(request));
  s.sources.monthly_overrides.rows=[{bill_id:'rent',month:'NaN',year:2026,paid_amount:900,actual_amount:900}];
  const result=wealthAnalysis(s,request);
  assert.ok(result.missing.some(reason=>/settlement period is invalid/.test(reason)));assert.equal(result.facts.threeMonthTarget,undefined);
});
