export const MOBILE_RIBBON_ITEMS = [
  { name: "index", title: "Dashboard", icon: "home" },
  { name: "bills", title: "Bills", icon: "file-text" },
  { name: "add", title: "Add", icon: "plus" },
  { name: "transactions", title: "Activity", icon: "repeat" },
  { name: "monthly", title: "Monthly", icon: "calendar" },
] as const;

export type MobileRibbonItem = (typeof MOBILE_RIBBON_ITEMS)[number];

export function isMobileRibbonAction(name: MobileRibbonItem["name"]) {
  return name === "add";
}
