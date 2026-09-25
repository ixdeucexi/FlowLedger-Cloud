import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAnalysisSnapshot } from './analysisSnapshot.ts';
import { wealthAnalysis } from './analysisWealth.ts';
import { createFloEvaluationClient, evaluationHousehold, evaluationNow } from '../../../scripts/flo-evaluation-fixture.ts';

test('configured debt-plan total does not silently include or double-count connected credit balances',async()=>{
  const s=await loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow);
  const request={domain:'debt',purpose:'general',operation:'summary',entity:null,amount:null,scenario:null,debtMethod:'snowball'};
  const result=wealthAnalysis(s,request);
  assert.equal(s.sources.plaid_accounts.rows[0].current_balance,400);
  assert.equal(result.facts.totalDebt,1000);assert.equal(result.facts.debtCount,1);assert.equal(result.facts.debtScope,'configured_plan_only');
  assert.equal(result.facts.minimumPayments,35);
  assert.match(result.text,/^Your configured FlowLedger debt-plan balances total \$1,000\.00/);
  assert.match(result.text,/Connected credit balances are reviewed separately and may not be included here/);
  assert.match(result.text,/not a verified total of every debt/);
  assert.doesNotMatch(result.text,/recorded active debt is|\$1,400\.00/);
});
