export type FloCreationKind="create_bill"|"create_debt"|"create_income"|"create_manual_transaction"|"create_bucket"|"create_savings_goal";
export type FloCreationDraft={kind:FloCreationKind;fields:Record<string,unknown>;evidence:Record<string,string>;authorizationText:string;userText:string;householdId:string;expiresAt:string};
export type FloCreationReceipt={commandId:string;householdId:string;kind:FloCreationKind;entityId:string;entityType:"bill"|"income"|"transaction"|"goal";title:string;route:string;createdAt:string};
export type FloCreationFormInput = {
 kind: FloCreationKind;
 fields: Record<string, string | number | boolean>;
};
export type FloCreationFormFeedback = {
 values: Record<string, string | number | boolean>;
 errors: Record<string, string>;
};
export const FLO_CREATION_FORM_FIELDS: Record<FloCreationKind, { required: readonly string[]; optional: readonly string[] }> = {
 create_bill: { required: ["name", "amount", "frequency", "first_date"], optional: ["category", "is_recurring"] },
 create_debt: { required: ["name", "balance", "minimum_payment", "apr", "frequency", "first_date"], optional: [] },
 create_income: { required: ["name", "amount", "frequency", "first_date"], optional: ["monthly_last_day"] },
 create_manual_transaction: { required: ["amount", "direction", "date", "category", "note", "account_id"], optional: [] },
 create_bucket: { required: ["name", "target_amount", "target_date"], optional: [] },
 create_savings_goal: { required: ["name", "target_amount", "target_date"], optional: ["current_amount"] },
};
export type FloCreationResult={form?:FloCreationFormFeedback;status:"needs_details"|"ready"|"saved"|"unavailable";kind?:FloCreationKind;prompt:string;missingFields:string[];draft?:FloCreationDraft;commandId?:string;householdId?:string;payload?:Record<string,unknown>;receipt?:FloCreationReceipt};
export const FLO_CREATION_ROUTES:Record<FloCreationKind,string>={create_bill:"/(tabs)/bills",create_debt:"/(tabs)/bills",create_income:"/(tabs)/more?section=money",create_manual_transaction:"/(tabs)/transactions",create_bucket:"/(tabs)/more?section=buckets",create_savings_goal:"/(tabs)/more?section=goals"};
const entityTypes:Record<FloCreationKind,FloCreationReceipt["entityType"]>={create_bill:"bill",create_debt:"bill",create_income:"income",create_manual_transaction:"transaction",create_bucket:"goal",create_savings_goal:"goal"};
const isUuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const object=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==="object"&&!Array.isArray(v));
function scalarFields(v:unknown,maxBytes=12000):v is Record<string,unknown>{return object(v)&&Object.keys(v).length<=20&&new TextEncoder().encode(JSON.stringify(v)).length<=maxBytes&&Object.values(v).every(value=>typeof value==="boolean"||typeof value==="number"&&Number.isFinite(value)||typeof value==="string"&&value.length<=2000);}
export function isFloCreationReceipt(v:unknown):v is FloCreationReceipt {
 if(!object(v)||Object.keys(v).some(k=>!["commandId","householdId","kind","entityId","entityType","title","route","createdAt"].includes(k)))return false;
 const r=v as unknown as FloCreationReceipt;
 return Boolean(isUuid(r.commandId)&&isUuid(r.householdId)&&isUuid(r.entityId)&&Object.hasOwn(FLO_CREATION_ROUTES,r.kind)&&r.entityType===entityTypes[r.kind]&&r.route===FLO_CREATION_ROUTES[r.kind]&&typeof r.title==="string"&&r.title.trim()&&r.title.length<=2000&&typeof r.createdAt==="string"&&r.createdAt.length<=40&&Number.isFinite(Date.parse(r.createdAt)));
}
/** Closed parser used for stream/history/volatile state. Parsing never commits. */
export function parseFloCreationResult(value:unknown):FloCreationResult|null {
 if(!object(value)||Object.keys(value).some(k=>!["status","kind","prompt","missingFields","draft","commandId","householdId","payload","receipt","form"].includes(k)))return null;
 const v=value as unknown as FloCreationResult;
 if(!["needs_details","ready","saved","unavailable"].includes(v.status)||typeof v.prompt!=="string"||v.prompt.length>2000||!Array.isArray(v.missingFields)||v.missingFields.length>15||v.missingFields.some(k=>typeof k!=="string"||k.length>100)||v.kind!==undefined&&!Object.hasOwn(FLO_CREATION_ROUTES,v.kind))return null;
 if(v.status==="saved")return !v.payload&&!v.draft&&v.form===undefined&&isFloCreationReceipt(v.receipt)&&v.receipt.kind===v.kind&&(!v.commandId||v.commandId===v.receipt.commandId)&&(!v.householdId||v.householdId===v.receipt.householdId)?v:null;
 if(v.status==="ready"&&(!v.kind||!isUuid(v.commandId)||!isUuid(v.householdId)||!scalarFields(v.payload)))return null;
 if (v.form !== undefined) {
  if (v.status !== "needs_details" || !v.kind || !object(v.form)
   || Object.keys(v.form).some(key => !["values", "errors"].includes(key))
   || !scalarFields(v.form.values) || !scalarFields(v.form.errors)
   || Object.values(v.form.errors).some(error => typeof error !== "string" || error.length > 300)) return null;
  const fields = FLO_CREATION_FORM_FIELDS[v.kind];
  const allowed = new Set([...fields.required, ...fields.optional]);
  if ([...Object.keys(v.form.values), ...Object.keys(v.form.errors)].some(key => !allowed.has(key))) return null;
 }
 if(v.draft){const d=v.draft;if(!object(d)||Object.keys(d).some(k=>!["kind","fields","evidence","authorizationText","userText","householdId","expiresAt"].includes(k))||d.kind!==v.kind||!isUuid(d.householdId)||!scalarFields(d.fields)||!scalarFields(d.evidence)||Object.values(d.evidence).some(v=>typeof v!=="string")||typeof d.authorizationText!=="string"||d.authorizationText.length>4000||typeof d.userText!=="string"||d.userText.length>12000||!Number.isFinite(Date.parse(d.expiresAt)))return null;}
 return v;
}

/** Display summaries never alter the immutable payload or receipt title. */
export function floCreationDisplayLabel(value:string):string {const label=value.replace(/\s+/g," ").trim();return label.length>100?label.slice(0,99)+"…":label;}
