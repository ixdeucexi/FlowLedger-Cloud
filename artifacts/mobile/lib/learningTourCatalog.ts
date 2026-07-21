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
    floSays: "I use this page to show your real checking balance first, then what is safe before payday and what needs your attention.",
    tryThis: "I want you to tap the Flow Score here whenever you want me to explain what is helping or hurting your plan.",
  },
  {
    route: "monthly",
    path: "/(tabs)/monthly",
    title: "Monthly",
    focus: "Calendar forecast",
    floSays: "This is where I show your money by date. Tap any day to see the bills, income, plans, transactions, and projected balance behind that day.",
    tryThis: "Tap a day here. I will show the money behind it and explain any low-balance date.",
  },
  {
    route: "bills",
    path: "/(tabs)/bills",
    title: "Bills and Debt",
    focus: "Obligations and payoff",
    floSays: "I keep bills and debt payoff here. Snowball targets the smallest balance first. Avalanche targets the highest APR first.",
    tryThis: "I want you to touch Debt here to see which balance I would make the current snowball target.",
  },
  {
    route: "transactions",
    path: "/(tabs)/transactions",
    title: "Activity",
    focus: "What actually happened",
    floSays: "This page is your money trail. I compare what happened with what you planned so your calendar stays current.",
    tryThis: "I want you to use these filters when you need to review bills, manual spending, income, or debt payments.",
  },
  {
    route: "flo",
    path: "/(tabs)/flo",
    title: "Flo",
    focus: "Ask before changing the plan",
    floSays: "This is where you ask me money questions. I can explain, preview, and help create plans, but I should confirm before changing real data.",
    tryThis: "Ask me: “Can I afford $100 on July 15?” or “Why is next week a low-balance week?”",
  },
  {
    route: "more",
    path: "/(tabs)/more?section=overview",
    title: "More",
    focus: "Control center",
    floSays: "I use More as your control center for accounts, bank sync, notifications, membership, setup, and app preferences.",
    tryThis: "I brought you to the main Settings page. Tap the section you want to change from here.",
  },
];
