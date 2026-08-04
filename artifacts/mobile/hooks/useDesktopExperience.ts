import { Platform, useWindowDimensions } from "react-native";

import { shouldUseDesktopExperience } from "@/lib/desktopExperience";

type BrowserNavigator = Navigator & {
  standalone?: boolean;
  userAgentData?: { mobile?: boolean };
};

function readBrowserEnvironment() {
  if (Platform.OS !== "web" || typeof navigator === "undefined") {
    return {};
  }

  const browserNavigator = navigator as BrowserNavigator;
  const standalone =
    (typeof window !== "undefined" &&
      window.matchMedia?.("(display-mode: standalone)").matches) ||
    browserNavigator.standalone === true;

  return {
    userAgent: browserNavigator.userAgent,
    userAgentMobile: browserNavigator.userAgentData?.mobile === true,
    maxTouchPoints: browserNavigator.maxTouchPoints,
    standalone,
  };
}

export function useDesktopExperience() {
  const { width } = useWindowDimensions();

  return shouldUseDesktopExperience({
    platform: Platform.OS,
    viewportWidth: width,
    ...readBrowserEnvironment(),
  });
}
