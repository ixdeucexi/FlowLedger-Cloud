export const MOBILE_RIBBON_ITEMS = [
  { name: "index", title: "Dashboard", icon: "home" },
  { name: "monthly", title: "Calendar", icon: "calendar" },
  { name: "add", title: "Add", icon: "plus" },
  { name: "accounts", title: "Accounts", icon: "credit-card" },
  { name: "more", title: "Menu", icon: "menu" },
] as const;

export type MobileRibbonItem = (typeof MOBILE_RIBBON_ITEMS)[number];

export function isMobileRibbonAction(name: MobileRibbonItem["name"]) {
  return name === "add";
}
