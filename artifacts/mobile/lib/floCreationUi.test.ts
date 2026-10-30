import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transpileModule, ModuleKind } from "typescript";
import { floCreationAccessMessage } from "./floPlanAccess";
import { parseFloCreationResult, FLO_CREATION_ROUTES, type FloCreationResult } from "./floCreationProtocol";
const commandId = "11111111-1111-4111-8111-111111111111", householdId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ready = (kind: "create_income" | "create_bucket" | "create_manual_transaction" = "create_income"): FloCreationResult => ({ status: "ready", kind, commandId, householdId, prompt: "Ready to add.", missingFields: [], payload: kind === "create_bucket" ? { name: "Fictional trip", target_amount: 100, target_date: "2026-11-01" } : kind === "create_manual_transaction" ? { amount: 30, direction: "expense", date: "2026-10-28", category: "Food", note: "Fictional lunch", account_id: "33333333-3333-4333-8333-333333333333" } : { name: "Fictional salary", amount: 1000, frequency: "monthly", first_date: "2026-11-01" } });
function harness(options: { demo?: boolean; edit?: boolean; text?: string; owner?: string; structured?: boolean; creationAllowed?: boolean; receipt?: FloCreationResult } = {}) {
  const source = readFileSync("app/(tabs)/flo.tsx", "utf8"), start = source.indexOf("    const seenCreationCommands ="), end = source.indexOf("    const verifiedFallback:", start); assert.ok(start > 0 && end > start);
  const state: any = { current: true, receiptReads: [], receipt: options.receipt ?? null, calls: [], refreshes: 0, creations: {}, safety: null, input: "", actions: [], error: null, saving: false, preview: [], warning: null, fail: false, held: null, owner: options.owner ?? "actor:" + householdId + ":budget-a:owner:real:edit", budgets: [] };
  const bindings: Record<string, any> = {
    requestUserId: "actor", floCreationAccessMessage, floCreationAllowedRef: { current: options.creationAllowed ?? true }, readFloCreationReceipt: async (...input: any[]) => { state.receiptReads.push(input); return state.receipt; },
    parseFloCreationResult, requestIsCurrent: () => state.current, requestCreationOwnerKey: state.owner, creationOwnerKeyRef: { get current() { return state.owner; } }, demoMode: options.demo ?? false, canEditHousehold: options.edit ?? true, requestBudgetId: "33333333-3333-4333-8333-333333333333", retryCreationRef: { current: null }, activeRequestRef: { current: 9 }, requestGeneration: 9, requestScopeKey: "actor:" + householdId, requestHouseholdId: householdId, userMessageId: commandId, assistantMessageId: "answer", clean: options.text ?? "Add the fictional record",
    creationForm: options.structured ? { kind: "create_income", fields: { name: "Salary" } } : undefined, creationFormRef: { current: options.structured ? { owner: state.owner, conversationId: null, creation: { kind: "create_income" } } : null },
    formFeedbackRevisionRef: { current: 0 }, historyEnabled: false, conversationId: null, activeConversationIdRef: { current: null }, setCreationFormSession: (value: any) => { state.formSession = value; }, setCreationFormBusy: (value: boolean) => { state.formBusy = value; }, activeCreationDraftRef: { current: null }, creationOperationRef: { current: null },
    setCreationByMessageId: (update: any) => { state.creations = update(state.creations); }, setCreationSafety: (value: any) => { state.safety = value; }, setCreationSaving: (value: boolean) => { state.saving = value; },
    commitFloCreation: async (creation: FloCreationResult, expectedBudgetId: string) => { state.budgets.push(expectedBudgetId); state.calls.push(creation); if (state.held) await state.held; if (state.fail) throw new Error("lost response"); return { status: "saved", kind: creation.kind, commandId, householdId, prompt: "Added Fictional record.", missingFields: [], receipt: { commandId, householdId, kind: creation.kind, entityId: "22222222-2222-4222-8222-222222222222", entityType: creation.kind === "create_bucket" ? "goal" : creation.kind === "create_manual_transaction" ? "transaction" : "income", title: "Fictional record", route: FLO_CREATION_ROUTES[creation.kind!], createdAt: "2026-10-28T12:00:00Z" } }; },
    dispatch: (action: any) => state.actions.push(action), retryBudgetLoad: () => { state.refreshes++; }, setChatError: (error: any) => { state.error = error; }, setRetryAllowed(value: boolean) { state.retry = value; }, settings: { safety_floor: 200, forecast_horizon_months: 6 }, getDailyBalances: () => [], buildBucketSafetyStop: () => state.warning,
    previewTransactionSafetyStop: (tx: any) => { state.preview.push(tx); return state.warning; }, setInput: (value: string) => { state.input = value; }, inputRef: { current: { focus() {} } },
  };
  const guardStart = source.indexOf("    const creationIsCurrent =");
  const guardEnd = source.indexOf("\n", guardStart);
  const code = transpileModule(source.slice(guardStart, guardEnd) + "\n" + source.slice(start, end), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const gate = new Function(...Object.keys(bindings), `let creationCommit = null; const creationReply = {current:null}; ${code}; return {run:handleCreationEvent,drain:()=>creationCommit,reply:()=>creationReply.current};`)(...Object.values(bindings));
  return { state, bindings, ...gate };
}
test("only the active explicit Send executes a matching current command and duplicate events commit once", async () => {
  for (const variant of ["stale", "inactive", "wrong-command", "wrong-household"]) {
    const h = harness(), value = ready();
    if (variant === "stale") h.state.current = false;
    if (variant === "inactive") h.bindings.activeRequestRef.current = null;
    if (variant === "wrong-command") value.commandId = "44444444-4444-4444-8444-444444444444";
    if (variant === "wrong-household") value.householdId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    h.run(value); assert.equal(h.state.calls.length, 0);
  }
  const h = harness(), value = ready(); h.run(value); h.run(value); await h.drain();
  assert.deepEqual(h.state.calls, [value]); assert.deepEqual(h.state.budgets, ["33333333-3333-4333-8333-333333333333"]); assert.equal(h.state.refreshes, 1); assert.equal(h.state.creations.answer.status, "saved"); assert.equal(h.state.saving, false);
  const source = readFileSync("app/(tabs)/flo.tsx", "utf8"); assert.equal(source.split("await commitFloCreation(").length - 1, 1); assert.match(source, /if \(event.type === "creation"\) \{\s*handleCreationEvent\(event.creation\)/); assert.match(source, /priorRequest\?\.userMessageId \?\? createFloId\(\)/);
});
test("missing details are scoped drafts; unrelated answers clear them without writing", () => {
  const h = harness(); h.run({ status: "needs_details", kind: "create_income", prompt: "What date?", missingFields: ["first_date"], draft: { kind: "create_income", fields: { name: "Fictional salary" }, evidence: { name: "Fictional salary" }, authorizationText: "Add income", userText: "Add income named Fictional salary", householdId, expiresAt: "2026-10-28T13:00:00Z" } });
  assert.equal(h.state.calls.length, 0); assert.equal(h.bindings.activeCreationDraftRef.current.scope, h.state.owner); h.run(null); assert.equal(h.bindings.activeCreationDraftRef.current, null);
});
test("canonical bucket and signed-expense safety previews defer only unsafe saves", async () => {
  const h = harness(); h.state.warning = { itemName: "Fictional", shortfall: 100 }; h.run(ready("create_bucket")); assert.equal(h.state.calls.length, 0); h.state.safety.cancel(); assert.equal(h.state.calls.length, 0); assert.equal(h.state.creations.answer, undefined); assert.equal(h.state.input, "Add the fictional record");
  const expense = harness(); expense.state.warning = { itemName: "Fictional", shortfall: 100 }; expense.run(ready("create_manual_transaction"));
  assert.deepEqual(expense.state.preview, [{ amount: -30, date: "2026-10-28", category: "Food", note: "Fictional lunch", source: "manual", account_id: "33333333-3333-4333-8333-333333333333" }]);
  const proceed = expense.state.safety.proceed; proceed(); proceed(); await expense.drain(); assert.equal(expense.state.calls.length, 1); assert.equal(expense.state.refreshes, 1);
  const stale = harness(); stale.state.warning = {}; stale.run(ready("create_bucket")); stale.state.current = false; stale.state.safety.proceed(); assert.equal(stale.state.calls.length, 0);
});
test("late RPC receipts cannot update a new scope; lost responses show uncertainty and retry", async () => {
  const h = harness(); let release!: () => void; h.state.held = new Promise<void>(resolve => { release = resolve; }); h.run(ready()); assert.equal(h.state.saving, true); h.state.current = false; release(); await h.drain(); assert.equal(h.state.refreshes, 0); assert.equal(h.state.creations.answer.status, "ready");
  const failed = harness(); failed.state.fail = true; failed.run(ready()); await failed.drain(); assert.equal(failed.state.creations.answer.status, "unavailable"); assert.equal(failed.state.refreshes, 0); assert.match(failed.state.error, /could not be verified/); assert.equal(failed.state.saving, false); assert.ok(failed.state.actions.every((action: any) => !/Added Fictional/.test(action.text ?? "")));
});

test("budget role and mode ownership changes reject delayed ready events and safety continuations", () => {
  for (const drift of ["budget-b", "viewer", "demo"]) {
    const h = harness(); h.state.owner += ":" + drift; h.run(ready()); assert.equal(h.state.calls.length, 0);
    const warning = harness(); warning.state.warning = {}; warning.run(ready("create_bucket")); const proceed = warning.state.safety.proceed; warning.state.owner += ":" + drift; proceed(); assert.equal(warning.state.calls.length, 0);
  }
  for (const options of [{ demo: true }, { edit: false }]) { const h = harness(options); h.run(ready()); assert.equal(h.state.calls.length, 0); }
});

test("explicit Retry reuses the exact canonical command after a multi-turn fragment loses its RPC response", async () => {
  const first = harness({ text: "Fictional salary $1000 monthly first date 2026-11-01" }); first.state.fail = true; first.run(ready()); await first.drain();
  const ticket = first.bindings.retryCreationRef.current;
  assert.ok(ticket); assert.equal(first.bindings.activeCreationDraftRef.current, null); assert.equal(ticket.expectedBudgetId, first.state.budgets[0]);
  const retry = harness(), source = readFileSync("app/(tabs)/flo.tsx", "utf8");
  const a = source.indexOf("      if (recovery) {"), b = source.indexOf("      if (!conversationId && historyEnabled)", a); assert.ok(a > 0 && b > a);
  const branch = transpileModule(source.slice(a, b), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const executeExplicitRetry = new Function("recovery", "run", "drain", "readReply", "requestIsCurrent", "dispatch", "assistantMessageId", `return async () => { let creationCommit = null; const creationReply = {get current(){return readReply()}}; const handleCreationEvent = value => {run(value);creationCommit=drain();}; ${branch} };`)(ticket, retry.run, retry.drain, retry.reply, () => true, retry.bindings.dispatch, "answer");
  await executeExplicitRetry();
  assert.deepEqual(retry.state.calls, [ticket.creation]); assert.equal(retry.state.calls[0].commandId, commandId); assert.deepEqual(retry.state.calls[0].payload, first.state.calls[0].payload); assert.deepEqual(retry.state.budgets, first.state.budgets); assert.equal(retry.state.creations.answer.status, "saved");
  assert.doesNotMatch(branch, /streamFloChat|createFloConversation/);
});

test("canceling a safety warning establishes the final reply before late stream text or done", () => {
  const h = harness(); h.state.warning = {}; h.run(ready("create_bucket")); h.state.safety.cancel();
  assert.match(h.reply(), /Nothing was added/); assert.equal(h.bindings.retryCreationRef.current, null); assert.equal(h.state.calls.length, 0);
  const source = readFileSync("app/(tabs)/flo.tsx", "utf8"); assert.match(source, /if \(!creationReply.current\) dispatch\(\{ type: "stream-delta"/); assert.match(source, /reply = creationReply.current \?\? event.answer\?\.answer/);
});

test("old ready history can only read a verified receipt and never executes creation", async () => {
  const live = harness(); live.run(ready()); await live.drain(); const saved = live.state.creations.answer;
  const source = readFileSync("app/(tabs)/flo.tsx", "utf8"), a = source.indexOf("async function readHistoryCreationReceipts("), b = source.indexOf("export default function FloScreen", a);
  const helper = transpileModule(source.slice(a, b), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const reads: any[] = []; const restore = new Function("readFloCreationReceipt", `${helper};return readHistoryCreationReceipts;`)(async (...args: any[]) => { reads.push(args); return saved; });
  const result = await restore([{ id: "old-answer", role: "flo", creation: ready() }], householdId, "33333333-3333-4333-8333-333333333333");
  assert.deepEqual(result, { "old-answer": saved }); assert.deepEqual(reads, [[commandId, householdId, "33333333-3333-4333-8333-333333333333"]]); assert.doesNotMatch(helper, /commitFloCreation|create_flo_entity|streamFloChat/);
  assert.deepEqual(await restore([{ id: "old-answer", role: "flo", creation: ready() }], householdId, undefined), {});
});

test("a fields-only retry before any ready event retains its captured collection draft after Stop", () => {
  const source = readFileSync("app/(tabs)/flo.tsx", "utf8"), a = source.indexOf("    const requestDraft ="), b = source.indexOf("    if (!recovery)", a);
  assert.ok(a > 0 && b > a);
  const code = transpileModule(source.slice(a, b), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const draft = { kind: "create_income", householdId, fields: { name: "Fictional salary" }, evidence: { name: "Fictional salary" }, authorizationText: "Add income", userText: "Add income named Fictional salary", expiresAt: "2026-10-28T13:00:00Z" };
  const bindings: Record<string, any> = { floCreationAllowedRef: { current: true }, submittedForm: undefined, retry: true, clean: "$1000 monthly first date 2026-11-01", creationOwnerKey: "actor:home:budget:owner:real:edit", activeCreationDraftRef: { current: null }, retryRequestRef: { current: { text: "$1000 monthly first date 2026-11-01", creationOwner: "actor:home:budget:owner:real:edit", creationDraft: draft } } };
  const selectDraft = () => new Function(...Object.keys(bindings), `${code};return creationDraft;`)(...Object.values(bindings));
  assert.deepEqual(selectDraft(), draft, "Stop cleared the active draft but the same explicit retry still has its request snapshot");
  bindings.creationOwnerKey += ":new-budget"; assert.equal(selectDraft(), undefined);
  bindings.creationOwnerKey = "actor:home:budget:owner:real:edit"; bindings.clean = "A different question"; assert.equal(selectDraft(), undefined);
  bindings.clean = "$1000 monthly first date 2026-11-01"; bindings.retry = false; assert.equal(selectDraft(), undefined);
  assert.match(source, /retryRequestRef.current = \{ text: clean, userMessageId, assistantMessageId, conversationId, creationDraft, creationForm, creationOwner: requestCreationOwnerKey \}/);
});

function observeActionOwnerHarness() {
  const source = readFileSync("app/(tabs)/flo.tsx", "utf8"), start = source.indexOf("  const creationOwnerScopeKey ="), end = source.indexOf("  const preferencesReady =", start); assert.ok(start > 0 && end > start);
  const code = transpileModule(source.slice(start, end), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const refs: any[] = []; let cursor = 0;
  const input: any = { floDataScopeKey: "actor:" + householdId, activeHousehold: { budgetId: "budget-a", role: "editor" }, demoMode: false, canEditHousehold: true, requestGenerationRef: { current: 10 }, activeRequestRef: { current: 10 }, nextFloRequestGeneration: (value: number) => value + 1, useRef: (initial: any) => { const i = cursor++; if (!refs[i]) refs[i] = { current: initial }; return refs[i]; } };
  const observe = () => { cursor = 0; return new Function(...Object.keys(input), `${code};return {key:creationOwnerKey,ref:creationOwnerKeyRef,epoch:creationOwnerEpochRef.current.epoch};`)(...Object.values(input)); };
  return { input, observe };
}

test("observed budget/role A→B→A permanently invalidates a held pre-ready request", () => {
  for (const field of ["budgetId", "role"]) {
    const observer = observeActionOwnerHarness(), a = observer.observe(); const h = harness({ owner: a.key });
    // Capture the actual request lease before either transition.
    const liveSource = readFileSync("app/(tabs)/flo.tsx", "utf8"), guardStart = liveSource.indexOf("    const creationIsCurrent ="), guardEnd = liveSource.indexOf("\n", guardStart);
    const guard = transpileModule(liveSource.slice(guardStart, guardEnd), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
    const heldIsCurrent = new Function("requestIsCurrent", "requestCreationOwnerKey", "creationOwnerKeyRef", "demoMode", "canEditHousehold", "requestBudgetId", `${guard};return creationIsCurrent;`)(() => observer.input.requestGenerationRef.current === 10, a.key, a.ref, false, true, "budget-a");
    const original = observer.input.activeHousehold[field]; observer.input.activeHousehold[field] = field === "role" ? "viewer" : "budget-b"; observer.observe(); observer.input.activeHousehold[field] = original; const returned = observer.observe();
    assert.notEqual(returned.key, a.key); assert.equal(returned.epoch, 2); assert.equal(observer.input.requestGenerationRef.current, 12); assert.equal(observer.input.activeRequestRef.current, null); assert.equal(heldIsCurrent(), false);
    h.state.owner = returned.key; h.run(ready()); assert.equal(h.state.calls.length, 0, "the delayed ready cannot enter RPC after ABA");
  }
});

test("an old submitted receipt after owner ABA neither publishes nor clears a newer save lock", async () => {
  const observer = observeActionOwnerHarness(), initial = observer.observe();
  const h = harness({ owner: initial.key }); let release!: () => void; h.state.held = new Promise<void>(resolve => { release = resolve; }); h.run(ready());
  observer.input.activeHousehold.budgetId = "budget-b"; observer.observe(); observer.input.activeHousehold.budgetId = "budget-a"; h.state.owner = observer.observe().key;
  h.bindings.creationOperationRef.current = { scope: h.state.owner, commandId: "new-command", submitted: true, settled: false }; h.state.creations = {}; h.state.saving = true;
  release(); await h.drain(); assert.equal(h.state.refreshes, 0); assert.deepEqual(h.state.creations, {}); assert.equal(h.state.saving, true, "old completion must not unlock the new owner’s save");
});

test("Cancel draft is unavailable during Send/save and a stale physical click cannot claim cancellation", () => {
  const source = readFileSync("app/(tabs)/flo.tsx", "utf8"), a = source.indexOf("  const cancelCreationDraft ="), b = source.indexOf("  const startNewConversation", a); assert.ok(a > 0 && b > a);
  const code = transpileModule(source.slice(a, b), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const draft = { fields: { name: "Fictional salary" } }, otherDraft = { fields: { name: "Other" } };
  let cards: any = { current: { draft }, old: { draft: otherDraft } };
  const bindings: Record<string, any> = { activeCreationDraftRef: { current: { scope: "owner:epoch2", draft } }, creationOperationRef: { current: null }, activeRequestRef: { current: 8 }, creationOwnerKeyRef: { current: "owner:epoch2" }, creationByMessageId: cards, creationFormRef: { current: null }, activeConversationIdRef: { current: null }, formSubmitRef: { current: null }, setCreationFormSession() {}, setCreationByMessageId: (update: any) => { cards = update(cards); } };
  const cancel = new Function(...Object.keys(bindings), `${code};return cancelCreationDraft;`)(...Object.values(bindings));
  cancel("current"); assert.equal(bindings.activeCreationDraftRef.current.draft, draft); assert.equal(cards.current.draft, draft, "active Send leaves the card intact");
  bindings.activeRequestRef.current = null; bindings.creationOperationRef.current = { submitted: true, settled: false }; cancel("current"); assert.equal(bindings.activeCreationDraftRef.current.draft, draft); assert.ok(cards.current);
  bindings.creationOperationRef.current = null; cancel("old"); assert.equal(bindings.activeCreationDraftRef.current.draft, draft, "an older card cannot cancel a newer draft");
  cancel("current"); assert.equal(bindings.activeCreationDraftRef.current, null); assert.equal(cards.current, undefined);
  assert.match(source, /status === "needs_details" && !chat.sending && !creationSaving && \(Boolean\(creationByMessageId\[message.id\].draft\) && activeCreationDraftRef.current\?\.draft === creationByMessageId\[message.id\].draft \|\| creationFormSession\?\.id === message.id\) \? \(\) => cancelCreationDraft/);
});

test("structured form unavailability is visible only to its current owned form and never enters RPC", () => {
  const result = { status: "unavailable", prompt: "I could not verify active accounts. Please try again.", missingFields: [] };
  const h = harness({ structured: true }), session = h.bindings.creationFormRef.current; h.run(result);
  assert.equal(h.state.error, result.prompt); assert.equal(h.bindings.creationFormRef.current, session); assert.deepEqual(h.state.calls, []);
  const natural = harness(); natural.run(result); assert.equal(natural.state.error, null); assert.deepEqual(natural.state.calls, []);
  const stale = harness({ structured: true }); stale.state.owner += ":new-epoch"; stale.run(result); assert.equal(stale.state.error, null);
  const otherChat = harness({ structured: true }); otherChat.bindings.activeConversationIdRef.current = "different-chat"; otherChat.run(result); assert.equal(otherChat.state.error, null);
});


test("a downgraded ready command only checks its old receipt and cannot create", async () => {
  const h = harness({ creationAllowed: false }); h.run(ready()); await h.drain();
  assert.deepEqual(h.state.calls, []); assert.equal(h.state.receiptReads.length, 1);
  assert.match(h.reply() ?? "", /Pro/); assert.equal(h.state.retry, false);
});
test("a committed creation remains replayable after downgrade without a second financial write", async () => {
  const saved: FloCreationResult = { status: "saved", prompt: "Already added.", missingFields: [], receipt: { commandId, householdId, kind: "create_income", entityId: "22222222-2222-4222-8222-222222222222", entityType: "income", title: "Salary", route: FLO_CREATION_ROUTES.create_income, createdAt: "2026-10-30T00:00:00Z" } };
  const h = harness({ creationAllowed: false, receipt: saved }); h.run(ready()); await h.drain();
  assert.deepEqual(h.state.calls, []); assert.equal(h.state.receiptReads.length, 1); assert.equal(h.state.creations.answer.status, "saved");
});

test("read-only Free chat rejects an incoming creation draft without opening a form or financial dispatch",()=>{
 const h=harness({creationAllowed:false});
 h.run({status:"needs_details",kind:"create_income",prompt:"What date?",missingFields:["first_date"],draft:{kind:"create_income",fields:{name:"Salary"},evidence:{name:"Salary"},authorizationText:"Add income",userText:"Add income named Salary",householdId,expiresAt:"2026-10-30T13:00:00Z"}});
 assert.equal(h.state.formSession,null);assert.equal(h.bindings.activeCreationDraftRef.current,null);assert.deepEqual(h.state.calls,[]);assert.deepEqual(h.state.receiptReads,[]);assert.match(h.reply(),/Pro/);assert.equal(h.state.creations.answer.status,"unavailable");
});
function proposalHarness(){
 const source=readFileSync("app/(tabs)/flo.tsx","utf8"),a=source.indexOf("  const openProposalReview ="),b=source.indexOf("  const searchHistory =",a);assert.ok(a>0&&b>a);
 const code=transpileModule(source.slice(a,b),{compilerOptions:{module:ModuleKind.CommonJS}}).outputText;
 const proposal={id:"proposal-a",kind:"recurring_bill_change",status:"review",payload:{expectedAmount:10,newAmount:12}};
 const state:any={review:null,phase:"idle",error:"",receipt:null,writes:0,refreshes:0,published:0,holdRead:null,holdWrite:null};
 const bindings:any={creationOwnerKey:"actor:home:budget:owner:0",creationOwnerKeyRef:{current:"actor:home:budget:owner:0"},proposalReviewOwnerRef:{current:null},activeConversationIdRef:{current:"chat-a"},floCreationAllowedRef:{current:true},user:{id:"actor"},canEditHousehold:true,floCreationAccessMessage,
  setProposalConfirmState:(value:any)=>{state.phase=value;state.published++;},setProposalConfirmError:(value:any)=>{state.error=value;state.published++;},setProposalReceipt:(value:any)=>{state.receipt=value;state.published++;},setReviewProposal:(value:any)=>{state.review=value;state.published++;},setChatError:(value:any)=>{state.error=value;state.published++;},setConfirmedProposalIds:(value:any)=>{value(new Set());state.published++;},retryBudgetLoad:()=>state.refreshes++,
  readAuthoritativeFloProposal:async()=>{if(state.holdRead)await state.holdRead;return proposal;},floProposalMatchesAuthoritative:()=>true,
  confirmFloRecurringBillProposal:async(_id:string,scope:any)=>{assert.equal(scope.userId,"actor");assert.equal(scope.isCurrent(),true);state.writes++;if(state.holdWrite)await state.holdWrite;return {previousAmount:10,newAmount:12};},
 };
 const handlers=()=>new Function(...Object.keys(bindings),"reviewProposal","proposalReceipt","proposalConfirmState",`${code};return {open:openProposalReview,confirm:confirmProposal};`)(...Object.values(bindings),state.review,state.receipt,state.phase);
 const open=async()=>{handlers().open(proposal);await new Promise<void>(resolve=>setImmediate(resolve));};
 return {state,bindings,handlers,open};
}
test("late proposal review never reopens after owner ABA",async()=>{
 const h=proposalHarness();let release!:()=>void;h.state.holdRead=new Promise<void>(r=>{release=r;});h.handlers().open({id:"proposal-a",kind:"recurring_bill_change"});
 h.bindings.creationOwnerKeyRef.current="actor:home:budget:owner:2";const before=h.state.published;release();await new Promise<void>(r=>setImmediate(r));assert.equal(h.state.published,before);assert.equal(h.state.review,null);
});
test("proposal confirmation rechecks owner and creation capability after authoritative review",async()=>{
 for(const transition of ["owner","capability","conversation"]){
  const h=proposalHarness();await h.open();let release!:()=>void;h.state.holdRead=new Promise<void>(r=>{release=r;});const pending=h.handlers().confirm();
  if(transition==="owner")h.bindings.creationOwnerKeyRef.current="actor:home:budget:owner:2";
  if(transition==="capability")h.bindings.floCreationAllowedRef.current=false;
  if(transition==="conversation")h.bindings.activeConversationIdRef.current="chat-b";
  const before=h.state.published;release();await pending;assert.equal(h.state.writes,0);assert.equal(h.state.receipt,null);assert.equal(h.state.refreshes,0);
  if(transition==="capability")assert.match(h.state.error,/Pro/);else assert.equal(h.state.published,before);
 }
});
test("a late proposal receipt cannot publish across owner changes, while current duplicate confirmation dispatches once",async()=>{
 const h=proposalHarness();await h.open();let release!:()=>void;h.state.holdWrite=new Promise<void>(r=>{release=r;});const pending=h.handlers().confirm();await new Promise<void>(r=>setImmediate(r));assert.equal(h.state.writes,1);
 h.bindings.creationOwnerKeyRef.current="actor:home:budget:owner:2";const before=h.state.published;release();await pending;assert.equal(h.state.published,before);assert.equal(h.state.receipt,null);assert.equal(h.state.refreshes,0);
 const current=proposalHarness();await current.open();const handlers=current.handlers();await Promise.all([handlers.confirm(),handlers.confirm()]);assert.equal(current.state.writes,1);assert.equal(current.state.refreshes,1);assert.equal(current.state.receipt.newAmount,12);
});
