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

type GridDot = {
  key: string;
  cx: number;
  cy: number;
  r: number;
  color: string;
  opacity: number;
};

type Ripple = {
  key: string;
  cx: number;
  cy: number;
  color: string;
  opacity: number;
  radii: number[];
};

const VARIANT_ACCENTS: Record<FlowWaveVariant, { primary: string; secondary: string; tertiary: string }> = {
  blue: { primary: "#38bdf8", secondary: "#2563eb", tertiary: "#22c55e" },
  green: { primary: "#22c55e", secondary: "#38bdf8", tertiary: "#8b5cf6" },
  purple: { primary: "#a855f7", secondary: "#38bdf8", tertiary: "#22c55e" },
};

function softWave(width: number, height: number, y: number, lift: number) {
  return [
    `M ${-width * 0.10} ${height * y}`,
    `C ${width * 0.14} ${height * (y - lift)}, ${width * 0.34} ${height * (y + lift)}, ${width * 0.54} ${height * (y - lift * 0.28)}`,
    `S ${width * 0.84} ${height * (y + lift * 0.52)}, ${width * 1.12} ${height * (y - lift * 0.18)}`,
  ].join(" ");
}

export function FlowWaveBackground({ variant = "blue", intensity = "standard", flashesEnabled = true }: Props) {
  const { width, height } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(false);
  const rippleAnim = useRef(new Animated.Value(0)).current;
  const driftAnim = useRef(new Animated.Value(0)).current;
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
      rippleAnim.setValue(0.42);
      driftAnim.setValue(0.34);
      glowAnim.setValue(0.52);
      return;
    }

    const rippleLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(rippleAnim, {
          toValue: 1,
          duration: flashesEnabled ? 3600 : 9000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(rippleAnim, {
          toValue: 0,
          duration: flashesEnabled ? 3800 : 9000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    const driftLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(driftAnim, {
          toValue: 1,
          duration: 15500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(driftAnim, {
          toValue: 0,
          duration: 16500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: flashesEnabled ? 1 : 0.54,
          duration: flashesEnabled ? 2400 : 11000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: flashesEnabled ? 0.20 : 0.54,
          duration: flashesEnabled ? 2800 : 11000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    rippleLoop.start();
    driftLoop.start();
    glowLoop.start();
    return () => {
      rippleLoop.stop();
      driftLoop.stop();
      glowLoop.stop();
    };
  }, [driftAnim, flashesEnabled, glowAnim, reduceMotion, rippleAnim]);

  const svgWidth = Math.max(width, 390);
  const svgHeight = Math.max(height, 760);
  const accents = VARIANT_ACCENTS[variant];
  const strength = intensity === "soft" ? 0.82 : 1;

  const rippleScale = rippleAnim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.18] });
  const counterRippleScale = rippleAnim.interpolate({ inputRange: [0, 1], outputRange: [1.14, 0.96] });
  const rippleOpacity = rippleAnim.interpolate({
    inputRange: [0, 0.52, 1],
    outputRange: [0.42 * strength, flashesEnabled ? 0.98 * strength : 0.62 * strength, 0.32 * strength],
  });
  const counterRippleOpacity = rippleAnim.interpolate({
    inputRange: [0, 0.48, 1],
    outputRange: [0.30 * strength, 0.58 * strength, flashesEnabled ? 0.86 * strength : 0.50 * strength],
  });
  const gridOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.34 * strength, flashesEnabled ? 0.82 * strength : 0.48 * strength],
  });
  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.12 * strength, flashesEnabled ? 0.44 * strength : 0.20 * strength],
  });
  const driftX = driftAnim.interpolate({ inputRange: [0, 1], outputRange: [-18, 22] });
  const driftY = driftAnim.interpolate({ inputRange: [0, 1], outputRange: [14, -16] });
  const counterDriftX = driftAnim.interpolate({ inputRange: [0, 1], outputRange: [16, -20] });
  const counterDriftY = driftAnim.interpolate({ inputRange: [0, 1], outputRange: [-10, 16] });

  const { gridDots, ripples, wavePaths } = useMemo(() => {
    const dotColors = [accents.secondary, "#22d3ee", accents.primary, accents.tertiary, "#c084fc"];
    const dots: GridDot[] = [];
    const columns = Math.max(7, Math.round(svgWidth / 58));
    const rows = Math.max(10, Math.round(svgHeight / 70));

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < columns; col += 1) {
        const offset = row % 2 ? 0.46 : 0;
        const cx = ((col + 0.45 + offset) / columns) * svgWidth;
        const cy = ((row + 0.44) / rows) * svgHeight;
        const centerPull = 1 - Math.min(0.72, Math.abs(cy - svgHeight * 0.48) / svgHeight);
        dots.push({
          key: `water-grid-${row}-${col}`,
          cx,
          cy,
          r: 0.8 + ((row + col) % 4) * 0.34,
          color: dotColors[(row + col) % dotColors.length],
          opacity: 0.18 + centerPull * 0.26,
        });
      }
    }

    const rippleSet: Ripple[] = [
      {
        key: "ripple-upper",
        cx: svgWidth * 0.82,
        cy: svgHeight * 0.22,
        color: accents.secondary,
        opacity: 0.58,
        radii: [46, 104, 172, 252, 340],
      },
      {
        key: "ripple-mid",
        cx: svgWidth * 0.46,
        cy: svgHeight * 0.48,
        color: accents.primary,
        opacity: 0.52,
        radii: [58, 132, 218, 316, 430],
      },
      {
        key: "ripple-lower",
        cx: svgWidth * 0.18,
        cy: svgHeight * 0.78,
        color: accents.tertiary,
        opacity: 0.40,
        radii: [52, 122, 204, 300, 408],
      },
    ];

    return {
      gridDots: dots,
      ripples: rippleSet,
      wavePaths: [
        { key: "waterline-a", d: softWave(svgWidth, svgHeight, 0.32, 0.05), color: accents.secondary, opacity: 0.34 },
        { key: "waterline-b", d: softWave(svgWidth, svgHeight, 0.58, 0.06), color: accents.primary, opacity: 0.36 },
        { key: "waterline-c", d: softWave(svgWidth, svgHeight, 0.73, 0.045), color: accents.tertiary, opacity: 0.24 },
      ],
    };
  }, [accents.primary, accents.secondary, accents.tertiary, svgHeight, svgWidth]);

  const renderRipple = (ripple: Ripple) => (
    <React.Fragment key={ripple.key}>
      {ripple.radii.map((radius, index) => (
        <Circle
          key={`${ripple.key}-${radius}`}
          cx={ripple.cx}
          cy={ripple.cy}
          r={radius}
          stroke={ripple.color}
          strokeWidth={index === 0 ? 1.4 : 1}
          fill="none"
          opacity={Math.max(0.05, ripple.opacity - index * 0.075)}
        />
      ))}
    </React.Fragment>
  );

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <LinearGradient
        colors={["#01020a", "#031326", "#020617", "#01020a"]}
        locations={[0, 0.34, 0.70, 1]}
        start={{ x: 0.12, y: 0 }}
        end={{ x: 0.88, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <Animated.View style={[styles.waterGlow, { opacity: glowOpacity }]}>
        <LinearGradient
          colors={["rgba(34,211,238,0)", "rgba(34,211,238,0.34)", "rgba(168,85,247,0.28)", "rgba(34,197,94,0.15)", "rgba(34,211,238,0)"]}
          locations={[0, 0.28, 0.54, 0.75, 1]}
          start={{ x: 0.08, y: 0.18 }}
          end={{ x: 0.90, y: 0.92 }}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.rippleLayer,
          {
            opacity: rippleOpacity,
            transform: [{ translateX: driftX }, { translateY: driftY }, { scale: rippleScale }],
          },
        ]}
      >
        <Svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
          {ripples.map(renderRipple)}
          {wavePaths.map(path => (
            <React.Fragment key={path.key}>
              <Path
                d={path.d}
                stroke={path.color}
                strokeWidth={12}
                strokeLinecap="round"
                fill="none"
                opacity={path.opacity * 0.16}
              />
              <Path
                d={path.d}
                stroke={path.color}
                strokeWidth={1.4}
                strokeLinecap="round"
                fill="none"
                opacity={path.opacity}
              />
            </React.Fragment>
          ))}
        </Svg>
      </Animated.View>

      <Animated.View
        style={[
          styles.rippleLayer,
          {
            opacity: counterRippleOpacity,
            transform: [{ translateX: counterDriftX }, { translateY: counterDriftY }, { scale: counterRippleScale }],
          },
        ]}
      >
        <Svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
          {ripples.slice().reverse().map(renderRipple)}
        </Svg>
      </Animated.View>

      <Animated.View style={[styles.gridLayer, { opacity: gridOpacity }]}>
        <Svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
          {gridDots.map(dot => (
            <React.Fragment key={dot.key}>
              <Circle cx={dot.cx} cy={dot.cy} r={dot.r * 5} fill={dot.color} opacity={dot.opacity * 0.10} />
              <Circle cx={dot.cx} cy={dot.cy} r={dot.r} fill={dot.color} opacity={dot.opacity} />
            </React.Fragment>
          ))}
        </Svg>
      </Animated.View>

      <LinearGradient
        colors={["rgba(2,6,23,0.02)", "rgba(2,6,23,0.22)", "rgba(0,0,0,0.20)"]}
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
  rippleLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  gridLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  waterGlow: {
    ...StyleSheet.absoluteFillObject,
    transform: [{ rotate: "-10deg" }, { scale: 1.18 }],
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.14)",
  },
  readabilityWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2,6,23,0.08)",
  },
});
