export type FloClientAllowance = {
  period: "month" | "day";
  limit: number;
  used: number;
  remaining: number;
  resetsAt: string;
  canCreate: boolean;
};

/** Legacy daily limits remain configurable on Edge; only fixed monthly caps block locally. */
export function floMonthlyAllowanceExhausted(allowance: FloClientAllowance | null | undefined): boolean {
  return allowance?.period === "month" && allowance.remaining <= 0;
}

export function floAllowanceLabel(allowance: FloClientAllowance | null | undefined): string {
  if (!allowance) return "Checking your Flo allowance…";
  if (allowance.period === "day") return `${allowance.used} chat requests today · daily fair-use limits apply`;
  return `${allowance.remaining} of ${allowance.limit} household chat requests left · resets ${allowance.resetsAt.slice(0, 10)} UTC`;
}

export const FLO_CREATION_PRO_MESSAGE = "Flo can add items with Pro. You can still add them for free using the app’s Add controls.";

export function floCreationAccessMessage(canEdit: boolean): string {
  return canEdit ? FLO_CREATION_PRO_MESSAGE : "You have view-only access. A household editor can add or change items.";
}
