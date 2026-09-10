import test from 'node:test';
import assert from 'node:assert/strict';
import { historyAnalysis } from './analysisHistory.ts';
import { analysisColumns, readAnalysisSource } from './analysisSnapshot.ts';
const req=(patch={})=>({domain:'savings',operation:'compare',entity:null,startDate:'2026-08-01',endDate:'2026-08-31',scenario:null,...patch});
const account=(id='a',patch={})=>({id,name:id==='a'?'Reserve':'Other',account_type:'savings',current_balance:9999,is_active:true,...patch});
const observation=(date,balance,patch={})=>({id:date,household_id:'h',account_id:'a',as_of_date:date,balance,created_at:`${date}T12:00:00Z`,...patch});
const snapshot=(history=[],accounts=[account()],banks=[])=>({householdId:'h',today:'2026-09-10',sources:{accounts:{complete:true,rows:accounts},account_balances:{complete:true,rows:history},plaid_accounts:{complete:true,rows:banks}}});
test('manual savings observed change does not add current balances or goal contributions',()=>{
 const s=snapshot([observation('2026-08-01',100),observation('2026-08-31',150)]);
 const r=historyAnalysis(s,req({entity:' reserve '})); assert.equal(r.facts.observedBalanceChange,50);assert.equal(r.facts.observedEndingBalance,150);assert.equal(r.missing.length,0);
});
test('checking scope includes retained checking/cash but excludes savings',()=>{
 const s=snapshot([observation('2026-08-01',100),observation('2026-08-31',70)],[account('a',{account_type:'checking'}),account('s')]);
 assert.equal(historyAnalysis(s,req({domain:'money'})).facts.observedBalanceChange,-30);
});
test('partial observed window is explicit and no earlier balance is filled forward',()=>{
 const r=historyAnalysis(snapshot([observation('2026-07-31',0),observation('2026-08-10',100),observation('2026-08-20',130)]),req());
 assert.equal(r.facts.observedBalanceChange,30);assert.equal(r.facts.observedStartDate,'2026-08-10');assert.equal(r.facts.historyStatus,'partial_window');assert.ok(r.missing.length);
});
test('one observation never becomes two by using current balance',()=>{
 const r=historyAnalysis(snapshot([observation('2026-08-01',100)]),req());assert.equal(r.facts.historyStatus,'unavailable');assert.equal(r.facts.observedBalanceChange,undefined);
});
test('different per-account dates are not summed into a household delta',()=>{
 const r=historyAnalysis(snapshot([observation('2026-08-01',100),observation('2026-08-31',150),observation('2026-08-02',20,{account_id:'b'}),observation('2026-08-30',30,{account_id:'b'})],[account(),account('b')]),req());
 assert.equal(r.facts.observedBalanceChange,null);assert.match(r.missing.join(' '),/different observation/);
});
test('latest same-day correction selected; null and conflicting equal-time values rejected',()=>{
 const records=[observation('2026-08-01',100),observation('2026-08-31',150),observation('2026-08-31',160,{id:'correction',created_at:'2026-08-31T13:00:00Z'})];
 assert.equal(historyAnalysis(snapshot(records),req()).facts.observedBalanceChange,60);
 assert.equal(historyAnalysis(snapshot([...records,observation('2026-08-31',null)]),req()).facts.historyStatus,'unavailable');
 assert.equal(historyAnalysis(snapshot([observation('2026-08-01',100),observation('2026-08-31',150),observation('2026-08-31',160)]),req()).facts.historyStatus,'unavailable');
});
test('exact ambiguous names, connected bank history and debt principal are honest limits',()=>{
 assert.match(historyAnalysis(snapshot([], [account(),account('b',{name:'Reserve'})]),req({entity:'Reserve'})).text,/exactly one/);
 assert.match(historyAnalysis(snapshot([],[],[{name:'Bank'}]),req({entity:'Bank'})).text,/connected-bank balance history/);
 assert.match(historyAnalysis(snapshot(),req({domain:'debt'})).text,/Repayments.*do not establish/);
 assert.equal(historyAnalysis(snapshot(),req({entity:'Res'})).facts.historyStatus,'unavailable');
});
test('incomplete source, foreign history, future range fail without numeric deltas',()=>{
 const s=snapshot([observation('2026-08-01',100,{household_id:'other'}),observation('2026-08-31',150)]);
 assert.equal(historyAnalysis(s,req()).facts.historyStatus,'unavailable');
 s.sources.account_balances.complete=false;assert.equal(historyAnalysis(s,req()).facts.historyStatus,'unavailable');
 assert.equal(historyAnalysis(snapshot(),req({endDate:'2027-01-01'})).facts.historyStatus,'unavailable');
});
test('history loader uses explicit safe columns and household predicate',async()=>{
 assert.equal(analysisColumns.account_balances,'id,household_id,account_id,balance,as_of_date,source,created_at');
 const calls=[]; const query={select(v){calls.push(['select',v]);return this;},eq(k,v){calls.push(['eq',k,v]);return this;},order(){return this;},limit(){return Promise.resolve({data:[observation('2026-08-01',0)],error:null});}};
 const r=await readAnalysisSource({from(table){assert.equal(table,'account_balances');return query;}},'h','account_balances');assert.equal(r.complete,true);assert.deepEqual(calls[1],['eq','household_id','h']);
});
