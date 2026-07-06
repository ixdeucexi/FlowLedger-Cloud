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
          duration: 12000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(driftAnim, {
          toValue: 0,
          duration: 13000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    const shimmerLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: flashesEnabled ? 1 : 0.24,
          duration: flashesEnabled ? 1700 : 9000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: flashesEnabled ? 0.18 : 0.24,
          duration: flashesEnabled ? 1800 : 9000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(slowPulseAnim, {
          toValue: flashesEnabled ? 1 : 0.20,
          duration: flashesEnabled ? 3400 : 12000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(slowPulseAnim, {
          toValue: flashesEnabled ? 0.12 : 0.20,
          duration: flashesEnabled ? 3600 : 12000,
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
  const strength = intensity === "soft" ? 0.9 : 1.45;

  const driftX = driftAnim.interpolate({ inputRange: [0, 1], outputRange: [-48, 52] });
  const driftY = driftAnim.interpolate({ inputRange: [0, 1], outputRange: [24, -34] });
  const reverseDriftX = driftAnim.interpolate({ inputRange: [0, 1], outputRange: [42, -48] });
  const reverseDriftY = driftAnim.interpolate({ inputRange: [0, 1], outputRange: [-18, 28] });
  const shimmerOpacity = shimmerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.42, flashesEnabled ? 1 : 0.54] });
  const pulseOpacity = slowPulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.08, flashesEnabled ? 0.34 : 0.12] });

  const { primaryPaths, secondaryPaths, droplets } = useMemo(() => {
    const primary: FlowPath[] = [
      { key: "main-current-a", d: flowCurve(svgWidth, svgHeight, 0.34, 0.17), color: accents.primary, glow: accents.primary, opacity: 0.86, width: 3.1 },
      { key: "main-current-b", d: flowCurve(svgWidth, svgHeight, 0.40, 0.15), color: accents.secondary, glow: accents.secondary, opacity: 0.82, width: 2.8 },
      { key: "main-current-c", d: flowCurve(svgWidth, svgHeight, 0.47, 0.18), color: accents.tertiary, glow: accents.tertiary, opacity: 0.62, width: 2.4 },
      { key: "main-current-d", d: flowCurve(svgWidth, svgHeight, 0.55, 0.16), color: "#c084fc", glow: "#c084fc", opacity: 0.72, width: 2.6 },
      { key: "main-current-e", d: flowCurve(svgWidth, svgHeight, 0.63, 0.19), color: "#22d3ee", glow: "#22d3ee", opacity: 0.58, width: 2.2 },
      { key: "main-dotted-a", d: flowCurve(svgWidth, svgHeight, 0.37, 0.16), color: accents.primary, glow: accents.primary, opacity: 1, width: 6.2, dash: "1 13" },
      { key: "main-dotted-b", d: flowCurve(svgWidth, svgHeight, 0.51, 0.14), color: accents.tertiary, glow: accents.tertiary, opacity: 0.86, width: 5.6, dash: "1 15" },
      { key: "main-dotted-c", d: flowCurve(svgWidth, svgHeight, 0.60, 0.20), color: "#d946ef", glow: "#d946ef", opacity: 0.92, width: 5.8, dash: "1 14" },
      { key: "main-dotted-d", d: flowCurve(svgWidth, svgHeight, 0.70, 0.14), color: "#38bdf8", glow: "#38bdf8", opacity: 0.68, width: 4.8, dash: "1 17" },
    ];

    const secondary: FlowPath[] = [
      { key: "quiet-current-a", d: flowCurve(svgWidth, svgHeight, 0.16, 0.09), color: "#38bdf8", glow: "#38bdf8", opacity: 0.46, width: 1.7 },
      { key: "quiet-current-b", d: flowCurve(svgWidth, svgHeight, 0.25, 0.11), color: "#818cf8", glow: "#818cf8", opacity: 0.48, width: 1.8 },
      { key: "quiet-current-c", d: flowCurve(svgWidth, svgHeight, 0.76, 0.11), color: "#22d3ee", glow: "#22d3ee", opacity: 0.48, width: 1.7 },
      { key: "quiet-current-d", d: flowCurve(svgWidth, svgHeight, 0.84, 0.13), color: "#8b5cf6", glow: "#8b5cf6", opacity: 0.50, width: 1.8 },
      { key: "quiet-dotted-a", d: flowCurve(svgWidth, svgHeight, 0.22, 0.10), color: "#38bdf8", glow: "#38bdf8", opacity: 0.56, width: 4.2, dash: "1 18" },
      { key: "quiet-dotted-b", d: flowCurve(svgWidth, svgHeight, 0.80, 0.12), color: "#a855f7", glow: "#a855f7", opacity: 0.62, width: 4.4, dash: "1 18" },
    ];

    const seeds = [
      [0.08, 0.58, 2.6, accents.primary, 0.80],
      [0.17, 0.51, 2.0, accents.secondary, 0.70],
      [0.28, 0.45, 2.5, accents.primary, 0.78],
      [0.39, 0.49, 1.8, accents.tertiary, 0.64],
      [0.50, 0.38, 2.9, "#c084fc", 0.82],
      [0.60, 0.48, 2.1, accents.primary, 0.72],
      [0.71, 0.33, 2.7, accents.secondary, 0.78],
      [0.82, 0.41, 2.0, accents.tertiary, 0.66],
      [0.91, 0.36, 2.4, "#22d3ee", 0.76],
      [0.13, 0.23, 1.7, "#38bdf8", 0.48],
      [0.34, 0.68, 1.9, "#d946ef", 0.58],
      [0.74, 0.77, 2.2, "#8b5cf6", 0.56],
      [0.88, 0.69, 1.8, "#38bdf8", 0.52],
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
        opacity={path.opacity * strength * 0.22}
      />
      <Path
        d={path.d}
        stroke={path.color}
        strokeWidth={path.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={path.dash}
        fill="none"
        opacity={Math.min(1, path.opacity * strength)}
      />
    </React.Fragment>
  );

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <LinearGradient
        colors={["#01020a", "#030818", "#020617", "#01020a"]}
        locations={[0, 0.36, 0.72, 1]}
        start={{ x: 0.18, y: 0 }}
        end={{ x: 0.86, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <Animated.View style={[styles.energyWash, { opacity: pulseOpacity }]}>
        <LinearGradient
          colors={["rgba(34,211,238,0)", "rgba(34,211,238,0.26)", "rgba(168,85,247,0.34)", "rgba(34,211,238,0)"]}
          locations={[0, 0.34, 0.66, 1]}
          start={{ x: 0.05, y: 0.72 }}
          end={{ x: 0.96, y: 0.30 }}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>

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
            <Circle key={drop.key} cx={drop.cx} cy={drop.cy} r={drop.r} fill={drop.color} opacity={Math.min(1, drop.opacity * strength)} />
          ))}
        </Svg>
      </Animated.View>

      <Animated.View
        style={[
          styles.flowLayer,
          {
            opacity: 0.86,
            transform: [{ translateX: reverseDriftX }, { translateY: reverseDriftY }],
          },
        ]}
      >
        <Svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
          {secondaryPaths.map(renderFlowPath)}
        </Svg>
      </Animated.View>

      <LinearGradient
        colors={["rgba(2,6,23,0.02)", "rgba(2,6,23,0.24)", "rgba(0,0,0,0.18)"]}
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
    backgroundColor: "rgba(34,211,238,0.28)",
  },
  energyWash: {
    ...StyleSheet.absoluteFillObject,
    transform: [{ rotate: "-9deg" }, { scale: 1.18 }],
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  readabilityWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2,6,23,0.06)",
  },
});
