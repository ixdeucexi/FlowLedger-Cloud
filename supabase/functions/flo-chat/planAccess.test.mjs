import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { parseFloAllowance, parseFloPlanAccess, readFloPlanAccess, parseFloReservation, reserveFloPlanRequest, floReservationRefund } from './planAccess.ts';

const HH='22222222-2222-4222-8222-222222222222',UID='11111111-1111-4111-8111-111111111111',RID='33333333-3333-4333-8333-333333333333';
const allowance=(extra={})=>({period:'month',limit:10,used:2,remaining:8,resetsAt:'2026-11-01T00:00:00.000Z',canCreate:false,...extra});
test('access parsing is scoped and fails closed for malformed or contradictory usage',()=>{
 const base={version:1,householdId:HH,features:['flo_account_chat'],flo:allowance()};
 assert.deepEqual(parseFloPlanAccess(base,HH).flo,allowance());
 assert.equal(parseFloPlanAccess({...base,householdId:UID},HH),null);
 for(const bad of [{remaining:9},{limit:0},{used:-1},{canCreate:'true'},{period:'year'},{resetsAt:'tomorrow'}]) assert.equal(parseFloAllowance(allowance(bad)),null);
 assert.equal(parseFloPlanAccess({...base,version:2},HH),null);
 assert.equal(parseFloReservation({allowed:true,legacyDaily:false,reservationId:UID,allowance:allowance()},RID),null);
 assert.ok(parseFloReservation({allowed:true,legacyDaily:true,reservationId:null,allowance:allowance({period:'day',limit:100,used:3,remaining:97})},RID));
});
test('RPC inputs contain scope and verified preview, never caller-provided quota limits',async()=>{
 const calls=[],client={rpc:async(name,input)=>{calls.push({name,input});return{data:name==='get_household_feature_access'?{version:1,householdId:HH,features:['flo_account_chat'],flo:allowance()}:{allowed:true,reservationId:RID,legacyDaily:false,allowance:allowance()},error:null};}};
 await readFloPlanAccess(client,HH,'free'); await reserveFloPlanRequest(client,UID,HH,RID,'free');
 assert.deepEqual(calls,[{name:'get_household_feature_access',input:{p_expected_household_id:HH,p_preview_tier:'free'}},{name:'reserve_flo_plan_request',input:{p_user_id:UID,p_household_id:HH,p_reservation_id:RID,p_preview_tier:'free'}}]);
 await assert.rejects(()=>readFloPlanAccess({rpc:async()=>({error:'offline',data:null})},HH,null),/plan_access_unavailable/);
 await assert.rejects(()=>reserveFloPlanRequest({rpc:async()=>({error:null,data:{allowed:true,reservationId:UID}})},UID,HH,RID,null),/usage_limit_unavailable/);
});
test('refund is scope-bound and single flight, including repeated failures and legacy no-op',async()=>{
 const calls=[],rpc=async(name,input)=>{calls.push({name,input});return{data:true,error:null}};
 const refund=floReservationRefund({rpc},UID,HH,RID);await Promise.all([refund(),refund(),refund()]);
 assert.deepEqual(calls,[{name:'refund_flo_plan_request',input:{p_user_id:UID,p_household_id:HH,p_reservation_id:RID}}]);
 await floReservationRefund({rpc},UID,HH,null)();assert.equal(calls.length,1);
 let count=0;const failed=floReservationRefund({rpc:async()=>{count++;return{data:null,error:'offline'}}},UID,HH,RID);
 await assert.rejects(failed,/usage_refund_unavailable/);await assert.rejects(failed,/usage_refund_unavailable/);assert.equal(count,1);
});

const source=readFileSync(new URL('./index.ts',import.meta.url),'utf8');
function handler(options={}) {
 const calls=[],writes=[],terminal=[],events=[];let providers=0;
 const query=(result)=>({select(){return this},in(){return Promise.resolve(result)},insert(row){writes.push(row);return this},single(){return Promise.resolve(result)}});
 const access={householdId:HH,message:options.creation?'Add Salary income.':'What is my balance?',membership:{role:options.role??'owner'},historyEnabled:true,requestedConversationId:RID,conversation:{id:RID},verifiedPreviewTier:null,enforcementEnabled:true};
 const existing=options.replay?[{id:'user',role:'user',created_by:UID,household_id:HH,conversation_id:RID,content:access.message},{id:'assistant',role:'assistant',created_by:UID,household_id:HH,conversation_id:RID,status:'completed',content:'Existing answer',model:'fixture'}]:[];
 const client={from:()=>query({data:existing,error:null})};
 const server={rpc:async(name,input)=>{calls.push({name,input});return{data:name==='reserve_flo_plan_request'?{allowed:!options.denied,reservationId:options.denied?null:RID,legacyDaily:false,allowance:allowance()}:true,error:null}},from:()=>query({data:null,error:options.persistenceFail?'offline':null})};
 const bindings={authorizeFloV3:async()=>({...access,historyEnabled:!options.ephemeral,requestedConversationId:options.ephemeral?undefined:RID,conversation:options.ephemeral?undefined:{id:RID}}),jsonError:(code,status)=>new Response(JSON.stringify({code}),{status}),sanitizeContext:()=>null,crypto:{randomUUID:()=>RID},sse:(type,data)=>{events.push({type,data});return new TextEncoder().encode(JSON.stringify({type,...data})+'\n')},streamHeaders:{},modelId:'fixture',enforceRateLimit:async()=>true,enforceDailyLimit:async()=>true,reserveFloPlanRequest,floReservationRefund,cleanupEphemeral:async()=>{},audit:async()=>{},finalizeFloResponse:async(_server,input)=>{terminal.push(input)},aggregateCoverage:()=>({partial:false,dataAsOf:null,coverage:{complete:true}}),allowsSavedPlanRead:()=>false,verifiedFallbackFromTools:()=>null,toolProgressMessage:()=>'',encoder:new TextEncoder(),forbiddenRequest:/^NEVER$/,creationIntent:()=>options.creation?{kind:'create_income',mode:'create'}:null,runFloCreation:async()=>{if(options.creation)throw Error('Read-only preview must not dispatch creation');return null},floCapabilityGuidance:()=>null,deterministicFloRoute:()=>null,isAppNavigationQuestion:()=>false,Deno:{env:{get:()=> 'fixture-not-a-credential'}},withinHardDeadline:async value=>value,hardAnswerDeadlineMs:30000,runFinancialAnalysis:async()=>{providers++;if(options.providerGate)await options.providerGate;if(options.providerFail)throw Error('provider unavailable');return{answer:{answer:'Verified answer',claims:[],evidenceIds:[],followups:[]},sources:[],aggregate:{partial:false,dataAsOf:null,coverage:{complete:true}},usage:{}}},loadAnalysisConversation:async()=>[],stableSafetyIdentifier:async()=> 'fixture',cleanText:text=>text,publicFailureCode:()=> 'answer_failed',classifyFloFailure:()=> 'fixture',safeFloFailureReason:()=> 'fixture',safeAnalysisFailureCodes:()=> [],console:{warn(){}},verifiedFallbackCodes:new Set()};
 const begin=source.indexOf('async function handleV3('),end=source.indexOf('\nDeno.serve',begin),code=stripTypeScriptTypes(source.slice(begin,end));
 const run=new Function(...Object.keys(bindings),code+'; return handleV3;')(...Object.values(bindings));
 return{calls,writes,terminal,events,providers:()=>providers,run:()=>run(client,server,UID,{assistantMessageId:'assistant',userMessage:{id:'user'}})};
}
test('completed response replay stays available without spending quota or calling provider',async()=>{
 const h=handler({replay:true});const response=await h.run();await response.text();assert.equal(h.providers(),0);assert.equal(h.calls.some(c=>c.name==='reserve_flo_plan_request'),false);assert.match(JSON.stringify(h.events),/Existing answer/);
});
test('monthly exhaustion rejects before provider and before message writes',async()=>{
 const h=handler({denied:true});assert.equal((await h.run()).status,429);assert.equal(h.providers(),0);assert.deepEqual(h.writes,[]);assert.equal(h.calls.filter(c=>c.name==='reserve_flo_plan_request').length,1);
});
test('ephemeral persistence failure refunds exactly once without any provider request',async()=>{
 const h=handler({ephemeral:true,persistenceFail:true});assert.equal((await h.run()).status,503);assert.equal(h.providers(),0);assert.equal(h.calls.filter(c=>c.name==='refund_flo_plan_request').length,1);
});
test('provider failure refunds once; finalized verified answer remains charged',async()=>{
 const failed=handler({providerFail:true});await failed.run();assert.equal(failed.providers(),1);assert.equal(failed.calls.filter(c=>c.name==='refund_flo_plan_request').length,1);assert.equal(failed.terminal.at(-1).messageStatus,'error');
 const saved=handler();await saved.run();assert.equal(saved.providers(),1);assert.equal(saved.calls.some(c=>c.name==='refund_flo_plan_request'),false);assert.equal(saved.terminal.at(-1).messageStatus,'completed');
});


test('Free creation questions give truthful Pro/manual guidance without provider or mutation dispatch and refund preview',async()=>{
 const h=handler({creation:true});await h.run();assert.equal(h.providers(),0);assert.equal(h.calls.filter(c=>c.name==='refund_flo_plan_request').length,1);
 assert.match(h.terminal.at(-1).content,/Pro.*for free/);assert.equal(h.terminal.at(-1).messageStatus,'completed');
 const viewer=handler({creation:true,role:'viewer'});await viewer.run();assert.match(viewer.terminal.at(-1).content,/view-only/);assert.doesNotMatch(viewer.terminal.at(-1).content,/with Pro/);
});


test('a paused provider cannot return Response early or refund an in-flight successful answer',async()=>{
 let release;const providerGate=new Promise(resolve=>{release=resolve});
 const h=handler({providerGate});let returned=false;
 const pending=h.run().then(response=>{returned=true;return response});
 for(let i=0;i<20&&h.providers()===0;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.providers(),1);assert.equal(returned,false);assert.equal(h.terminal.length,0);
 assert.equal(h.calls.some(c=>c.name==='refund_flo_plan_request'),false);
 release();const response=await pending;assert.equal(response.status,200);assert.equal(returned,true);
 assert.equal(h.terminal.at(-1).messageStatus,'completed');assert.equal(h.calls.some(c=>c.name==='refund_flo_plan_request'),false);
});
