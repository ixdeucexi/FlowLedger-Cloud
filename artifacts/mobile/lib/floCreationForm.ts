import type {
  FloCreationFormInput,
  FloCreationKind,
  FloCreationResult,
} from "./floCreationProtocol";
import { parseDecimalInput, parseMoneyInput } from "./moneyFormInput";

export type FloFormValues = Record<string, string | boolean>;
export type FloFormAccount = {
  id: string;
  name: string;
  account_type: string;
  is_active: boolean;
  current_balance?: number;
};
export type FloFormField = {
  key: string;
  label: string;
  type:
    | "text"
    | "money"
    | "apr"
    | "date"
    | "frequency"
    | "direction"
    | "account";
  optional?: boolean;
  maxLength?: number;
};
export const FLO_FORM_TITLES: Record<FloCreationKind, string> = {
  create_bill: "bill",
  create_debt: "debt",
  create_income: "income",
  create_manual_transaction: "transaction",
  create_bucket: "spending bucket",
  create_savings_goal: "savings goal",
};
const name: FloFormField = {
  key: "name",
  label: "Name",
  type: "text",
  maxLength: 120,
};
const frequency: FloFormField = {
  key: "frequency",
  label: "How often?",
  type: "frequency",
};
const firstDate: FloFormField = {
  key: "first_date",
  label: "First payment date",
  type: "date",
};
const targetDate: FloFormField = {
  key: "target_date",
  label: "Target date",
  type: "date",
};
const targetAmount: FloFormField = {
  key: "target_amount",
  label: "Target amount",
  type: "money",
};
export const FLO_FORM_FIELDS: Record<FloCreationKind, FloFormField[]> = {
  create_bill: [
    name,
    { key: "amount", label: "Amount", type: "money" },
    frequency,
    firstDate,
    {
      key: "category",
      label: "Category",
      type: "text",
      optional: true,
      maxLength: 120,
    },
  ],
  create_debt: [
    name,
    { key: "balance", label: "Current balance", type: "money" },
    { key: "minimum_payment", label: "Minimum payment", type: "money" },
    { key: "apr", label: "APR (%)", type: "apr" },
    frequency,
    firstDate,
  ],
  create_income: [
    { ...name, label: "Income name" },
    { key: "amount", label: "Take-home amount", type: "money" },
    { ...frequency, label: "Pay frequency" },
    { ...firstDate, label: "First payday" },
  ],
  create_manual_transaction: [
    { key: "note", label: "Description", type: "text", maxLength: 2000 },
    { key: "amount", label: "Amount", type: "money" },
    { key: "direction", label: "Money in or out?", type: "direction" },
    { key: "date", label: "Transaction date", type: "date" },
    { key: "category", label: "Category", type: "text", maxLength: 120 },
    { key: "account_id", label: "Account", type: "account" },
  ],
  create_bucket: [
    name,
    { ...targetAmount, label: "Budget amount" },
    targetDate,
  ],
  create_savings_goal: [
    name,
    targetAmount,
    {
      key: "current_amount",
      label: "Already saved",
      type: "money",
      optional: true,
    },
    targetDate,
  ],
};
export function floFormInitialValues(
  creation: FloCreationResult,
): FloFormValues {
  const kind = creation.kind;
  if (!kind) return {};
  const known = { ...creation.draft?.fields, ...creation.form?.values };
  const keys = [
    ...FLO_FORM_FIELDS[kind].map((field) => field.key),
    ...(kind === "create_bill" ? ["is_recurring"] : []),
    ...(kind === "create_income" ? ["monthly_last_day"] : []),
  ];
  const values: FloFormValues = {};
  for (const key of keys) {
    const value = known[key];
    if (typeof value === "boolean") values[key] = value;
    else if (
      typeof value === "string" ||
      (typeof value === "number" && Number.isFinite(value))
    )
      values[key] = String(value);
  }
  return values;
}
export function floFormAccounts(
  accounts: readonly FloFormAccount[],
): FloFormAccount[] {
  return accounts.filter(
    (account) =>
      account.is_active &&
      ["checking", "savings", "cash"].includes(account.account_type),
  );
}
export function validateFloForm(
  kind: FloCreationKind,
  values: FloFormValues,
  accounts: readonly FloFormAccount[],
): { input: FloCreationFormInput; errors: Record<string, string> } {
  const fields: FloCreationFormInput["fields"] = {},
    errors: Record<string, string> = {};
  for (const field of FLO_FORM_FIELDS[kind]) {
    const value =
      typeof values[field.key] === "string"
        ? String(values[field.key]).trim()
        : "";
    if (!value && field.optional) continue;
    if (field.type === "frequency") {
      if (kind === "create_bill" && values.is_recurring === false) {
        fields.frequency = "monthly";
        fields.is_recurring = false;
        continue;
      }
      if (
        ![
          "monthly",
          "weekly",
          "biweekly",
          ...(kind === "create_income" ? [] : ["quarterly"]),
        ].includes(value)
      )
        errors[field.key] = "Choose how often this repeats.";
      else {
        fields[field.key] = value;
        if (kind === "create_bill") fields.is_recurring = true;
      }
    } else if (field.type === "money" || field.type === "apr") {
      const amount =
        field.type === "apr"
          ? parseDecimalInput(value, 4)
          : parseMoneyInput(value);
      const zeroAllowed =
        field.key === "balance" ||
        field.key === "current_amount" ||
        field.type === "apr";
      if (
        amount === null ||
        (zeroAllowed ? amount < 0 : amount <= 0) ||
        amount >= 1e9 ||
        (field.type === "apr" && amount > 100)
      )
        errors[field.key] =
          field.type === "apr"
            ? "Enter an APR from 0 to 100, with up to four decimal places."
            : `Enter ${zeroAllowed ? "a nonnegative" : "a positive"} amount with up to two decimal places.`;
      else fields[field.key] = amount;
    } else if (field.type === "date") {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(value + "T12:00:00Z")
        : null;
      if (
        !date ||
        value.startsWith("0000-") ||
        !Number.isFinite(+date) ||
        date.toISOString().slice(0, 10) !== value
      )
        errors[field.key] = "Enter a valid date as YYYY-MM-DD.";
      else fields[field.key] = value;
    } else if (field.type === "direction") {
      if (value !== "expense" && value !== "inflow")
        errors[field.key] = "Choose money out or money in.";
      else fields[field.key] = value;
    } else if (field.type === "account") {
      if (!floFormAccounts(accounts).some((account) => account.id === value))
        errors[field.key] = "Choose an active account.";
      else fields[field.key] = value;
    } else if (!value || value.length > (field.maxLength ?? 120))
      errors[field.key] = !value
        ? `Enter ${field.label.toLowerCase()}.`
        : `Use ${field.maxLength ?? 120} characters or fewer.`;
    else fields[field.key] = value;
  }
  if (
    kind === "create_income" &&
    fields.frequency === "monthly" &&
    typeof values.monthly_last_day === "boolean"
  )
    fields.monthly_last_day = values.monthly_last_day;
  return { input: { kind, fields }, errors };
}
