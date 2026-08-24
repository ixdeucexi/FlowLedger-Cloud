const COMPACT_TAB_WIDTH = 340;
const NATIVE_TAB_CONTENT_HEIGHT = 72;
const NATIVE_TAB_MIN_BOTTOM_PADDING = 14;

export function tabBarLabelSize(viewportWidth: number) {
  return viewportWidth < COMPACT_TAB_WIDTH ? 8 : 10;
}

export function tabBarDisplayLabel(title: string, viewportWidth: number) {
  if (viewportWidth >= COMPACT_TAB_WIDTH) return title;
  if (title === "Dashboard") return "Home";
  return title;
}

export function nativeTabBarMetrics(bottomInset: number) {
  const normalizedInset = Number.isFinite(bottomInset) ? Math.max(0, bottomInset) : 0;
  const paddingBottom = Math.max(NATIVE_TAB_MIN_BOTTOM_PADDING, normalizedInset);
  return {
    height: NATIVE_TAB_CONTENT_HEIGHT + paddingBottom,
    paddingBottom,
  };
}
