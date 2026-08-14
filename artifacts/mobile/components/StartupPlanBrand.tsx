import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Platform, StyleSheet, Text, View, type ViewStyle } from "react-native";

const STARTUP_LOGO_SIZE = 200;

export function StartupPlanBrand({ cinematic = false }: { cinematic?: boolean }) {
  const nativeReveal = useRef(new Animated.Value(0)).current;
  const startedRef = useRef(false);
  const [webRevealStarted, setWebRevealStarted] = useState(false);
  const [webSweepDone, setWebSweepDone] = useState(false);

  useEffect(() => {
    if (!cinematic || startedRef.current) return;
    startedRef.current = true;

    if (Platform.OS === "web") {
      let secondFrame: number | undefined;
      const firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => setWebRevealStarted(true));
      });
      const sweepTimer = setTimeout(() => setWebSweepDone(true), 1050);
      return () => {
        window.cancelAnimationFrame(firstFrame);
        if (secondFrame !== undefined) window.cancelAnimationFrame(secondFrame);
        clearTimeout(sweepTimer);
      };
    }

    Animated.timing(nativeReveal, {
      toValue: 1,
      duration: 1100,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [cinematic, nativeReveal]);

  const nativeRingStyle = Platform.OS === "web" ? undefined : {
    opacity: nativeReveal.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 0.52, 0.2] }),
  };
  const nativeGlowStyle = Platform.OS === "web" ? undefined : {
    opacity: nativeReveal.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0, 0.48, 0.24] }),
  };
  const nativeShineStyle = Platform.OS === "web" ? undefined : {
    opacity: nativeReveal.interpolate({ inputRange: [0, 0.18, 0.82, 1], outputRange: [0, 0.34, 0.28, 0] }),
    transform: [
      { translateX: nativeReveal.interpolate({ inputRange: [0, 1], outputRange: [-185, 185] }) },
      { rotate: "18deg" },
    ],
  };
  const webRingStyle = Platform.OS === "web" ? ({
    opacity: webRevealStarted ? 0.2 : 0,
    transitionDuration: "850ms",
    transitionProperty: "opacity",
    transitionTimingFunction: "ease-in-out",
  } as ViewStyle) : undefined;
  const webGlowStyle = Platform.OS === "web" ? ({
    opacity: webRevealStarted ? 0.24 : 0,
    transitionDuration: "850ms",
    transitionProperty: "opacity",
    transitionTimingFunction: "ease-in-out",
  } as ViewStyle) : undefined;
  const webShineStyle = Platform.OS === "web" ? ({
    opacity: webRevealStarted && !webSweepDone ? 0.32 : 0,
    transform: [{ translateX: webRevealStarted ? 185 : -185 }, { rotate: "18deg" }],
    transitionDuration: webSweepDone ? "180ms" : "950ms",
    transitionProperty: "opacity, transform",
    transitionTimingFunction: "ease-in-out",
  } as ViewStyle) : undefined;

  return (
    <View style={styles.brand}>
      <View style={styles.logoStage}>
        <Animated.View pointerEvents="none" style={[styles.ambientGlow, nativeGlowStyle, webGlowStyle]} />
        <Animated.View pointerEvents="none" style={[styles.revealRing, nativeRingStyle, webRingStyle]} />
        <Image
          accessibilityIgnoresInvertColors
          accessibilityLabel="FlowLedger"
          source={require("../assets/images/startup_f_transparent.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <View pointerEvents="none" style={styles.shineMask}>
          <Animated.View style={[styles.shine, nativeShineStyle, webShineStyle]} />
        </View>
      </View>
      <Text style={styles.status}>Loading Plan...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: {
    alignItems: "center",
    flexShrink: 0,
  },
  logoStage: {
    width: STARTUP_LOGO_SIZE,
    height: STARTUP_LOGO_SIZE,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  ambientGlow: {
    position: "absolute",
    width: STARTUP_LOGO_SIZE - 12,
    height: STARTUP_LOGO_SIZE - 12,
    borderRadius: 52,
    backgroundColor: "#0ea5e9",
    shadowColor: "#22d3ee",
    shadowOpacity: 0.72,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
  },
  revealRing: {
    position: "absolute",
    width: STARTUP_LOGO_SIZE + 28,
    height: STARTUP_LOGO_SIZE + 28,
    left: -14,
    top: -14,
    borderRadius: 64,
    borderWidth: 1.5,
    borderColor: "#67e8f9",
    shadowColor: "#84cc16",
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
  },
  logo: {
    width: STARTUP_LOGO_SIZE,
    height: STARTUP_LOGO_SIZE,
    flexShrink: 0,
    borderRadius: 48,
    shadowColor: "#38bdf8",
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  shineMask: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 48,
    overflow: "hidden",
  },
  shine: {
    position: "absolute",
    top: -28,
    bottom: -28,
    left: 70,
    width: 42,
    backgroundColor: "#ffffff",
    shadowColor: "#ffffff",
    shadowOpacity: 0.75,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  status: {
    color: "#f8fafc",
    fontFamily: "Inter_800ExtraBold",
    fontSize: 20,
    fontWeight: "800",
    marginTop: 18,
  },
});
