import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet } from "react-native";

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
        },
      ]}
    >
      <Feather name="plus" size={iconSize} color="#f8fafc" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(124,58,237,0.88)",
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.38)",
    shadowColor: "#8b5cf6",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.52,
    shadowRadius: 22,
    elevation: 12,
  },
});
