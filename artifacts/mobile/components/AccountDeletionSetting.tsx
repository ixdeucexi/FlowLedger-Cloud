import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

/** Navigation only. Identity verification and deletion stay on the existing screen. */
export function AccountDeletionSetting() {
  const c = useColors();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Delete account"
      accessibilityHint="Opens account deletion details and verification. Nothing is deleted by opening this screen."
      onPress={() => router.push("/delete-account" as never)}
      style={({ pressed }) => ({
        minHeight: 64,
        padding: 16,
        borderRadius: 16,
        backgroundColor: c.card,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Feather name="trash-2" size={20} color={c.destructive} />
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: c.destructive,
            fontSize: 15,
            fontFamily: "Inter_600SemiBold",
          }}
        >
          Delete account
        </Text>
        <Text
          style={{
            color: c.mutedForeground,
            fontSize: 12,
            lineHeight: 18,
            marginTop: 4,
          }}
        >
          Review what will be deleted and verify your identity before
          confirming.
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={c.mutedForeground} />
    </Pressable>
  );
}
