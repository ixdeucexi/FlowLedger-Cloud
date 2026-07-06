import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, useWindowDimensions, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

type FlowWaveVariant = "blue" | "green" | "purple";

type Props = {
  variant?: FlowWaveVariant;
  intensity?: "soft" | "standard";
  flashesEnabled?: boolean;
};

type FlowPath = {
  key: string;
  d: string;
  color: string;
  glow: string;
  opacity: number;
  width: number;
  dash?: string;
};

type Droplet = {
  key: string;
  cx: number;
  cy: number;
  r: number;
  color: string;
  opacity: number;
};

const VARIANT_ACCENTS: Record<FlowWaveVariant, { primary: string; secondary: string; tertiary: string }> = {
  blue: { primary: "#38bdf8", secondary: "#2563eb", tertiary: "#22c55e" },
  green: { primary: "#22c55e", secondary: "#38bdf8", tertiary: "#8b5cf6" },
  purple: { primary: "#a855f7", secondary: "#38bdf8", tertiary: "#22c55e" },
};

function flowCurve(width: number, height: number, y: number, lift: number) {
  return [
    `M ${-width * 0.18} ${height * y}`,
    `C ${width * 0.12} ${height * (y - lift)}, ${width * 0.28} ${height * (y + lift * 0.72)}, ${width * 0.50} ${height * (y - lift * 0.28)}`,
    `S ${width * 0.82} ${height * (y - lift * 1.28)}, ${width * 1.18} ${height * (y - lift * 0.48)}`,
  ].join(" ");
}

export function FlowWaveBackground({ variant = "blue", intensity = "standard", flashesEnabled = true }: Props) {
  const { width, height } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(false);
  const driftAnim = useRef(new Animated.Value(0)).current;
  const shimmerAnim = useRef(new Animated.Value(0)).current;
  const slowPulseAnim = useRef(new Animated.Value(0)).current;

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
      driftAnim.setValue(0.34);
      shimmerAnim.setValue(0.28);
      slowPulseAnim.setValue(0.18);
      return;
    }

    const driftLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(driftAnim, {
          toValue: 1,
          duration: 18000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(driftAnim, {
          toValue: 0,
          duration: 19000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    const shimmerLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: flashesEnabled ? 1 : 0.24,
          duration: flashesEnabled ? 2600 : 9000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: flashesEnabled ? 0.18 : 0.24,
          duration: flashesEnabled ? 2400 : 9000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(slowPulseAnim, {
          toValue: flashesEnabled ? 1 : 0.20,
          duration: flashesEnabled ? 5400 : 12000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(slowPulseAnim, {
          toValue: flashesEnabled ? 0.12 : 0.20,
          duration: flashesEnabled ? 5200 : 12000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    driftLoop.start();
    shimmerLoop.start();
    pulseLoop.start();
    return () => {
      driftLoop.stop();
      shimmerLoop.stop();
      pulseLoop.stop();
    };
  }, [driftAnim, flashesEnabled, reduceMotion, shimmerAnim, slowPulseAnim]);

  const svgWidth = Math.max(width, 390);
  const svgHeight = Math.max(height, 760);
  const accents = VARIANT_ACCENTS[variant];
  const strength = intensity === "soft" ? 0.68 : 1;

  const driftX = driftAnim.interpolate({ inputRange: [0, 1], outputRange: [-34, 34] });
  const driftY = driftAnim.interpolate({ inputRange: [0, 1], outputRange: [18, -24] });
  const reverseDriftX = driftAnim.interpolate({ inputRange: [0, 1], outputRange: [24, -30] });
  const reverseDriftY = driftAnim.interpolate({ inputRange: [0, 1], outputRange: [-12, 18] });
  const shimmerOpacity = shimmerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.20, flashesEnabled ? 0.78 : 0.28] });
  const pulseOpacity = slowPulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.05, flashesEnabled ? 0.22 : 0.08] });

  const { primaryPaths, secondaryPaths, droplets } = useMemo(() => {
    const primary: FlowPath[] = [
      { key: "main-current-a", d: flowCurve(svgWidth, svgHeight, 0.38, 0.15), color: accents.primary, glow: accents.primary, opacity: 0.58, width: 1.8 },
      { key: "main-current-b", d: flowCurve(svgWidth, svgHeight, 0.44, 0.13), color: accents.secondary, glow: accents.secondary, opacity: 0.44, width: 1.4 },
      { key: "main-current-c", d: flowCurve(svgWidth, svgHeight, 0.51, 0.16), color: accents.tertiary, glow: accents.tertiary, opacity: 0.34, width: 1.3 },
      { key: "main-dotted-a", d: flowCurve(svgWidth, svgHeight, 0.42, 0.14), color: accents.primary, glow: accents.primary, opacity: 0.75, width: 3.5, dash: "1 18" },
      { key: "main-dotted-b", d: flowCurve(svgWidth, svgHeight, 0.56, 0.12), color: accents.tertiary, glow: accents.tertiary, opacity: 0.50, width: 3, dash: "1 22" },
      { key: "main-dotted-c", d: flowCurve(svgWidth, svgHeight, 0.64, 0.18), color: "#c084fc", glow: "#c084fc", opacity: 0.48, width: 3, dash: "1 20" },
    ];

    const secondary: FlowPath[] = [
      { key: "quiet-current-a", d: flowCurve(svgWidth, svgHeight, 0.18, 0.08), color: "#38bdf8", glow: "#38bdf8", opacity: 0.22, width: 1.1 },
      { key: "quiet-current-b", d: flowCurve(svgWidth, svgHeight, 0.28, 0.10), color: "#818cf8", glow: "#818cf8", opacity: 0.25, width: 1.2 },
      { key: "quiet-current-c", d: flowCurve(svgWidth, svgHeight, 0.74, 0.10), color: "#22d3ee", glow: "#22d3ee", opacity: 0.25, width: 1.1 },
      { key: "quiet-current-d", d: flowCurve(svgWidth, svgHeight, 0.82, 0.12), color: "#8b5cf6", glow: "#8b5cf6", opacity: 0.26, width: 1.2 },
      { key: "quiet-dotted-a", d: flowCurve(svgWidth, svgHeight, 0.24, 0.09), color: "#38bdf8", glow: "#38bdf8", opacity: 0.30, width: 2.6, dash: "1 24" },
      { key: "quiet-dotted-b", d: flowCurve(svgWidth, svgHeight, 0.78, 0.11), color: "#a855f7", glow: "#a855f7", opacity: 0.34, width: 2.8, dash: "1 24" },
    ];

    const seeds = [
      [0.12, 0.62, 1.7, accents.primary, 0.52],
      [0.23, 0.55, 1.2, accents.secondary, 0.38],
      [0.35, 0.43, 1.5, accents.primary, 0.50],
      [0.48, 0.50, 1.0, accents.tertiary, 0.36],
      [0.57, 0.39, 1.7, "#c084fc", 0.52],
      [0.68, 0.48, 1.2, accents.primary, 0.44],
      [0.78, 0.34, 1.6, accents.secondary, 0.48],
      [0.89, 0.42, 1.1, accents.tertiary, 0.36],
      [0.16, 0.25, 1.0, "#38bdf8", 0.26],
      [0.72, 0.77, 1.4, "#8b5cf6", 0.30],
    ] as const;

    return {
      primaryPaths: primary,
      secondaryPaths: secondary,
      droplets: seeds.map(([x, y, r, color, opacity], index): Droplet => ({
        key: `drop-${index}`,
        cx: svgWidth * x,
        cy: svgHeight * y,
        r,
        color,
        opacity,
      })),
    };
  }, [accents.primary, accents.secondary, accents.tertiary, svgHeight, svgWidth]);

  const renderFlowPath = (path: FlowPath) => (
    <React.Fragment key={path.key}>
      <Path
        d={path.d}
        stroke={path.glow}
        strokeWidth={path.width * 7}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={path.dash}
        fill="none"
        opacity={path.opacity * strength * 0.12}
      />
      <Path
        d={path.d}
        stroke={path.color}
        strokeWidth={path.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={path.dash}
        fill="none"
        opacity={path.opacity * strength}
      />
    </React.Fragment>
  );

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <LinearGradient
        colors={["#02030b", "#040816", "#020617", "#01030a"]}
        locations={[0, 0.36, 0.72, 1]}
        start={{ x: 0.18, y: 0 }}
        end={{ x: 0.86, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <Animated.View style={[styles.deepCurrentGlow, { opacity: pulseOpacity }]} />

      <Animated.View
        style={[
          styles.flowLayer,
          {
            opacity: shimmerOpacity,
            transform: [{ translateX: driftX }, { translateY: driftY }],
          },
        ]}
      >
        <Svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
          {primaryPaths.map(renderFlowPath)}
          {droplets.map(drop => (
            <Circle key={drop.key} cx={drop.cx} cy={drop.cy} r={drop.r} fill={drop.color} opacity={drop.opacity * strength} />
          ))}
        </Svg>
      </Animated.View>

      <Animated.View
        style={[
          styles.flowLayer,
          {
            opacity: 0.62,
            transform: [{ translateX: reverseDriftX }, { translateY: reverseDriftY }],
          },
        ]}
      >
        <Svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
          {secondaryPaths.map(renderFlowPath)}
        </Svg>
      </Animated.View>

      <LinearGradient
        colors={["rgba(2,6,23,0.08)", "rgba(2,6,23,0.48)", "rgba(0,0,0,0.36)"]}
        locations={[0, 0.64, 1]}
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
  flowLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  deepCurrentGlow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#38bdf8",
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  readabilityWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2,6,23,0.22)",
  },
});
