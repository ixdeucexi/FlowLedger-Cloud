import { supabase } from "./supabase";
import { FLO_CREATION_ROUTES, isFloCreationReceipt, floCreationDisplayLabel, type FloCreationResult, type FloCreationReceipt } from "./floCreationProtocol";
export * from "./floCreationProtocol";
/** Called only by a current explicit Send event, after canonical app previews.
 * Reusing commandId and payload is required after timeout/Stop/lost response. */
export async function commitFloCreation(creation:FloCreationResult,expectedBudgetId:string):Promise<FloCreationResult>{
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(expectedBudgetId))throw new Error("Choose your active budget again before adding this item.");
 if(creation.status!=="ready"||!creation.commandId||!creation.householdId||!creation.kind||!creation.payload||!FLO_CREATION_ROUTES[creation.kind])throw new Error("This creation request is incomplete. Send the details again.");
 const controller=new AbortController();
 const timeoutMessage="I couldn’t verify the save receipt yet. It may still finish; retry to check this same request.";
 let timer:ReturnType<typeof setTimeout>|undefined;
 let data:unknown;
 try {
  const request=supabase.rpc("create_flo_entity",{p_command_id:creation.commandId,p_kind:creation.kind,p_payload:creation.payload,p_expected_household_id:creation.householdId,p_expected_budget_id:expectedBudgetId}).abortSignal(controller.signal);
  const result=await Promise.race([request,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error(timeoutMessage));},20_000);})]);
  if(result.error)throw new Error(controller.signal.aborted?timeoutMessage:result.error.message);
  data=result.data;
 } finally {if(timer)clearTimeout(timer);}
 const receipt=data as FloCreationReceipt;
 if(!isFloCreationReceipt(receipt)||receipt.commandId!==creation.commandId||receipt.householdId!==creation.householdId||receipt.kind!==creation.kind)throw new Error("I couldn’t verify the save receipt. Retry to check this same request.");
 return {status:"saved",kind:creation.kind,prompt:`Added ${floCreationDisplayLabel(receipt.title)}.`,missingFields:[],commandId:creation.commandId,householdId:creation.householdId,receipt};
}

/** Read-only receipt recovery. This never creates or retries a financial row. */
export async function readFloCreationReceipt(commandId:string,householdId:string,expectedBudgetId:string):Promise<FloCreationResult|null>{
 const {data,error}=await supabase.rpc("read_flo_creation_receipt",{p_command_id:commandId,p_expected_household_id:householdId,p_expected_budget_id:expectedBudgetId});
 if(error)throw new Error(error.message);if(data===null)return null;
 if(!isFloCreationReceipt(data)||data.commandId!==commandId||data.householdId!==householdId)throw new Error("The saved receipt could not be verified.");
 return {status:"saved",kind:data.kind,prompt:`Added ${floCreationDisplayLabel(data.title)}.`,missingFields:[],commandId,householdId,receipt:data};
}
