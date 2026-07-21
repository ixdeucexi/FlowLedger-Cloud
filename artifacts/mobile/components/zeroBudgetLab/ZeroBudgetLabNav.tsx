import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

export type ZeroBudgetLabTab =
  | "dashboard"
  | "bills"
  | "budget"
  | "monthly"
  | "more";
const ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: "bar-chart-2" },
  { id: "bills", label: "Bills", icon: "file-text" },
  { id: "budget", label: "Budget", icon: "pie-chart" },
  { id: "monthly", label: "Monthly", icon: "calendar" },
  { id: "more", label: "More", icon: "more-horizontal" },
] as const;
interface ZeroBudgetLabNavProps {
  active: ZeroBudgetLabTab;
  bottomInset: number;
  onChange: (tab: ZeroBudgetLabTab) => void;
}
export function ZeroBudgetLabNav({
  active,
  bottomInset,
  onChange,
}: ZeroBudgetLabNavProps) {
  const c = useColors();
  return (
    <View
      style={[
        styles.nav,
        {
          backgroundColor: c.card,
          borderColor: c.border,
          paddingBottom: Math.max(8, bottomInset),
        },
      ]}
    >
      {ITEMS.map((item) => {
        const selected = active === item.id;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`Sample ${item.label}`}
            onPress={() => onChange(item.id)}
            style={styles.item}
          >
            <Feather
              name={item.icon}
              size={21}
              color={selected ? c.primary : c.mutedForeground}
            />
            <Text
              style={[
                styles.label,
                { color: selected ? c.primary : c.mutedForeground },
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
const styles = StyleSheet.create({
  nav: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 70,
    borderTopWidth: 1,
    flexDirection: "row",
    paddingTop: 8,
    paddingHorizontal: 5,
  },
  item: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  label: { fontSize: 8, fontFamily: "Inter_700Bold" },
});
