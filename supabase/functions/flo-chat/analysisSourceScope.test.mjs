import test from 'node:test';
import assert from 'node:assert/strict';
import { currentBalanceAnalysis } from './analysisAccounts.ts';
import { analysisColumns, analysisSourceDependencies, loadAnalysisSnapshot, verifyAnalysisSnapshot } from './analysisSnapshot.ts';
import { projectionInput, forecastAnalysis, projectionSources } from './analysisProjection.ts';

const request = (patch = {}) => ({purpose:'current_balance',domain:'money',operation:'detail',amountRole:'none',startDate:null,endDate:null,dateEvent:'none',merchant:null,category:null,entity:null,amount:null,comparisonStart:null,comparisonEnd:null,target:'none',debtMethod:'snowball',scenario:null,...patch});
function snapshot() {
  const sources = Object.fromEntries(Object.keys(analysisColumns).map(name => [name, {rows:[],complete:true}]));
  sources.household_settings.rows = [{household_id:'test',starting_balance:1000,starting_balance_date:'2026-09-10',safety_floor:200,forecast_horizon_months:6,time_zone:'America/Chicago'}];
  sources.accounts.rows = [
    {id:'checking',name:'Main checking',account_type:'checking',current_balance:1000,balance_as_of:'2026-09-10',is_active:true},
    {id:'saving',name:'Rainy day',account_type:'savings',current_balance:300,balance_as_of:'2026-09-10',is_active:true},
  ];
  return {householdId:'test',today:'2026-09-10',capturedAt:'2026-09-10T15:00:00Z',timeZone:'America/Chicago',hash:'test',sources};
}
const forecast = request({purpose:'forecast_balance',domain:'forecast',operation:'summary',endDate:'2026-09-30'});

test('current balance scope distinguishes checking, savings and combined assets using one domain', () => {
  const s = snapshot();
  assert.equal(currentBalanceAnalysis(s,request({accountGroup:'checking'})).facts.recordedBalance,1000);
  const saving = currentBalanceAnalysis(s,request({accountGroup:'savings'}));
  assert.equal(saving.facts.recordedBalance,300);
  assert.match(saving.text,/^Savings:/);
  assert.equal(currentBalanceAnalysis(s,request({accountGroup:'all'})).facts.recordedBalance,1300);
  assert.ok(currentBalanceAnalysis(s,request({accountGroup:'savings',entity:'Main checking'})).missing.length);
  s.sources.accounts.rows = s.sources.accounts.rows.filter(row=>row.account_type==='savings');
  assert.equal(currentBalanceAnalysis(s,request({accountGroup:'all'})).facts.recordedBalance,1300,'combined totals retain the app settings checking fallback');
});

test('combined account group applies bank precedence separately without adding manual duplicates', () => {
  const s = snapshot();
  s.sources.plaid_accounts.rows = [{id:'bank',name:'Connected checking',account_type:'depository',account_subtype:'checking',is_active:true,current_balance:900,updated_at:s.capturedAt}];
  const all = currentBalanceAnalysis(s,request({accountGroup:'all'}));
  assert.equal(all.facts.recordedBalance,1200);
  assert.equal(all.facts.accountCount,2);
  s.sources.accounts.rows[1].current_balance = null;
  assert.equal(currentBalanceAnalysis(s,request({accountGroup:'all'})).facts.recordedBalance,undefined);
});

function clientFixture(s, unavailable = []) {
  const reads = [];
  return {reads,client:{from(table) {
    reads.push(table);
    const query = {
      select() { return query; }, eq(key,value) { assert.equal(key,'household_id'); assert.equal(value,'test'); return query; },
      order() { return query; }, limit() { return query; }, gt() { return query; },
      then(resolve) { return Promise.resolve({data:unavailable.includes(table)?null:(s.sources[table]?.rows??[]).map(r=>({...r,household_id:'test'})),error:unavailable.includes(table)?new Error('unavailable'):null}).then(resolve); },
    };
    return query;
  }}};
}

test('targeted snapshots read only requested sources plus household date settings', async () => {
  const fixture = clientFixture(snapshot(),['goals','transactions']);
  const result = await loadAnalysisSnapshot(fixture.client,'test','2026-09-10T15:00:00Z',['accounts','plaid_accounts','accounts']);
  assert.deepEqual(fixture.reads.sort(),['accounts','household_settings','plaid_accounts']);
  assert.equal(result.timeZone,'America/Chicago');
  assert.equal(result.sources.transactions,undefined);
  assert.equal(currentBalanceAnalysis(result,request({accountGroup:'savings'})).facts.recordedBalance,300);
  assert.ok(projectionInput(result).missing.some(reason=>/transactions/.test(reason)));
});

test('default snapshots preserve full coverage; unavailable selected sources never become empty success', async () => {
  const fixture = clientFixture(snapshot(),['accounts']);
  const result = await loadAnalysisSnapshot(fixture.client,'test','2026-09-10T15:00:00Z');
  assert.deepEqual(fixture.reads.sort(),Object.keys(analysisColumns).sort());
  assert.equal(result.sources.accounts.complete,false);
  assert.ok(currentBalanceAnalysis(result,request()).missing.length);
  assert.equal(await verifyAnalysisSnapshot(fixture.client,result,['accounts']),false);
  await assert.rejects(loadAnalysisSnapshot(fixture.client,'test','2026-09-10T15:00:00Z',['not_a_financial_source']),/Unknown financial/);
});

test('source dependencies keep simple balances independent while preserving cash-flow and classification inputs', () => {
  assert.deepEqual(analysisSourceDependencies(request()),['household_settings','accounts','plaid_accounts']);
  assert.deepEqual(analysisSourceDependencies(request({purpose:'general',domain:'income',incomeTiming:'expected'})),['household_settings','incomes']);
  const spending = analysisSourceDependencies(request({purpose:'general',domain:'spending'}));
  for (const source of ['transactions','plaid_transactions','plaid_accounts','accounts','bills','goals']) assert.ok(spending.includes(source));
  const review = analysisSourceDependencies(request({purpose:'general',domain:'review'}));
  for (const source of [...projectionSources,'category_budgets','household_daily_checking_closes']) assert.ok(review.includes(source));
});

test('irrelevant removed activity and closed buckets do not block a valid forecast', () => {
  const s = snapshot();
  s.sources.transactions.rows = [
    {id:'deleted-manual',date:'not-a-date',amount:null,deleted_at:'2026-09-01T00:00:00Z'},
    {id:'removed-bank',date:null,amount:'NaN',source:'plaid',removed_at:'2026-09-01T00:00:00Z'},
    {id:'pending-manual',date:null,amount:null,pending:true},
  ];
  s.sources.plaid_transactions.rows = [{id:'removed',amount:null,transaction_date:null,removed_at:s.capturedAt}];
  s.sources.goals.rows = [{id:'closed',goal_type:'planned_expense',target_amount:null,current_amount:null,target_date:null,closed_at:s.capturedAt,archived_at:s.capturedAt}];
  const before = JSON.stringify(s);
  const inputs = projectionInput(s);
  assert.deepEqual(inputs.missing,[]);
  assert.equal(inputs.input.transactions.length,0);
  assert.equal(inputs.input.deletedTransactions.length,0);
  assert.equal(inputs.input.goals.length,0);
  const result = forecastAnalysis(s,forecast);
  assert.equal(result.facts.projectedBalance,1000);
  assert.match(result.assumptions.join(' '),/excluded from current-plan inputs/);
  assert.equal(JSON.stringify(s),before);
});

test('active invalid money and hidden posted bank cash movements still block unverifiable projections', () => {
  for (const row of [
    {id:'active',date:'2026-09-11',amount:null},
    {id:'hidden-import',date:'2026-09-11',amount:null,import_hash:'bank-file',deleted_at:'2026-09-10T10:00:00Z'},
    {id:'hidden-bank',date:'2026-09-11',amount:null,source:'plaid',plaid_account_id:'bank',deleted_at:'2026-09-10T10:00:00Z'},
  ]) {
    const s = snapshot(); s.sources.transactions.rows = [row];
    assert.ok(projectionInput(s).missing.some(reason=>/amount/.test(reason)),row.id);
    assert.throws(()=>forecastAnalysis(s,forecast),/amount/,row.id);
  }
  const s = snapshot();
  s.sources.transactions.rows = [{id:'hidden-import',date:'2026-09-11',amount:-75,import_hash:'bank-file',deleted_at:'2026-09-10T10:00:00Z'}];
  assert.equal(projectionInput(s).input.deletedTransactions.length,1);
  assert.equal(forecastAnalysis(s,forecast).facts.projectedBalance,925);
});

test('open bucket obligations and incomplete data remain visible even when archive flags disagree', () => {
  const s = snapshot();
  s.sources.goals.rows = [{id:'open',goal_type:'planned_expense',target_amount:50,current_amount:0,target_date:'2026-09-20',archived_at:s.capturedAt}];
  assert.ok(projectionInput(s).missing.some(reason=>/archived spending bucket/.test(reason)));
  assert.equal(projectionInput(s).input.goals.length,1);
  s.sources.goals.rows[0].archived_at = null;
  assert.equal(forecastAnalysis(s,forecast).facts.projectedBalance,950);
  s.sources.goals.rows[0].target_amount = null;
  assert.ok(projectionInput(s).missing.some(reason=>/goals.target_amount/.test(reason)));
  s.sources.goals.complete = false;
  assert.ok(projectionInput(s).missing.some(reason=>/goals could not be fully checked/.test(reason)));
});
