import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { useMembership } from "@/context/MembershipContext";

export function PlanPreviewBanner() {
  const { previewTier, resetPreview } = useMembership();
  if (!previewTier) return null;

  return (
    <View style={styles.banner} accessibilityRole="summary">
      <Feather name="eye" size={16} color="#bfdbfe" />
      <Text style={styles.text}>Testing {previewTier === "pro" ? "Pro" : "Basic"}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Reset plan preview" onPress={() => void resetPreview()} style={styles.reset}>
        <Text style={styles.resetText}>Reset to actual plan</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: Platform.OS === "ios" ? 54 : 10,
    left: 12,
    right: 12,
    zIndex: 120,
    minHeight: 42,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(15,23,42,0.96)",
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.45)",
  },
  text: { flex: 1, color: "#f8fafc", fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  reset: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "rgba(37,99,235,0.28)" },
  resetText: { color: "#bfdbfe", fontSize: 10, fontFamily: "Inter_800ExtraBold" },
});
