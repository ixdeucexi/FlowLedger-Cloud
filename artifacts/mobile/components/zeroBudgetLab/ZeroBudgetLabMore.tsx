import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

interface ZeroBudgetLabMoreProps {
  bottomInset: number;
  onEdit: () => void;
  onSettings: () => void;
  onReset: () => void;
  onExit: () => void;
}
export function ZeroBudgetLabMore({
  bottomInset,
  onEdit,
  onSettings,
  onReset,
  onExit,
}: ZeroBudgetLabMoreProps) {
  const c = useColors();
  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingBottom: bottomInset + 112 },
      ]}
    >
      <Text style={[styles.section, { color: c.foreground }]}>Sample plan</Text>
      <View
        style={[
          styles.card,
          { backgroundColor: c.card, borderColor: c.border },
        ]}
      >
        <Row
          icon="edit-3"
          title="Edit sample plan"
          description="Groups, targets, and sample income"
          onPress={onEdit}
        />
        <Row
          icon="settings"
          title="Lab settings"
          description="Display and isolation details"
          onPress={onSettings}
        />
      </View>
      <Text style={[styles.section, { color: c.foreground }]}>
        Lab controls
      </Text>
      <View
        style={[
          styles.card,
          { backgroundColor: c.card, borderColor: c.border },
        ]}
      >
        <Row
          icon="refresh-cw"
          title="Reset all sample data"
          description="Restore fake transactions and original amounts"
          onPress={onReset}
        />
        <Row
          icon="log-out"
          title="Exit test environment"
          description="Return to your unchanged FlowLedger account"
          onPress={onExit}
          destructive
        />
      </View>
      <View
        style={[
          styles.notice,
          { backgroundColor: c.success + "12", borderColor: c.success + "35" },
        ]}
      >
        <Feather name="shield" size={19} color={c.success} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.noticeTitle, { color: c.foreground }]}>
            Real money stays untouched
          </Text>
          <Text style={[styles.noticeText, { color: c.mutedForeground }]}>
            Every tab in this lab uses local sample data only.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
function Row({
  icon,
  title,
  description,
  onPress,
  destructive = false,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  description: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  const c = useColors();
  const tone = destructive ? c.destructive : c.primary;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.row, { borderColor: c.border }]}
    >
      <View style={[styles.icon, { backgroundColor: tone + "18" }]}>
        <Feather name={icon} size={18} color={tone} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={[
            styles.rowTitle,
            { color: destructive ? c.destructive : c.foreground },
          ]}
        >
          {title}
        </Text>
        <Text style={[styles.rowDescription, { color: c.mutedForeground }]}>
          {description}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={c.mutedForeground} />
    </Pressable>
  );
}
const styles = StyleSheet.create({
  content: { padding: 16 },
  section: {
    fontSize: 19,
    fontFamily: "Inter_800ExtraBold",
    marginTop: 7,
    marginBottom: 8,
    paddingHorizontal: 5,
  },
  card: {
    borderWidth: 1,
    borderRadius: 22,
    overflow: "hidden",
    marginBottom: 17,
  },
  row: {
    minHeight: 76,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  rowDescription: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    lineHeight: 15,
    marginTop: 3,
  },
  notice: {
    borderWidth: 1,
    borderRadius: 19,
    padding: 14,
    flexDirection: "row",
    gap: 11,
    alignItems: "center",
  },
  noticeTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  noticeText: { fontSize: 10, fontFamily: "Inter_500Medium", marginTop: 3 },
});
