import type { AlgorithmId } from "./algorithmCatalog";
import type { OnboardingPreferences } from "./onboarding";

export type UserFocusId = "debt" | "savings" | "bills" | "spending" | "budget" | "organized" | "full";

export interface SetupPersonalization {
  focus: UserFocusId;
  title: string;
  summary: string;
  nextActionLabel: string;
  nextActionPrompt: string;
  nextRoute: "/(tabs)/flo" | "/(tabs)/bills" | "/(tabs)/transactions" | "/setup";
  quickPrompts: string[];
  recommendedAlgorithms: AlgorithmId[];
}

function has(preferences: OnboardingPreferences, value: string) {
  return preferences.help.includes(value as any) || preferences.goals.includes(value as any);
}

export function determineUserFocus(preferences: OnboardingPreferences): UserFocusId {
  if (has(preferences, "pay_off_debt")) return "debt";
  if (has(preferences, "grow_savings") || preferences.savingsGoal) return "savings";
  if (preferences.help.includes("track_spending") || preferences.goals.includes("reduce_spending")) return "spending";
  if (preferences.help.includes("create_budget")) return "budget";
  if (preferences.help.includes("stay_organized") || preferences.goals.includes("stay_on_top")) return "organized";
  return "full";
}

export function buildSetupPersonalization(preferences: OnboardingPreferences): SetupPersonalization {
  const focus = determineUserFocus(preferences);
  switch (focus) {
    case "debt":
      return {
        focus,
        title: "Debt payoff focus",
        summary: "I’ll protect your cushion and focus extra money on your next debt.",
        nextActionLabel: "Review snowball",
        nextActionPrompt: "Show me my debt snowball target and the next safe move.",
        nextRoute: "/(tabs)/bills",
        quickPrompts: [
          "Show me my debt snowball target.",
          "Can I send extra money to debt safely?",
          "What happens when my next debt is paid off?",
        ],
        recommendedAlgorithms: ["debtPayoff", "safeCushion", "extraMoneyRouter", "cashFlowGap"],
      };
    case "savings":
      return {
        focus,
        title: "Savings focus",
        summary: "I’ll protect your cushion, then find money for savings.",
        nextActionLabel: "Plan savings",
        nextActionPrompt: "What can I safely move to savings without hurting the forecast?",
        nextRoute: "/(tabs)/flo",
        quickPrompts: [
          "What can I safely move to savings?",
          "How can I reach my savings goal faster?",
          "Should I keep this money available or save it?",
        ],
        recommendedAlgorithms: ["safeCushion", "extraMoneyRouter", "purchaseDecision", "spendingLimit"],
      };
    case "bills":
      return {
        focus,
        title: "Bill review focus",
        summary: "I’ll watch due dates and bills before payday.",
        nextActionLabel: "Review bills",
        nextActionPrompt: "Which bill should I review first, and is any bill squeezing my month?",
        nextRoute: "/(tabs)/bills",
        quickPrompts: [
          "Which bill should I review first?",
          "Which bills are due before payday?",
          "Can moving a bill date help my forecast?",
        ],
        recommendedAlgorithms: ["billPriority", "cashFlowGap", "paydaySplit", "safeCushion"],
      };
    case "spending":
      return {
        focus,
        title: "Spending focus",
        summary: "I’ll connect actual spending to your plan.",
        nextActionLabel: "Review activity",
        nextActionPrompt: "Where is my spending putting the most pressure on the plan?",
        nextRoute: "/(tabs)/transactions",
        quickPrompts: [
          "Where am I spending the most?",
          "What can I spend until payday?",
          "Which category needs attention?",
        ],
        recommendedAlgorithms: ["spendingLimit", "purchaseDecision", "safeCushion", "flowScore"],
      };
    case "budget":
      return {
        focus,
        title: "Budget setup focus",
        summary: "I’ll start with income, bills, categories, and your cushion.",
        nextActionLabel: "Continue setup",
        nextActionPrompt: "What setup step should I finish next?",
        nextRoute: "/setup",
        quickPrompts: [
          "What setup step should I finish next?",
          "How do I create a useful budget?",
          "What can I spend until payday?",
        ],
        recommendedAlgorithms: ["flowScore", "safeCushion", "paydaySplit", "spendingLimit"],
      };
    case "organized":
      return {
        focus,
        title: "Stay organized focus",
        summary: "I’ll keep your next action easy to find.",
        nextActionLabel: "Ask what’s next",
        nextActionPrompt: "What needs my attention next?",
        nextRoute: "/(tabs)/flo",
        quickPrompts: [
          "What needs my attention next?",
          "Which decisions need review?",
          "Why is my balance changing this week?",
        ],
        recommendedAlgorithms: ["flowScore", "billPriority", "cashFlowGap", "safeCushion"],
      };
    case "full":
    default:
      return {
        focus: "full",
        title: "Full forecast focus",
        summary: "I’ll build your core forecast one step at a time.",
        nextActionLabel: "Build forecast",
        nextActionPrompt: "Walk me through the next setup step.",
        nextRoute: "/setup",
        quickPrompts: [
          "Walk me through the next setup step.",
          "Can I afford $500?",
          "Why is my balance getting low?",
        ],
        recommendedAlgorithms: ["flowScore", "safeCushion", "purchaseDecision", "billPriority"],
      };
  }
}
