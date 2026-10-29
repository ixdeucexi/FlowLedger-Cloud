import Feather from "@expo/vector-icons/Feather";
import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";
import { calendarHighlightText } from "@/lib/calendarAppearance";

type Props = {
  onPress: () => void;
  size?: number;
  iconSize?: number;
  accessibilityLabel?: string;
};

export function CommandPlusButton({
  onPress,
  size = 54,
  iconSize = 22,
  accessibilityLabel = "Add",
}: Props) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.35),
          opacity: pressed ? 0.82 : 1,
          backgroundColor: c.primary,
          borderColor: c.primary + "88",
          shadowColor: c.primary,
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 0.52,
          shadowRadius: 22,
        },
      ]}
    >
      <Feather name="plus" size={iconSize} color={calendarHighlightText(c.primary)} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    elevation: 12,
  },
});
