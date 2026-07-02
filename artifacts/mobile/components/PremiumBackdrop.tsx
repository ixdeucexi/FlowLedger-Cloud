import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, View } from "react-native";

type Props = {
  variant?: "blue" | "green" | "purple";
};

const palettes = {
  blue: ["rgba(37,99,235,0.30)", "rgba(14,165,233,0.08)", "rgba(2,6,23,0)"] as const,
  green: ["rgba(34,197,94,0.24)", "rgba(20,184,166,0.08)", "rgba(2,6,23,0)"] as const,
  purple: ["rgba(124,58,237,0.26)", "rgba(37,99,235,0.10)", "rgba(2,6,23,0)"] as const,
};

export function PremiumBackdrop({ variant = "blue" }: Props) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <LinearGradient
        colors={["#050816", "#08111f", "#050816"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <LinearGradient
        colors={palettes[variant]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.orb, styles.orbOne]}
      />
      <LinearGradient
        colors={["rgba(16,185,129,0.16)", "rgba(59,130,246,0.06)", "rgba(2,6,23,0)"]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[styles.orb, styles.orbTwo]}
      />
      <View style={styles.grid} />
    </View>
  );
}

const styles = StyleSheet.create({
  orb: { position: "absolute", width: 280, height: 280, borderRadius: 140 },
  orbOne: { top: -95, right: -90 },
  orbTwo: { bottom: 110, left: -130 },
  grid: {
    ...StyleSheet.absoluteFillObject,
    borderColor: "rgba(148,163,184,0.055)",
    borderWidth: 1,
  },
});
