import React from "react";
import { StyleSheet, View } from "react-native";

type FlowWaveVariant = "blue" | "green" | "purple";

type Props = {
  variant?: FlowWaveVariant;
  intensity?: "soft" | "standard";
  flashesEnabled?: boolean;
};

const DROP_COLORS: Record<FlowWaveVariant, string[]> = {
  blue: ["rgba(56,189,248,0.18)", "rgba(96,165,250,0.13)", "rgba(167,139,250,0.12)"],
  green: ["rgba(45,212,191,0.16)", "rgba(34,197,94,0.11)", "rgba(96,165,250,0.12)"],
  purple: ["rgba(168,85,247,0.17)", "rgba(56,189,248,0.13)", "rgba(129,140,248,0.12)"],
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
  const colors = DROP_COLORS[variant];
  const opacityScale = intensity === "soft" ? 0.72 : 1;

  return (
    <View pointerEvents="none" style={styles.background}>
      {RAINDROPS.map((drop, index) => (
        <View
          key={`${drop.top}-${drop.left}`}
          style={[
            styles.raindrop,
            {
              top: drop.top,
              left: drop.left,
              width: drop.size,
              height: drop.size,
              opacity: drop.opacity * opacityScale,
              backgroundColor: colors[index % colors.length],
            },
          ]}
        />
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
  raindrop: {
    position: "absolute",
    borderTopLeftRadius: 999,
    borderTopRightRadius: 999,
    borderBottomLeftRadius: 999,
    borderBottomRightRadius: 120,
    transform: [{ rotate: "45deg" }],
  },
});
