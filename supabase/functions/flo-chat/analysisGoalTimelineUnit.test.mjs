import test from 'node:test';
import assert from 'node:assert/strict';
import { wealthAnalysis } from './analysisWealth.ts';
import { analysisColumns } from './analysisSnapshot.ts';

const request=(patch={})=>({domain:'savings',purpose:'goal_timeline',operation:'plan',entity:'Vacation',amount:null,amountRole:'none',timelineUnit:'household_paydays',contribution:null,scenario:null,...patch});
function snapshot(){
  const sources=Object.fromEntries(Object.keys(analysisColumns).map(table=>[table,{rows:[],complete:true}]));
  sources.household_settings.rows=[{starting_balance:500,starting_balance_date:'2026-09-10',safety_floor:200,forecast_horizon_months:6}];
  sources.accounts.rows=[{id:'savings',name:'Savings',account_type:'savings',current_balance:300,balance_as_of:'2026-09-10',is_active:true}];
  sources.goals.rows=[{id:'goal',name:'Vacation',goal_type:'savings',target_amount:1000,current_amount:100,target_date:'2026-12-31'}];
  return {householdId:'test',today:'2026-09-10',capturedAt:'2026-09-10T15:00:00Z',timeZone:'America/Chicago',sources};
}

test('goal paycheck count requires a paycheck contribution, not a monthly substitute',()=>{
  for(const contribution of [null,{amount:100,frequency:'monthly'},{amount:100,frequency:'once'}]){
    const result=wealthAnalysis(snapshot(),request({contribution}));
    assert.equal(result.facts.timelineOutcome,'not_estimable');assert.equal(result.facts.timelineDuration,null);assert.equal(result.facts.timelineUnit,'household_paydays');
    assert.match(result.text,/^How much would you like to set aside from each paycheck/);assert.ok(result.missing.some(reason=>/goal paycheck count/.test(reason)));
    assert.doesNotMatch(result.text,/needs 9 monthly contributions/);
  }
});

test('goal paycheck count preserves known contribution and earmarked funding',()=>{
  const result=wealthAnalysis(snapshot(),request({contribution:{amount:100,frequency:'paycheck'}}));
  assert.equal(result.facts.timelineOutcome,'duration');assert.equal(result.facts.timelineDuration,9);assert.equal(result.facts.timelineUnit,'household_paydays');
  assert.deepEqual(result.missing,[]);assert.match(result.text,/9 household-payday contributions/);
});

test('requested goal months remain partial when only paycheck contribution count is known',()=>{
  const result=wealthAnalysis(snapshot(),request({timelineUnit:'months',contribution:{amount:100,frequency:'paycheck'}}));
  assert.equal(result.facts.timelineOutcome,'not_estimable');assert.equal(result.facts.timelineDuration,null);assert.equal(result.facts.timelineUnit,'months');assert.equal(result.facts.contributionPeriods,9);
  assert.ok(result.missing.some(reason=>/requested months/.test(reason)));assert.match(result.text,/cannot translate those paychecks into calendar months/);
});

test('monthly goal contributions and already-reached goals retain supported unit results',()=>{
  const result=wealthAnalysis(snapshot(),request({timelineUnit:'months',contribution:{amount:100,frequency:'monthly'}}));
  assert.equal(result.facts.timelineOutcome,'duration');assert.equal(result.facts.timelineDuration,9);assert.equal(result.facts.timelineUnit,'months');
  const s=snapshot();s.sources.goals.rows[0].current_amount=1000;
  const reached=wealthAnalysis(s,request());
  assert.equal(reached.facts.timelineOutcome,'already_reached');assert.equal(reached.facts.timelineDuration,0);assert.equal(reached.facts.timelineUnit,'household_paydays');assert.deepEqual(reached.missing,[]);
});
