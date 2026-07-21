export type BillImportance = "must" | "flexible" | "optional";

export const BILL_IMPORTANCE_OPTIONS: readonly {
  value: BillImportance;
  label: string;
  description: string;
  icon: "shield" | "sliders" | "heart";
}[] = [
  {
    value: "must",
    label: "Must Pay",
    description: "Protect this first. It counts toward your required backup days.",
    icon: "shield",
  },
  {
    value: "flexible",
    label: "Flexible",
    description: "You need it, but the date or amount can change when the balance is low.",
    icon: "sliders",
  },
  {
    value: "optional",
    label: "Optional",
    description: "Good to have, but it does not count as a required expense.",
    icon: "heart",
  },
] as const;

export function normalizeBillImportance(value: unknown, isDebt = false): BillImportance {
  if (isDebt) return "must";
  return value === "flexible" || value === "optional" ? value : "must";
}

export function isRequiredBill(importance: BillImportance | null | undefined, isDebt = false): boolean {
  return normalizeBillImportance(importance, isDebt) === "must";
}
