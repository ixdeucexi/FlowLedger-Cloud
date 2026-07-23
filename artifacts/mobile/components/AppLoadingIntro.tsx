import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";

import { useColors } from "@/hooks/useColors";

const APP_MESSAGES = [
  "Starting FlowLedger",
  "Getting Flo ready",
  "Almost there",
] as const;

const PLAN_MESSAGES = [
  "Opening your plan",
  "Checking your latest numbers",
  "Getting Flo ready",
] as const;

interface AppLoadingIntroProps {
  phase?: "app" | "plan";
  style?: StyleProp<ViewStyle>;
}

export function AppLoadingIntro({ phase = "app", style }: AppLoadingIntroProps) {
  const colors = useColors();
  const [messageIndex, setMessageIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const entrance = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const messages = phase === "plan" ? PLAN_MESSAGES : APP_MESSAGES;

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (mounted) setReduceMotion(enabled);
    });

    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    entrance.stopAnimation();
    orbit.stopAnimation();
    pulse.stopAnimation();

    if (reduceMotion) {
      entrance.setValue(1);
      orbit.setValue(0);
      pulse.setValue(0);
      return;
    }

    entrance.setValue(0);
    orbit.setValue(0);
    pulse.setValue(0);

    const entranceAnimation = Animated.timing(entrance, {
      toValue: 1,
      duration: 650,
      easing: Easing.out(Easing.back(1.2)),
      useNativeDriver: true,
    });
    const orbitAnimation = Animated.loop(
      Animated.timing(orbit, {
        toValue: 1,
        duration: 4200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    entranceAnimation.start();
    orbitAnimation.start();
    pulseAnimation.start();

    return () => {
      entranceAnimation.stop();
      orbitAnimation.stop();
      pulseAnimation.stop();
    };
  }, [entrance, orbit, pulse, reduceMotion]);

  useEffect(() => {
    setMessageIndex(0);
    if (reduceMotion) return;

    const timer = setInterval(() => {
      setMessageIndex(current => (current + 1) % messages.length);
    }, 1450);
    return () => clearInterval(timer);
  }, [messages.length, phase, reduceMotion]);

  const logoScale = entrance.interpolate({
    inputRange: [0, 1],
    outputRange: [0.72, 1],
  });
  const titleTranslate = entrance.interpolate({
    inputRange: [0, 1],
    outputRange: [14, 0],
  });
  const ringRotation = orbit.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });
  const reverseRingRotation = orbit.interpolate({
    inputRange: [0, 1],
    outputRange: ["360deg", "0deg"],
  });
  const logoFloat = orbit.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [0, -5, 0, 5, 0],
  });
  const haloScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1.08],
  });
  const haloOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.22, 0.5],
  });

  return (
    <Animated.View
      accessibilityLabel="FlowLedger is loading"
      style={[styles.screen, { backgroundColor: colors.background }, style]}
    >
      <View style={styles.brandStage}>
        <Animated.View
          style={[
            styles.halo,
            {
              opacity: haloOpacity,
              transform: [{ scale: haloScale }],
            },
          ]}
        />
        <Animated.View style={[styles.outerRing, { transform: [{ rotate: ringRotation }] }]} />
        <Animated.View style={[styles.innerRing, { transform: [{ rotate: reverseRingRotation }] }]} />
        <Animated.View
          pointerEvents="none"
          style={[styles.outerOrbit, { transform: [{ rotate: ringRotation }] }]}
        >
          <View style={[styles.orbitMarker, styles.outerMarkerTop]} />
          <View style={[styles.orbitMarker, styles.outerMarkerSide]} />
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[styles.innerOrbit, { transform: [{ rotate: reverseRingRotation }] }]}
        >
          <View style={[styles.orbitMarker, styles.innerMarker]} />
        </Animated.View>
        <Animated.View
          style={[
            styles.logoFrame,
            {
              opacity: entrance,
              transform: [{ translateY: logoFloat }, { scale: logoScale }],
            },
          ]}
        >
          <Image
            accessibilityIgnoresInvertColors
            source={require("../assets/images/startup_f_transparent.png")}
            style={styles.logo}
            resizeMode="contain"
          />
        </Animated.View>
      </View>

      <Animated.View
        style={{
          opacity: entrance,
          transform: [{ translateY: titleTranslate }],
        }}
      >
        <Text style={[styles.eyebrow, { color: colors.primary }]}>YOUR MONEY, IN MOTION</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>FlowLedger Algo</Text>
      </Animated.View>

      <View style={styles.statusRow}>
        {[0, 1, 2].map(index => (
          <Animated.View
            key={index}
            style={[
              styles.statusDot,
              {
                backgroundColor: index === messageIndex ? colors.primary : colors.mutedForeground,
                opacity: index === messageIndex ? 1 : 0.28,
                transform: [{ scale: index === messageIndex ? 1 : 0.72 }],
              },
            ]}
          />
        ))}
        <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
          {messages[messageIndex]}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#050816",
  },
  brandStage: {
    width: 188,
    height: 188,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  halo: {
    position: "absolute",
    width: 156,
    height: 156,
    borderRadius: 78,
    backgroundColor: "#0ea5e9",
    shadowColor: "#22d3ee",
    shadowOpacity: 0.7,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
  },
  outerRing: {
    position: "absolute",
    width: 174,
    height: 174,
    borderRadius: 87,
    borderWidth: 2,
    borderColor: "rgba(56,189,248,0.18)",
    borderTopColor: "#22d3ee",
    borderRightColor: "#8b5cf6",
  },
  innerRing: {
    position: "absolute",
    width: 144,
    height: 144,
    borderRadius: 72,
    borderWidth: 2,
    borderColor: "rgba(139,92,246,0.16)",
    borderBottomColor: "#8b5cf6",
    borderLeftColor: "#34d399",
  },
  outerOrbit: {
    position: "absolute",
    width: 184,
    height: 184,
  },
  innerOrbit: {
    position: "absolute",
    width: 152,
    height: 152,
  },
  orbitMarker: {
    position: "absolute",
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.8)",
    shadowOpacity: 0.85,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  outerMarkerTop: {
    top: -5,
    left: 86,
    backgroundColor: "#22d3ee",
    shadowColor: "#22d3ee",
  },
  outerMarkerSide: {
    right: -5,
    top: 86,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#8b5cf6",
    shadowColor: "#8b5cf6",
  },
  innerMarker: {
    bottom: -5,
    left: 71,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#34d399",
    shadowColor: "#34d399",
  },
  logoFrame: {
    width: 126,
    height: 126,
    borderRadius: 34,
    backgroundColor: "rgba(2,6,23,0.82)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#38bdf8",
    shadowOpacity: 0.42,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  logo: {
    width: 118,
    height: 118,
    borderRadius: 30,
  },
  eyebrow: {
    fontWeight: "700",
    fontSize: 11,
    letterSpacing: 2,
    textAlign: "center",
    marginBottom: 7,
  },
  title: {
    fontWeight: "800",
    fontSize: 24,
    textAlign: "center",
    letterSpacing: -0.4,
  },
  statusRow: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  statusText: {
    minWidth: 176,
    fontWeight: "500",
    fontSize: 13,
    marginLeft: 5,
  },
});
