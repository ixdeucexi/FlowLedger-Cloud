import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, type PressableProps } from "react-native";

export function AccessiblePressable({ accessibilityRole = "button", hitSlop = 8, style, ...props }: PressableProps) {
  return (
    <Pressable
      {...props}
      accessibilityRole={accessibilityRole}
      hitSlop={hitSlop}
      style={state => [styles.target, typeof style === "function" ? style(state) : style]}
    />
  );
}

type AccessibleIconButtonProps = Omit<PressableProps, "children"> & {
  accessibilityLabel: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  color: string;
  size?: number;
};

export function AccessibleIconButton({ accessibilityLabel, icon, color, size = 20, style, ...props }: AccessibleIconButtonProps) {
  return (
    <AccessiblePressable {...props} accessibilityLabel={accessibilityLabel} style={style}>
      <Feather name={icon} size={size} color={color} />
    </AccessiblePressable>
  );
}

const styles = StyleSheet.create({ target: { minWidth: 44, minHeight: 44 } });
