import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transpileModule, ModuleKind } from "typescript";
import { floConversationContext } from "./floExperience";
import { reduceFloChat, type FloChatState } from "./floPolicy";

test("actual v4 body carries optional bounded temporary context and retains the omitted contract", () => {
  const exports: Record<string, any> = {};
  const js = transpileModule(readFileSync("lib/floChat.ts", "utf8"), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  new Function("exports", "require", js)(exports, () => ({}));
  const input = { householdId: "h", text: "What is its balance?", timezone: "UTC", userMessageId: "u", assistantMessageId: "a", historyEnabled: false };
  const context = [{ role: "user", content: "What is my Cedar balance?" }, { role: "assistant", content: "Recorded balance was checked." }];
  assert.deepEqual(exports.floChatRequestBody("v4", input), { version: 4, householdId: "h", question: input.text, commandId: "u", timezone: "UTC" });
  assert.deepEqual(exports.floChatRequestBody("v4", { ...input, conversationContext: context }), { version: 4, householdId: "h", question: input.text, commandId: "u", timezone: "UTC", conversationContext: context });
  assert.equal(exports.floChatRequestBody("v3", input).historyEnabled, false);
});

test("only successful terminal completion admits both sides; deltas failures stopped replies and retry placeholders stay out", () => {
  let state: FloChatState = reduceFloChat({ messages: [], sending: false }, { type: "submit", id: "u", assistantId: "a", text: "Cedar balance?" });
  state = reduceFloChat(state, { type: "stream-delta", id: "a", delta: "Unfinished amount" });
  assert.deepEqual(floConversationContext(state.messages), []);
  state = reduceFloChat(state, { type: "replace", id: "a", text: "Final checked answer" });
  assert.deepEqual(floConversationContext(state.messages), []);
  const completed = reduceFloChat(state, { type: "complete", id: "a", userId: "u" });
  assert.deepEqual(floConversationContext(completed.messages).map(turn => turn.role), ["user", "assistant"]);
  assert.deepEqual(floConversationContext(completed.messages, ["u", "a"]), []);
  const switching = reduceFloChat(completed, { type: "submit", id: "switch-u", assistantId: "switch-a", text: "Reserve 2 balance?" });
  const interrupted = reduceFloChat(switching, { type: "stream-delta", id: "switch-a", delta: "Incomplete Reserve answer" });
  assert.deepEqual(floConversationContext(reduceFloChat(interrupted, { type: "stop" }).messages), [], "a failed account switch blocks an old account antecedent");
  assert.equal(floConversationContext(interrupted.messages, ["switch-u", "switch-a"]).length, 2, "retry can retain the earlier successful pair");
  const retried = reduceFloChat(completed, { type: "submit", id: "u", assistantId: "a", text: "Cedar balance?" });
  assert.deepEqual(floConversationContext(retried.messages), []);
  const failed = reduceFloChat(retried, { type: "replace", id: "a", text: "Response stopped before verification" });
  assert.deepEqual(floConversationContext(reduceFloChat(failed, { type: "stop" }).messages), []);
  assert.deepEqual(floConversationContext(reduceFloChat(completed, { type: "hydrate", messages: [] }).messages), []);
});

test("preview reset and stream callbacks guard generations and user-household scope before accepting context", () => {
  const source = readFileSync("app/(tabs)/flo.tsx", "utf8");
  const reset = source.slice(source.indexOf("const startNewConversation"), source.indexOf("const selectConversation"));
  assert.match(reset, /activeRequestRef.current = null/);assert.match(reset, /setLastPrompt\(""\)/);assert.match(reset, /retryRequestRef.current = null/);assert.match(reset, /messages: \[\]/);
  assert.doesNotMatch(reset, /if \(activeRequestRef.current !== null/);
  assert.match(source, /requestScopeKey === floDataScopeKeyRef.current/);
  assert.match(source, /chatScopeKey !== floDataScopeKey/);
  assert.match(source, /accessibilityLabel="New chat"/);
  assert.match(source, /completedAnswer && reply.trim\(\)/);
});

test("opening Flo from the floating shortcut carries context without asking a question", () => {
  const launcher = readFileSync("components/FloLauncher.tsx", "utf8");
  const launch = launcher.slice(launcher.indexOf('router.push({'), launcher.indexOf('} as never);', launcher.indexOf('router.push({')));
  assert.match(launch, /sourceRoute: pathname/);
  assert.match(launch, /entityType: context.entityType/);
  assert.doesNotMatch(launch, /prompt\s*:|promptId\s*:|send\(/);
});

test("explicit route questions only prefill once per scope and prompt and never replace a typed draft", () => {
  const source = readFileSync("app/(tabs)/flo.tsx", "utf8");
  const start = source.indexOf("  // Route context can suggest a draft.");
  const end = source.indexOf("  const composerBottom", start);
  assert.ok(start > 0 && end > start);
  const effect = transpileModule(source.slice(start, end), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  let input = "";
  const bindings: Record<string, any> = {
    params: { prompt: "Which bills are due next?", promptId: "explicit-1" },
    user: { id: "actor-a" }, activeHousehold: { householdId: "home-a" },
    floDataScopeKey: "actor-a:home-a", chatScopeKey: "actor-a:home-a", floAccessLocked: false, historyBusy: false,
    handledPromptRef: { current: null }, consumedRoutePromptsRef: { current: new Set<string>() },
    setInput: (next: (current: string) => string) => { input = next(input); },
    useEffect: (callback: () => void) => callback(),
    send: () => { throw new Error("A route must never send"); },
    createFloConversation: () => { throw new Error("A route must never create history"); },
    setAiConsentPrompt: () => { throw new Error("A route must never request consent"); },
  };
  const run = () => new Function(...Object.keys(bindings), effect)(...Object.values(bindings));
  run(); assert.equal(input, "Which bills are due next?");
  input = "My own question"; run(); assert.equal(input, "My own question");
  bindings.params = { prompt: "How is my debt payoff going?", promptId: "explicit-2" };
  run(); assert.equal(input, "My own question");
  input = ""; run(); assert.equal(input, "", "a consumed link cannot refill after the user clears it");
  bindings.params.promptId = "explicit-3"; run(); assert.equal(input, "How is my debt payoff going?");
  input = ""; bindings.floDataScopeKey = "actor-a:home-b"; run(); assert.equal(input, "", "wait for scope hydration");
  bindings.chatScopeKey = "actor-a:home-b"; run(); assert.equal(input, "How is my debt payoff going?");
  input = ""; bindings.floDataScopeKey = "actor-a:home-a"; bindings.chatScopeKey = "actor-a:home-a"; run();
  assert.equal(input, "", "returning to a scope cannot resurrect the already consumed prompt");
  assert.doesNotMatch(effect, /\bsend\(|setAiConsentPrompt|createFloConversation/);
});
