import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";

import type { DesktopAddAction } from "@/lib/desktopActions";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

const ACTIONS: ReadonlyArray<{
  key: DesktopAddAction;
  label: string;
  detail: string;
  icon: FeatherName;
  color: string;
}> = [
  { key: "income", label: "Add income", detail: "Create an income source", icon: "arrow-down-left", color: "#34d399" },
  { key: "bill", label: "Add bill", detail: "Schedule a commitment", icon: "file-plus", color: "#60a5fa" },
  { key: "debt", label: "Add debt", detail: "Add it to your payoff plan", icon: "credit-card", color: "#c084fc" },
  { key: "goal", label: "Add goal", detail: "Start a savings target", icon: "target", color: "#f472b6" },
];

export function DesktopAddMenu({
  onSelect,
  style,
}: {
  onSelect: (action: DesktopAddAction) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View accessibilityRole="menu" style={[styles.menu, style]}>
      <Text style={styles.eyebrow}>ADD TO YOUR PLAN</Text>
      {ACTIONS.map((action) => (
        <Pressable
          key={action.key}
          accessibilityRole="menuitem"
          accessibilityLabel={action.label}
          onPress={() => onSelect(action.key)}
          style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
        >
          <View style={[styles.icon, { backgroundColor: `${action.color}18`, borderColor: `${action.color}38` }]}>
            <Feather name={action.icon} size={15} color={action.color} />
          </View>
          <View style={styles.copy}>
            <Text style={styles.label}>{action.label}</Text>
            <Text style={styles.detail}>{action.detail}</Text>
          </View>
          <Feather name="chevron-right" size={14} color="#64748b" />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: "absolute",
    zIndex: 40,
    width: 260,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    borderRadius: 16,
    backgroundColor: "rgba(8,13,31,0.98)",
    padding: 10,
    shadowColor: "#000000",
    shadowOpacity: 0.42,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
  },
  eyebrow: { color: "#71809a", fontSize: 10, fontWeight: "800", letterSpacing: 1.1, paddingHorizontal: 8, paddingVertical: 7 },
  row: { minHeight: 55, borderRadius: 11, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0 },
  label: { color: "#edf4ff", fontSize: 13, fontWeight: "800" },
  detail: { color: "#7f8da5", fontSize: 11, marginTop: 2 },
});
