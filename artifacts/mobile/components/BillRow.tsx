import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import colors from "@/constants/colors";
import { useColors } from "@/hooks/useColors";

interface BillRowProps {
  name: string;
  amount: number;
  category?: string;
  onPress?: () => void;
  onDelete?: () => void;
  rightElement?: React.ReactNode;
}

export function BillRow({ name, amount, category, onPress, onDelete, rightElement }: BillRowProps) {
  const c = useColors();

  const categoryIcon: Record<string, keyof typeof Feather.glyphMap> = {
    housing: "home",
    utilities: "zap",
    insurance: "shield",
    transportation: "truck",
    food: "coffee",
    entertainment: "film",
    health: "heart",
    education: "book",
    savings: "trending-up",
    debt: "credit-card",
    other: "more-horizontal",
  };

  const iconName = categoryIcon[(category ?? "other").toLowerCase()] ?? "file-text";

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: c.card, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1 },
      ]}
      onPress={onPress}
    >
      <View style={[styles.iconWrap, { backgroundColor: c.primary + "12" }]}>
        <Feather name={iconName} size={18} color={c.primary} />
      </View>
      <View style={styles.info}>
        <Text style={[styles.name, { color: c.foreground }]} numberOfLines={1}>
          {name}
        </Text>
        {category ? (
          <Text style={[styles.category, { color: c.mutedForeground }]}>{category}</Text>
        ) : null}
      </View>
      {rightElement ?? (
        <Text style={[styles.amount, { color: c.foreground }]}>${amount.toFixed(2)}</Text>
      )}
      {onDelete ? (
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onDelete();
          }}
          hitSlop={8}
          style={styles.deleteBtn}
        >
          <Feather name="trash-2" size={16} color={c.destructive} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  category: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  amount: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    marginLeft: 8,
  },
  deleteBtn: {
    marginLeft: 12,
    padding: 4,
  },
});
