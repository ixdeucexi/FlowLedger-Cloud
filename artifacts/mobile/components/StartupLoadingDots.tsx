import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  View,
} from "react-native";

const DOTS = [
  [14, 0],
  [24, 4],
  [28, 14],
  [24, 24],
  [14, 28],
  [4, 24],
  [0, 14],
  [4, 4],
] as const;

/** Decorative only: never signals readiness or delays the startup cover. */
export function StartupLoadingDots() {
  const rotation = useRef(new Animated.Value(0)).current;
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    // Web uses compositor CSS plus its live media query; no JS animation frames.
    if (Platform.OS === "web") return;
    let mounted = true;
    let eventReceived = false;
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (value) => {
        eventReceived = true;
        if (mounted) setReducedMotion(value);
      },
    );
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (mounted && !eventReceived) setReducedMotion(value);
      })
      .catch(() => {
        /* Unknown preference stays still. */
      });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    if (Platform.OS === "web" || reducedMotion) return;
    rotation.setValue(0);
    const animation = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
        isInteraction: false,
      }),
    );
    animation.start();
    return () => {
      animation.stop();
      rotation.setValue(0);
    };
  }, [reducedMotion, rotation]);
  return (
    <Animated.View
      nativeID="flowledger-react-startup-dots"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{
        width: 32,
        height: 32,
        marginTop: 18,
        transform:
          Platform.OS === "web"
            ? undefined
            : [
                {
                  rotate: rotation.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0deg", "360deg"],
                  }),
                },
              ],
      }}
    >
      {DOTS.map(([left, top], index) => (
        <View
          key={index}
          style={{
            position: "absolute",
            left,
            top,
            width: 4,
            height: 4,
            borderRadius: 2,
            backgroundColor: "#a855f7",
            opacity: 0.25 + index * 0.1,
          }}
        />
      ))}
    </Animated.View>
  );
}
