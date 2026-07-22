export type DebtPaymentPlanSummary = {
  extraPayment: number;
  requiredMinimum: number;
  totalPlanned: number;
};

function money(value: number) {
  return Math.round(Math.max(0, Number(value) || 0) * 100) / 100;
}

export function buildDebtPaymentPlanSummary(requiredMinimum: number, extraPayment: number): DebtPaymentPlanSummary {
  const minimum = money(requiredMinimum);
  const extra = money(extraPayment);
  return {
    extraPayment: extra,
    requiredMinimum: minimum,
    totalPlanned: money(minimum + extra),
  };
}
