import { Platform, useWindowDimensions } from "react-native";

import { shouldUseDesktopExperience } from "@/lib/desktopExperience";

export function useDesktopExperience() {
  const { width } = useWindowDimensions();

  return shouldUseDesktopExperience({
    platform: Platform.OS,
    viewportWidth: width,
  });
}
