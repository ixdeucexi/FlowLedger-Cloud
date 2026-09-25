import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAnalysisSnapshot, analysisSourceDependencies } from './analysisSnapshot.ts';
import { stabilityAnalysis } from './analysisStability.ts';
import { historicalExpenseCoverage } from './analysisSpending.ts';
import { createFloEvaluationClient, evaluationHousehold, evaluationNow } from '../../../scripts/flo-evaluation-fixture.ts';

const request={domain:'buffer',purpose:'buffer_timeline',operation:'plan',amount:1000,amountRole:'target_balance',contribution:null,startDate:null,endDate:null,target:'none',scenario:null};
const snapshot=()=>loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow,analysisSourceDependencies(request));

test('unmatched paid bills prevent historical surplus, days-ahead and inferred buffer timeline, not current forecast capacity',async()=>{
  const s=await snapshot();
  const result=stabilityAnalysis(s,request);
  assert.equal(typeof result.facts.currentPlanBuffer,'number');
  assert.equal(result.facts.historicalMonthlySurplus,null);assert.equal(result.facts.daysAhead,null);
  assert.equal(result.facts.timelineOutcome,'not_estimable');assert.equal(result.facts.timelineDuration,null);
  assert.equal(result.facts.monthsToTargetScenario,undefined);assert.equal(result.facts.contributionPerPaydayScenario,undefined);
  assert.ok(result.missing.some(reason=>/not reconciled/.test(reason)));
  assert.match(result.text,/cannot estimate how long.*recorded bill payments are not fully reconciled/);
  assert.doesNotMatch(result.text,/Recorded monthly average|22\.55 days|\$2,595\.00/);
});

test('reconciled spending is counted once in sustainable historical surplus',async()=>{
  const s=await snapshot();
  for(const settlement of s.sources.monthly_overrides.rows)s.sources.transactions.rows.push({id:`matched-${settlement.id}`,date:settlement.paid_date,amount:-settlement.paid_amount,category:settlement.bill_id==='card'?'CREDIT_CARD_PAYMENT':settlement.bill_id==='rent'?'Housing':'Subscriptions',linked_bill_id:settlement.bill_id,account_id:'checking'});
  const result=stabilityAnalysis(s,request);
  assert.equal(result.facts.historicalMonthlySurplus,1680);assert.equal(result.facts.daysAhead,6.92);
  assert.equal(result.facts.timelineOutcome,'duration');
  assert.ok(!result.missing.some(reason=>/not reconciled/.test(reason)));
});

test('explicit contribution stays a labeled count scenario when historical coverage is partial',async()=>{
  const result=stabilityAnalysis(await snapshot(),{...request,timelineUnit:'household_paydays',contribution:{amount:100,frequency:'paycheck'}});
  assert.equal(result.facts.timelineOutcome,'duration');assert.equal(result.facts.timelineUnit,'household_paydays');
  assert.equal(result.facts.historicalMonthlySurplus,null);assert.equal(result.facts.daysAhead,null);
  assert.ok(result.missing.some(reason=>/not reconciled/.test(reason)));
  assert.match(result.text,/not been confirmed affordable/);
});

test('shared historical coverage requires a complete settlement source and ignores known out-of-window invalid money',async()=>{
  const s=await snapshot();
  s.sources.monthly_overrides={complete:false,rows:[]};
  assert.equal(historicalExpenseCoverage(s,[],'2026-06-01','2026-08-31').complete,false);
  s.sources.monthly_overrides={complete:true,rows:[{bill_id:'rent',month:0,year:2026,paid_amount:'NaN',actual_amount:900}]};
  assert.deepEqual(historicalExpenseCoverage(s,[],'2026-06-01','2026-08-31'),{complete:true,missing:[]});
});
