import React from "react";
import { StyleSheet, View } from "react-native";

type FlowWaveVariant = "blue" | "green" | "purple";

type Props = {
  variant?: FlowWaveVariant;
  intensity?: "soft" | "standard";
  flashesEnabled?: boolean;
};

export function FlowWaveBackground(_props: Props) {
  return <View pointerEvents="none" style={styles.background} />;
}

const styles = StyleSheet.create({
  background: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#020617",
  },
});
