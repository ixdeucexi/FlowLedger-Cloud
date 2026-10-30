import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind } from "typescript";
import { createClient, type Session } from "@supabase/supabase-js";
import * as protocol from "./floCreationProtocol";
const commandId="11111111-1111-4111-8111-111111111111",householdId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",entityId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",budgetId="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const receipt:protocol.FloCreationReceipt={commandId,householdId,kind:"create_income",entityId,entityType:"income",title:"Acme",route:"/(tabs)/more?section=money",createdAt:"2026-10-28T12:00:00Z"};
const ready:protocol.FloCreationResult={status:"ready",kind:"create_income",commandId,householdId,payload:{name:"Acme",amount:2000,frequency:"monthly",first_date:"2026-11-01"},missingFields:[],prompt:"Adding after the app’s safety check."};
const saved:protocol.FloCreationResult={status:"saved",kind:"create_income",commandId,householdId,receipt,prompt:"Added Acme.",missingFields:[]};
test("pure creation protocol validates closed receipt, kind, domain route and identifiers",()=>{assert.deepEqual(protocol.parseFloCreationResult(saved),saved);for(const change of [{entityId:"not-an-id"},{commandId:"bad"},{householdId:"bad"},{entityType:"bill"},{route:"/(tabs)/more"},{route:"https://example.com"},{kind:"create_bank"},{createdAt:"bad"},{title:""}])assert.equal(protocol.parseFloCreationResult({...saved,receipt:{...receipt,...change}}),null);});
test("saved protocol rejects hidden draft/payload and unknown fields",()=>{assert.equal(protocol.parseFloCreationResult({...saved,payload:{name:"hidden"}}),null);assert.equal(protocol.parseFloCreationResult({...saved,unrecognized:true}),null);assert.equal(protocol.parseFloCreationResult({...saved,draft:{kind:"create_income"}}),null);});
test("ready is bounded data and parsing never changes it into saved",()=>{assert.equal(protocol.parseFloCreationResult(ready)?.status,"ready");assert.equal(protocol.parseFloCreationResult({...ready,payload:{amount:Infinity}}),null);assert.equal(protocol.parseFloCreationResult({...ready,prompt:"x".repeat(2001)}),null);});
const actorId="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const mutationScope={userId:actorId,isCurrent:()=>true};
function creationExports(supabase:any,timer:typeof setTimeout=setTimeout,cancel:typeof clearTimeout=clearTimeout){
 const exports:any={};const code=transpileModule(readFileSync("lib/floCreation.ts","utf8"),{compilerOptions:{module:ModuleKind.CommonJS}}).outputText;
 new Function("require","exports","setTimeout","clearTimeout",code)((name:string)=>name==="./supabase"?{supabase}:protocol,exports,timer,cancel);return exports;
}
function helper(result:any,timeout=false){
 const calls:any[]=[],headers:any[]=[];let aborts=0;
 const supabase={auth:{getSession:async()=>({data:{session:{user:{id:actorId},access_token:"actor-token"}},error:null})},rpc:(name:string,args:any)=>{
  calls.push({name,args});const promise=timeout?new Promise(()=>{}):Promise.resolve(result);
  const builder={then:promise.then.bind(promise),setHeader:(key:string,value:string)=>{headers.push([key,value]);return builder;},abortSignal:(signal:AbortSignal)=>{signal.addEventListener("abort",()=>aborts++);return promise;}};return builder;
 }};
 const exports=creationExports(supabase,timeout?((fn:()=>void)=>{queueMicrotask(fn);return 1;}) as unknown as typeof setTimeout:setTimeout,timeout?(()=>{}):clearTimeout);
 return {calls,exports,headers,aborts:()=>aborts};
}
test("authenticated commit passes stable IDs and bound budget, then trusts only authoritative receipt",async()=>{const h=helper({data:receipt,error:null});const result=await h.exports.commitFloCreation(ready,budgetId,mutationScope);assert.equal(result.status,"saved");assert.deepEqual(h.headers,[["Authorization","Bearer actor-token"]]);assert.deepEqual(h.calls[0],{name:"create_flo_entity",args:{p_command_id:commandId,p_kind:"create_income",p_payload:ready.payload,p_expected_household_id:householdId,p_expected_budget_id:budgetId}});const altered=helper({data:{...receipt,entityType:"bill"},error:null});await assert.rejects(altered.exports.commitFloCreation(ready,budgetId,mutationScope),/receipt/);});
test("missing budget and nonready result never issue a write",async()=>{const h=helper({data:receipt,error:null});await assert.rejects(h.exports.commitFloCreation(ready,"",mutationScope),/budget/);await assert.rejects(h.exports.commitFloCreation(saved,budgetId,mutationScope),/incomplete/);assert.equal(h.calls.length,0);});
test("timeout aborts client wait without claiming the submitted save was rolled back",async()=>{const h=helper(null,true);await assert.rejects(h.exports.commitFloCreation(ready,budgetId,mutationScope),/may still finish; retry/);assert.equal(h.aborts(),1);assert.equal(h.calls.length,1);});
test("history receipt recovery is read-only and rejects foreign receipts",async()=>{const h=helper({data:receipt,error:null});assert.equal((await h.exports.readFloCreationReceipt(commandId,householdId,budgetId)).status,"saved");assert.equal(h.calls[0].name,"read_flo_creation_receipt");const foreign=helper({data:{...receipt,householdId:entityId},error:null});await assert.rejects(foreign.exports.readFloCreationReceipt(commandId,householdId,budgetId),/verified/);});
test("maximum manual note keeps payload and immutable receipt title exact while display remains bounded",async()=>{const note="x".repeat(2000),manualReceipt={...receipt,kind:"create_manual_transaction"as const,entityType:"transaction"as const,route:"/(tabs)/transactions",title:note};const manualReady={...ready,kind:"create_manual_transaction"as const,payload:{amount:25,direction:"expense",date:"2026-11-01",category:"Food",note,account_id:entityId}};const h=helper({data:manualReceipt,error:null});const savedResult=await h.exports.commitFloCreation(manualReady,budgetId,mutationScope);assert.equal(h.calls[0].args.p_payload.note,note);assert.equal(savedResult.receipt.title,note);assert.ok(savedResult.prompt.length<200);assert.ok(protocol.parseFloCreationResult(savedResult));const recovered=await h.exports.readFloCreationReceipt(commandId,householdId,budgetId);assert.ok(protocol.parseFloCreationResult(recovered));assert.equal(recovered.receipt.title,note);});
test("draft quote provenance remains opaque bounded scalar metadata",()=>{const draft={kind:"create_income"as const,fields:{name:"Acme"},evidence:{name:"Acme"},authorizationText:"Create income named Acme",userText:"Create income named Acme",householdId,expiresAt:"2026-10-28T12:30:00Z"};assert.ok(protocol.parseFloCreationResult({status:"needs_details",kind:"create_income",prompt:"Send take-home amount.",missingFields:["amount"],draft}));assert.equal(protocol.parseFloCreationResult({status:"needs_details",kind:"create_income",prompt:"Send amount.",missingFields:["amount"],draft:{...draft,evidence:{name:{nested:true}}}}),null);});
test("structured form feedback is closed, bounded, and allowed only on needs-details",()=>{const feedback:protocol.FloCreationResult={status:"needs_details",kind:"create_income",prompt:"Check the highlighted fields.",missingFields:["amount"],form:{values:{name:"Salary",amount:"1,50",frequency:"monthly",first_date:"2026-11-01"},errors:{amount:"Enter a positive amount."}}};assert.deepEqual(protocol.parseFloCreationResult(feedback),feedback);for(const form of [null,false,[],{}, {...feedback.form,unexpected:true},{values:{unknown:"x"},errors:{}},{values:{name:{nested:true}},errors:{}},{values:{name:"x".repeat(2001)},errors:{}},{values:{},errors:{amount:"x".repeat(301)}}])assert.equal(protocol.parseFloCreationResult({...feedback,form}),null);assert.equal(protocol.parseFloCreationResult({...saved,form:null}),null);assert.equal(protocol.parseFloCreationResult({...ready,form:feedback.form}),null);});
test("structured form field registry preserves the six canonical payload contracts",()=>{assert.deepEqual(protocol.FLO_CREATION_FORM_FIELDS.create_manual_transaction.required,["amount","direction","date","category","note","account_id"]);assert.equal(protocol.FLO_CREATION_FORM_FIELDS.create_manual_transaction.required.includes("account_name"),false);assert.deepEqual(protocol.FLO_CREATION_FORM_FIELDS.create_income.optional,["monthly_last_day"]);assert.deepEqual(protocol.FLO_CREATION_FORM_FIELDS.create_savings_goal.optional,["current_amount"]);});

function chatExports(supabase:any,creation:any){
 const exports:any={};const code=transpileModule(readFileSync("lib/floChat.ts","utf8"),{compilerOptions:{module:ModuleKind.CommonJS}}).outputText;
 new Function("require","exports",code)((name:string)=>name==="@/lib/supabase"?{supabase}:name==="./floCreation"?creation:{},exports);return exports;
}
function sdkSession(id:string,token:string):Session{return {access_token:token,refresh_token:"unit-refresh",token_type:"bearer",expires_in:3600,user:{id,aud:"authenticated",app_metadata:{},user_metadata:{},created_at:"2026-01-01T00:00:00Z"}};}
test("actual SDK pins creation and recurring confirmation to the captured actor token after ambient auth changes",async()=>{
 for(const operation of ["create","confirm"]){
  const transport:any[]=[],users:string[]=[];
  const client=createClient("https://unit-test.invalid","unit-public-key",{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,init)=>{
   transport.push({path:new URL(String(input)).pathname,authorization:new Headers(init?.headers).get("Authorization"),body:JSON.parse(String(init?.body))});
   return new Response(JSON.stringify(operation==="create"?receipt:{billId:entityId,previousAmount:10,newAmount:12,confirmedAt:"2026-10-30T10:00:00Z",auditId:5}),{status:200,headers:{"Content-Type":"application/json"}});
  }}});
  await client.auth.initialize();client.auth.getSession=async()=>{const actor=users.length===0?actorId:"other-actor";users.push(actor);return {data:{session:sdkSession(actor,actor===actorId?"captured-a":"ambient-b")},error:null};};
  const creation=creationExports(client);
  if(operation==="create")await creation.commitFloCreation(ready,budgetId,mutationScope);
  else await chatExports(client,creation).confirmFloRecurringBillProposal(commandId,mutationScope);
  assert.deepEqual(users.slice(0,2),[actorId,"other-actor"]);assert.equal(transport.length,1);assert.equal(transport[0].authorization,"Bearer captured-a");
  assert.equal(transport[0].path,operation==="create"?"/rest/v1/rpc/create_flo_entity":"/rest/v1/rpc/confirm_flo_recurring_bill_proposal");client.realtime.disconnect();
 }
});
test("SDK actor mismatch or owner/capability changes during session lookup prevent both canonical dispatches",async()=>{
 for(const operation of ["create","confirm"]){for(const transition of ["actor","scope"]){
  let current=true;const calls:any[]=[];const client={auth:{getSession:async()=>{if(transition==="scope")current=false;return {data:{session:sdkSession(transition==="actor"?"other-actor":actorId,"unit-token")},error:null};}},rpc:(...args:any[])=>{calls.push(args);throw new Error("must not dispatch");}};
  const creation=creationExports(client),scope={userId:actorId,isCurrent:()=>current};
  await assert.rejects(operation==="create"?creation.commitFloCreation(ready,budgetId,scope):chatExports(client,creation).confirmFloRecurringBillProposal(commandId,scope),/flo_mutation_scope_changed/);assert.deepEqual(calls,[]);
 }}
});

test("canonical scope-lock contention stays retryable and Pro denial remains a recognizable domain error",async()=>{for(const error of [{code:"55P03",message:"could not obtain lock"},{code:"P0001",message:"flo_creation_pro_required"}]){const h=helper({data:null,error});await assert.rejects(h.exports.commitFloCreation(ready,budgetId,mutationScope),error.code==="55P03"?/lock_not_available/:/flo_creation_pro_required/);}});
