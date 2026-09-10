import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretAnalysisQuestion, validateAnalysisPlan, isAppNavigationQuestion } from './analysisSemantics.ts';

// These exercise the production interpretation guard with injected model output.
// They are NOT evidence that the live language model selects a correct plan.
const request = (patch={}) => ({domain:'savings',operation:'summary',purpose:'general',amountRole:'none',amount:null,contribution:null,startDate:null,endDate:null,dateEvent:'none',entity:null,merchant:null,category:null,comparisonStart:null,comparisonEnd:null,target:'none',debtMethod:'snowball',scenario:null,...patch});
const plan = (patch={}) => ({legacy:false,requests:[request(patch)]});
const bufferPlan = () => plan({domain:'buffer',operation:'plan',purpose:'buffer_timeline',amountRole:'target_balance',amount:1000});

for (const question of ['How long will it take to have 1000 buffer','When can I build a $1,000 cushion?','How many paychecks until I have a thousand-dollar buffer?']) {
  test(`wrong savings answer is corrected before execution: ${question}`,async()=>{
    const prompts=[];
    const result=await interpretAnalysisQuestion(question,async correction=>{prompts.push(correction);return prompts.length===1?plan():bufferPlan();});
    assert.equal(prompts.length,2);assert.ok(prompts[1].includes('timeline'));
    assert.equal(result.requests[0].domain,'buffer');assert.equal(result.requests[0].amount,1000);assert.equal(result.requests[0].amountRole,'target_balance');
  });
}
test('repeated incorrect interpretation is rejected, never executed as a balance',async()=>{
  let calls=0;
  await assert.rejects(interpretAnalysisQuestion('How long until I build a $1000 buffer?',async()=>{calls++;return plan();}),/structured_output_invalid/);
  assert.equal(calls,2);
});
test('valid interpretation does not spend a second model call',async()=>{
  let calls=0;await interpretAnalysisQuestion('When can I build a $1000 cushion?',async()=>{calls++;return bufferPlan();});assert.equal(calls,1);
});
test('buffer target cannot become a savings contribution or numeric entity',()=>{
  assert.ok(validateAnalysisPlan('How long to have $1000 buffer?',plan({domain:'buffer',operation:'plan',purpose:'buffer_timeline',amount:1000,amountRole:'contribution_amount'})).length);
  assert.ok(validateAnalysisPlan('How long to have $1000 buffer?',plan({domain:'savings',operation:'plan',purpose:'goal_timeline',amount:1000,amountRole:'target_balance',entity:'1000'})).length);
});
test('current buffer and threshold crossing are not forced into funding timelines',()=>{
  assert.deepEqual(validateAnalysisPlan('What is my buffer now?',plan({domain:'buffer'})),[]);
  assert.deepEqual(validateAnalysisPlan('When will checking reach $1000?',plan({domain:'forecast',operation:'threshold',purpose:'forecast_balance',amount:1000,amountRole:'threshold'})),[]);
});
test('financial questions containing add do not bypass the analyst',()=>{
  for(const q of ['How much faster would I pay off debt if I add $100?','How long to save $1000?','Where is my money going?'])assert.equal(isAppNavigationQuestion(q),false,q);
  for(const q of ['How do I add income?','Where can I edit a bill?','How to record a payment?'])assert.equal(isAppNavigationQuestion(q),true,q);
});
test('debt-free timing cannot be satisfied by listing balances',()=>{
  assert.ok(validateAnalysisPlan('When will I be debt-free?',plan({domain:'debt'})).length);
  assert.deepEqual(validateAnalysisPlan('When will I be debt-free?',plan({domain:'debt',operation:'plan',purpose:'debt_timeline'})),[]);
});
