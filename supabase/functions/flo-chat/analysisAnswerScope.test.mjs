import test from 'node:test';
import assert from 'node:assert/strict';
import { requestedDebtCoverage, distinctAnalysisParagraphs } from './analysisPlanner.ts';
import { validateAnalysisPlan, interpretAnalysisQuestion } from './analysisSemantics.ts';

const result={text:'Configured plan only; not a total of every debt.',facts:{debtScope:'configured_plan_only',totalDebt:1000},sources:['bills'],missing:[],assumptions:[],scenario:false};
test('whole-debt questions cannot label a configured-plan subtotal complete',()=>{
  for(const question of ['How much total debt do I have across all my accounts?','What is my total debt?','How much debt do I have?','What are all my debts?']) {
    const checked=requestedDebtCoverage(question,result);
    assert.equal(checked.facts.totalDebt,1000);assert.equal(checked.text,result.text);
    assert.match(checked.missing.join(' '),/reconciled total.*not been verified/);
  }
  assert.deepEqual(result.missing,[]);
});
test('explicit plan, payment and snowball questions retain their own coverage',()=>{
  for(const question of ['What is the total debt in my plan?','What are my configured debts?','Show my debt snowball target','What minimum payments remain?'])assert.equal(requestedDebtCoverage(question,result),result);
  assert.equal(requestedDebtCoverage('What is my total debt?',{...result,facts:{cardBalance:400}}).missing.length,0);
});
test('dedup removes only exact repeated paragraphs, preserving different amounts and warnings',()=>{
  assert.deepEqual(distinctAnalysisParagraphs(['Current buffer $300.\n\nNeed $700.','Current buffer $300.\n\nNeed $1200.','Missing history.\n\nMissing history.']),['Current buffer $300.','Need $700.','Need $1200.','Missing history.']);
});

test('total debt cannot route to cash, but a separate checking question is preserved',async()=>{
  const debt={purpose:'general',domain:'debt',operation:'summary',amount:null,amountRole:'none',entity:null,scenario:null};
  const cash={...debt,purpose:'current_balance',domain:'money',operation:'detail'};
  const question='How much total debt do I have across all my accounts?';
  assert.ok(validateAnalysisPlan(question,{legacy:false,requests:[cash]}).length);
  let calls=0;
  const repaired=await interpretAnalysisQuestion(question,async()=>({legacy:false,requests:[++calls===1?cash:debt]}),'2026-09-10');
  assert.equal(calls,2);assert.equal(repaired.requests[0].domain,'debt');
  assert.deepEqual(validateAnalysisPlan('What is my total debt and checking balance?',{legacy:false,requests:[debt,cash]}),[]);
  assert.deepEqual(validateAnalysisPlan('How much money do I have across all my accounts?',{legacy:false,requests:[cash]}),[]);
});
