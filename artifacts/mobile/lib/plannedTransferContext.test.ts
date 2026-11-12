import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {enqueueMutationByKey} from "./financialMutationRecovery";
import {buildForecastAccountCatalog,resolveForecastAccountReference} from "./accountForecasts";
import {normalizePlannedTransfer,normalizePlannedTransferOccurrence,mergePlannedTransferRows,plannedTransferScheduledDate,type PlannedAccountTransfer} from "./plannedAccountTransfers";
import {billTransferCutoff,billTransferExpected,mergeConvertedBill,verifyBillTransferConversion} from "./billTransferConversion";
import {BILL_EDITABLE_FIELDS,billEditableValuesEqual} from "./billEditPersistence";
import {safeLocalDateInTimeZone} from "./financialProjection";
import type {Bill} from "./financialProjectionTypes";
const source=readFileSync("context/BudgetContext.tsx","utf8");
const block=source.slice(source.indexOf("  const plannedTransferMutation ="),source.indexOf("  // One shared read-only engine",source.indexOf("  const plannedTransferMutation =")));
const row=(patch:Partial<PlannedAccountTransfer>={})=>({id:"p",household_id:"home",budget_id:"budget",name:"Savings",amount:100,from_account_ref:"manual:checking",to_account_ref:"manual:savings",frequency:"monthly",start_date:"2027-01-15",end_date:null,status:"active",deleted_at:null,revision:1,created_at:"2027-01-01",updated_at:"2027-01-01",created_by:null,...patch}) as PlannedAccountTransfer;
function deferred(){let resolve!:(value:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve};}
function harness(rpc:(name:string,args:any)=>Promise<any>,options:{editor:boolean;ready:boolean;bills?:Bill[];demo?:boolean}={editor:true,ready:true}){
 const state={rows:[] as PlannedAccountTransfer[],states:[] as any[],calls:[] as any[],bills:[...(options.bills??[])] as Bill[]};
 const scope={current:{householdId:"home",budgetId:"budget",role:"editor"}},generation={current:1},uid={current:"user"},dataScope={current:"user:home:budget"};
 const accounts=buildForecastAccountCatalog({accounts:[{id:"checking",name:"Checking",account_type:"checking",current_balance:1000,balance_as_of:"2027-01-01",is_active:true,created_at:"2027-01-01"},{id:"savings",name:"Savings",account_type:"savings",current_balance:2000,balance_as_of:"2027-01-01",is_active:true,created_at:"2027-01-01"}],bankAccounts:[]});
 const dependencies={useCallback:(fn:any)=>fn,assertCanEditHousehold:()=>{if(!options.editor)throw Error("View only");},userScopeIdRef:uid,householdScopeRef:scope,financialScopeGenerationRef:generation,plannedTransfersReady:options.ready,plannedDataScopeRef:dataScope,plannedTransferQueuesRef:{current:new Map()},demoMode:options.demo??false,runTrackedFinancialMutation:(fn:any)=>fn(),enqueueMutationByKey,
  plannedAccountTransfers:state.rows,plannedTransferOccurrences:state.states,forecastAccounts:accounts,resolveForecastAccountReference,normalizePlannedTransfer,normalizePlannedTransferOccurrence,mergePlannedTransferRows,plannedTransferScheduledDate,genId:()=>"new",
  bills:state.bills,householdTimeZone:"UTC",billWriteQueuesRef:{current:new Map()},billTransferCutoff,billTransferExpected,mergeConvertedBill,verifyBillTransferConversion,BILL_EDITABLE_FIELDS,billEditableValuesEqual,safeLocalDateInTimeZone,setBills:(fn:any)=>{state.bills=fn(state.bills);},
  supabase:{rpc:async(name:string,args:any)=>{state.calls.push({name,args});return rpc(name,args);}},setPlannedAccountTransfers:(fn:any)=>{state.rows=fn(state.rows);},setPlannedTransferOccurrences:(fn:any)=>{state.states=fn(state.states);}};
 const js=ts.transpileModule(block,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const actions=new Function(...Object.keys(dependencies),js+"\nreturn {savePlannedAccountTransfer,convertBillToPlannedTransfer,deletePlannedAccountTransfer,savePlannedTransferOccurrence};")(...Object.values(dependencies));
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

const conversionSource = (): Bill => ({id:"bill",name:"Kids",amount:50,category:"Other",priority:1,is_debt:false,balance:0,interest_rate:0,due_day:4,day_of_week:0,is_recurring:true,frequency:"monthly",created_at:"2026-01-01",smart_priority:"must",include_in_snowball:true,debt_payment_pauses:[],funding_account_ref:"manual:checking"});
const conversionDate = () => new Date(Date.now()+40*86400000).toISOString().slice(0,10);
const conversionPatch = () => ({name:"Kids transfer",amount:50,from_account_ref:"manual:checking" as const,to_account_ref:"manual:savings" as const,frequency:"monthly" as const,start_date:conversionDate(),end_date:null,status:"active" as const});
const conversionReply = (source:Bill, patch=conversionPatch()) => ({bill:{...source,household_id:"home",budget_id:"budget",end_date:billTransferCutoff(patch.start_date)},transfer:row({id:"bill-transfer-0123456789abcdef0123456789abcdef",name:patch.name,amount:patch.amount,from_account_ref:patch.from_account_ref,to_account_ref:patch.to_account_ref,frequency:patch.frequency,start_date:patch.start_date,created_by:"user",source_bill_id:source.id})});
test("actual Bill conversion sends one atomic request and publishes only the verified cutoff and plan",async()=>{
 const source=conversionSource(),patch=conversionPatch();const h=harness(async()=>({data:conversionReply(source,patch),error:null}),{editor:true,ready:true,bills:[source]});
 const saved=await h.convertBillToPlannedTransfer(source,patch);assert.equal(saved.amount,50);assert.equal(h.state.calls.length,1);assert.equal(h.state.calls[0].name,"convert_bill_to_planned_transfer");
 assert.deepEqual(h.state.calls[0].args.p_expected,billTransferExpected(source));assert.deepEqual(h.state.calls[0].args.p_patch,patch);assert.deepEqual(h.state.bills,[{...source,end_date:billTransferCutoff(patch.start_date)}]);assert.equal(h.state.rows.length,1);
});
test("malformed conversion source or plan replies publish neither side",async()=>{
 for(const alter of [(r:any)=>{r.bill.amount=99;},(r:any)=>{r.bill.end_date=conversionDate();},(r:any)=>{r.bill.household_id="other";},(r:any)=>{r.transfer.amount=99;},(r:any)=>{r.transfer.created_by="other";}]){
  const source=conversionSource(),reply=conversionReply(source);alter(reply);const h=harness(async()=>({data:reply,error:null}),{editor:true,ready:true,bills:[source]});await assert.rejects(h.convertBillToPlannedTransfer(source,conversionPatch()),/verified/);assert.deepEqual(h.state.bills,[source]);assert.deepEqual(h.state.rows,[]);
 }
});
test("conversion rejection retains the Bill and delayed old-household acknowledgments publish nothing",async()=>{
 const source=conversionSource(),h=harness(async()=>({data:null,error:{message:"Review unpaid bill activity first."}}),{editor:true,ready:true,bills:[source]});await assert.rejects(h.convertBillToPlannedTransfer(source,conversionPatch()),/unpaid/);assert.deepEqual(h.state.bills,[source]);assert.deepEqual(h.state.rows,[]);
 for(const aba of [false,true]){const gate=deferred(),old=harness(()=>gate.promise,{editor:true,ready:true,bills:[source]}),pending=old.convertBillToPlannedTransfer(source,conversionPatch());await new Promise(r=>setTimeout(r,0));old.generation.current++;old.scope.current={householdId:aba?"home":"other",budgetId:"budget",role:"editor"};gate.resolve({data:conversionReply(source),error:null});await assert.rejects(pending,/household changed/);assert.deepEqual(old.state.bills,[source]);assert.deepEqual(old.state.rows,[]);}
});
test("unavailable or changed conversion sources fail before making a request",async()=>{
 const source=conversionSource();for(const options of [{editor:false,ready:true},{editor:true,ready:false},{editor:true,ready:true,demo:true}]){const h=harness(async()=>{throw Error("must not write");},{...options,bills:[source]});await assert.rejects(h.convertBillToPlannedTransfer(source,conversionPatch()));assert.equal(h.state.calls.length,0);}
 const changed=harness(async()=>{throw Error("must not write");},{editor:true,ready:true,bills:[{...source,amount:100}]});await assert.rejects(changed.convertBillToPlannedTransfer(source,conversionPatch()),/changed/);assert.equal(changed.state.calls.length,0);
});
