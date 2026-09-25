import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAnalysisSnapshot, analysisSourceDependencies } from './analysisSnapshot.ts';
import { wealthAnalysis } from './analysisWealth.ts';
import { createFloEvaluationClient, evaluationHousehold, evaluationNow } from '../../../scripts/flo-evaluation-fixture.ts';

const request={domain:'budget',purpose:'general',operation:'summary',entity:null,category:'Groceries',amount:null,startDate:'2026-09-01',endDate:'2026-09-30',target:'none',scenario:null};

test('current-month budget reports posted spending through today rather than the future requested end',async()=>{
  const s=await loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow,analysisSourceDependencies(request));
  const result=wealthAnalysis(s,request);
  assert.match(result.text,/\$35\.00 classified spending of \$450\.00; \$415\.00 remaining \(month start through 2026-09-10\)/);
  assert.doesNotMatch(result.text,/through 2026-09-30/);
  assert.deepEqual(result.missing,[]);
});

test('future category budget remains visible without fabricating zero spending or full remaining balance',async()=>{
  const future={...request,startDate:'2026-10-01',endDate:'2026-10-31'};
  const s=await loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow,analysisSourceDependencies(future));
  s.sources.category_budgets.rows.push({category:'Groceries',month:9,year:2026,amount:500});
  const result=wealthAnalysis(s,future);
  assert.match(result.text,/2026-10 Groceries: \$500\.00 planned budget/);
  assert.match(result.text,/spending and remaining budget are not yet known/);
  assert.doesNotMatch(result.text,/\$0\.00 classified spending|\$500\.00 remaining/);
  assert.ok(result.missing.some(reason=>/Future budget spending/.test(reason)));
});
