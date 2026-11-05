export interface DetectorTransaction { id: string; date: string; amount: number; description: string; }
export interface DetectedSubscription {
  merchant: string;
  cadence: "weekly" | "monthly" | "annual" | "unknown";
  averageAmount: number;
  lastAmount: number;
  monthlyEquivalent: number;
  yearlyEquivalent: number;
  transactionIds: string[];
  priceIncrease: boolean;
  duplicateRisk: boolean;
  confidence: "low" | "medium" | "high";
}
export function normalizeMerchant(value: string): string;
export function detectSubscriptions(transactions: readonly DetectorTransaction[]): DetectedSubscription[];

export const KNOWN_SUBSCRIPTION_WORDS: readonly string[];
