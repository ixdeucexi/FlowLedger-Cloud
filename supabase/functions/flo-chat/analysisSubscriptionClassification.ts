/** A manual bill choice wins over the legacy category-based suggestion. */
export function configuredSubscriptionBill(bill: { is_subscription?: unknown; category?: unknown }): boolean {
  if (bill.is_subscription === true) return true;
  if (bill.is_subscription === false) return false;
  return /subscription|entertainment|stream|software/i.test(String(bill.category ?? ""));
}
