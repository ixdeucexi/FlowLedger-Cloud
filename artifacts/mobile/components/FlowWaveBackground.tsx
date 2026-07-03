import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, useWindowDimensions, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Path, Stop } from "react-native-svg";

type FlowWaveVariant = "blue" | "green" | "purple";

type Props = {
  variant?: FlowWaveVariant;
  intensity?: "soft" | "standard";
};

export function FlowWaveBackground({ intensity = "standard" }: Props) {
  const { width, height } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(false);
  const flowAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;

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
      flowAnim.setValue(0.35);
      pulseAnim.setValue(0.25);
      return;
    }

    const flowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(flowAnim, {
          toValue: 1,
          duration: 16000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(flowAnim, {
          toValue: 0,
          duration: 16000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 2400,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 5200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    flowLoop.start();
    pulseLoop.start();
    return () => {
      flowLoop.stop();
      pulseLoop.stop();
    };
  }, [flowAnim, pulseAnim, reduceMotion]);

  const svgWidth = Math.max(width, 390);
  const svgHeight = Math.max(height, 760);
  const particleCount = intensity === "soft" ? 22 : 36;
  const translateX = flowAnim.interpolate({ inputRange: [0, 1], outputRange: [-34, 34] });
  const translateY = flowAnim.interpolate({ inputRange: [0, 1], outputRange: [14, -22] });
  const lightningOpacity = pulseAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.34, 0.82, 0.42] });

  const particles = useMemo(() => (
    Array.from({ length: particleCount }).map((_, index) => {
      const x = (index * 73 + 29) % svgWidth;
      const y = (index * 127 + 41) % Math.max(1, svgHeight * 0.76);
      const radius = index % 6 === 0 ? 2.1 : index % 4 === 0 ? 1.45 : 0.95;
      const color = index % 3 === 0 ? "#22d3ee" : index % 3 === 1 ? "#8b5cf6" : "#60a5fa";
      const opacity = index % 5 === 0 ? 0.42 : 0.20;
      return { key: index, x, y: y + 36, radius, color, opacity };
    })
  ), [particleCount, svgHeight, svgWidth]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <LinearGradient
        colors={["#01030a", "#050817", "#071326", "#02030a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <Animated.View style={[styles.flowLayer, { transform: [{ translateX }, { translateY }] }]}>
        <Svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
          <Defs>
            <SvgLinearGradient id="waveGlow" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#22d3ee" stopOpacity="0" />
              <Stop offset="0.28" stopColor="#22d3ee" stopOpacity="0.32" />
              <Stop offset="0.54" stopColor="#8b5cf6" stopOpacity="0.48" />
              <Stop offset="0.78" stopColor="#2563eb" stopOpacity="0.28" />
              <Stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
            </SvgLinearGradient>
            <SvgLinearGradient id="lightningBlue" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#38bdf8" stopOpacity="0" />
              <Stop offset="0.42" stopColor="#38bdf8" stopOpacity="0.72" />
              <Stop offset="0.60" stopColor="#c084fc" stopOpacity="0.68" />
              <Stop offset="1" stopColor="#60a5fa" stopOpacity="0" />
            </SvgLinearGradient>
            <SvgLinearGradient id="deepPurple" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#312e81" stopOpacity="0" />
              <Stop offset="0.44" stopColor="#7c3aed" stopOpacity="0.42" />
              <Stop offset="0.88" stopColor="#06b6d4" stopOpacity="0.18" />
              <Stop offset="1" stopColor="#020617" stopOpacity="0" />
            </SvgLinearGradient>
          </Defs>

          <Path
            d={`M ${-180} ${svgHeight * 0.18} C ${svgWidth * 0.12} ${svgHeight * 0.02}, ${svgWidth * 0.48} ${svgHeight * 0.38}, ${svgWidth + 180} ${svgHeight * 0.12}`}
            stroke="url(#waveGlow)"
            strokeWidth="38"
            strokeLinecap="round"
            fill="none"
            opacity="0.11"
          />
          <Path
            d={`M ${-120} ${svgHeight * 0.28} C ${svgWidth * 0.20} ${svgHeight * 0.04}, ${svgWidth * 0.48} ${svgHeight * 0.46}, ${svgWidth + 120} ${svgHeight * 0.16}`}
            stroke="url(#waveGlow)"
            strokeWidth="8"
            strokeLinecap="round"
            fill="none"
            opacity="0.72"
          />
          <Path
            d={`M ${-110} ${svgHeight * 0.32} C ${svgWidth * 0.20} ${svgHeight * 0.10}, ${svgWidth * 0.54} ${svgHeight * 0.42}, ${svgWidth + 140} ${svgHeight * 0.20}`}
            stroke="url(#lightningBlue)"
            strokeWidth="2.2"
            strokeLinecap="round"
            fill="none"
            opacity="0.82"
          />
          <Path
            d={`M ${-150} ${svgHeight * 0.39} C ${svgWidth * 0.18} ${svgHeight * 0.11}, ${svgWidth * 0.54} ${svgHeight * 0.50}, ${svgWidth + 160} ${svgHeight * 0.23}`}
            stroke="url(#deepPurple)"
            strokeWidth="20"
            strokeLinecap="round"
            fill="none"
            opacity="0.24"
          />
          <Path
            d={`M ${-120} ${svgHeight * 0.68} C ${svgWidth * 0.24} ${svgHeight * 0.43}, ${svgWidth * 0.58} ${svgHeight * 0.88}, ${svgWidth + 130} ${svgHeight * 0.62}`}
            stroke="url(#waveGlow)"
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
            opacity="0.24"
          />

          {particles.map(dot => (
            <Circle key={dot.key} cx={dot.x} cy={dot.y} r={dot.radius} fill={dot.color} opacity={dot.opacity} />
          ))}
        </Svg>
      </Animated.View>

      <Animated.View style={[styles.lightningLayer, { opacity: lightningOpacity }]}>
        <Svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
          <Defs>
            <SvgLinearGradient id="boltCore" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#22d3ee" stopOpacity="0" />
              <Stop offset="0.30" stopColor="#7dd3fc" stopOpacity="0.90" />
              <Stop offset="0.52" stopColor="#c084fc" stopOpacity="0.95" />
              <Stop offset="0.78" stopColor="#60a5fa" stopOpacity="0.80" />
              <Stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
            </SvgLinearGradient>
          </Defs>
          <Path
            d={`M ${svgWidth * -0.08} ${svgHeight * 0.18} L ${svgWidth * 0.18} ${svgHeight * 0.13} L ${svgWidth * 0.12} ${svgHeight * 0.18} L ${svgWidth * 0.44} ${svgHeight * 0.09} L ${svgWidth * 0.36} ${svgHeight * 0.16} L ${svgWidth * 1.06} ${svgHeight * 0.03}`}
            stroke="url(#boltCore)"
            strokeWidth="5.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            opacity="0.22"
          />
          <Path
            d={`M ${svgWidth * -0.08} ${svgHeight * 0.18} L ${svgWidth * 0.18} ${svgHeight * 0.13} L ${svgWidth * 0.12} ${svgHeight * 0.18} L ${svgWidth * 0.44} ${svgHeight * 0.09} L ${svgWidth * 0.36} ${svgHeight * 0.16} L ${svgWidth * 1.06} ${svgHeight * 0.03}`}
            stroke="url(#boltCore)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            opacity="0.92"
          />
          <Path
            d={`M ${svgWidth * 0.10} ${svgHeight * 0.22} L ${svgWidth * 0.34} ${svgHeight * 0.16} L ${svgWidth * 0.28} ${svgHeight * 0.22} L ${svgWidth * 0.58} ${svgHeight * 0.13} L ${svgWidth * 0.45} ${svgHeight * 0.24} L ${svgWidth * 0.86} ${svgHeight * 0.10}`}
            stroke="#38bdf8"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            opacity="0.62"
          />
          <Path
            d={`M ${svgWidth * 0.02} ${svgHeight * 0.54} L ${svgWidth * 0.28} ${svgHeight * 0.49} L ${svgWidth * 0.22} ${svgHeight * 0.55} L ${svgWidth * 0.52} ${svgHeight * 0.48} L ${svgWidth * 0.44} ${svgHeight * 0.57} L ${svgWidth * 0.92} ${svgHeight * 0.45}`}
            stroke="#a855f7"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            opacity="0.42"
          />
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
    opacity: 0.94,
  },
  lightningLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.20)",
  },
  readabilityWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2,6,23,0.18)",
  },
});
