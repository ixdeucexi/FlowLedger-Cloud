import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {enqueueMutationByKey} from "./financialMutationRecovery";
import {buildForecastAccountCatalog,resolveForecastAccountReference} from "./accountForecasts";
import {normalizePlannedTransfer,normalizePlannedTransferOccurrence,mergePlannedTransferRows,plannedTransferScheduledDate,type PlannedAccountTransfer} from "./plannedAccountTransfers";
const source=readFileSync("context/BudgetContext.tsx","utf8");
const block=source.slice(source.indexOf("  const plannedTransferMutation ="),source.indexOf("  // One shared read-only engine",source.indexOf("  const plannedTransferMutation =")));
const row=(patch:Partial<PlannedAccountTransfer>={})=>({id:"p",household_id:"home",budget_id:"budget",name:"Savings",amount:100,from_account_ref:"manual:checking",to_account_ref:"manual:savings",frequency:"monthly",start_date:"2027-01-15",end_date:null,status:"active",deleted_at:null,revision:1,created_at:"2027-01-01",updated_at:"2027-01-01",created_by:null,...patch}) as PlannedAccountTransfer;
function deferred(){let resolve!:(value:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve};}
function harness(rpc:(name:string,args:any)=>Promise<any>,options={editor:true,ready:true}){
 const state={rows:[] as PlannedAccountTransfer[],states:[] as any[],calls:[] as any[]};
 const scope={current:{householdId:"home",budgetId:"budget",role:"editor"}},generation={current:1},uid={current:"user"},dataScope={current:"user:home:budget"};
 const accounts=buildForecastAccountCatalog({accounts:[{id:"checking",name:"Checking",account_type:"checking",current_balance:1000,balance_as_of:"2027-01-01",is_active:true,created_at:"2027-01-01"},{id:"savings",name:"Savings",account_type:"savings",current_balance:2000,balance_as_of:"2027-01-01",is_active:true,created_at:"2027-01-01"}],bankAccounts:[]});
 const dependencies={useCallback:(fn:any)=>fn,assertCanEditHousehold:()=>{if(!options.editor)throw Error("View only");},userScopeIdRef:uid,householdScopeRef:scope,financialScopeGenerationRef:generation,plannedTransfersReady:options.ready,plannedDataScopeRef:dataScope,plannedTransferQueuesRef:{current:new Map()},demoMode:false,runTrackedFinancialMutation:(fn:any)=>fn(),enqueueMutationByKey,
  plannedAccountTransfers:state.rows,plannedTransferOccurrences:state.states,forecastAccounts:accounts,resolveForecastAccountReference,normalizePlannedTransfer,normalizePlannedTransferOccurrence,mergePlannedTransferRows,plannedTransferScheduledDate,genId:()=>"new",
  supabase:{rpc:async(name:string,args:any)=>{state.calls.push({name,args});return rpc(name,args);}},setPlannedAccountTransfers:(fn:any)=>{state.rows=fn(state.rows);},setPlannedTransferOccurrences:(fn:any)=>{state.states=fn(state.states);}};
 const js=ts.transpileModule(block,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const actions=new Function(...Object.keys(dependencies),js+"\nreturn {savePlannedAccountTransfer,deletePlannedAccountTransfer,savePlannedTransferOccurrence};")(...Object.values(dependencies));
 return {state,scope,generation,uid,dataScope,...actions};
}
test("actual template callback verifies routing and only publishes confirmed revision",async()=>{
 const h=harness(async()=>({data:{transfer:row()},error:null}));await h.savePlannedAccountTransfer("p",{amount:100,from_account_ref:"manual:checking",to_account_ref:"manual:savings"},null);
 assert.equal(h.state.rows.length,1);assert.deepEqual(h.state.calls[0].args.p_patch,{amount:100,from_account_ref:"manual:checking",to_account_ref:"manual:savings"});
 const wrong=harness(async()=>({data:{transfer:row({amount:200})},error:null}));await assert.rejects(wrong.savePlannedAccountTransfer("p",{amount:100},null),/verified/);assert.deepEqual(wrong.state.rows,[]);
});
test("late RPC reply cannot replace a later revision from a fresh read",async()=>{
 const gate=deferred(),h=harness(()=>gate.promise);const pending=h.savePlannedAccountTransfer("p",{amount:100},null);
 await new Promise(r=>setTimeout(r,0));h.state.rows=[row({revision:2,amount:200})];gate.resolve({data:{transfer:row()},error:null});await pending;
 assert.equal(h.state.rows[0].amount,200);assert.equal(h.state.rows[0].revision,2);
});
test("old HH response cannot publish after scope switch or A-B-A generation roundtrip",async()=>{
 for(const roundtrip of [false,true]){const gate=deferred(),h=harness(()=>gate.promise);const pending=h.savePlannedAccountTransfer("p",{amount:100},null);
  await new Promise(r=>setTimeout(r,0));h.generation.current++;h.scope.current={householdId:roundtrip?"home":"other",budgetId:"budget",role:"editor"};
  gate.resolve({data:{transfer:row()},error:null});await assert.rejects(pending,/household changed/);assert.deepEqual(h.state.rows,[]);}
});
test("new household save has its own queue while prior household reply is held",async()=>{
 const gate=deferred();let count=0;const h=harness(async()=>++count===1?gate.promise:{data:{transfer:row({household_id:"other",id:"q"})},error:null});
 const old=h.savePlannedAccountTransfer("p",{amount:100},null);await new Promise(r=>setTimeout(r,0));
 h.scope.current={householdId:"other",budgetId:"budget",role:"editor"};h.generation.current++;h.dataScope.current="user:other:budget";
 await h.savePlannedAccountTransfer("q",{amount:100},null);assert.equal(h.state.rows[0].household_id,"other");
 gate.resolve({data:{transfer:row()},error:null});await assert.rejects(old,/household changed/);assert.equal(h.state.rows.length,1);
});
test("readonly and unresolved-scope callbacks do not make RPC requests",async()=>{
 for(const options of [{editor:false,ready:true},{editor:true,ready:false}]){const h=harness(async()=>{throw Error("must not read/write");},options);await assert.rejects(h.savePlannedAccountTransfer("p",{amount:100},null));assert.equal(h.state.calls.length,0);}
});
