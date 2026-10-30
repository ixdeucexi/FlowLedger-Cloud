import { revealedPrivacyBindings, revealedPrivacyModule } from "./privacyTestHarness";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";
import { parseStatementCsv } from "./accounts";

const csv = "Date,Description,Amount\n2026-10-26,Fictional purchase,-25";
const accounts = Array.from({ length: 5 }, (_, i) => ({ id: `account-${i + 1}`, name: i < 2 ? "Shared name" : `Account ${i + 1}`, account_type: i === 1 ? "savings" : "checking", current_balance: 100 + i, is_active: true }));
function harness(options: { platform?: string; content?: string; pick?: () => Promise<any>; afterRead?: () => void; afterParse?: () => void; persist?: () => Promise<any>; httpOk?: boolean } = {}) {
  const state = { open: false, busy: false, feedback: null as any, picks: 0, reads: 0, saves: [] as any[] };
  const scope = { current: { key: "actor/household/budget", revision: 1, canEdit: true } };
  const accountRef = { current: accounts.map(account => ({ ...account })) };
  const mounted = { current: true }, draft = { current: null as any }, inFlight = { current: false };
  const source = readFileSync("app/(tabs)/more.tsx", "utf8"), start = source.indexOf("  const readPickedFile =");
  const body = source.slice(start, source.indexOf("  const handleResetFlo =", start));
  const read = async () => { state.reads++; options.afterRead?.(); return options.content ?? csv; };
  const bindings = revealedPrivacyBindings({
    statementImportScopeRef: scope, statementImportDraftScopeRef: draft, statementImportAccountsRef: accountRef,
    statementImportMountedRef: mounted, statementImportInFlightRef: inFlight,
    setStatementImportOpen: (value: boolean) => { state.open = value; }, setStatementImportBusy: (value: boolean) => { state.busy = value; }, setStatementImportFeedback: (value: any) => { state.feedback = value; },
    DocumentPicker: { getDocumentAsync: async () => { state.picks++; return options.pick ? options.pick() : { canceled: false, assets: [{ uri: "fictional.csv" }] }; } },
    Platform: { OS: options.platform ?? "web" }, fetch: async () => ({ ok: options.httpOk !== false, text: read }), FileSystem: { readAsStringAsync: read },
    parseStatementCsv: (content: string, id: string) => { const rows = parseStatementCsv(content, id); options.afterParse?.(); return rows; },
    importStatementTransactions: async (accountId: string, rows: unknown[]) => { state.saves.push({ accountId, rows }); return options.persist ? options.persist() : { imported: rows.length, duplicates: 0 }; },
  });
  const js = transpileModule(body, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const handlers = new Function(...Object.keys(bindings), `${js}; return { handleStatementImport, importStatementFor, cancelStatementImport };`)(...Object.values(bindings));
  return { ...handlers, state, scope, accountRef, mounted, draft, inFlight };
}

test("statement selection reaches the fifth active account on web and native without an Alert", async () => {
  for (const platform of ["web", "android"]) {
    const h = harness({ platform }); h.handleStatementImport();
    assert.equal(h.state.open, true); assert.equal(h.state.picks, 0);
    await h.importStatementFor("account-5");
    assert.equal(h.state.saves.length, 1); assert.equal(h.state.saves[0].accountId, "account-5");
    assert.deepEqual(h.state.saves[0].rows, parseStatementCsv(csv, "account-5"));
    assert.match(h.state.feedback.message, /1 new transaction added/); assert.equal(h.state.open, false); assert.equal(h.inFlight.current, false);
  }
});

test("one flight covers both file selection and persistence and ignores duplicate taps or cancellation while busy", async () => {
  let pick!: (value: any) => void, save!: (value: any) => void;
  const picked = new Promise<any>(resolve => { pick = resolve; }), persisted = new Promise<any>(resolve => { save = resolve; });
  const h = harness({ pick: () => picked, persist: () => persisted }); h.handleStatementImport();
  const first = h.importStatementFor("account-5"); await h.importStatementFor("account-4"); h.handleStatementImport(); h.cancelStatementImport();
  assert.equal(h.state.picks, 1); assert.equal(h.state.open, true); assert.equal(h.state.busy, true);
  pick({ assets: [{ uri: "fictional.csv" }] }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.saves.length, 1); await h.importStatementFor("account-3"); assert.equal(h.state.picks, 1);
  save({ imported: 1, duplicates: 2 }); await first;
  assert.equal(h.state.busy, false); assert.match(h.state.feedback.message, /2 duplicates were skipped/);
});

test("chooser/file cancellation, empty data and unreadable HTTP files do not write and release the guard", async () => {
  for (const kind of ["chooser", "file", "empty", "http"]) {
    const h = harness({ pick: kind === "file" ? async () => ({ canceled: true }) : undefined, content: kind === "empty" ? "" : undefined, httpOk: kind !== "http" });
    h.handleStatementImport();
    if (kind === "chooser") h.cancelStatementImport(); else await h.importStatementFor("account-5");
    assert.equal(h.state.saves.length, 0); assert.equal(h.inFlight.current, false); assert.equal(h.state.busy, false);
    if (kind === "chooser") { assert.equal(h.state.open, false); assert.equal(h.state.picks, 0); }
    if (kind === "file") assert.match(h.state.feedback.message, /No file selected/);
    if (kind === "empty") assert.match(h.state.feedback.message, /No transactions found/);
    if (kind === "http") { assert.equal(h.state.reads, 0); assert.match(h.state.feedback.message, /file could not be read/); }
  }
});

test("failed persistence retains the chooser and readable feedback for a successful retry without claiming no changes", async () => {
  let failed = true;
  const h = harness({ persist: async () => { if (failed) throw new Error("Connection lost"); return { imported: 0, duplicates: 1 }; } });
  h.handleStatementImport(); await h.importStatementFor("account-5");
  assert.equal(h.state.open, true); assert.equal(h.state.busy, false); assert.match(h.state.feedback.message, /Import failed.*Connection lost/); assert.doesNotMatch(h.state.feedback.message, /not changed|unchanged/);
  failed = false; await h.importStatementFor("account-5");
  assert.equal(h.state.saves.length, 2); assert.match(h.state.feedback.message, /0 new transactions added.*1 duplicate was skipped/); assert.equal(h.state.open, false);
});

test("no active accounts and viewers cannot open the chooser or start a file picker", () => {
  for (const kind of ["none", "viewer"]) {
    const h = harness();
    if (kind === "none") h.accountRef.current = h.accountRef.current.map((account: typeof accounts[number]) => ({ ...account, is_active: false })); else h.scope.current.canEdit = false;
    h.handleStatementImport(); assert.equal(h.state.open, false); assert.equal(h.state.picks, 0); assert.equal(h.state.saves.length, 0);
    assert.match(h.state.feedback.message, kind === "none" ? /Add an active account first/ : /Only household editors/);
  }
});

test("captured actor/household/budget/edit revision and active account are revalidated before selection, after read and before save", async () => {
  for (const stage of ["beforePick", "afterRead", "afterParse"]) for (const kind of ["actor", "household", "budget", "revoke", "roundTrip", "inactive", "unmount"]) {
    let h: ReturnType<typeof harness>;
    const change = () => {
      if (kind === "inactive") h.accountRef.current = h.accountRef.current.map((account: typeof accounts[number]) => account.id === "account-5" ? { ...account, is_active: false } : account);
      else if (kind === "unmount") h.mounted.current = false;
      else if (kind === "revoke") h.scope.current.canEdit = false;
      else if (kind === "roundTrip") h.scope.current.revision += 2;
      else h.scope.current.key = `${kind}-changed`;
    };
    h = harness({ afterRead: stage === "afterRead" ? change : undefined, afterParse: stage === "afterParse" ? change : undefined }); h.handleStatementImport();
    if (stage === "beforePick") change();
    await h.importStatementFor("account-5");
    assert.equal(h.state.saves.length, 0, `${stage}/${kind}`); assert.equal(h.inFlight.current, false);
    if (stage === "beforePick") assert.equal(h.state.picks, 0);
    if (kind !== "unmount") assert.match(h.state.feedback.message, /changed|no longer active/);
  }
});

function flatten(node: any): any[] { return Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === "object" ? [node, ...flatten(node.props?.children)] : []; }
function content(node: any): string { return Array.isArray(node) ? node.map(content).join(" ") : node && typeof node === "object" ? content(node.props?.children) : typeof node === "string" ? node : ""; }
function panelHarness() {
  const exported: any = {}, state: any[] = []; let cursor = 0;
  const react = { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }) };
  const hooks = { __esModule: true, default: react, useState: (initial: any) => { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], (value: any) => { state[i] = value; }]; }, useMemo: (fn: () => any) => { cursor++; return fn(); }, useEffect() {} };
  const props: any = { open: true, canEdit: true, busy: false, accounts: [...accounts, { ...accounts[0], id: "inactive", name: "Hidden inactive", is_active: false }], feedback: null, onSelect() {}, onCancel() {} };
  const js = transpileModule(readFileSync("components/StatementImportPanel.tsx", "utf8"), { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.React, esModuleInterop: true } }).outputText;
  new Function("exports", "require", js)(exported, (name: string) => revealedPrivacyModule(name) ?? (name === "react" ? hooks : name === "react-native" ? { ...Object.fromEntries(["View", "Text", "Pressable", "ScrollView", "TextInput"].map(value => [value, value])), StyleSheet: { create: (value: any) => value } } : name.endsWith("useColors") ? { useColors: () => new Proxy({}, { get: () => "#000000" }) } : {}));
  return { props, render: () => { cursor = 0; return exported.StatementImportPanel(props); } };
}

test("actual account chooser lists every active account, distinguishes duplicates, filters accessibly and disables writes while busy", () => {
  const h = panelHarness(); let tree = h.render();
  const choices = () => flatten(tree).filter(node => node.type === "Pressable" && node.props.accessibilityLabel?.startsWith("Import statement to"));
  assert.equal(choices().length, 5); assert.doesNotMatch(content(tree), /Hidden inactive/);
  assert.match(choices()[0].props.accessibilityLabel, /Checking.*Account 1/); assert.match(choices()[1].props.accessibilityLabel, /Savings.*Account 2/);
  let selected = ""; h.props.onSelect = (id: string) => { selected = id; };
  flatten(tree).find(node => node.type === "TextInput").props.onChangeText("Account 5"); tree = h.render(); assert.equal(choices().length, 1); choices()[0].props.onPress(); assert.equal(selected, "account-5");
  flatten(tree).find(node => node.type === "TextInput").props.onChangeText("missing"); tree = h.render(); assert.match(content(tree), /No matching accounts/);
  flatten(tree).find(node => node.type === "TextInput").props.onChangeText(""); h.props.busy = true; tree = h.render(); assert.ok(choices().every(node => node.props.disabled));
  h.props.canEdit = false; tree = h.render(); assert.equal(choices().length, 0); assert.match(content(tree), /Only household editors/);
});

test("a household switch during an already-started save cannot publish another household's success or server error", async () => {
  for (const failure of [false, true]) {
    let finish!: () => void;
    const pending = new Promise<any>((resolve, reject) => { finish = () => failure ? reject(new Error("Previous-household server error")) : resolve({ imported: 1, duplicates: 0 }); });
    const h = harness({ persist: () => pending }); h.handleStatementImport();
    const saving = h.importStatementFor("account-5"); await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.state.saves.length, 1);
    h.scope.current = { key: "new-household", revision: 2, canEdit: true };
    finish(); await saving;
    assert.notEqual(h.state.feedback?.kind, "success"); assert.doesNotMatch(h.state.feedback?.message ?? "", /Previous-household server error|not changed|unchanged/);
    if (failure) assert.match(h.state.feedback.message, /household or editing access changed/);
    assert.equal(h.inFlight.current, false);
  }
});
