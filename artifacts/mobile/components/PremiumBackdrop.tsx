import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, useWindowDimensions, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Path, Stop } from "react-native-svg";

type Props = {
  variant?: "blue" | "green" | "purple";
};

const palettes = {
  blue: ["rgba(37,99,235,0.30)", "rgba(14,165,233,0.08)", "rgba(2,6,23,0)"] as const,
  green: ["rgba(34,197,94,0.24)", "rgba(20,184,166,0.08)", "rgba(2,6,23,0)"] as const,
  purple: ["rgba(124,58,237,0.26)", "rgba(37,99,235,0.10)", "rgba(2,6,23,0)"] as const,
};

export function PremiumBackdrop({ variant = "blue" }: Props) {
  const { width, height } = useWindowDimensions();
  const waveShift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(waveShift, {
          toValue: 1,
          duration: 9000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(waveShift, {
          toValue: 0,
          duration: 9000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [waveShift]);

  const translateX = waveShift.interpolate({ inputRange: [0, 1], outputRange: [-18, 18] });
  const translateY = waveShift.interpolate({ inputRange: [0, 1], outputRange: [0, -16] });
  const svgWidth = Math.max(width, 390);
  const svgHeight = Math.max(height, 760);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <LinearGradient
        colors={["#02030a", "#060817", "#08101f", "#02030a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <Animated.View style={[styles.waveLayer, { transform: [{ translateX }, { translateY }] }]}>
        <Svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
          <Defs>
            <SvgLinearGradient id="flowA" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#22d3ee" stopOpacity="0.04" />
              <Stop offset="0.35" stopColor="#38bdf8" stopOpacity="0.46" />
              <Stop offset="0.68" stopColor="#8b5cf6" stopOpacity="0.38" />
              <Stop offset="1" stopColor="#22c55e" stopOpacity="0.12" />
            </SvgLinearGradient>
            <SvgLinearGradient id="flowB" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#2563eb" stopOpacity="0" />
              <Stop offset="0.45" stopColor="#a855f7" stopOpacity="0.36" />
              <Stop offset="0.88" stopColor="#06b6d4" stopOpacity="0.26" />
              <Stop offset="1" stopColor="#22c55e" stopOpacity="0" />
            </SvgLinearGradient>
            <SvgLinearGradient id="flowC" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#22d3ee" stopOpacity="0" />
              <Stop offset="0.2" stopColor="#22d3ee" stopOpacity="0.55" />
              <Stop offset="0.52" stopColor="#7c3aed" stopOpacity="0.62" />
              <Stop offset="0.78" stopColor="#06b6d4" stopOpacity="0.42" />
              <Stop offset="1" stopColor="#22c55e" stopOpacity="0" />
            </SvgLinearGradient>
          </Defs>
          <Path
            d={`M ${-180} ${svgHeight * 0.20} C ${svgWidth * 0.16} ${svgHeight * 0.03}, ${svgWidth * 0.48} ${svgHeight * 0.36}, ${svgWidth + 180} ${svgHeight * 0.10}`}
            stroke="url(#flowC)"
            strokeWidth="34"
            strokeLinecap="round"
            fill="none"
            opacity="0.12"
          />
          <Path
            d={`M ${-120} ${svgHeight * 0.28} C ${svgWidth * 0.18} ${svgHeight * 0.04}, ${svgWidth * 0.48} ${svgHeight * 0.48}, ${svgWidth + 120} ${svgHeight * 0.16}`}
            stroke="url(#flowA)"
            strokeWidth="9"
            strokeLinecap="round"
            fill="none"
          />
          <Path
            d={`M ${-100} ${svgHeight * 0.31} C ${svgWidth * 0.18} ${svgHeight * 0.09}, ${svgWidth * 0.50} ${svgHeight * 0.42}, ${svgWidth + 160} ${svgHeight * 0.18}`}
            stroke="url(#flowC)"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
            opacity="0.92"
          />
          <Path
            d={`M ${-130} ${svgHeight * 0.24} C ${svgWidth * 0.16} ${svgHeight * 0.00}, ${svgWidth * 0.42} ${svgHeight * 0.42}, ${svgWidth + 130} ${svgHeight * 0.12}`}
            stroke="#38bdf8"
            strokeWidth="1.4"
            strokeLinecap="round"
            fill="none"
            opacity="0.36"
          />
          <Path
            d={`M ${-160} ${svgHeight * 0.36} C ${svgWidth * 0.18} ${svgHeight * 0.10}, ${svgWidth * 0.55} ${svgHeight * 0.44}, ${svgWidth + 170} ${svgHeight * 0.20}`}
            stroke="url(#flowB)"
            strokeWidth="22"
            strokeLinecap="round"
            fill="none"
            opacity="0.34"
          />
          <Path
            d={`M ${-120} ${svgHeight * 0.64} C ${svgWidth * 0.25} ${svgHeight * 0.38}, ${svgWidth * 0.55} ${svgHeight * 0.86}, ${svgWidth + 120} ${svgHeight * 0.58}`}
            stroke="url(#flowA)"
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
            opacity="0.32"
          />
          <Path
            d={`M ${-90} ${svgHeight * 0.70} C ${svgWidth * 0.20} ${svgHeight * 0.48}, ${svgWidth * 0.58} ${svgHeight * 0.84}, ${svgWidth + 100} ${svgHeight * 0.63}`}
            stroke="#a855f7"
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
            opacity="0.28"
          />
          {Array.from({ length: 34 }).map((_, index) => {
            const x = (index * 67) % svgWidth;
            const y = (index * 113) % Math.max(1, svgHeight * 0.72);
            const radius = index % 5 === 0 ? 2.2 : 1.1;
            const color = index % 3 === 0 ? "#22d3ee" : index % 3 === 1 ? "#8b5cf6" : "#22c55e";
            return <Circle key={index} cx={x} cy={y + 40} r={radius} fill={color} opacity={index % 4 === 0 ? 0.48 : 0.22} />;
          })}
        </Svg>
      </Animated.View>
      <LinearGradient
        colors={palettes[variant]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.orb, styles.orbOne]}
      />
      <LinearGradient
        colors={["rgba(16,185,129,0.18)", "rgba(59,130,246,0.08)", "rgba(2,6,23,0)"]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[styles.orb, styles.orbTwo]}
      />
      <View style={styles.deepVignette} />
      <View style={styles.grid} />
    </View>
  );
}

const styles = StyleSheet.create({
  waveLayer: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.98,
  },
  orb: { position: "absolute", width: 330, height: 330, borderRadius: 165 },
  orbOne: { top: -110, right: -95 },
  orbTwo: { bottom: 80, left: -145 },
  deepVignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.12)",
  },
  grid: {
    ...StyleSheet.absoluteFillObject,
    borderColor: "rgba(148,163,184,0.045)",
    borderWidth: 1,
  },
});
