import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, View } from "react-native";

type FlowWaveVariant = "blue" | "green" | "purple";

type Props = {
  variant?: FlowWaveVariant;
  intensity?: "soft" | "standard";
  flashesEnabled?: boolean;
};

type DropGradient = readonly [string, string, string];

const DROP_GRADIENTS: Record<FlowWaveVariant, DropGradient[]> = {
  blue: [
    ["rgba(125,211,252,0.34)", "rgba(37,99,235,0.16)", "rgba(15,23,42,0.02)"],
    ["rgba(147,197,253,0.28)", "rgba(56,189,248,0.13)", "rgba(15,23,42,0.02)"],
    ["rgba(196,181,253,0.24)", "rgba(59,130,246,0.12)", "rgba(15,23,42,0.02)"],
  ],
  green: [
    ["rgba(94,234,212,0.30)", "rgba(34,197,94,0.13)", "rgba(15,23,42,0.02)"],
    ["rgba(134,239,172,0.24)", "rgba(45,212,191,0.12)", "rgba(15,23,42,0.02)"],
    ["rgba(125,211,252,0.23)", "rgba(34,197,94,0.10)", "rgba(15,23,42,0.02)"],
  ],
  purple: [
    ["rgba(216,180,254,0.32)", "rgba(124,58,237,0.15)", "rgba(15,23,42,0.02)"],
    ["rgba(125,211,252,0.27)", "rgba(168,85,247,0.12)", "rgba(15,23,42,0.02)"],
    ["rgba(165,180,252,0.24)", "rgba(56,189,248,0.12)", "rgba(15,23,42,0.02)"],
  ],
};

const RAINDROPS = [
  { top: "6%", left: "72%", size: 132, opacity: 0.34 },
  { top: "18%", left: "-10%", size: 188, opacity: 0.26 },
  { top: "33%", left: "48%", size: 96, opacity: 0.18 },
  { top: "47%", left: "82%", size: 148, opacity: 0.2 },
  { top: "61%", left: "9%", size: 118, opacity: 0.18 },
  { top: "75%", left: "58%", size: 176, opacity: 0.16 },
] as const;

export function FlowWaveBackground({ variant = "blue", intensity = "standard" }: Props) {
  const gradients = DROP_GRADIENTS[variant];
  const opacityScale = intensity === "soft" ? 0.72 : 1;

  return (
    <View pointerEvents="none" style={styles.background}>
      {RAINDROPS.map((drop, index) => (
        <View
          key={`${drop.top}-${drop.left}`}
          style={[
            styles.raindropShell,
            {
              top: drop.top,
              left: drop.left,
              width: drop.size,
              height: drop.size,
              opacity: drop.opacity * opacityScale,
            },
          ]}
        >
          <LinearGradient
            colors={gradients[index % gradients.length]}
            locations={[0, 0.52, 1]}
            start={{ x: 0.12, y: 0.08 }}
            end={{ x: 0.88, y: 0.9 }}
            style={styles.raindrop}
          >
            <View style={styles.raindropHighlight} />
            <View style={styles.raindropShade} />
          </LinearGradient>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  background: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#020617",
    overflow: "hidden",
  },
  raindropShell: {
    position: "absolute",
    transform: [{ rotate: "-45deg" }],
  },
  raindrop: {
    flex: 1,
    borderTopLeftRadius: 999,
    borderTopRightRadius: 999,
    borderBottomRightRadius: 999,
    borderBottomLeftRadius: 30,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  raindropHighlight: {
    position: "absolute",
    top: "16%",
    left: "22%",
    width: "26%",
    height: "26%",
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  raindropShade: {
    position: "absolute",
    right: "8%",
    bottom: "10%",
    width: "42%",
    height: "42%",
    borderRadius: 999,
    backgroundColor: "rgba(2,6,23,0.18)",
  },
});
