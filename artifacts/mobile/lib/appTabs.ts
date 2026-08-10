import { planningTabPresentation } from "./planningMode";

export const APP_TABS = [
  {
    name: "index",
    title: "Dashboard",
    icon: "bar-chart-2",
    pathname: "/(tabs)",
  },
  {
    name: "bills",
    title: "Bills",
    icon: "file-text",
    pathname: "/(tabs)/bills",
  },
  {
    name: "transactions",
    title: "Activity",
    icon: "repeat",
    pathname: "/(tabs)/transactions",
  },
  {
    name: "monthly",
    title: "Monthly",
    icon: "calendar",
    pathname: "/(tabs)/monthly",
  },
  {
    name: "reports",
    title: "Reports",
    icon: "bar-chart-2",
    pathname: "/(tabs)/reports",
  },
  {
    name: "more",
    title: "Settings",
    icon: "settings",
    pathname: "/(tabs)/more",
  },
] as const;

export type AppTab = (typeof APP_TABS)[number];
export type AppTabName = AppTab["name"];

export function appTabsForPlanning(zeroBasedBudgetEnabled: boolean) {
  const activityPresentation = planningTabPresentation(zeroBasedBudgetEnabled);
  return APP_TABS.map((tab) => tab.name === "transactions"
    ? { ...tab, ...activityPresentation }
    : tab);
}

function normalizedPathname(pathname: string) {
  const withoutQuery = pathname.split(/[?#]/, 1)[0] || "/";
  const withoutGroup = withoutQuery.replace(/^\/\(tabs\)/, "");
  if (!withoutGroup || withoutGroup === "/index") return "/";
  return withoutGroup.length > 1 ? withoutGroup.replace(/\/$/, "") : withoutGroup;
}

export function isAppTabActive(tab: AppTabName, pathname: string) {
  const currentPath = normalizedPathname(pathname);
  return tab === "index" ? currentPath === "/" : currentPath === `/${tab}`;
}
