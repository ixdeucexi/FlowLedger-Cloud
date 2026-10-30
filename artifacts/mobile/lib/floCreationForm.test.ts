import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transpileModule, ModuleKind, JsxEmit } from "typescript";
import {
  FLO_FORM_FIELDS,
  FLO_FORM_TITLES,
  floFormInitialValues,
  floFormInitialDraft,
  floFormAccounts,
  validateFloForm,
  type FloFormValues,
  type FloFormDraft,
} from "./floCreationForm";
import { revealedPrivacyModule } from "./privacyTestHarness";
import {
  FLO_CREATION_FORM_FIELDS,
  type FloCreationKind,
  type FloCreationResult,
} from "./floCreationProtocol";
const account = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Fictional checking",
  account_type: "checking",
  is_active: true,
};
const values: Record<FloCreationKind, FloFormValues> = {
  create_bill: {
    name: "Internet",
    amount: "1,200.50",
    frequency: "monthly",
    first_date: "2026-11-01",
  },
  create_debt: {
    name: "Card",
    balance: "0",
    minimum_payment: "50",
    apr: "0",
    frequency: "monthly",
    first_date: "2026-11-01",
  },
  create_income: {
    name: "Salary",
    amount: "500",
    frequency: "biweekly",
    first_date: "2026-11-06",
  },
  create_manual_transaction: {
    note: "Cafe lunch",
    amount: "25",
    direction: "expense",
    date: "2026-10-28",
    category: "Food",
    account_id: account.id,
  },
  create_bucket: {
    name: "Holiday",
    target_amount: "300",
    target_date: "2026-12-25",
  },
  create_savings_goal: {
    name: "Reserve",
    target_amount: "2,000",
    current_amount: "",
    target_date: "2027-01-01",
  },
};
test("all six labeled forms produce closed canonical fields without inferring omitted dates, APR, or recurrence", () => {
  for (const kind of Object.keys(values) as FloCreationKind[]) {
    const result = validateFloForm(kind, values[kind], [account]);
    assert.deepEqual(result.errors, {});
    assert.equal(result.input.kind, kind);
    const allowed = [
      ...FLO_CREATION_FORM_FIELDS[kind].required,
      ...FLO_CREATION_FORM_FIELDS[kind].optional,
    ];
    assert.ok(
      Object.keys(result.input.fields).every((key) => allowed.includes(key)),
    );
    assert.ok(
      FLO_FORM_FIELDS[kind].every((field) => allowed.includes(field.key)),
    );
  }
  assert.equal(
    validateFloForm("create_bill", values.create_bill, [account]).input.fields
      .amount,
    1200.5,
  );
  assert.equal(
    validateFloForm("create_debt", values.create_debt, [account]).input.fields
      .apr,
    0,
  );
  assert.equal(
    validateFloForm("create_savings_goal", values.create_savings_goal, [
      account,
    ]).input.fields.current_amount,
    undefined,
  );
  const once = validateFloForm(
    "create_bill",
    { ...values.create_bill, is_recurring: false, frequency: "" },
    [account],
  );
  assert.deepEqual(once.errors, {});
  assert.equal(once.input.fields.frequency, "monthly");
  assert.equal(once.input.fields.is_recurring, false);
});
test("invalid full fields fail visibly; unknown frequency, direction, account and date never default", () => {
  for (const amount of ["-1", "12,34", "1.001", "1000000000", ""])
    assert.ok(
      validateFloForm("create_income", { ...values.create_income, amount }, [
        account,
      ]).errors.amount,
    );
  for (const date of ["2026-02-30", "0000-01-01", "11/1/2026", ""])
    assert.ok(
      validateFloForm(
        "create_income",
        { ...values.create_income, first_date: date },
        [account],
      ).errors.first_date,
    );
  for (const apr of ["", "-1", "100.0001", "1.12345"])
    assert.ok(
      validateFloForm("create_debt", { ...values.create_debt, apr }, [account])
        .errors.apr,
    );
  assert.ok(
    validateFloForm(
      "create_income",
      { ...values.create_income, frequency: "" },
      [account],
    ).errors.frequency,
  );
  assert.ok(
    validateFloForm(
      "create_income",
      { ...values.create_income, frequency: "quarterly" },
      [account],
    ).errors.frequency,
  );
  assert.ok(
    validateFloForm(
      "create_manual_transaction",
      { ...values.create_manual_transaction, direction: "" },
      [account],
    ).errors.direction,
  );
  assert.ok(
    validateFloForm(
      "create_manual_transaction",
      values.create_manual_transaction,
      [{ ...account, is_active: false }],
    ).errors.account_id,
  );
  assert.deepEqual(
    floFormAccounts([
      account,
      { ...account, id: "inactive", is_active: false },
      { ...account, id: "credit", account_type: "credit_card" },
    ]),
    [account],
  );
});
test("known values prefill; server-rejected raw text overrides only its own fields and is retained exactly", () => {
  const creation = {
    status: "needs_details",
    kind: "create_income",
    prompt: "Check amount",
    missingFields: ["amount"],
    draft: {
      fields: {
        name: "Salary",
        amount: 500,
        frequency: "monthly",
        account_name: "Never infer this",
      },
    },
    form: {
      values: { amount: "-500.001", first_date: "2026-02-30" },
      errors: { amount: "Check amount" },
    },
  } as unknown as FloCreationResult;
  assert.deepEqual(floFormInitialValues(creation), {
    name: "Salary",
    amount: "-500.001",
    frequency: "monthly",
    first_date: "2026-02-30",
  });
});

function componentHarness(
  kind: FloCreationKind,
  initial = values[kind],
  platform = "web",
  retained?: { initialDraft?: FloFormDraft; onDraftChange?: (draft: FloFormDraft) => void },
) {
  const state: any[] = [],
    refs: any[] = [],
    effects: Array<() => any> = [];
  let stateIndex = 0,
    refIndex = 0;
  const events: any = {
    saves: [],
    close: 0,
    safetyBack: 0,
    scroll: [],
    focus: [],
    historyBack: null,
    held: null,
    fail: false,
  };
  const props: any = {
    creation: {
      status: "needs_details",
      kind,
      prompt: "Complete details",
      missingFields: [],
      form: { values: initial, errors: {} },
    },
    visible: true,
    suspended: false,
    busy: false,
    accounts: [account],
    onClose: () => events.close++,
    onBackFromSafety: () => events.safetyBack++,
    onSave: async (input: any) => {
      events.saves.push(input);
      if (events.held) await events.held;
      if (events.fail) throw new Error("Fictional network error");
    },
    ...retained,
  };
  const React = {
    createElement: (type: any, p: any, ...children: any[]) => {
      if (type === "TextInput" && typeof p?.ref === "function")
        p.ref({ focus: () => events.focus.push(p.accessibilityLabel) });
      if (type === "ScrollView" && p?.ref)
        p.ref.current = {
          scrollTo: (position: any) => events.scroll.push(position),
        };
      return { type, props: { ...p, children } };
    },
  };
  const exports: any = {};
  const source = readFileSync("components/FloCreationForm.tsx", "utf8");
  const js = transpileModule(source, {
    compilerOptions: {
      module: ModuleKind.CommonJS,
      jsx: JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
  const requireMock = (name: string) =>
    revealedPrivacyModule(name) ?? (name === "react"
      ? {
          __esModule: true,
          default: React,
          useState: (initial: any) => {
            const i = stateIndex++;
            if (!(i in state))
              state[i] = typeof initial === "function" ? initial() : initial;
            return [
              state[i],
              (next: any) => {
                state[i] = typeof next === "function" ? next(state[i]) : next;
              },
            ];
          },
          useRef: (initial: any) => {
            const i = refIndex++;
            return refs[i] ?? (refs[i] = { current: initial });
          },
          useMemo: (fn: any) => fn(),
          useEffect: (fn: any) => effects.push(fn),
        }
      : name === "react-native"
        ? {
            Platform: { OS: platform },
            Modal: "Modal",
            Pressable: "Pressable",
            ScrollView: "ScrollView",
            Text: "Text",
            TextInput: "TextInput",
            View: "View",
            StyleSheet: { create: (value: any) => value },
          }
        : name.endsWith("useColors")
          ? { useColors: () => new Proxy({}, { get: () => "#123456" }) }
          : name.endsWith("useDesktopExperience")
            ? { useDesktopExperience: () => false }
            : name === "react-native-safe-area-context"
              ? { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }
              : name.endsWith("floCreationForm")
                ? {
                    floFormAccounts,
                    floFormInitialValues,
                    floFormInitialDraft,
                    FLO_FORM_FIELDS,
                    FLO_FORM_TITLES,
                    validateFloForm,
                  }
                : name.endsWith("simulatorEditorHistory")
                  ? {
                      createSimulatorEditorHistory: (
                        _host: any,
                        onBack: any,
                      ) => {
                        events.historyBack = onBack;
                        return { dispose() {} };
                      },
                    }
                  : {});
  new Function(
    "exports",
    "require",
    "window",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    js,
  )(
    exports,
    requireMock,
    { addEventListener() {}, removeEventListener() {} },
    (fn: any) => {
      fn();
      return 1;
    },
    () => {},
  );
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    effects.length = 0;
    return exports.FloCreationForm(props);
  };
  return { props, events, effects, render };
}
const flatten = (node: any): any[] =>
  Array.isArray(node)
    ? node.flatMap(flatten)
    : node && typeof node === "object"
      ? [node, ...flatten(node.props?.children)]
      : [];
const text = (node: any): string =>
  Array.isArray(node)
    ? node.map(text).join(" ")
    : node && typeof node === "object"
      ? text(node.props?.children)
      : typeof node === "string"
        ? node
        : "";

function draftOwnerHarness() {
  const source = readFileSync("app/(tabs)/flo.tsx", "utf8");
  const start = source.indexOf("  const retainCreationFormDraft =");
  const end = source.indexOf("  const closeCreationForm =", start);
  assert.ok(start > 0 && end > start);
  const session: any = {
    id: "command-a", revision: 1, owner: "actor:home:budget:epoch0",
    conversationId: "conversation-a", open: true,
  };
  const bindings: Record<string, any> = {
    creationFormRef: { current: session },
    creationOwnerKeyRef: { current: session.owner },
    activeConversationIdRef: { current: session.conversationId },
    setCreationFormSession: (update: any) => {
      bindings.creationFormRef.current = update(bindings.creationFormRef.current);
    },
  };
  const code = transpileModule(source.slice(start, end), {
    compilerOptions: { module: ModuleKind.CommonJS },
  }).outputText;
  const retain = new Function(...Object.keys(bindings), `${code};return retainCreationFormDraft;`)(...Object.values(bindings));
  return { bindings, session, retain };
}

test("private Flo removes every form field while all six actual creation drafts survive unmount and reveal", async () => {
  const source = readFileSync("app/(tabs)/flo.tsx", "utf8");
  const start = source.indexOf("  if (moneyPrivacy.hidden) {");
  const end = source.indexOf("  if (floAccessLocked)", start);
  const hiddenCode = transpileModule(source.slice(start, end), {
    compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.React },
  }).outputText;
  const privateScreen = new Function("moneyPrivacy", "React", "View", "Text", "PremiumBackdrop", "FloLogo", "MoneyPrivacyToggle", "styles", "colors", hiddenCode);
  const React = { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }) };
  for (const kind of Object.keys(values) as FloCreationKind[]) {
    const owner = draftOwnerHarness();
    const onDraftChange = (draft: FloFormDraft) => owner.retain("command-a", 1, draft);
    const h = componentHarness(kind, values[kind], "web", { onDraftChange });
    let tree = h.render();
    const field = (label: string) => flatten(tree).find(node => node.props?.accessibilityLabel === label);
    for (const definition of FLO_FORM_FIELDS[kind]) {
      if (["text", "money", "apr"].includes(definition.type)) {
        field(definition.label).props.onChangeText(definition.type === "money" ? "4777.77" : definition.type === "apr" ? "12.3456" : "Edited draft");
      } else if (definition.type === "date") {
        field(`Type ${definition.label.toLowerCase()}`).props.onPress();
        tree = h.render();
        field(definition.label).props.onChangeText("2027-02-28");
      } else if (definition.type === "frequency") {
        field("Monthly").props.onPress();
      } else if (definition.type === "direction") {
        field("Money in").props.onPress();
      } else if (definition.type === "account") {
        field(`${account.name}, checking`).props.onPress();
        field("Search accounts").props.onChangeText("Fictional");
      }
      tree = h.render();
    }
    if (kind === "create_income") field("Paid on the last day of each month").props.onPress();
    if (kind === "create_bill") field("One time").props.onPress();
    // The latest event is retained synchronously, before another local render.
    const retained: FloFormDraft = owner.bindings.creationFormRef.current.draft;
    assert.ok(retained);
    assert.equal(h.events.saves.length, 0);
    const privateTree = privateScreen({ hidden: true }, React, "View", "Text", "PremiumBackdrop", "FloLogo", "MoneyPrivacyToggle", {}, {});
    assert.match(text(privateTree), /Flo conversations are hidden/);
    assert.equal(flatten(privateTree).some(node => node.type === "TextInput" || "value" in (node.props ?? {})), false);
    assert.doesNotMatch(text(privateTree), /4777|Edited draft|Fictional/);
    const revealed = componentHarness(kind, values[kind], "web", { initialDraft: retained, onDraftChange });
    const revealedTree = revealed.render();
    for (const definition of FLO_FORM_FIELDS[kind]) {
      if (["text", "money", "apr", "date"].includes(definition.type)) {
        assert.equal(flatten(revealedTree).find(node => node.props?.accessibilityLabel === definition.label)?.props.value, retained.values[definition.key], `${kind}:${definition.key}`);
      }
    }
    if (kind === "create_manual_transaction") {
      assert.equal(flatten(revealedTree).find(node => node.props?.accessibilityLabel === "Search accounts")?.props.value, "Fictional");
      assert.equal(flatten(revealedTree).find(node => node.props?.accessibilityLabel === `${account.name}, checking`)?.props["aria-checked"], true);
    }
    if (kind === "create_income") assert.equal(flatten(revealedTree).find(node => node.props?.accessibilityRole === "checkbox")?.props["aria-checked"], true);
    if (kind === "create_bill") assert.equal(flatten(revealedTree).find(node => node.props?.accessibilityLabel === "One time")?.props["aria-checked"], true);
    assert.equal(revealed.events.saves.length, 0, "reveal never saves or asks Flo");
    await flatten(revealedTree).find(node => node.props?.accessibilityLabel === `Save ${FLO_FORM_TITLES[kind]}`)?.props.onPress();
    assert.deepEqual(revealed.events.saves, [validateFloForm(kind, retained.values, [account]).input]);
  }
});

test("retained form drafts reject a different command, feedback revision, conversation, owner epoch and explicit reset", () => {
  const draft = floFormInitialDraft({ status: "needs_details", kind: "create_income", prompt: "Details", missingFields: [], form: { values: { amount: "4777.77" }, errors: {} } });
  for (const drift of ["command", "revision", "conversation", "scope", "aba", "reset"]) {
    const h = draftOwnerHarness();
    if (drift === "command") h.bindings.creationFormRef.current = { ...h.session, id: "command-b" };
    if (drift === "revision") h.bindings.creationFormRef.current = { ...h.session, revision: 2 };
    if (drift === "conversation") h.bindings.activeConversationIdRef.current = "conversation-b";
    if (drift === "scope") h.bindings.creationOwnerKeyRef.current = "actor:other-home:budget:epoch1";
    if (drift === "aba") h.bindings.creationOwnerKeyRef.current = "actor:home:budget:epoch2";
    if (drift === "reset") h.bindings.creationFormRef.current = null;
    h.retain("command-a", 1, draft);
    assert.equal(h.bindings.creationFormRef.current?.draft, undefined, drift);
  }
});

test("opening/closing a populated form never saves; double Save uses one guarded explicit callback", async () => {
  const h = componentHarness("create_income");
  let release!: () => void;
  h.events.held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let tree = h.render();
  assert.equal(h.events.saves.length, 0);
  const nodes = flatten(tree);
  nodes
    .find((node) => node.props?.accessibilityLabel === "Close creation form")
    .props.onPress();
  assert.equal(h.events.close, 1);
  assert.equal(h.events.saves.length, 0);
  const save = nodes.find(
    (node) => node.props?.accessibilityLabel === "Save income",
  ).props.onPress;
  save();
  save();
  assert.equal(h.events.saves.length, 1);
  tree = h.render();
  assert.equal(
    flatten(tree).find(
      (node) => node.props?.accessibilityLabel === "Close creation form",
    ).props.disabled,
    true,
  );
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    flatten(h.render()).find(
      (node) => node.props?.accessibilityLabel === "Save income",
    ).props.disabled,
    false,
  );
});
test("selector/date errors scroll to their field and stay visible in the fixed footer with values intact", () => {
  for (const field of ["frequency", "first_date"]) {
    const h = componentHarness("create_income", {
      ...values.create_income,
      [field]: "",
    });
    let tree = h.render();
    const target = flatten(tree).find(
      (node) =>
        node.props?.onLayout &&
        flatten(node).some(
          (child) => child.props?.nativeID === `flo-form-label-${field}`,
        ),
    );
    target.props.onLayout({ nativeEvent: { layout: { y: 400 } } });
    flatten(tree)
      .find((node) => node.props?.accessibilityLabel === "Save income")
      .props.onPress();
    tree = h.render();
    assert.equal(h.events.saves.length, 0);
    assert.deepEqual(h.events.scroll, [{ y: 388, animated: true }]);
    assert.match(
      text(tree),
      field === "frequency"
        ? /Pay frequency: Choose/
        : /First payday: Enter a valid date/,
    );
    assert.equal(
      flatten(tree).find(
        (node) => node.props?.accessibilityLabel === "Income name",
      ).props.value,
      "Salary",
    );
  }
});
test("save failure preserves typed fields after StrictMode setup replay and Safety Back precedes pending guards", async () => {
  const h = componentHarness("create_income");
  let tree = h.render();
  const cleanup = h.effects[0]();
  cleanup();
  h.effects[0]();
  h.events.fail = true;
  flatten(tree)
    .find((node) => node.props?.accessibilityLabel === "Save income")
    .props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  tree = h.render();
  assert.match(text(tree), /Fictional network error/);
  assert.equal(
    flatten(tree).find(
      (node) => node.props?.accessibilityLabel === "Take-home amount",
    ).props.value,
    "500",
  );
  h.props.busy = true;
  h.props.suspended = true;
  h.render();
  h.effects[1]();
  h.events.historyBack();
  assert.equal(h.events.safetyBack, 1);
  assert.equal(h.events.close, 0);
});

test("parent Close/resume is local; Save is current owner/conversation only and synchronous single flight", async () => {
  const source = readFileSync("app/(tabs)/flo.tsx", "utf8"),
    a = source.indexOf("  const closeCreationForm ="),
    b = source.indexOf("  const cancelCreationDraft =", a);
  assert.ok(a > 0 && b > a);
  const code = transpileModule(source.slice(a, b), {
    compilerOptions: { module: ModuleKind.CommonJS },
  }).outputText;
  const input = validateFloForm("create_income", values.create_income, [
    account,
  ]).input;
  const session = {
    id: "form",
    owner: "actor:home:budget:epoch0",
    conversationId: "conversation-a",
    creation: { kind: "create_income" },
    open: true,
  };
  const state: any = { saves: [], busy: false, held: null };
  const bindings: Record<string, any> = {
    creationFormRef: { current: session },
    creationOwnerKeyRef: { current: session.owner },
    activeConversationIdRef: { current: session.conversationId },
    activeRequestRef: { current: null },
    creationOperationRef: { current: null },
    formSubmitRef: { current: null },
    historyMutationRef: { current: false },
    demoMode: false,
    canEditHousehold: true,
    FLO_FORM_TITLES,
    setChatError() {},
    setCreationFormSession: (update: any) => {
      bindings.creationFormRef.current =
        typeof update === "function"
          ? update(bindings.creationFormRef.current)
          : update;
    },
    setCreationFormBusy: (busy: boolean) => {
      state.busy = busy;
    },
    send: async (...args: any[]) => {
      state.saves.push(args);
      if (state.held) await state.held;
    },
  };
  const form = new Function(
    ...Object.keys(bindings),
    `${code};return {close:closeCreationForm,reopen:reopenCreationForm,save:submitCreationForm};`,
  )(...Object.values(bindings));
  form.close("form");
  assert.equal(bindings.creationFormRef.current.open, false);
  assert.deepEqual(state.saves, []);
  form.reopen("form");
  assert.equal(bindings.creationFormRef.current.open, true);
  bindings.creationOwnerKeyRef.current = session.owner.replace(
    "epoch0",
    "epoch2",
  );
  await form.save("form", input);
  assert.deepEqual(state.saves, [], "ABA cannot submit an old form");
  bindings.creationOwnerKeyRef.current = session.owner;
  bindings.activeConversationIdRef.current = "conversation-b";
  await form.save("form", input);
  assert.deepEqual(state.saves, []);
  bindings.activeConversationIdRef.current = session.conversationId;
  let release!: () => void;
  state.held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = form.save("form", input);
  await form.save("form", input);
  form.close("form");
  assert.equal(state.saves.length, 1);
  assert.equal(bindings.creationFormRef.current.open, true);
  assert.deepEqual(state.saves[0], ["Add income", false, false, input]);
  release();
  await pending;
  assert.equal(state.busy, false);
});

test("pre-ready explicit Retry retains exact structured fields and never reconstructs them from display prose", () => {
  const source = readFileSync("app/(tabs)/flo.tsx", "utf8"),
    a = source.indexOf("    const requestDraft ="),
    b = source.indexOf("    if (!recovery)", a);
  const code = transpileModule(source.slice(a, b), {
    compilerOptions: { module: ModuleKind.CommonJS },
  }).outputText;
  const creationForm = {
    kind: "create_income",
    fields: {
      name: "Salary",
      amount: "-5.001",
      frequency: "monthly",
      first_date: "2026-11-01",
    },
  };
  const bindings: Record<string, any> = {
    retry: true,
    clean: "Add income",
    submittedForm: undefined,
    creationOwnerKey: "lease-2",
    activeCreationDraftRef: { current: null },
    retryRequestRef: {
      current: { text: "Add income", creationOwner: "lease-2", creationForm },
    },
  };
  const select = () =>
    new Function(
      ...Object.keys(bindings),
      `${code};return {creationForm,creationDraft};`,
    )(...Object.values(bindings));
  assert.deepEqual(select(), { creationForm, creationDraft: undefined });
  bindings.creationOwnerKey = "lease-3";
  assert.deepEqual(select(), {
    creationForm: undefined,
    creationDraft: undefined,
  });
  assert.match(
    source,
    /conversationId, creationDraft, creationForm, creationOwner: requestCreationOwnerKey/,
  );
});

test("server unavailable prompt remains in the form footer without losing any typed value", () => {
  const h = componentHarness("create_income");
  h.props.error = "I could not verify active accounts. Please try again.";
  const tree = h.render();
  assert.match(text(tree), /could not verify active accounts/);
  assert.equal(
    flatten(tree).find(
      (node) => node.props?.accessibilityLabel === "Take-home amount",
    ).props.value,
    "500",
  );
  assert.deepEqual(h.events.saves, []);
});

test("web frequency direction account and month-end controls expose checked state while native state remains", () => {
  const bill = componentHarness("create_bill", {
    ...values.create_bill,
    is_recurring: false,
  });
  const oneTime = flatten(bill.render()).find(
    (node) => node.props?.accessibilityLabel === "One time",
  );
  assert.equal(oneTime.props["aria-checked"], true);
  assert.equal(oneTime.props.accessibilityState.checked, true);
  const manual = componentHarness("create_manual_transaction");
  const nodes = flatten(manual.render());
  assert.equal(
    nodes.find((node) => node.props?.accessibilityLabel === "Money out").props[
      "aria-checked"
    ],
    true,
  );
  assert.equal(
    nodes.find(
      (node) => node.props?.accessibilityLabel === `${account.name}, checking`,
    ).props["aria-checked"],
    true,
  );
  const income = componentHarness("create_income", {
    ...values.create_income,
    frequency: "monthly",
    monthly_last_day: true,
  });
  assert.equal(
    flatten(income.render()).find(
      (node) => node.props?.accessibilityRole === "checkbox",
    ).props["aria-checked"],
    true,
  );
  const native = componentHarness(
    "create_bill",
    { ...values.create_bill, is_recurring: false },
    "ios",
  );
  const nativeOneTime = flatten(native.render()).find(
    (node) => node.props?.accessibilityLabel === "One time",
  );
  assert.equal(nativeOneTime.props["aria-checked"], undefined);
  assert.equal(nativeOneTime.props.accessibilityState.checked, true);
});
