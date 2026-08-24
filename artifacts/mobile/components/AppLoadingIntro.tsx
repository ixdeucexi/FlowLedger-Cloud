import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";

import { StartupPlanBrand } from "@/components/StartupPlanBrand";

type LoadingPhase = "app" | "plan" | "privacy" | "setup" | "simulator" | "workspace";

interface AppLoadingIntroProps {
  phase?: LoadingPhase;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function AppLoadingIntro({
  style,
  accessibilityLabel = "Loading your FlowLedger plan",
}: AppLoadingIntroProps) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      style={[styles.screen, style]}
    >
      <StartupPlanBrand />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#050816",
  },
});
