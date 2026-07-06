import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, View } from "react-native";

type FlowWaveVariant = "blue" | "green" | "purple";

type Props = {
  variant?: FlowWaveVariant;
  intensity?: "soft" | "standard";
  flashesEnabled?: boolean;
};

const VARIANT_GLOWS: Record<FlowWaveVariant, { primary: string; secondary: string; edge: string }> = {
  blue: {
    primary: "rgba(56,189,248,0.18)",
    secondary: "rgba(37,99,235,0.14)",
    edge: "rgba(34,197,94,0.08)",
  },
  green: {
    primary: "rgba(34,197,94,0.16)",
    secondary: "rgba(56,189,248,0.12)",
    edge: "rgba(139,92,246,0.08)",
  },
  purple: {
    primary: "rgba(168,85,247,0.18)",
    secondary: "rgba(56,189,248,0.13)",
    edge: "rgba(34,197,94,0.08)",
  },
};

export function FlowWaveBackground({ variant = "blue", intensity = "standard" }: Props) {
  const glow = VARIANT_GLOWS[variant];
  const soft = intensity === "soft";

  return (
    <View pointerEvents="none" style={styles.root}>
      <LinearGradient
        colors={["#01020a", "#020617", "#050816", "#01020a"]}
        locations={[0, 0.36, 0.72, 1]}
        start={{ x: 0.16, y: 0 }}
        end={{ x: 0.88, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={[styles.glowPrimary, { backgroundColor: glow.primary, opacity: soft ? 0.58 : 1 }]} />
      <View style={[styles.glowSecondary, { backgroundColor: glow.secondary, opacity: soft ? 0.50 : 0.9 }]} />
      <View style={[styles.glowEdge, { backgroundColor: glow.edge, opacity: soft ? 0.42 : 0.72 }]} />
      <LinearGradient
        colors={["rgba(255,255,255,0.035)", "rgba(255,255,255,0)", "rgba(255,255,255,0.025)"]}
        locations={[0, 0.58, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.softSheen}
      />
      <View style={styles.readabilityWash} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  glowPrimary: {
    position: "absolute",
    top: -140,
    right: -160,
    width: 360,
    height: 360,
    borderRadius: 180,
  },
  glowSecondary: {
    position: "absolute",
    bottom: 120,
    left: -170,
    width: 390,
    height: 390,
    borderRadius: 195,
  },
  glowEdge: {
    position: "absolute",
    bottom: -180,
    right: -170,
    width: 360,
    height: 360,
    borderRadius: 180,
  },
  softSheen: {
    ...StyleSheet.absoluteFillObject,
    transform: [{ rotate: "-8deg" }, { scale: 1.12 }],
  },
  readabilityWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2,6,23,0.16)",
  },
});
