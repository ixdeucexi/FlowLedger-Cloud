export type LearningTourRoute =
  | "index"
  | "monthly"
  | "bills"
  | "transactions"
  | "flo"
  | "more";

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
    title: "Forecast",
    focus: "See the plan by day",
    floSays: "I show your closing balance for each day.",
    tryThis: "Open Plan Simulator to test a change without changing your plan.",
  },
  {
    route: "bills",
    path: "/(tabs)/bills?view=debt",
    title: "Bills and Debt",
    focus: "Obligations and payoff",
    floSays: "I keep your bills, debt, and payoff order here.",
    tryThis: "Open Debt, then review Debt Payoff Progress to see your next target.",
  },
  {
    route: "transactions",
    path: "/(tabs)/transactions",
    title: "Activity",
    focus: "What really happened",
    floSays: "I keep posted, pending, and needs-review activity together here.",
    tryThis: "Open Filters to narrow the activity you want to review.",
  },
  {
    route: "flo",
    path: "/(tabs)/flo",
    title: "Flo",
    focus: "Ask before changing the plan",
    floSays: "I answer questions and preview changes here.",
    tryThis: "Ask: “Can I afford $100 next Friday?”",
  },
  {
    route: "more",
    path: "/(tabs)/more",
    title: "Settings",
    focus: "Your plan controls",
    floSays: "I keep accounts, reminders, setup, security, and support here.",
    tryThis: "Open Setup & walkthrough whenever you want to replay this tour.",
  },
];
