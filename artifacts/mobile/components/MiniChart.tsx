import React from "react";
import { StyleSheet, Text, View } from "react-native";

import colors from "@/constants/colors";
import { useColors } from "@/hooks/useColors";

interface BarData {
  label: string;
  value: number;
  color?: string;
}

interface MiniChartProps {
  data: BarData[];
  title?: string;
  subtitle?: string;
  height?: number;
}

function fmtK(v: number) {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

export function MiniChart({ data, title, subtitle, height = 120 }: MiniChartProps) {
  const c = useColors();
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
      {title ? (
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: c.foreground }]}>{title}</Text>
          {total > 0 && (
            <Text style={[styles.titleTotal, { color: c.mutedForeground }]}>
              {fmtK(total)} total
            </Text>
          )}
        </View>
      ) : null}
      {subtitle ? (
        <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{subtitle}</Text>
      ) : null}
      <View style={[styles.chartArea, { height }]}>
        {data.map((d, i) => {
          const barH = Math.max((d.value / maxVal) * (height - 40), d.value > 0 ? 4 : 0);
          const barColor = d.color ?? c.primary;
          return (
            <View key={i} style={styles.barWrapper}>
              <View style={[styles.barContainer, { height: height - 40 }]}>
                {d.value > 0 && (
                  <Text style={[styles.barValue, { color: barColor }]} numberOfLines={1}>
                    {fmtK(d.value)}
                  </Text>
                )}
                <View
                  style={[
                    styles.bar,
                    {
                      height: barH,
                      backgroundColor: barColor,
                      borderRadius: 4,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.barLabel, { color: c.mutedForeground }]} numberOfLines={1}>
                {d.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  segments: DonutSegment[];
  title?: string;
  size?: number;
}

export function DonutChart({ segments, title, size = 100 }: DonutChartProps) {
  const c = useColors();
  const total = segments.reduce((s, seg) => s + seg.value, 0);

  let cumPercent = 0;
  const segmentData = segments.map(seg => {
    const percent = total > 0 ? (seg.value / total) * 100 : 0;
    const start = cumPercent;
    cumPercent += percent;
    return { ...seg, percent, start };
  });

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
      {title ? (
        <Text style={[styles.title, { color: c.foreground }]}>{title}</Text>
      ) : null}
      <View style={styles.donutRow}>
        <View style={[styles.donutOuter, { width: size, height: size }]}>
          {segmentData.map((seg, i) => {
            const rotation = (seg.start / 100) * 360;
            const sweepAngle = (seg.percent / 100) * 360;
            if (seg.percent === 0) return null;
            return (
              <View
                key={i}
                style={[
                  styles.donutSegment,
                  {
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    borderWidth: size * 0.18,
                    borderColor: "transparent",
                    borderTopColor: seg.color,
                    borderRightColor: sweepAngle > 90 ? seg.color : "transparent",
                    borderBottomColor: sweepAngle > 180 ? seg.color : "transparent",
                    borderLeftColor: sweepAngle > 270 ? seg.color : "transparent",
                    transform: [{ rotate: `${rotation - 90}deg` }],
                  },
                ]}
              />
            );
          })}
          <View
            style={[
              styles.donutInner,
              {
                width: size * 0.6,
                height: size * 0.6,
                borderRadius: size * 0.3,
                backgroundColor: c.card,
              },
            ]}
          >
            <Text style={[styles.donutTotal, { color: c.foreground }]}>
              ${total.toFixed(0)}
            </Text>
          </View>
        </View>
        <View style={styles.legend}>
          {segments.map((seg, i) => (
            <View key={i} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: seg.color }]} />
              <Text style={[styles.legendLabel, { color: c.mutedForeground }]} numberOfLines={1}>
                {seg.label}
              </Text>
              <Text style={[styles.legendValue, { color: c.foreground }]}>
                ${seg.value.toFixed(0)}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  title: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  titleTotal: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  subtitle: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginBottom: 10,
  },
  chartArea: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    marginTop: 10,
  },
  barWrapper: {
    flex: 1,
    alignItems: "center",
  },
  barContainer: {
    width: "100%",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  barValue: {
    fontSize: 9,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 3,
    textAlign: "center",
  },
  bar: {
    width: "70%",
    minHeight: 2,
  },
  barLabel: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    marginTop: 4,
    textAlign: "center",
  },
  donutRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
  },
  donutOuter: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  donutSegment: {
    position: "absolute",
  },
  donutInner: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  donutTotal: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  legend: {
    flex: 1,
    gap: 6,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  legendValue: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
});
