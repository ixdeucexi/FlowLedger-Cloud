import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, useWindowDimensions, View } from "react-native";
import Svg, { Path } from "react-native-svg";

type FlowWaveVariant = "blue" | "green" | "purple";

type Props = {
  variant?: FlowWaveVariant;
  intensity?: "soft" | "standard";
};

type LightningBolt = {
  key: string;
  path: string;
  branches: string[];
  coreColor: string;
  glowColor: string;
  coreWidth: number;
  glowWidth: number;
  opacity: number;
};

export function FlowWaveBackground({ intensity = "standard" }: Props) {
  const { width, height } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(false);
  const stormDriftAnim = useRef(new Animated.Value(0)).current;
  const primaryFlashAnim = useRef(new Animated.Value(0)).current;
  const secondaryFlashAnim = useRef(new Animated.Value(0)).current;
  const skyPulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener?.("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      stormDriftAnim.setValue(0.45);
      primaryFlashAnim.setValue(0.20);
      secondaryFlashAnim.setValue(0.12);
      skyPulseAnim.setValue(0.18);
      return;
    }

    const stormDriftLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(stormDriftAnim, {
          toValue: 1,
          duration: 12000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(stormDriftAnim, {
          toValue: 0,
          duration: 13000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    const primaryFlashLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(220),
        Animated.timing(primaryFlashAnim, {
          toValue: 1,
          duration: 48,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(primaryFlashAnim, {
          toValue: 0.18,
          duration: 70,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(primaryFlashAnim, {
          toValue: 0.92,
          duration: 42,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(primaryFlashAnim, {
          toValue: 0,
          duration: 230,
          easing: Easing.out(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.delay(1250),
        Animated.timing(primaryFlashAnim, {
          toValue: 0.72,
          duration: 60,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(primaryFlashAnim, {
          toValue: 0,
          duration: 270,
          easing: Easing.out(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.delay(1700),
      ]),
    );

    const secondaryFlashLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(820),
        Animated.timing(secondaryFlashAnim, {
          toValue: 0.86,
          duration: 54,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(secondaryFlashAnim, {
          toValue: 0.10,
          duration: 120,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(80),
        Animated.timing(secondaryFlashAnim, {
          toValue: 0.58,
          duration: 42,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(secondaryFlashAnim, {
          toValue: 0,
          duration: 240,
          easing: Easing.out(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.delay(2100),
      ]),
    );

    const skyPulseLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(230),
        Animated.timing(skyPulseAnim, {
          toValue: 1,
          duration: 62,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(skyPulseAnim, {
          toValue: 0,
          duration: 420,
          easing: Easing.out(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.delay(1300),
        Animated.timing(skyPulseAnim, {
          toValue: 0.42,
          duration: 58,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(skyPulseAnim, {
          toValue: 0,
          duration: 340,
          easing: Easing.out(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.delay(1900),
      ]),
    );

    stormDriftLoop.start();
    primaryFlashLoop.start();
    secondaryFlashLoop.start();
    skyPulseLoop.start();
    return () => {
      stormDriftLoop.stop();
      primaryFlashLoop.stop();
      secondaryFlashLoop.stop();
      skyPulseLoop.stop();
    };
  }, [primaryFlashAnim, reduceMotion, secondaryFlashAnim, skyPulseAnim, stormDriftAnim]);

  const svgWidth = Math.max(width, 390);
  const svgHeight = Math.max(height, 760);
  const stormStrength = intensity === "soft" ? 0.72 : 1;
  const stormTranslateX = stormDriftAnim.interpolate({ inputRange: [0, 1], outputRange: [-18, 18] });
  const stormTranslateY = stormDriftAnim.interpolate({ inputRange: [0, 1], outputRange: [10, -14] });
  const stormScale = stormDriftAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.025, 1] });
  const primaryOpacity = primaryFlashAnim.interpolate({
    inputRange: [0, 0.18, 0.72, 1],
    outputRange: [0.06, 0.18, 0.88, 1],
  });
  const secondaryOpacity = secondaryFlashAnim.interpolate({
    inputRange: [0, 0.22, 0.86],
    outputRange: [0.04, 0.18, 0.78],
  });
  const skyFlashOpacity = skyPulseAnim.interpolate({
    inputRange: [0, 0.42, 1],
    outputRange: [0, 0.06, 0.13],
  });

  const { primaryBolts, secondaryBolts } = useMemo(() => {
    const primary: LightningBolt[] = [
      {
        key: "main-sky-tear",
        path: `M ${svgWidth * 0.84} ${-svgHeight * 0.06} L ${svgWidth * 0.76} ${svgHeight * 0.10} L ${svgWidth * 0.82} ${svgHeight * 0.17} L ${svgWidth * 0.64} ${svgHeight * 0.31} L ${svgWidth * 0.70} ${svgHeight * 0.39} L ${svgWidth * 0.48} ${svgHeight * 0.56} L ${svgWidth * 0.56} ${svgHeight * 0.64} L ${svgWidth * 0.32} ${svgHeight * 0.86} L ${svgWidth * 0.38} ${svgHeight * 0.98}`,
        branches: [
          `M ${svgWidth * 0.64} ${svgHeight * 0.31} L ${svgWidth * 0.49} ${svgHeight * 0.28} L ${svgWidth * 0.56} ${svgHeight * 0.38} L ${svgWidth * 0.39} ${svgHeight * 0.46}`,
          `M ${svgWidth * 0.48} ${svgHeight * 0.56} L ${svgWidth * 0.34} ${svgHeight * 0.57} L ${svgWidth * 0.41} ${svgHeight * 0.66} L ${svgWidth * 0.25} ${svgHeight * 0.74}`,
          `M ${svgWidth * 0.56} ${svgHeight * 0.64} L ${svgWidth * 0.72} ${svgHeight * 0.67} L ${svgWidth * 0.64} ${svgHeight * 0.75} L ${svgWidth * 0.79} ${svgHeight * 0.82}`,
        ],
        coreColor: "#f8fbff",
        glowColor: "#38bdf8",
        coreWidth: 2.6,
        glowWidth: 20,
        opacity: 1,
      },
      {
        key: "left-crawl",
        path: `M ${-svgWidth * 0.08} ${svgHeight * 0.33} L ${svgWidth * 0.16} ${svgHeight * 0.23} L ${svgWidth * 0.29} ${svgHeight * 0.27} L ${svgWidth * 0.46} ${svgHeight * 0.17} L ${svgWidth * 0.66} ${svgHeight * 0.21} L ${svgWidth * 1.05} ${svgHeight * 0.08}`,
        branches: [
          `M ${svgWidth * 0.29} ${svgHeight * 0.27} L ${svgWidth * 0.23} ${svgHeight * 0.37} L ${svgWidth * 0.09} ${svgHeight * 0.43}`,
          `M ${svgWidth * 0.66} ${svgHeight * 0.21} L ${svgWidth * 0.74} ${svgHeight * 0.31} L ${svgWidth * 0.91} ${svgHeight * 0.32}`,
        ],
        coreColor: "#dbeafe",
        glowColor: "#60a5fa",
        coreWidth: 2.2,
        glowWidth: 16,
        opacity: 0.78,
      },
      {
        key: "center-fork-drop",
        path: `M ${svgWidth * 0.48} ${-svgHeight * 0.04} L ${svgWidth * 0.42} ${svgHeight * 0.10} L ${svgWidth * 0.53} ${svgHeight * 0.18} L ${svgWidth * 0.35} ${svgHeight * 0.34} L ${svgWidth * 0.43} ${svgHeight * 0.43} L ${svgWidth * 0.21} ${svgHeight * 0.62} L ${svgWidth * 0.27} ${svgHeight * 0.71}`,
        branches: [
          `M ${svgWidth * 0.53} ${svgHeight * 0.18} L ${svgWidth * 0.67} ${svgHeight * 0.20} L ${svgWidth * 0.58} ${svgHeight * 0.30} L ${svgWidth * 0.76} ${svgHeight * 0.36}`,
          `M ${svgWidth * 0.35} ${svgHeight * 0.34} L ${svgWidth * 0.22} ${svgHeight * 0.32} L ${svgWidth * 0.12} ${svgHeight * 0.40}`,
          `M ${svgWidth * 0.43} ${svgHeight * 0.43} L ${svgWidth * 0.55} ${svgHeight * 0.51} L ${svgWidth * 0.49} ${svgHeight * 0.61}`,
        ],
        coreColor: "#ffffff",
        glowColor: "#7dd3fc",
        coreWidth: 2.4,
        glowWidth: 18,
        opacity: 0.88,
      },
      {
        key: "right-side-split",
        path: `M ${svgWidth * 1.08} ${svgHeight * 0.18} L ${svgWidth * 0.90} ${svgHeight * 0.27} L ${svgWidth * 0.97} ${svgHeight * 0.35} L ${svgWidth * 0.79} ${svgHeight * 0.45} L ${svgWidth * 0.87} ${svgHeight * 0.55} L ${svgWidth * 0.66} ${svgHeight * 0.69}`,
        branches: [
          `M ${svgWidth * 0.90} ${svgHeight * 0.27} L ${svgWidth * 0.73} ${svgHeight * 0.25} L ${svgWidth * 0.62} ${svgHeight * 0.34}`,
          `M ${svgWidth * 0.79} ${svgHeight * 0.45} L ${svgWidth * 0.63} ${svgHeight * 0.48} L ${svgWidth * 0.52} ${svgHeight * 0.58}`,
          `M ${svgWidth * 0.87} ${svgHeight * 0.55} L ${svgWidth * 1.02} ${svgHeight * 0.61} L ${svgWidth * 0.91} ${svgHeight * 0.74}`,
        ],
        coreColor: "#dff7ff",
        glowColor: "#22d3ee",
        coreWidth: 2,
        glowWidth: 15,
        opacity: 0.74,
      },
    ];

    const secondary: LightningBolt[] = [
      {
        key: "purple-ground-flash",
        path: `M ${svgWidth * 0.08} ${svgHeight * 0.78} L ${svgWidth * 0.24} ${svgHeight * 0.68} L ${svgWidth * 0.41} ${svgHeight * 0.72} L ${svgWidth * 0.57} ${svgHeight * 0.60} L ${svgWidth * 0.76} ${svgHeight * 0.64} L ${svgWidth * 1.12} ${svgHeight * 0.49}`,
        branches: [
          `M ${svgWidth * 0.41} ${svgHeight * 0.72} L ${svgWidth * 0.33} ${svgHeight * 0.84} L ${svgWidth * 0.20} ${svgHeight * 0.90}`,
          `M ${svgWidth * 0.57} ${svgHeight * 0.60} L ${svgWidth * 0.49} ${svgHeight * 0.50} L ${svgWidth * 0.36} ${svgHeight * 0.47}`,
        ],
        coreColor: "#f5d0fe",
        glowColor: "#a855f7",
        coreWidth: 2.1,
        glowWidth: 17,
        opacity: 0.84,
      },
      {
        key: "distant-blue-crack",
        path: `M ${svgWidth * 0.96} ${svgHeight * 0.22} L ${svgWidth * 0.82} ${svgHeight * 0.31} L ${svgWidth * 0.88} ${svgHeight * 0.39} L ${svgWidth * 0.70} ${svgHeight * 0.51} L ${svgWidth * 0.77} ${svgHeight * 0.57}`,
        branches: [
          `M ${svgWidth * 0.82} ${svgHeight * 0.31} L ${svgWidth * 0.68} ${svgHeight * 0.32} L ${svgWidth * 0.58} ${svgHeight * 0.39}`,
          `M ${svgWidth * 0.70} ${svgHeight * 0.51} L ${svgWidth * 0.58} ${svgHeight * 0.58} L ${svgWidth * 0.48} ${svgHeight * 0.57}`,
        ],
        coreColor: "#cffafe",
        glowColor: "#22d3ee",
        coreWidth: 1.8,
        glowWidth: 14,
        opacity: 0.70,
      },
      {
        key: "top-purple-snap",
        path: `M ${-svgWidth * 0.12} ${svgHeight * 0.15} L ${svgWidth * 0.05} ${svgHeight * 0.10} L ${svgWidth * 0.20} ${svgHeight * 0.14} L ${svgWidth * 0.38} ${svgHeight * 0.07} L ${svgWidth * 0.57} ${svgHeight * 0.12} L ${svgWidth * 0.77} ${svgHeight * 0.06}`,
        branches: [
          `M ${svgWidth * 0.20} ${svgHeight * 0.14} L ${svgWidth * 0.27} ${svgHeight * 0.25} L ${svgWidth * 0.18} ${svgHeight * 0.32}`,
          `M ${svgWidth * 0.57} ${svgHeight * 0.12} L ${svgWidth * 0.64} ${svgHeight * 0.22} L ${svgWidth * 0.79} ${svgHeight * 0.25}`,
        ],
        coreColor: "#faf5ff",
        glowColor: "#c084fc",
        coreWidth: 1.7,
        glowWidth: 13,
        opacity: 0.68,
      },
      {
        key: "low-blue-branch",
        path: `M ${svgWidth * 0.02} ${svgHeight * 0.92} L ${svgWidth * 0.20} ${svgHeight * 0.80} L ${svgWidth * 0.35} ${svgHeight * 0.84} L ${svgWidth * 0.51} ${svgHeight * 0.73} L ${svgWidth * 0.68} ${svgHeight * 0.77} L ${svgWidth * 0.93} ${svgHeight * 0.64}`,
        branches: [
          `M ${svgWidth * 0.35} ${svgHeight * 0.84} L ${svgWidth * 0.28} ${svgHeight * 0.95} L ${svgWidth * 0.13} ${svgHeight * 1.02}`,
          `M ${svgWidth * 0.51} ${svgHeight * 0.73} L ${svgWidth * 0.42} ${svgHeight * 0.65} L ${svgWidth * 0.29} ${svgHeight * 0.65}`,
          `M ${svgWidth * 0.68} ${svgHeight * 0.77} L ${svgWidth * 0.82} ${svgHeight * 0.84} L ${svgWidth * 1.02} ${svgHeight * 0.82}`,
        ],
        coreColor: "#eff6ff",
        glowColor: "#60a5fa",
        coreWidth: 1.9,
        glowWidth: 15,
        opacity: 0.76,
      },
    ];

    return { primaryBolts: primary, secondaryBolts: secondary };
  }, [svgHeight, svgWidth]);

  const renderBolt = (bolt: LightningBolt) => (
    <React.Fragment key={bolt.key}>
      <Path
        d={bolt.path}
        stroke={bolt.glowColor}
        strokeWidth={bolt.glowWidth}
        strokeLinecap="butt"
        strokeLinejoin="miter"
        fill="none"
        opacity={bolt.opacity * stormStrength * 0.18}
      />
      <Path
        d={bolt.path}
        stroke={bolt.glowColor}
        strokeWidth={Math.max(5, bolt.coreWidth * 3.2)}
        strokeLinecap="butt"
        strokeLinejoin="miter"
        fill="none"
        opacity={bolt.opacity * stormStrength * 0.42}
      />
      <Path
        d={bolt.path}
        stroke={bolt.coreColor}
        strokeWidth={bolt.coreWidth}
        strokeLinecap="butt"
        strokeLinejoin="miter"
        fill="none"
        opacity={bolt.opacity * stormStrength}
      />
      {bolt.branches.map((branch, index) => (
        <React.Fragment key={`${bolt.key}-branch-${index}`}>
          <Path
            d={branch}
            stroke={bolt.glowColor}
            strokeWidth={Math.max(7, bolt.glowWidth * 0.62)}
            strokeLinecap="butt"
            strokeLinejoin="miter"
            fill="none"
            opacity={bolt.opacity * stormStrength * 0.13}
          />
          <Path
            d={branch}
            stroke={bolt.coreColor}
            strokeWidth={Math.max(1.25, bolt.coreWidth * 0.72)}
            strokeLinecap="butt"
            strokeLinejoin="miter"
            fill="none"
            opacity={bolt.opacity * stormStrength * 0.68}
          />
        </React.Fragment>
      ))}
    </React.Fragment>
  );

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <LinearGradient
        colors={["#02030b", "#040817", "#020617", "#010108"]}
        locations={[0, 0.36, 0.72, 1]}
        start={{ x: 0.18, y: 0 }}
        end={{ x: 0.86, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <Animated.View style={[styles.skyFlash, { opacity: skyFlashOpacity }]} />

      <Animated.View
        style={[
          styles.lightningLayer,
          {
            opacity: primaryOpacity,
            transform: [{ translateX: stormTranslateX }, { translateY: stormTranslateY }, { scale: stormScale }],
          },
        ]}
      >
        <Svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
          {primaryBolts.map(renderBolt)}
        </Svg>
      </Animated.View>

      <Animated.View
        style={[
          styles.lightningLayer,
          {
            opacity: secondaryOpacity,
            transform: [{ translateX: stormTranslateY }, { translateY: stormTranslateX }],
          },
        ]}
      >
        <Svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
          {secondaryBolts.map(renderBolt)}
        </Svg>
      </Animated.View>

      <LinearGradient
        colors={["rgba(2,6,23,0.14)", "rgba(2,6,23,0.58)", "rgba(0,0,0,0.30)"]}
        locations={[0, 0.66, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.vignette} />
      <View style={styles.readabilityWash} />
    </View>
  );
}

const styles = StyleSheet.create({
  lightningLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  skyFlash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#7dd3fc",
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.20)",
  },
  readabilityWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2,6,23,0.24)",
  },
});
