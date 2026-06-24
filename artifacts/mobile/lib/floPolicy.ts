import { evaluateDecision, type DecisionBaselineDay } from "./decisions";

export interface FloFacts {
  balanceToday: number;
  lowestBalance: number;
  lowestBalanceDate: string;
  safetyFloor: number;
  monthlyIncome: number;
  monthlyBills: number;
  upcoming: { name: string; amount: number; date: string }[];
  activePlans: number;
  forecastConfidence: string;
}

export type FloChatMessage = { id: string; role: "user" | "flo"; text: string };
export type FloChatState = { messages: FloChatMessage[]; sending: boolean };
export type FloChatAction =
  | { type: "submit"; id: string; text: string }
  | { type: "reply"; id: string; text: string };

export const AI_USAGE_UNAVAILABLE_MESSAGE =
  "Flo is connected, but AI usage is currently unavailable. Check OpenAI billing or usage limits.";
export const FLO_CONNECTION_ERROR_MESSAGE =
  "Flo couldn't connect just now. Your FlowLedger calculations are still available, so please try again.";

export function reduceFloChat(state: FloChatState, action: FloChatAction): FloChatState {
  if (action.type === "submit") {
    const text = action.text.trim();
    if (!text || state.sending) return state;
    return { messages: [...state.messages, { id: action.id, role: "user", text }], sending: true };
  }
  return {
    messages: [...state.messages, { id: action.id, role: "flo", text: action.text }],
    sending: false,
  };
}

export function normalizeFloReply(reply?: string | null, status?: number): string {
  if (
    status === 429 ||
    (reply && /quota|billing|usage.*(?:limit|unavailable)|rate limit/i.test(reply))
  ) return AI_USAGE_UNAVAILABLE_MESSAGE;
  return reply?.trim() || FLO_CONNECTION_ERROR_MESSAGE;
}

export function sanitizeFloSummary(message: string): string {
  return message
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/[$€£]?\s*\d[\d,]*(?:\.\d+)?/g, "[amount/date]")
    .slice(0, 500);
}

export function localFloAnswer(message: string, facts: FloFacts, days: DecisionBaselineDay[]): string | null {
  const lower = message.toLowerCase();
  const match = message.match(/\$?\s*([\d,]+(?:\.\d{1,2})?)/);
  if ((lower.includes("afford") || lower.includes("buy") || lower.includes("spend")) && match) {
    const amount = Number(match[1].replace(/,/g, ""));
    const date = message.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1] ?? new Date().toISOString().slice(0, 10);
    const result = evaluateDecision(days, {
      type: "one_time_purchase",
      name: "Flo affordability question",
      amount,
      date,
      frequency: "once",
    }, facts.safetyFloor);
    const lead = result.verdict === "safe"
      ? "Yes."
      : result.verdict === "caution"
        ? "Yes, but it would be tight."
        : "Not safely.";
    return `${lead} ${result.explanation} Your lowest projected balance would be $${result.lowestBalance.toFixed(0)} on ${result.lowestBalanceDate}.`;
  }
  if (lower.includes("why") && (lower.includes("negative") || lower.includes("balance"))) {
    return `Your current forecast reaches its lowest point at $${facts.lowestBalance.toFixed(0)} on ${facts.lowestBalanceDate}. The largest near-term obligations are ${facts.upcoming.slice(0, 3).map(i => `${i.name} ($${i.amount.toFixed(0)})`).join(", ") || "not yet available"}.`;
  }
  if (lower.includes("next") && (lower.includes("bill") || lower.includes("due"))) {
    return facts.upcoming.length
      ? `Your next obligations are ${facts.upcoming.slice(0, 3).map(i => `${i.name} for $${i.amount.toFixed(0)} on ${i.date}`).join(", ")}.`
      : "I don't see any upcoming bills in the current forecast.";
  }
  if (lower.includes("income") && (lower.includes("add") || lower.includes("enter") || lower.includes("set up"))) {
    return "Open More, choose Income, then tap Add Income. Enter the amount, frequency, and next pay date so FlowLedger can include it in your forecast.";
  }
  return null;
}
