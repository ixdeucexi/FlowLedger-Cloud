import test from 'node:test';
import assert from 'node:assert/strict';
import { analyticTransactions, aggregateSpending, spendingAnalysis } from './analysisSpending.ts';
import { analysisColumns, loadAnalysisSnapshot } from './analysisSnapshot.ts';
import { createFloEvaluationClient, evaluationHousehold, evaluationNow } from '../../../scripts/flo-evaluation-fixture.ts';

function snapshot() {
  const sources = Object.fromEntries(Object.keys(analysisColumns).map(name=>[name,{rows:[],complete:true}]));
  sources.accounts.rows = [{id:'checking',name:'Manual checking'}];
  sources.plaid_accounts.rows = [{id:'card',name:'Connected card',account_type:'credit'}];
  sources.transactions.rows = [{id:'salary',date:'2026-09-01',amount:1500,category:'Income',note:'Salary',account_id:'checking'}];
  return {householdId:'test',today:'2026-09-10',timeZone:'America/Chicago',sources};
}

test('missing bank identifiers never turn manual checking salary into a connected-card refund', () => {
  for (const empty of [undefined,null,'','   ']) {
    const s = snapshot();
    s.sources.transactions.rows[0].plaid_account_id = empty;
    s.sources.plaid_accounts.rows[0].plaid_account_id = empty;
    const result = analyticTransactions(s);
    assert.equal(result.rows[0].kind,'income');
    assert.equal(result.rows[0].account,'Manual checking');
    assert.equal(result.rows[0].accountKey,'manual:checking');
    const totals = aggregateSpending(result.rows,'2026-09-01','2026-09-10');
    assert.equal(totals.income,1500);
    assert.equal(totals.spending,0);
  }
});

test('a bank transaction without a provider ID cannot supply identity or classification to unrelated manual income', () => {
  const s = snapshot();
  s.sources.plaid_transactions.rows = [{id:'raw-card-credit',plaid_account_id:'card',transaction_date:'2026-09-02',amount:50,category:'Shopping',name:'Refund'}];
  const rows = analyticTransactions(s).rows;
  assert.equal(rows.find(row=>row.id==='salary').kind,'income');
  assert.equal(rows.find(row=>row.id==='salary').accountKey,'manual:checking');
  assert.equal(rows.find(row=>row.id==='raw-card-credit').kind,'refund');
});

test('valid local, provider and linked bank identities still classify card refunds', () => {
  for (const [direct, linked] of [['card',false],['provider-card',false],['card',true],['provider-card',true]]) {
    const s = snapshot();
    s.sources.plaid_accounts.rows[0].plaid_account_id = 'provider-card';
    s.sources.transactions.rows = [{id:'refund',date:'2026-09-01',amount:25,category:'Shopping',plaid_transaction_id:'provider-transaction',...(linked?{}:{plaid_account_id:direct})}];
    if (linked) s.sources.plaid_transactions.rows = [{id:'raw',plaid_transaction_id:'provider-transaction',plaid_account_id:direct,transaction_date:'2026-09-01',amount:25}];
    const rows = analyticTransactions(s).rows;
    assert.equal(rows.length,1);
    assert.equal(rows[0].kind,'refund');
    assert.equal(rows[0].accountKey,'connected:card');
  }
});

test('unidentified bank activity stays unresolved and unassigned manual records stay unassigned', () => {
  const s = snapshot();
  s.sources.accounts.rows.unshift({name:'Broken account without identity'});
  s.sources.transactions.rows[0].account_id = undefined;
  s.sources.plaid_accounts.rows.unshift({name:'Broken card without identity',account_type:'credit'});
  s.sources.plaid_transactions.rows = [{id:'raw',plaid_transaction_id:'provider-transaction',transaction_date:'2026-09-02',amount:50,category:'Income'}];
  const rows = analyticTransactions(s).rows;
  assert.equal(rows.find(row=>row.id==='salary').kind,'income');
  assert.equal(rows.find(row=>row.id==='salary').account,'Unassigned account');
  assert.equal(rows.find(row=>row.id==='salary').accountKey,undefined);
  assert.equal(rows.find(row=>row.id==='raw').kind,'unresolved');
});

test('missing linked-goal identities do not invent a savings transfer', () => {
  const s = snapshot();
  s.sources.goals.rows = [{goal_type:'savings'}];
  s.sources.transactions.rows[0] = {id:'goal-payment',date:'2026-09-01',amount:-20,category:'Other',linked_plan_type:'goal'};
  assert.equal(analyticTransactions(s).rows[0].kind,'unresolved');
});

test('representative mixed manual/credit household retains its actual income average', async () => {
  const s = await loadAnalysisSnapshot(createFloEvaluationClient(),evaluationHousehold,evaluationNow);
  const result = spendingAnalysis(s,{domain:'income',operation:'average',incomeTiming:'received',startDate:null,endDate:null,merchant:null,category:null,entity:null,amount:null});
  assert.equal(result.facts.income,9000);
  assert.equal(result.facts.averageMonthlyIncome,3000);
  assert.equal(result.facts.averagePaycheck,1500);
});
