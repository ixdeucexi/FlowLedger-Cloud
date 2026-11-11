import assert from 'node:assert/strict';
import test from 'node:test';
import { createFloEvaluationClient, evaluationHousehold, evaluationNow } from '../../../scripts/flo-evaluation-fixture.ts';
import { loadAnalysisSnapshot, readAnalysisSource, analysisProjectionSources } from './analysisSnapshot.ts';
import { buildAnalysisForecast } from './analysisProjection.ts';
const h=evaluationHousehold,b='fictional-budget';
const plan={id:'transfer',household_id:h,budget_id:b,name:'My savings',amount:100,from_account_ref:'manual:checking',to_account_ref:'manual:savings',frequency:'monthly',start_date:'2026-09-15',end_date:null,status:'active',deleted_at:null,revision:1,created_by:'editor',created_at:evaluationNow,updated_at:evaluationNow};
function client({budget=true,foreign=false}={}) {
 const base=createFloEvaluationClient(),calls=[];
 return {calls,from(table) {
  if(table==='budgets'&&!budget) return {select(){return this},eq(){return this},maybeSingle:async()=>({data:null,error:new Error('unavailable')})};
  if(table!=='planned_account_transfers'&&table!=='planned_account_transfer_occurrences')return base.from(table);
  const filters=[],q={select(columns){assert.ok(!columns.includes('*'));return q},eq(key,value){filters.push([key,value]);return q},order(){return q},limit(){return q},gt(){return q},then(resolve){calls.push({table,filters});return Promise.resolve({data:table==='planned_account_transfers'?[{...plan,budget_id:foreign?'other-budget':b}]:[],error:null}).then(resolve)}};return q;
 }};
}
test('Flo planned cash transfers use exact default budget and canonical operating projection',async()=>{
 const c=client();const s=await loadAnalysisSnapshot(c,h,evaluationNow,analysisProjectionSources);
 assert.equal(s.sources.planned_account_transfers.complete,true);
 for(const call of c.calls)assert.deepEqual(call.filters,[['household_id',h],['budget_id',b]]);
 const withPlan=buildAnalysisForecast(s,'2026-09-30');
 s.sources.planned_account_transfers.rows=[];
 const without=buildAnalysisForecast(s,'2026-09-30');
 assert.equal(withPlan.days.at(-1).balance,without.days.at(-1).balance-100);
 assert.equal(withPlan.days.reduce((sum,d)=>sum+d.income,0),without.days.reduce((sum,d)=>sum+d.income,0));
 assert.equal(withPlan.days.reduce((sum,d)=>sum+d.expense,0),without.days.reduce((sum,d)=>sum+d.expense,0));
});
test('missing default budget and foreign budget rows never become empty complete transfer coverage',async()=>{
 const missing=client({budget:false});const s=await loadAnalysisSnapshot(missing,h,evaluationNow,analysisProjectionSources);
 assert.equal(s.sources.planned_account_transfers.complete,false);assert.equal(missing.calls.length,0);
 assert.throws(()=>buildAnalysisForecast(s,'2026-09-30'),/planned account transfers/);
 const foreign=await readAnalysisSource(client({foreign:true}),h,'planned_account_transfers');
 assert.equal(foreign.complete,false);assert.deepEqual(foreign.rows,[]);
});
