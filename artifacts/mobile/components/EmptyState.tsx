import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import colors from "@/constants/colors";
import { useColors } from "@/hooks/useColors";

interface EmptyStateProps {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, message, actionLabel, onAction }: EmptyStateProps) {
  const c = useColors();

  return (
    <View style={styles.container}>
      <View style={[styles.iconWrap, { backgroundColor: c.muted }]}>
        <Feather name={icon} size={32} color={c.mutedForeground} />
      </View>
      <Text style={[styles.title, { color: c.foreground }]}>{title}</Text>
      <Text style={[styles.message, { color: c.mutedForeground }]}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={({ pressed }) => [
            styles.actionBtn,
            { backgroundColor: c.primary, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.actionText, { color: c.primaryForeground }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    gap: 8,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  message: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  actionBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: 8,
  },
  actionText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
});
