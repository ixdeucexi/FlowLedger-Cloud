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
    floSays: "I use this page to give you the short answer first: what is available, how tight the month is, and which algorithm needs your attention.",
    tryThis: "Tap the Flow Score when you want me to explain what is helping or hurting your plan.",
  },
  {
    route: "monthly",
    path: "/(tabs)/monthly",
    title: "Monthly",
    focus: "Calendar forecast",
    floSays: "This is where I show your money by date. Tap any day to see the bills, income, plans, transactions, and projected balance behind that day.",
    tryThis: "Tap a low-balance day, then ask me why that day is tight.",
  },
  {
    route: "bills",
    path: "/(tabs)/bills",
    title: "Bills and Debt",
    focus: "Obligations and payoff",
    floSays: "This is where your recurring bills and debt snowball live. I use these dates and minimums to protect the forecast before you make new decisions.",
    tryThis: "Open Debt to see which balance is the current snowball target.",
  },
  {
    route: "transactions",
    path: "/(tabs)/transactions",
    title: "Activity",
    focus: "What actually happened",
    floSays: "This page is your money trail. I compare actual activity against the plan so FlowLedger can stay honest instead of guessing.",
    tryThis: "Use the filters when you want to review bills, manual spending, income, or debt payments.",
  },
  {
    route: "flo",
    path: "/(tabs)/flo",
    title: "Flo",
    focus: "Ask before changing the plan",
    floSays: "This is where you ask me money questions. I can explain, preview, and help create plans, but I should confirm before changing real data.",
    tryThis: "Ask: “Can I afford $100 on July 15?” or “Why is next week tight?”",
  },
  {
    route: "more",
    path: "/(tabs)/more",
    title: "More",
    focus: "Control center",
    floSays: "I use More as your control center for accounts, setup, app install, exports, safety cushion, and the Algorithm Suite.",
    tryThis: "Open Algorithm Suite to turn financial engines on or off as the account grows.",
  },
];
