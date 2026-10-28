import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transpileModule, ModuleKind, JsxEmit } from "typescript";
import {
  FLO_FORM_FIELDS,
  FLO_FORM_TITLES,
  floFormInitialValues,
  floFormAccounts,
  validateFloForm,
  type FloFormValues,
} from "./floCreationForm";
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
    name === "react"
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
                  : {};
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
