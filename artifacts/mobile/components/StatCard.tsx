import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import colors from "@/constants/colors";

interface StatCardProps {
  title: string;
  value: string;
  icon: keyof typeof Feather.glyphMap;
  color?: string;
  subtitle?: string;
}

export function StatCard({ title, value, icon, color, subtitle }: StatCardProps) {
  const c = useColors();
  const iconColor = color ?? c.primary;

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
      <View style={[styles.iconContainer, { backgroundColor: iconColor + "15" }]}>
        <Feather name={icon} size={20} color={iconColor} />
      </View>
      <Text style={[styles.title, { color: c.mutedForeground }]} numberOfLines={1}>
        {title}
      </Text>
      <Text style={[styles.value, { color: c.foreground }]} numberOfLines={1}>
        {value}
      </Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: c.mutedForeground }]} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    padding: 16,
    minWidth: 140,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  value: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  subtitle: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
});
