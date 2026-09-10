import test from 'node:test';
import assert from 'node:assert/strict';
import { currentBalanceAnalysis } from './analysisAccounts.ts';
const request = (patch={}) => ({domain:'money',operation:'detail',startDate:null,endDate:null,dateEvent:'none',entity:null,scenario:null,...patch});
const manual = (patch={}) => ({id:'m',name:'Wallet',account_type:'cash',current_balance:25,balance_as_of:'2026-09-10',is_active:true,...patch});
const bank = (patch={}) => ({id:'b',name:'Checking',display_name:'Main checking',account_type:'depository',account_subtype:'checking',current_balance:500,is_active:true,updated_at:'2026-09-10T15:00:00Z',...patch});
const snapshot = (accounts=[],banks=[]) => ({today:'2026-09-10',timeZone:'America/Chicago',sources:{accounts:{complete:true,rows:accounts},plaid_accounts:{complete:true,rows:banks},household_settings:{complete:true,rows:[]}}});
test('named checking and savings resolve exact normalized names, not household total',()=>{
 const s=snapshot([manual()],[bank(),bank({id:'s',name:'Savings',display_name:'Rainy day',account_subtype:'savings',current_balance:1200})]);
 assert.equal(currentBalanceAnalysis(s,request({entity:' MAIN  CHECKING '})).facts.recordedBalance,500);
 assert.equal(currentBalanceAnalysis(s,request({entity:'Rainy day'})).facts.recordedBalance,1200);
 assert.equal(currentBalanceAnalysis(s,request({entity:'Wallet'})).facts.recordedBalance,25);
 assert.deepEqual(currentBalanceAnalysis(s,request({entity:'Main'})).facts,{});
});
test('connected precedence and canonical reconnect identity avoid duplicate totals; savings separate',()=>{
 const s=snapshot([manual({account_type:'checking',current_balance:500}),manual({id:'s',account_type:'savings',current_balance:1200})],[bank({persistent_account_id:'same',updated_at:'2026-09-09T15:00:00Z',current_balance:400}),bank({id:'new',persistent_account_id:'same'}),bank({id:'sav',account_subtype:'savings',current_balance:1000})]);
 assert.equal(currentBalanceAnalysis(s,request()).facts.recordedBalance,500);
 assert.equal(currentBalanceAnalysis(s,request({domain:'savings'})).facts.recordedBalance,1000);
});
test('ambiguous names and inactive accounts never silently pick a balance',()=>{
 const s=snapshot([manual({name:'Shared'})],[bank({display_name:'Shared'}),bank({id:'off',display_name:'Inactive',is_active:false})]);
 assert.match(currentBalanceAnalysis(s,request({entity:'Shared'})).text,/more than one/);
 assert.deepEqual(currentBalanceAnalysis(s,request({entity:'Inactive'})).facts,{});
});
test('invalid balances never become zero; numeric zero is valid',()=>{
 for(const value of [null,'',false,{},'NaN']) assert.deepEqual(currentBalanceAnalysis(snapshot([],[bank({current_balance:value})]),request()).facts,{});
 assert.equal(currentBalanceAnalysis(snapshot([],[bank({current_balance:0})]),request()).facts.recordedBalance,0);
});
test('dates and source gaps explicit; future named projection never returns aggregate',()=>{
 const s=snapshot([],[bank()]);
 assert.match(currentBalanceAnalysis(s,request({entity:'Main checking',endDate:'2026-09-20'})).text,/must not be substituted/);
 assert.deepEqual(currentBalanceAnalysis(snapshot([],[bank({updated_at:null})]),request()).facts,{});
 s.sources.accounts.complete=false; assert.deepEqual(currentBalanceAnalysis(s,request()).facts,{});
});
test('mixed observation dates disclosed and balance never advertised as safe funds',()=>{
 const s=snapshot([manual(),manual({id:'m2',name:'Other',current_balance:30,balance_as_of:'2026-09-08'})]);
 const r=currentBalanceAnalysis(s,request()); assert.equal(r.facts.recordedBalance,55); assert.equal(r.facts.balanceAsOf,null); assert.match(r.text,/not one simultaneous/); assert.equal(r.facts.safeToSpend,null);
});
test('manual operating group excludes savings and settings fallback is dated, never named',()=>{
 const s=snapshot([manual(),manual({id:'s',name:'Reserve',account_type:'savings',current_balance:900})]);
 assert.equal(currentBalanceAnalysis(s,request()).facts.recordedBalance,25);
 assert.equal(currentBalanceAnalysis(s,request({domain:'savings'})).facts.recordedBalance,900);
 const empty=snapshot(); empty.sources.household_settings.rows=[{starting_balance:120,starting_balance_date:'2026-09-09'}];
 assert.equal(currentBalanceAnalysis(empty,request()).facts.recordedBalance,120);
 assert.deepEqual(currentBalanceAnalysis(empty,request({entity:'Missing'})).facts,{});
 assert.deepEqual(currentBalanceAnalysis(empty,request({domain:'savings'})).facts,{});
});
