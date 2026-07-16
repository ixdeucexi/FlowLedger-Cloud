import { StyleSheet, View } from "react-native";

import { FlowWaveBackground } from "@/components/FlowWaveBackground";
import { useEffectiveThemeMode } from "@/hooks/useEffectiveThemeMode";

type Props = {
  variant?: "blue" | "green" | "purple";
};

const LIGHT_GLOWS: Record<NonNullable<Props["variant"]>, { primary: string; secondary: string }> = {
  blue: {
    primary: "rgba(37,99,235,0.13)",
    secondary: "rgba(34,211,238,0.10)",
  },
  green: {
    primary: "rgba(34,197,94,0.12)",
    secondary: "rgba(14,165,233,0.09)",
  },
  purple: {
    primary: "rgba(124,58,237,0.13)",
    secondary: "rgba(34,211,238,0.09)",
  },
};

export function PremiumBackdrop({ variant = "blue" }: Props) {
  const themeMode = useEffectiveThemeMode();

  if (themeMode === "light") {
    const glow = LIGHT_GLOWS[variant];
    return (
      <View pointerEvents="none" style={styles.lightBackdrop}>
        <View style={styles.lightBase} />
        <View style={[styles.lightGlowPrimary, { backgroundColor: glow.primary }]} />
        <View style={[styles.lightGlowSecondary, { backgroundColor: glow.secondary }]} />
        <View style={styles.lightSheen} />
      </View>
    );
  }

  return <FlowWaveBackground variant={variant} />;
}

const styles = StyleSheet.create({
  lightBackdrop: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  lightBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#f8fafc",
  },
  lightGlowPrimary: {
    position: "absolute",
    top: -96,
    right: -120,
    width: 320,
    height: 320,
    borderRadius: 160,
  },
  lightGlowSecondary: {
    position: "absolute",
    bottom: 72,
    left: -148,
    width: 330,
    height: 330,
    borderRadius: 165,
  },
  lightSheen: {
    position: "absolute",
    top: 0,
    left: -80,
    width: "140%",
    height: "100%",
    opacity: 0.42,
    backgroundColor: "rgba(255,255,255,0.30)",
    transform: [{ rotate: "-8deg" }],
  },
});
