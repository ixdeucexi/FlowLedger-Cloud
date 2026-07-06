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

type TopologyPath = {
  key: string;
  d: string;
  color: string;
  opacity: number;
  width: number;
};

type TopologyPoint = {
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

function organicContourPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  phase: number,
  wobble = 0.12,
) {
  const count = 12;
  const points = Array.from({ length: count }, (_, index) => {
    const angle = (Math.PI * 2 * index) / count;
    const pulse =
      1 +
      Math.sin(angle * 3 + phase) * wobble +
      Math.cos(angle * 5 - phase * 0.8) * wobble * 0.52;

    return {
      x: cx + Math.cos(angle) * rx * pulse,
      y: cy + Math.sin(angle) * ry * pulse,
    };
  });

  const first = points[0];
  const second = points[1];
  const firstMid = {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };

  const parts = [`M ${firstMid.x.toFixed(1)} ${firstMid.y.toFixed(1)}`];
  for (let index = 1; index <= points.length; index += 1) {
    const current = points[index % points.length];
    const next = points[(index + 1) % points.length];
    const mid = {
      x: (current.x + next.x) / 2,
      y: (current.y + next.y) / 2,
    };
    parts.push(`Q ${current.x.toFixed(1)} ${current.y.toFixed(1)} ${mid.x.toFixed(1)} ${mid.y.toFixed(1)}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

function ridgeLine(width: number, height: number, y: number, phase: number) {
  return [
    `M ${-width * 0.18} ${height * y}`,
    `C ${width * 0.12} ${height * (y - 0.08 + phase)}, ${width * 0.28} ${height * (y + 0.08 - phase)}, ${width * 0.52} ${height * (y - 0.02)}`,
    `S ${width * 0.82} ${height * (y + 0.07)}, ${width * 1.16} ${height * (y - 0.04 - phase)}`,
  ].join(" ");
}

export function FlowWaveBackground({ variant = "blue", intensity = "standard", flashesEnabled = true }: Props) {
  const { width, height } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(false);
  const topologyAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

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
      topologyAnim.setValue(0.36);
      glowAnim.setValue(0.48);
      return;
    }

    const topologyLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(topologyAnim, {
          toValue: 1,
          duration: 14000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(topologyAnim, {
          toValue: 0,
          duration: 16000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: flashesEnabled ? 1 : 0.52,
          duration: flashesEnabled ? 2600 : 11000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: flashesEnabled ? 0.18 : 0.52,
          duration: flashesEnabled ? 3200 : 11000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    topologyLoop.start();
    glowLoop.start();
    return () => {
      topologyLoop.stop();
      glowLoop.stop();
    };
  }, [flashesEnabled, glowAnim, reduceMotion, topologyAnim]);

  const svgWidth = Math.max(width, 390);
  const svgHeight = Math.max(height, 760);
  const accents = VARIANT_ACCENTS[variant];
  const strength = intensity === "soft" ? 0.78 : 1;

  const topologyShiftX = topologyAnim.interpolate({ inputRange: [0, 1], outputRange: [-22, 28] });
  const topologyShiftY = topologyAnim.interpolate({ inputRange: [0, 1], outputRange: [18, -20] });
  const counterShiftX = topologyAnim.interpolate({ inputRange: [0, 1], outputRange: [18, -24] });
  const counterShiftY = topologyAnim.interpolate({ inputRange: [0, 1], outputRange: [-14, 18] });
  const topologyScale = topologyAnim.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1.045] });
  const counterScale = topologyAnim.interpolate({ inputRange: [0, 1], outputRange: [1.035, 0.99] });
  const topologyOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.48 * strength, flashesEnabled ? 0.96 * strength : 0.62 * strength],
  });
  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.12 * strength, flashesEnabled ? 0.44 * strength : 0.20 * strength],
  });

  const { frontContours, rearContours, points } = useMemo(() => {
    const clusters = [
      { cx: svgWidth * 0.78, cy: svgHeight * 0.20, rx: 46, ry: 34, color: accents.secondary, wobble: 0.12 },
      { cx: svgWidth * 0.55, cy: svgHeight * 0.45, rx: 58, ry: 42, color: accents.primary, wobble: 0.15 },
      { cx: svgWidth * 0.18, cy: svgHeight * 0.70, rx: 52, ry: 38, color: accents.tertiary, wobble: 0.13 },
      { cx: svgWidth * 0.88, cy: svgHeight * 0.78, rx: 44, ry: 32, color: "#c084fc", wobble: 0.14 },
    ];

    const contours: TopologyPath[] = [];
    clusters.forEach((cluster, clusterIndex) => {
      for (let ring = 0; ring < 8; ring += 1) {
        const spread = 1 + ring * 0.42;
        contours.push({
          key: `topology-${clusterIndex}-${ring}`,
          d: organicContourPath(
            cluster.cx,
            cluster.cy,
            cluster.rx * spread,
            cluster.ry * spread,
            clusterIndex * 0.9 + ring * 0.42,
            cluster.wobble,
          ),
          color: cluster.color,
          opacity: Math.max(0.10, 0.64 - ring * 0.055),
          width: ring % 3 === 0 ? 1.25 : 0.95,
        });
      }
    });

    const ridges: TopologyPath[] = [
      { key: "ridge-a", d: ridgeLine(svgWidth, svgHeight, 0.28, 0.012), color: accents.secondary, opacity: 0.26, width: 1.1 },
      { key: "ridge-b", d: ridgeLine(svgWidth, svgHeight, 0.40, -0.006), color: "#22d3ee", opacity: 0.22, width: 1.0 },
      { key: "ridge-c", d: ridgeLine(svgWidth, svgHeight, 0.62, 0.010), color: accents.primary, opacity: 0.24, width: 1.0 },
      { key: "ridge-d", d: ridgeLine(svgWidth, svgHeight, 0.82, -0.011), color: "#c084fc", opacity: 0.22, width: 1.0 },
    ];

    const dotSeeds: TopologyPoint[] = [];
    const dotColors = [accents.secondary, "#22d3ee", accents.primary, accents.tertiary, "#c084fc"];
    for (let i = 0; i < 36; i += 1) {
      const column = i % 9;
      const row = Math.floor(i / 9);
      const jitterX = Math.sin(i * 2.17) * svgWidth * 0.025;
      const jitterY = Math.cos(i * 1.73) * svgHeight * 0.022;
      dotSeeds.push({
        key: `topology-node-${i}`,
        cx: svgWidth * (0.08 + column * 0.105) + jitterX,
        cy: svgHeight * (0.13 + row * 0.20) + jitterY,
        r: 0.8 + (i % 4) * 0.25,
        color: dotColors[i % dotColors.length],
        opacity: 0.18 + (i % 5) * 0.045,
      });
    }

    return {
      frontContours: [...contours, ...ridges],
      rearContours: contours.slice().reverse().map(path => ({
        ...path,
        key: `${path.key}-rear`,
        opacity: path.opacity * 0.55,
        width: path.width * 0.85,
      })),
      points: dotSeeds,
    };
  }, [accents.primary, accents.secondary, accents.tertiary, svgHeight, svgWidth]);

  const renderPath = (path: TopologyPath) => (
    <React.Fragment key={path.key}>
      <Path
        d={path.d}
        stroke={path.color}
        strokeWidth={path.width * 8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity={path.opacity * 0.10}
      />
      <Path
        d={path.d}
        stroke={path.color}
        strokeWidth={path.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity={path.opacity}
      />
    </React.Fragment>
  );

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <LinearGradient
        colors={["#01020a", "#031326", "#020617", "#01020a"]}
        locations={[0, 0.34, 0.72, 1]}
        start={{ x: 0.10, y: 0 }}
        end={{ x: 0.92, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <Animated.View style={[styles.topologyGlow, { opacity: glowOpacity }]}>
        <LinearGradient
          colors={["rgba(34,211,238,0)", "rgba(34,211,238,0.30)", "rgba(168,85,247,0.32)", "rgba(34,197,94,0.18)", "rgba(34,211,238,0)"]}
          locations={[0, 0.26, 0.52, 0.76, 1]}
          start={{ x: 0.06, y: 0.20 }}
          end={{ x: 0.92, y: 0.90 }}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.topologyLayer,
          {
            opacity: topologyOpacity,
            transform: [{ translateX: counterShiftX }, { translateY: counterShiftY }, { scale: counterScale }],
          },
        ]}
      >
        <Svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
          {rearContours.map(renderPath)}
        </Svg>
      </Animated.View>

      <Animated.View
        style={[
          styles.topologyLayer,
          {
            opacity: topologyOpacity,
            transform: [{ translateX: topologyShiftX }, { translateY: topologyShiftY }, { scale: topologyScale }],
          },
        ]}
      >
        <Svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
          {frontContours.map(renderPath)}
          {points.map(point => (
            <React.Fragment key={point.key}>
              <Circle cx={point.cx} cy={point.cy} r={point.r * 5.5} fill={point.color} opacity={point.opacity * 0.10} />
              <Circle cx={point.cx} cy={point.cy} r={point.r} fill={point.color} opacity={point.opacity} />
            </React.Fragment>
          ))}
        </Svg>
      </Animated.View>

      <LinearGradient
        colors={["rgba(2,6,23,0.02)", "rgba(2,6,23,0.22)", "rgba(0,0,0,0.22)"]}
        locations={[0, 0.62, 1]}
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
  topologyLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  topologyGlow: {
    ...StyleSheet.absoluteFillObject,
    transform: [{ rotate: "-10deg" }, { scale: 1.16 }],
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.14)",
  },
  readabilityWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2,6,23,0.06)",
  },
});
