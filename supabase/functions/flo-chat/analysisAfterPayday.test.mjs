import test from 'node:test';
import assert from 'node:assert/strict';
import { recurringAnalysis } from './analysisRecurring.ts';

const tables=['incomes','bills','monthly_overrides','bill_date_moves','transactions','plaid_transactions','plaid_accounts','goals'];
const snapshot=()=>({householdId:'h',today:'2026-10-14',capturedAt:'2026-10-14T16:00:00Z',timeZone:'UTC',hash:'test',sources:Object.fromEntries(tables.map(table=>[table,{rows:[],complete:true}]))});
const request=(patch={})=>({purpose:'general',domain:'bills',operation:'summary',incomeTiming:'expected',startDate:null,endDate:null,dateEvent:'after_payday',entity:null,merchant:null,category:null,amount:null,...patch});
const income=(id,name,day,patch={})=>({id,name,amount:1000,frequency:'monthly',start_date:`2026-10-${day}`,next_payment_date:`2026-10-${day}`,amount_history:[],excluded_dates:[],...patch});
const bill=(id,name,day,amount=10,patch={})=>({id,name,amount,is_debt:false,is_recurring:true,frequency:'monthly',due_day:day,category:'Household',start_date:'2026-01-01',created_at:'2026-01-01T00:00:00Z',...patch});
const weekly=(id='ymca',name='YMCA')=>bill(id,name,1,150,{frequency:'weekly',day_of_week:3,next_payment_date:'2026-10-07'});
const reviewedPayment=(id,billId,occurrenceDate,amount,plannedAmount=150,settlement='exact',patch={})=>({id,date:occurrenceDate,amount:-amount,category:'Household',note:'Payment',review_status:'matched',review_resolution:'bill',linked_bill_id:billId,review_allocations:[{type:'bill',targetId:billId,occurrenceDate,amount,plannedAmount,settlement}],...patch});

test('after-payday bills use the strict next-to-following payday window and reconcile unpaid detail totals',()=>{
  const s=snapshot();
  s.sources.incomes.rows=[income('pay-a','Pay A','16'),income('pay-duplicate','Pay duplicate','16'),income('pay-b','Pay B','30')];
  s.sources.bills.rows=[
    bill('boundary-a','Boundary A',16,999),
    bill('partial','Partial',17,100),
    bill('settled','Settled',18,70),
    bill('pending','Pending',19,30),
    bill('ordinary','Ordinary',29,20),
    bill('boundary-b','Boundary B',30,999),
    bill('past','Past',13,999),
    bill('moved','Moved',20,80),
  ];
  s.sources.monthly_overrides.rows=[
    {id:'partial-o',bill_id:'partial',month:9,year:2026,paid_amount:40,actual_amount:40,paid_date:'2026-10-17'},
    {id:'settled-o',bill_id:'settled',month:9,year:2026,paid_amount:70,actual_amount:70,paid_date:'2026-10-18'},
  ];
  s.sources.transactions.rows=[{id:'pending-t',date:'2026-10-19',amount:-30,pending:true,linked_bill_id:'pending'}];
  s.sources.bill_date_moves.rows=[{id:'move',bill_id:'moved',from_date:'2026-10-20',to_date:'2026-10-31',created_at:s.capturedAt}];
  const r=recurringAnalysis(s,request());
  assert.deepEqual(r.missing,[]);
  assert.ok(r.sources.includes('incomes'));
  assert.equal(r.facts.startDate,'2026-10-17');
  assert.equal(r.facts.endDate,'2026-10-29');
  assert.equal(r.facts.occurrenceCount,3);
  assert.equal(r.facts.displayedOccurrenceCount,3);
  assert.equal(r.facts.remainingObligations,110);
  assert.match(r.text,/after the 2026-10-16 payday and before the 2026-10-30 payday/);
  assert.match(r.text,/2026-10-17: Partial.*\$60\.00 remaining/);
  assert.match(r.text,/2026-10-19: Pending.*\$30\.00 remaining/);
  assert.match(r.text,/2026-10-29: Ordinary.*\$20\.00 remaining/);
  for(const hidden of ['Boundary A','Boundary B','Past','Settled','Moved'])assert.doesNotMatch(r.text,new RegExp(hidden));
  assert.doesNotMatch(r.text,/earlier this month/);
});

test('after-payday detail shows every normal occurrence through 50 rather than truncating at 12',()=>{
  const s=snapshot();
  s.sources.incomes.rows=[income('pay-a','Pay A','16'),income('pay-b','Pay B','30')];
  s.sources.bills.rows=Array.from({length:19},(_,index)=>bill(`b-${index}`,`Future ${index+1}`,17+(index%13),index+1));
  const r=recurringAnalysis(s,request());
  assert.deepEqual(r.missing,[]);
  assert.equal(r.facts.occurrenceCount,19);
  assert.equal(r.facts.displayedOccurrenceCount,19);
  assert.equal(r.facts.remainingObligations,190);
  assert.match(r.text,/Future 19/);
  assert.doesNotMatch(r.text,/first 12|omitted/);
});

test('after-payday window does not guess an ending date without a second distinct positive payday',()=>{
  const s=snapshot();
  s.sources.incomes.rows=[income('only','Only pay','16',{amount_history:[{effective_from:'2026-11',amount:0}]})];
  const r=recurringAnalysis(s,request());
  assert.equal(r.facts.nextPayday,'2026-10-16');
  assert.equal(r.facts.followingPayday,null);
  assert.ok(r.missing.some(value=>/following positive household payday/.test(value)));
  assert.match(r.text,/cannot safely choose an end date/);
});

test('after-payday window crosses months while excluding both payday dates',()=>{
  const s=snapshot();
  s.sources.incomes.rows=[{...income('pay','Pay','30'),frequency:'biweekly'}];
  s.sources.bills.rows=[bill('first-payday','First payday',30,100),bill('cross','Cross month',1,40),bill('next-payday','Next payday',13,100)];
  const r=recurringAnalysis(s,request());
  assert.equal(r.facts.startDate,'2026-10-31');
  assert.equal(r.facts.endDate,'2026-11-12');
  assert.equal(r.facts.remainingObligations,40);
  assert.match(r.text,/2026-11-01: Cross month/);
  assert.doesNotMatch(r.text,/First payday|Next payday/);
});

test('after-payday boundaries require net-positive aggregate household income on the date',()=>{
  for(const offset of [-100,-200]) {
    const s=snapshot();
    s.sources.incomes.rows=[
      income('offset-a','Offset A','16',{amount:100}),
      income('offset-b','Offset B','16',{amount:100,amount_history:[{effective_from:'2026-10',amount:offset}]}),
      income('actual-a','Actual A','20',{amount:500}),
      income('actual-b','Actual B','30',{amount:500}),
    ];
    s.sources.bills.rows=[bill('wrong-window','Wrong window',17,90),bill('right-window','Right window',21,40)];
    const r=recurringAnalysis(s,request());
    assert.deepEqual(r.missing,[]);
    assert.equal(r.facts.nextPayday,'2026-10-20');
    assert.equal(r.facts.followingPayday,'2026-10-30');
    assert.equal(r.facts.startDate,'2026-10-21');
    assert.equal(r.facts.remainingObligations,40);
    assert.match(r.text,/Right window/);
    assert.doesNotMatch(r.text,/Wrong window/);
  }
});

test('reviewed earlier weekly payment cannot spill into the live after-payday window',()=>{
  const s=snapshot();
  s.sources.incomes.rows=[income('pay-a','Pay A','16'),income('pay-b','Pay B','30')];
  s.sources.bills.rows=[weekly()];
  s.sources.monthly_overrides.rows=[{id:'ymca-o',bill_id:'ymca',month:9,year:2026,paid_amount:150,actual_amount:150,paid_date:'2026-10-07'}];
  s.sources.transactions.rows=[reviewedPayment('ymca-paid','ymca','2026-10-07',150)];
  const r=recurringAnalysis(s,request());
  assert.deepEqual(r.missing,[]);
  assert.equal(r.facts.occurrenceCount,2);
  assert.equal(r.facts.paymentStatusNeedsReviewCount,0);
  assert.equal(r.facts.remainingObligations,300);
  assert.match(r.text,/2026-10-21: YMCA.*\$150\.00 remaining/);
  assert.match(r.text,/2026-10-28: YMCA.*\$150\.00 remaining/);
});

test('reviewed exact and partial weekly allocations are authoritative per occurrence',()=>{
  for(const [settlement,amount,expected] of [['exact',150,150],['partial',50,250]]) {
    const s=snapshot();
    s.sources.incomes.rows=[income('pay-a','Pay A','16'),income('pay-b','Pay B','30')];
    s.sources.bills.rows=[weekly()];
    s.sources.monthly_overrides.rows=[{id:'ymca-o',bill_id:'ymca',month:9,year:2026,paid_amount:amount,actual_amount:amount,paid_date:'2026-10-21'}];
    s.sources.transactions.rows=[reviewedPayment('ymca-paid','ymca','2026-10-21',amount,150,settlement)];
    const r=recurringAnalysis(s,request());
    assert.deepEqual(r.missing,[],settlement);
    assert.equal(r.facts.remainingObligations,expected,settlement);
    if(settlement==='exact')assert.doesNotMatch(r.text,/2026-10-21: YMCA/);
    else assert.match(r.text,/2026-10-21: YMCA.*partial.*\$100\.00 remaining/);
    assert.match(r.text,/2026-10-28: YMCA.*\$150\.00 remaining/);
  }
});

test('legacy dated weekly payments apply only to their matching occurrence and are capped',()=>{
  for(const [paidDate,expected,visible21] of [['2026-10-07',300,true],['2026-10-21',150,false]]) {
    const s=snapshot();
    s.sources.incomes.rows=[income('pay-a','Pay A','16'),income('pay-b','Pay B','30')];
    s.sources.bills.rows=[weekly()];
    s.sources.monthly_overrides.rows=[{id:'ymca-o',bill_id:'ymca',month:9,year:2026,paid_amount:900,actual_amount:900,paid_date:paidDate}];
    const r=recurringAnalysis(s,request());
    assert.deepEqual(r.missing,[],paidDate);
    assert.equal(r.facts.remainingObligations,expected,paidDate);
    if(visible21)assert.match(r.text,/2026-10-21: YMCA.*\$150\.00 remaining/);
    else assert.doesNotMatch(r.text,/2026-10-21: YMCA/);
    assert.match(r.text,/2026-10-28: YMCA.*\$150\.00 remaining/);
  }
});

test('ambiguous weekly month payment keeps review rows separate while unrelated verified bills remain totaled',()=>{
  for(const paidDate of [null,'2026-10-08']) {
    const s=snapshot();
    s.sources.incomes.rows=[income('pay-a','Pay A','16'),income('pay-b','Pay B','30')];
    s.sources.bills.rows=[weekly(),bill('phone','Phone',22,40)];
    s.sources.monthly_overrides.rows=[{id:'ymca-o',bill_id:'ymca',month:9,year:2026,paid_amount:150,actual_amount:150,paid_date:paidDate}];
    const r=recurringAnalysis(s,request());
    assert.equal(r.facts.occurrenceCount,1,paidDate);
    assert.equal(r.facts.paymentStatusNeedsReviewCount,2,paidDate);
    assert.equal(r.facts.remainingObligations,40,paidDate);
    assert.ok(r.missing.some(value=>/ambiguous month-level payment status/.test(value)),paidDate);
    assert.match(r.text,/2026-10-22: Phone.*\$40\.00 remaining/);
    assert.match(r.text,/Payment status needs review/);
    assert.match(r.text,/2026-10-21: YMCA.*payment and remainder are not verified/);
    assert.match(r.text,/2026-10-28: YMCA.*payment and remainder are not verified/);
  }
});

test('pending weekly payment remains unpaid',()=>{
  const s=snapshot();
  s.sources.incomes.rows=[income('pay-a','Pay A','16'),income('pay-b','Pay B','30')];
  s.sources.bills.rows=[weekly()];
  s.sources.transactions.rows=[reviewedPayment('pending','ymca','2026-10-21',150,150,'exact',{pending:true})];
  const r=recurringAnalysis(s,request());
  assert.deepEqual(r.missing,[]);
  assert.equal(r.facts.remainingObligations,300);
  assert.match(r.text,/2026-10-21: YMCA.*\$150\.00 remaining/);
});

test('more than 50 unpaid occurrences is explicitly partial while totals retain full coverage',()=>{
  const s=snapshot();
  s.sources.incomes.rows=[income('pay-a','Pay A','16'),income('pay-b','Pay B','30')];
  s.sources.bills.rows=Array.from({length:51},(_,index)=>bill(`b-${index}`,`Future ${index+1}`,17+(index%13),1));
  const r=recurringAnalysis(s,request());
  assert.equal(r.facts.occurrenceCount,51);
  assert.equal(r.facts.displayedOccurrenceCount,50);
  assert.equal(r.facts.remainingObligations,51);
  assert.ok(r.missing.some(value=>/1 additional unpaid/.test(value)));
  assert.match(r.text,/Showing 50 of 51.*1.*omitted/);
});
