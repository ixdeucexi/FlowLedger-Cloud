const COMPACT_TAB_WIDTH = 300;

export function tabBarLabelSize(viewportWidth: number) {
  return viewportWidth < COMPACT_TAB_WIDTH ? 8 : 10;
}

export function tabBarDisplayLabel(title: string, viewportWidth: number) {
  if (viewportWidth >= COMPACT_TAB_WIDTH) return title;
  if (title === "Dashboard") return "Home";
  if (title === "Monthly") return "Month";
  return title;
}
