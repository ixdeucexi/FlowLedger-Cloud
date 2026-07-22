export type LearningTourRoute = "index" | "monthly" | "bills" | "transactions" | "flo" | "more";

export interface LearningTourStep {
  route: LearningTourRoute;
  path: string;
  title: string;
  focus: string;
  floSays: string;
  tryThis: string;
}

export const LEARNING_TOUR_STEPS: LearningTourStep[] = [
  {
    route: "index",
    path: "/(tabs)",
    title: "Dashboard",
    focus: "Your command center",
    floSays: "I show your balance, plan, and next move here.",
    tryThis: "Tap the Flow Score for details.",
  },
  {
    route: "monthly",
    path: "/(tabs)/monthly",
    title: "Monthly",
    focus: "Calendar forecast",
    floSays: "I show your projected balance for each day.",
    tryThis: "Tap a low-balance day to see why.",
  },
  {
    route: "bills",
    path: "/(tabs)/bills",
    title: "Bills and Debt",
    focus: "Obligations and payoff",
    floSays: "I keep your bills, debt, and payoff order here.",
    tryThis: "Open Debt to see your next target.",
  },
  {
    route: "transactions",
    path: "/(tabs)/transactions",
    title: "Activity",
    focus: "What actually happened",
    floSays: "I keep the record of what happened here.",
    tryThis: "Use filters to find an item.",
  },
  {
    route: "flo",
    path: "/(tabs)/flo",
    title: "Flo",
    focus: "Ask before changing the plan",
    floSays: "I answer questions and preview changes here.",
    tryThis: "Ask: “Can I afford $100 on July 15?”",
  },
  {
    route: "more",
    path: "/(tabs)/more?section=overview",
    title: "More",
    focus: "Control center",
    floSays: "I keep your accounts, setup, and app controls here.",
    tryThis: "Open a section to view its controls.",
  },
];
