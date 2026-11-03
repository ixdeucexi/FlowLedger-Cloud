import test from 'node:test';
import assert from 'node:assert/strict';
import { currentFloMonth, recordedSnowballTarget } from './snowballTarget.ts';
import { createFloTools } from './tools.ts';
import { deterministicAnswerFromTools, validateGroundedAnswer } from './contract.ts';
import { analysisColumns, loadAnalysisSnapshot } from './analysisSnapshot.ts';
import { wealthAnalysis } from './analysisWealth.ts';
import { calculateFinancialAnalysis } from './analysisPlanner.ts';
import { presentFinancialAnalysis } from './analysisPresentation.ts';

const pause=(start='2026-09-10',resume='2026-10-01',redirect=true)=>({id:'pause-1',start_date:start,resume_date:resume,redirect_payment:redirect});
const debt=(id,balance,extra={})=>({id,household_id:'h',name:`Debt ${id}`,amount:50,is_debt:true,balance,interest_rate:0,due_day:15,is_recurring:true,frequency:'monthly',start_date:'2026-09-01',include_in_snowball:true,created_at:'2026-09-01T12:00:00Z',last_reviewed_at:'2026-09-10',...extra});
const at=date=>({year:Number(date.slice(0,4)),month:Number(date.slice(5,7))-1,date});
const request=(extra={})=>({purpose:'general',domain:'debt',operation:'summary',startDate:null,endDate:null,dateEvent:'none',merchant:null,category:null,entity:null,amount:null,comparisonStart:null,comparisonEnd:null,target:'none',debtMethod:'snowball',scenario:null,...extra});
function snapshot(bills) {
  const sources=Object.fromEntries(Object.keys(analysisColumns).map(name=>[name,{rows:[],complete:true}]));
  sources.household_settings.rows=[{household_id:'h',time_zone:'America/Chicago',starting_balance:5000,starting_balance_date:'2026-09-10',safety_floor:100,forecast_horizon_months:6,debt_payoff_enabled:true,payment_method:'snowball'}];
  sources.bills.rows=bills;
  return {householdId:'h',today:'2026-09-10',capturedAt:'2026-09-10T15:00:00Z',timeZone:'America/Chicago',hash:'pause-fixture',sources};
}

// Project the selected columns in the fake database, so a missing explicit
// select loses the pause just as it would in the real Data API.
function clientFor(tables,calls=[]) {
  return {from(table) {
    let columns=null;
    const predicates=[];
    const query=new Proxy({}, {get(_target,key) {
      if(key==='then')return (resolve,reject)=>{
        const selected=(tables[table]??[]).filter(row=>predicates.every(([field,value])=>row[field]===value));
        const data=selected.map(row=>columns?Object.fromEntries(columns.split(',').filter(column=>Object.hasOwn(row,column)).map(column=>[column,row[column]])):{...row});
        return Promise.resolve({data,count:data.length,error:null}).then(resolve,reject);
      };
      return (...args)=>{
        calls.push([table,key,...args]);
        if(key==='select')columns=args[0];
        if(key==='eq')predicates.push(args);
        return query;
      };
    }});
    return query;
  }};
}
const runtime=client=>({client,householdId:'h',userId:'synthetic-owner',now:'2026-09-10T15:00:00Z',timezone:'America/Chicago',toolResults:[],toolResultNames:[],toolNames:[],toolCache:new Map()});

test('recorded target skips a saved pause at start and restores original ordering exactly on resume',()=>{
  const rows=[debt('a',100,{debt_payment_pauses:[pause()]}),debt('b',500)];
  const original=structuredClone(rows);
  for(const [date,id] of [['2026-09-09','a'],['2026-09-10','b'],['2026-09-30','b'],['2026-10-01','a']])assert.equal(recordedSnowballTarget(rows,at(date),true,[]).targetId,id,date);
  assert.deepEqual(rows,original);
});

test('pause boundaries respect leap day and the household date at a UTC boundary',()=>{
  const rows=[debt('a',100,{start_date:'2028-02-01',debt_payment_pauses:[pause('2028-02-29','2028-03-01')]}),debt('b',500,{start_date:'2028-02-01'})];
  assert.equal(recordedSnowballTarget(rows,at('2028-02-28'),true,[]).targetId,'a');
  assert.equal(recordedSnowballTarget(rows,at('2028-02-29'),true,[]).targetId,'b');
  assert.equal(recordedSnowballTarget(rows,at('2028-03-01'),true,[]).targetId,'a');
  const local=currentFloMonth('2026-10-01T01:00:00Z','America/Chicago');
  assert.equal(recordedSnowballTarget([debt('a',100,{debt_payment_pauses:[pause()]}),debt('b',500)],local,true,[]).targetId,'b');
});

test('all paused is distinct from excluded or paid off and retains completeness and balance guards',()=>{
  const rows=[debt('a',100,{debt_payment_pauses:[pause()]}),debt('b',500,{debt_payment_pauses:[pause()]})];
  assert.deepEqual(recordedSnowballTarget(rows,at('2026-09-10'),true,[]),{state:'all_paused'});
  assert.equal(recordedSnowballTarget(rows,at('2026-09-10'),false,[]).reason,'incomplete_records');
  assert.equal(recordedSnowballTarget([{...rows[0],balance:null},rows[1]],at('2026-09-10'),true,[]).reason,'missing_balance');
  assert.equal(recordedSnowballTarget(rows.map(row=>({...row,include_in_snowball:false})),at('2026-09-10'),true,[]).state,'all_excluded');
  assert.equal(recordedSnowballTarget(rows.map(row=>({...row,balance:0})),at('2026-09-10'),true,[]).state,'paid_off');
});

test('legacy missing pause history preserves target ordering while malformed pauses and unknown dates fail closed',()=>{
  const rows=[debt('a',100),debt('b',100,{interest_rate:20})];
  assert.deepEqual(recordedSnowballTarget(rows,{year:2026,month:8},true,[]),{state:'target',targetId:'b'});
  assert.deepEqual(recordedSnowballTarget(rows.map(row=>({...row,debt_payment_pauses:[]})),at('2026-09-10'),true,[]),{state:'target',targetId:'b'});
  assert.equal(recordedSnowballTarget([{...rows[0],interest_rate:null},rows[1]],at('2026-09-10'),true,[]).reason,'missing_tiebreak_apr');
  const paused=[{...rows[0],debt_payment_pauses:[pause()]}];
  for(const month of [{year:2026,month:8},{year:2026,month:8,date:'2026-09-31'},{year:2026,month:8,date:'2026-10-01'}])assert.equal(recordedSnowballTarget(paused,month,true,[]).reason,'pause_date_unknown');
  for(const value of [{},[pause('2026-02-30','2026-03-01')],[{...pause(),redirect_payment:'true'}],[pause(),pause()]])assert.equal(recordedSnowballTarget([{...rows[0],debt_payment_pauses:value}],at('2026-09-10'),true,[]).reason,'invalid_payment_pause');
});

test('actual tools select saved pause history and use the local date without dropping paused balances',async()=>{
  const rows=[debt('a',100,{debt_payment_pauses:[pause()]}),debt('b',500)];
  const calls=[];
  const tools=createFloTools(runtime(clientFor({bills:rows},calls)));
  const target=await tools.getCurrentSnowballTarget.execute({});
  assert.equal(target.summary.targetId,'b');
  assert.equal(target.coverage.startDate,'2026-09-10');
  const bills=await tools.getBillsAndDebt.execute({debtOnly:true,includeClosed:false,query:null});
  assert.deepEqual(bills.records.find(row=>row.id==='a').debt_payment_pauses,[pause()]);
  assert.equal(bills.summary.debtBalance,600);
  assert.equal(bills.summary.configuredMinimums,100);
  assert.ok(calls.filter(([,method])=>method==='select').filter(([table])=>table==='bills').every(([, ,columns])=>columns.split(',').includes('debt_payment_pauses')));
  for(const table of ['bills','monthly_overrides','bill_date_moves'])assert.ok(calls.some(call=>call[0]===table&&call[1]==='eq'&&call[2]==='household_id'&&call[3]==='h'));
});

test('all-paused deterministic reply stays grounded and does not call the debts paid off',async()=>{
  const tools=createFloTools(runtime(clientFor({bills:[debt('a',100,{debt_payment_pauses:[pause()]})]})));
  const checked=await tools.getCurrentSnowballTarget.execute({});
  assert.equal(checked.status,'ok');
  assert.equal(checked.summary.state,'all_paused');
  const answer=deterministicAnswerFromTools('debt_snowball_target',['getCurrentSnowballTarget'],[checked]);
  assert.match(answer.answer.answer,/remain open.*resume/);
  assert.doesNotMatch(answer.answer.answer,/paid off|excluded from Snowball/);
  assert.deepEqual(validateGroundedAnswer(answer.answer,answer.sources,[checked]),{valid:true});
});

test('malformed saved pause returns a grounded unavailable tool answer without exposing a selected balance or date',async()=>{
  const tools=createFloTools(runtime(clientFor({bills:[debt('a',100,{debt_payment_pauses:[pause('2026-09-31','2026-10-01')]})]})));
  const checked=await tools.getCurrentSnowballTarget.execute({});
  assert.equal(checked.status,'partial');
  assert.deepEqual(checked.summary,{id:'summary',state:'unavailable',reason:'invalid_payment_pause'});
  assert.deepEqual(checked.records,[checked.summary]);
  const answer=deterministicAnswerFromTools('debt_snowball_target',['getCurrentSnowballTarget'],[checked]);
  assert.match(answer.answer.answer,/cannot verify your current snowball target/);
  assert.doesNotMatch(answer.answer.answer,/\$100|target is Debt|2026-09-31/);
  assert.deepEqual(validateGroundedAnswer(answer.answer,answer.sources,[checked]),{valid:true});
});

test('analysis snapshot reads pause history through explicit columns and preserves it in the shared engine input',async()=>{
  const s=snapshot([debt('a',100,{debt_payment_pauses:[pause()]})]);
  const tables=Object.fromEntries(Object.entries(s.sources).map(([table,source])=>[table,source.rows]));
  const loaded=await loadAnalysisSnapshot(clientFor(tables),'h',s.capturedAt);
  assert.deepEqual(loaded.sources.bills.rows[0].debt_payment_pauses,[pause()]);
  assert.equal(wealthAnalysis(loaded,request()).facts.totalDebt,100);
});

test('wealth target respects exact pause and resume dates for snowball and avalanche while interest and total retain paused debt',()=>{
  const s=snapshot([debt('a',100,{interest_rate:24,debt_payment_pauses:[pause()]}),debt('b',1000,{interest_rate:12})]);
  for(const debtMethod of ['snowball','avalanche']) {
    const result=wealthAnalysis(s,request({debtMethod}));
    assert.equal(result.facts.nextDebt,'Debt b');
    assert.equal(result.facts.totalDebt,1100);
    assert.equal(result.facts.debtCount,2);
    assert.equal(result.facts.monthlyInterestEstimate,12);
  }
  s.today='2026-10-01';s.capturedAt='2026-10-01T15:00:00Z';s.sources.household_settings.rows[0].starting_balance_date=s.today;
  assert.equal(wealthAnalysis(s,request()).facts.nextDebt,'Debt a');
});

test('canonical baseline reaches payoff after all-paused debts resume and final concise answer preserves dated model',()=>{
  const s=snapshot([debt('a',100,{debt_payment_pauses:[pause('2026-09-01','2026-11-01',false)]})]);
  const req=request({purpose:'debt_timeline',operation:'plan'});
  const result=calculateFinancialAnalysis(s,req);
  assert.equal(result.facts.nextDebt,null);
  assert.equal(result.facts.totalDebt,100);
  assert.equal(result.facts.baselineDebtFreeMonth,'2026-12');
  assert.equal(result.facts.scenarioDebtFreeMonth,'2026-12');
  assert.equal(result.facts.timelineOutcome,'duration');
  assert.deepEqual(result.missing,[]);
  const concise=presentFinancialAnalysis([result],[req],'When will I be debt free?');
  assert.match(concise.answer,/2026-12.*recorded dated plan.*saved pauses and resume dates/);
  assert.doesNotMatch(concise.answer,/fixed-payment scenario/);
});

test('canonical baseline keeps future inactive included debt in payoff scope',()=>{
  const s=snapshot([debt('current',50),debt('future',100,{start_date:'2026-12-01',debt_payment_pauses:[pause('2026-12-01','2027-01-01',false)]})]);
  const result=wealthAnalysis(s,request({purpose:'debt_timeline',operation:'plan'}));
  assert.equal(result.facts.totalDebt,150);
  // The current debt's freed $50 rolls forward once the future debt resumes.
  assert.equal(result.facts.baselineDebtFreeMonth,'2027-01');
});

test('named canonical baseline never substitutes a whole-plan date for an excluded debt',()=>{
  const s=snapshot([debt('included',100,{debt_payment_pauses:[pause()]}),debt('excluded',1000,{include_in_snowball:false})]);
  const req=request({purpose:'debt_timeline',operation:'plan',entity:'Debt excluded'});
  const result=calculateFinancialAnalysis(s,req);
  assert.equal(result.facts.namedDebtPayoffMonth,null);
  assert.ok(result.facts.scenarioDebtFreeMonth);
  assert.equal(result.facts.timelineOutcome,'not_estimable');
  const concise=presentFinancialAnalysis([result],[req],'When will Debt excluded be paid off?');
  assert.doesNotMatch(concise.answer,/projected to be paid off in/);
});

test('canonical horizon leaves long-paused debt outstanding without inventing a payoff month',()=>{
  const s=snapshot([debt('a',100,{debt_payment_pauses:[pause('2026-09-01','2050-01-01',false)]})]);
  const result=wealthAnalysis(s,request({purpose:'debt_timeline',operation:'plan'}));
  assert.equal(result.facts.totalDebt,100);
  assert.equal(result.facts.baselineDebtFreeMonth,null);
  assert.equal(result.facts.scenarioDebtFreeMonth,null);
  assert.ok(result.missing.some(message=>/240-month/.test(message)));
});

test('unsupported paused extra hypotheticals have no invented scenario month and retain explicit concise planner direction',()=>{
  for(const repeat of ['once','monthly','paycheck']) {
    const s=snapshot([debt('a',100,{debt_payment_pauses:[pause()]}),debt('b',1000)]);
    const req=request({purpose:'debt_timeline',operation:'scenario',scenario:{kind:'extra_debt',amount:25,date:s.today,entity:repeat==='once'?'Debt a':null,repeat}});
    const result=calculateFinancialAnalysis(s,req);
    assert.equal(result.facts.scenarioDebtFreeMonth,null);
    assert.equal(result.facts.timelineOutcome,'not_estimable');
    assert.ok(result.missing.some(message=>/cannot model saved debt payment pauses/.test(message)));
    const concise=presentFinancialAnalysis([result],[req],'When will my debts be paid off with extra payments?');
    assert.match(concise.answer,/cannot verify.*saved pauses.*Debt Payoff Planner/);
    assert.doesNotMatch(concise.answer,/projected to be paid off in/);
  }
});

test('saved-pause baseline never substitutes its recorded method for an alternate method without extra payments',()=>{
  for(const storedMethod of ['snowball','avalanche'])for(const operation of ['plan','compare','scenario']) {
    const s=snapshot([debt('a',100,{interest_rate:12,debt_payment_pauses:[pause()]}),debt('b',1000,{interest_rate:24})]);
    s.sources.household_settings.rows[0].payment_method=storedMethod;
    // Saved settings normalize to the app's canonical snowball policy, even
    // when a legacy row still carries an old avalanche setting.
    const savedMethod='snowball',alternate='avalanche';
    const req=request({purpose:operation==='compare'?'general':'debt_timeline',operation,debtMethod:alternate});
    const result=calculateFinancialAnalysis(s,req);
    assert.equal(typeof result.facts.baselineDebtFreeMonth,'string');
    assert.equal(result.facts.debtBaselineMethod,savedMethod);
    assert.equal(result.facts.requestedDebtMethod,alternate);
    assert.equal(result.facts.scenarioDebtFreeMonth,undefined);
    assert.equal(result.facts.namedDebtPayoffMonth,undefined);
    if(req.purpose==='debt_timeline')assert.equal(result.facts.timelineOutcome,'not_estimable');
    assert.ok(result.missing.some(message=>/different payoff method cannot be verified/.test(message)));
    assert.match(result.text,new RegExp(`recorded ${savedMethod} dated plan.*baseline`));
    const concise=presentFinancialAnalysis([result],[req],'When will I be debt free under the other method?');
    assert.match(concise.answer,new RegExp(`cannot verify the ${alternate} payoff scenario.*saved pauses.*Debt Payoff Planner`));
    assert.doesNotMatch(concise.answer,/projected to be paid off in/);
    delete s.sources.bills.rows[0].debt_payment_pauses;
    const legacy=calculateFinancialAnalysis(s,req);
    assert.equal(typeof legacy.facts.scenarioDebtFreeMonth,'string');
    assert.equal(legacy.facts.debtProjectionModel,undefined);
    assert.deepEqual(legacy.missing,[]);
  }
});

test('fully prior-month pause history leaves legacy fixed-payment hypotheticals unchanged',()=>{
  const s=snapshot([debt('a',100,{debt_payment_pauses:[pause('2026-08-01','2026-09-01')]}),debt('b',1000)]);
  const req=request({operation:'scenario',scenario:{kind:'extra_debt',amount:25,date:s.today,entity:null,repeat:'monthly'}});
  const withHistory=wealthAnalysis(s,req);
  const legacy=structuredClone(s);delete legacy.sources.bills.rows[0].debt_payment_pauses;
  const withoutHistory=wealthAnalysis(legacy,req);
  assert.deepEqual(withHistory,withoutHistory);
  assert.match(withHistory.text,/Fixed-payment scenario/);
});

test('invalid saved pause never becomes a normal target or payoff in wealth analysis',()=>{
  const s=snapshot([debt('a',100,{debt_payment_pauses:[pause('2026-09-31','2026-10-01')]})]);
  const result=wealthAnalysis(s,request({operation:'plan'}));
  assert.equal(result.facts.totalDebt,100);
  assert.equal(result.facts.nextDebt,undefined);
  assert.equal(result.facts.scenarioDebtFreeMonth,undefined);
  assert.ok(result.missing.some(message=>/saved debt payment pause is invalid/.test(message)));
});
