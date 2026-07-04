import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, useWindowDimensions, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Path, Stop } from "react-native-svg";

type FlowWaveVariant = "blue" | "green" | "purple";

type Props = {
  variant?: FlowWaveVariant;
  intensity?: "soft" | "standard";
};

type FlowLine = {
  key: string;
  path: string;
  color: string;
  opacity: number;
  width: number;
  dash?: string;
};

type LightningBolt = {
  key: string;
  path: string;
  color: string;
  glowColor: string;
  width: number;
  glowWidth: number;
  opacity: number;
};

export function FlowWaveBackground({ intensity = "standard" }: Props) {
  const { width, height } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(false);
  const driftAnim = useRef(new Animated.Value(0)).current;
  const counterDriftAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const flashAnim = useRef(new Animated.Value(0)).current;

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
      driftAnim.setValue(0.42);
      counterDriftAnim.setValue(0.32);
      pulseAnim.setValue(0.35);
      flashAnim.setValue(0.24);
      return;
    }

    const driftLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(driftAnim, {
          toValue: 1,
          duration: 22000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(driftAnim, {
          toValue: 0,
          duration: 22000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 3600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 6200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    const counterLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(counterDriftAnim, {
          toValue: 1,
          duration: 28000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(counterDriftAnim, {
          toValue: 0,
          duration: 28000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    const flashLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(900),
        Animated.timing(flashAnim, {
          toValue: 1,
          duration: 58,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(flashAnim, {
          toValue: 0.18,
          duration: 92,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(flashAnim, {
          toValue: 0.84,
          duration: 48,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(flashAnim, {
          toValue: 0.08,
          duration: 210,
          easing: Easing.out(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.delay(2600),
        Animated.timing(flashAnim, {
          toValue: 0.62,
          duration: 76,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(flashAnim, {
          toValue: 0.06,
          duration: 260,
          easing: Easing.out(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.delay(3600),
      ]),
    );

    driftLoop.start();
    pulseLoop.start();
    counterLoop.start();
    flashLoop.start();
    return () => {
      driftLoop.stop();
      pulseLoop.stop();
      counterLoop.stop();
      flashLoop.stop();
    };
  }, [counterDriftAnim, driftAnim, flashAnim, pulseAnim, reduceMotion]);

  const svgWidth = Math.max(width, 390);
  const svgHeight = Math.max(height, 760);
  const density = intensity === "soft" ? 0.72 : 1;
  const translateX = driftAnim.interpolate({ inputRange: [0, 1], outputRange: [-22, 28] });
  const translateY = driftAnim.interpolate({ inputRange: [0, 1], outputRange: [16, -18] });
  const counterTranslateX = counterDriftAnim.interpolate({ inputRange: [0, 1], outputRange: [30, -26] });
  const counterTranslateY = counterDriftAnim.interpolate({ inputRange: [0, 1], outputRange: [-10, 18] });
  const streamOpacity = pulseAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.72, 1, 0.78] });
  const dotOpacity = pulseAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.42, 0.86, 0.50] });
  const lightningOpacity = flashAnim.interpolate({ inputRange: [0, 0.18, 0.62, 1], outputRange: [0.08, 0.20, 0.72, 1] });
  const lightningShift = flashAnim.interpolate({ inputRange: [0, 1], outputRange: [-4, 5] });

  const { flowLines, particles, lightningBolts } = useMemo(() => {
    const baseY = svgHeight * 0.60;
    const lines: FlowLine[] = [];
    const bolts: LightningBolt[] = [
      {
        key: "storm-front-main",
        path: `M ${-svgWidth * 0.10} ${svgHeight * 0.38} L ${svgWidth * 0.16} ${svgHeight * 0.30} L ${svgWidth * 0.35} ${svgHeight * 0.34} L ${svgWidth * 0.52} ${svgHeight * 0.26} L ${svgWidth * 0.76} ${svgHeight * 0.30} L ${svgWidth * 1.10} ${svgHeight * 0.18}`,
        color: "#dbeafe",
        glowColor: "#38bdf8",
        width: 1.8,
        glowWidth: 9,
        opacity: 0.82,
      },
      {
        key: "storm-purple-cut",
        path: `M ${-svgWidth * 0.16} ${svgHeight * 0.58} L ${svgWidth * 0.12} ${svgHeight * 0.50} L ${svgWidth * 0.30} ${svgHeight * 0.53} L ${svgWidth * 0.49} ${svgHeight * 0.45} L ${svgWidth * 0.70} ${svgHeight * 0.49} L ${svgWidth * 1.06} ${svgHeight * 0.36}`,
        color: "#f5d0fe",
        glowColor: "#a855f7",
        width: 1.6,
        glowWidth: 8,
        opacity: 0.66,
      },
      {
        key: "storm-lower-arc",
        path: `M ${svgWidth * 0.08} ${svgHeight * 0.74} L ${svgWidth * 0.26} ${svgHeight * 0.68} L ${svgWidth * 0.43} ${svgHeight * 0.70} L ${svgWidth * 0.60} ${svgHeight * 0.62} L ${svgWidth * 0.82} ${svgHeight * 0.66} L ${svgWidth * 1.16} ${svgHeight * 0.54}`,
        color: "#cffafe",
        glowColor: "#22d3ee",
        width: 1.4,
        glowWidth: 7,
        opacity: 0.56,
      },
    ];
    const total = Math.round(18 * density);

    for (let index = 0; index < total; index += 1) {
      const offset = (index - total / 2) * 13;
      const startY = baseY + offset + (index % 4) * 9;
      const lift = svgHeight * (0.18 + (index % 5) * 0.018);
      const endY = startY - lift - (index % 3) * 26;
      const controlOneY = startY - svgHeight * (0.04 + (index % 3) * 0.018);
      const controlTwoY = endY + svgHeight * (0.13 + (index % 4) * 0.015);
      const color = index % 5 === 0 ? "#c084fc" : index % 3 === 0 ? "#38bdf8" : "#0ea5e9";

      lines.push({
        key: `fiber-${index}`,
        path: `M ${-svgWidth * 0.16} ${startY} C ${svgWidth * 0.18} ${controlOneY}, ${svgWidth * 0.54} ${controlTwoY}, ${svgWidth * 1.18} ${endY}`,
        color,
        opacity: index % 5 === 0 ? 0.22 : 0.16,
        width: index % 6 === 0 ? 2.4 : 1.1,
      });
    }

    for (let index = 0; index < Math.round(9 * density); index += 1) {
      const offset = (index - 4) * 24;
      const startY = baseY + offset + svgHeight * 0.08;
      const endY = startY - svgHeight * 0.32 - (index % 4) * 20;
      const color = index % 3 === 0 ? "#22d3ee" : index % 3 === 1 ? "#a855f7" : "#60a5fa";
      lines.push({
        key: `dotted-${index}`,
        path: `M ${-svgWidth * 0.12} ${startY} C ${svgWidth * 0.20} ${startY - svgHeight * 0.10}, ${svgWidth * 0.52} ${endY + svgHeight * 0.18}, ${svgWidth * 1.12} ${endY}`,
        color,
        opacity: index % 3 === 0 ? 0.72 : 0.54,
        width: index % 2 === 0 ? 3.2 : 2.2,
        dash: index % 2 === 0 ? "1 16" : "1 11",
      });
    }

    const dots = Array.from({ length: Math.round(56 * density) }).map((_, index) => {
      const along = (index * 47 + 19) % Math.max(1, svgWidth);
      const band = (index * 31 + 11) % Math.max(1, svgHeight * 0.52);
      const curveBias = Math.sin(index * 0.75) * 42;
      const x = along;
      const y = svgHeight * 0.16 + band + curveBias;
      const radius = index % 11 === 0 ? 2.5 : index % 5 === 0 ? 1.7 : 1.05;
      const color = index % 7 === 0 ? "#c084fc" : index % 4 === 0 ? "#60a5fa" : "#22d3ee";
      const opacity = index % 9 === 0 ? 0.62 : 0.28;
      return { key: index, x, y, radius, color, opacity };
    });

    return { flowLines: lines, particles: dots, lightningBolts: bolts };
  }, [density, svgHeight, svgWidth]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <LinearGradient
        colors={["#01030b", "#020817", "#031225", "#01020a"]}
        locations={[0, 0.38, 0.72, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <Animated.View style={[styles.flowLayer, { opacity: streamOpacity, transform: [{ translateX }, { translateY }] }]}>
        <Svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
          <Defs>
            <SvgLinearGradient id="fiberGlow" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#22d3ee" stopOpacity="0" />
              <Stop offset="0.24" stopColor="#22d3ee" stopOpacity="0.20" />
              <Stop offset="0.58" stopColor="#38bdf8" stopOpacity="0.36" />
              <Stop offset="0.82" stopColor="#a855f7" stopOpacity="0.26" />
              <Stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
            </SvgLinearGradient>
            <SvgLinearGradient id="purpleFiber" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#7c3aed" stopOpacity="0" />
              <Stop offset="0.42" stopColor="#8b5cf6" stopOpacity="0.30" />
              <Stop offset="0.72" stopColor="#22d3ee" stopOpacity="0.18" />
              <Stop offset="1" stopColor="#0f172a" stopOpacity="0" />
            </SvgLinearGradient>
          </Defs>

          <Path
            d={`M ${-svgWidth * 0.24} ${svgHeight * 0.76} C ${svgWidth * 0.18} ${svgHeight * 0.56}, ${svgWidth * 0.52} ${svgHeight * 0.70}, ${svgWidth * 1.24} ${svgHeight * 0.28}`}
            stroke="url(#fiberGlow)"
            strokeWidth="42"
            strokeLinecap="round"
            fill="none"
            opacity="0.08"
          />
          <Path
            d={`M ${-svgWidth * 0.18} ${svgHeight * 0.82} C ${svgWidth * 0.18} ${svgHeight * 0.64}, ${svgWidth * 0.60} ${svgHeight * 0.72}, ${svgWidth * 1.24} ${svgHeight * 0.34}`}
            stroke="url(#purpleFiber)"
            strokeWidth="32"
            strokeLinecap="round"
            fill="none"
            opacity="0.08"
          />

          {flowLines.map(line => (
            <Path
              key={line.key}
              d={line.path}
              stroke={line.color}
              strokeWidth={line.width}
              strokeLinecap="round"
              fill="none"
              opacity={line.opacity}
              strokeDasharray={line.dash}
            />
          ))}
        </Svg>
      </Animated.View>

      <Animated.View style={[styles.counterFlowLayer, { transform: [{ translateX: counterTranslateX }, { translateY: counterTranslateY }] }]}>
        <Svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
          {flowLines.filter((_, index) => index % 3 === 0).map(line => (
            <Path
              key={`counter-${line.key}`}
              d={line.path}
              stroke={line.color}
              strokeWidth={Math.max(0.8, line.width * 0.65)}
              strokeLinecap="round"
              fill="none"
              opacity={line.dash ? 0.30 : 0.10}
              strokeDasharray={line.dash ? "1 18" : undefined}
            />
          ))}
        </Svg>
      </Animated.View>

      <Animated.View
        style={[
          styles.lightningLayer,
          { opacity: lightningOpacity, transform: [{ translateX: lightningShift }, { translateY }] },
        ]}
      >
        <Svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
          {lightningBolts.map(bolt => (
            <React.Fragment key={bolt.key}>
              <Path
                d={bolt.path}
                stroke={bolt.glowColor}
                strokeWidth={bolt.glowWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                opacity={bolt.opacity * 0.18}
              />
              <Path
                d={bolt.path}
                stroke={bolt.glowColor}
                strokeWidth={Math.max(3.5, bolt.width * 2.6)}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                opacity={bolt.opacity * 0.34}
              />
              <Path
                d={bolt.path}
                stroke={bolt.color}
                strokeWidth={bolt.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                opacity={bolt.opacity}
              />
            </React.Fragment>
          ))}
        </Svg>
      </Animated.View>

      <Animated.View style={[styles.particleLayer, { opacity: dotOpacity }]}>
        <Svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
          {particles.map(dot => (
            <Circle
              key={dot.key}
              cx={dot.x}
              cy={dot.y}
              r={dot.radius}
              fill={dot.color}
              opacity={dot.opacity}
            />
          ))}
        </Svg>
      </Animated.View>

      <View style={styles.vignette} />
      <View style={styles.readabilityWash} />
    </View>
  );
}

const styles = StyleSheet.create({
  flowLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  counterFlowLayer: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.62,
  },
  lightningLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  particleLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.24)",
  },
  readabilityWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2,6,23,0.20)",
  },
});
