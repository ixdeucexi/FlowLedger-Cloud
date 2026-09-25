import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisColumns, loadAnalysisSnapshot, analysisSourceDependencies } from './analysisSnapshot.ts';
import { spendingAnalysis } from './analysisSpending.ts';
import { createFloEvaluationClient, evaluationHousehold, evaluationNow } from '../../../scripts/flo-evaluation-fixture.ts';

const request={domain:'spending',purpose:'general',operation:'compare',amount:null,startDate:'2026-06-11',endDate:'2026-09-10',comparisonStart:'2026-03-11',comparisonEnd:'2026-06-10',merchant:null,category:null,entity:null,scenario:null};
const snapshot=(transactions)=>({householdId:'test',today:'2026-09-10',timeZone:'America/Chicago',sources:Object.fromEntries(Object.keys(analysisColumns).map(name=>[name,{complete:true,rows:name==='transactions'?transactions:[]}]))});

test('multi-month comparison cannot treat older unavailable months as zero spending',async()=>{
  const s=await loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow,analysisSourceDependencies(request));
  const result=spendingAnalysis(s,request);
  assert.equal(result.facts.spending,1250);
  assert.equal(result.facts.previousSpending,undefined);assert.equal(result.facts.spendingChange,undefined);
  assert.ok(result.missing.some(reason=>/Prior comparison history.*2026-03-11–2026-03-31.*2026-04-01–2026-04-30.*2026-05-01–2026-05-31/.test(reason)));
  assert.match(result.text,/retained history does not cover every requested period/);
  assert.doesNotMatch(result.text,/spending is.*higher|spending is.*lower/);
});

test('classified income covers a legitimate zero-spending comparison period',()=>{
  const transactions=['03-20','04-20','05-20','06-05'].map(date=>({id:date,date:`2026-${date}`,amount:1500,category:'Income',note:'Salary'}));
  transactions.push(...['06-20','07-20','08-20','09-05'].map(date=>({id:date,date:`2026-${date}`,amount:-25,category:'Groceries',note:'Walmart'})));
  for(const filters of [{},{merchant:'Walmart'},{category:'Groceries'}]) {
    const result=spendingAnalysis(snapshot(transactions),{...request,...filters});
    assert.equal(result.facts.previousSpending,0);assert.equal(result.facts.spendingChange,100);
    assert.deepEqual(result.missing,[]);assert.match(result.text,/spending is \$100\.00 higher/);
  }
});

test('partial-month comparison cannot borrow coverage from later in the same month',()=>{
  const s=snapshot([{id:'late-june',date:'2026-06-20',amount:1500,category:'Income'},...['07-20','08-20','09-05'].map(date=>({id:date,date:`2026-${date}`,amount:-25,category:'Groceries'}))]);
  const result=spendingAnalysis(s,request);
  assert.equal(result.facts.spendingChange,undefined);
  assert.ok(result.missing.some(reason=>reason.includes('2026-06-01–2026-06-10')));
});

test('an unresolved row alone is not proof of a covered zero-spending month',()=>{
  const s=snapshot(['03-20','04-20','05-20','06-05','06-20','07-20','08-20','09-05'].map(date=>({id:date,date:`2026-${date}`,amount:1500,category:'Income',note:'Salary',...(date==='04-20'?{review_status:'needs_review'}:{})})));
  const result=spendingAnalysis(s,{...request,category:'Groceries'});
  assert.equal(result.facts.spendingChange,undefined);
  assert.ok(result.missing.some(reason=>reason.includes('2026-04-01–2026-04-30')));
});
