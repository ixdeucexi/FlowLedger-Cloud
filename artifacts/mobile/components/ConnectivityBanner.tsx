import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";

export function ConnectivityBanner({ desktop }: { desktop: boolean }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { online, reconnected } = useNetworkStatus();

  if (online === null || (online && !reconnected)) return null;

  const compact = width < 700;
  const positive = online && reconnected;
  const color = positive ? c.success : c.warning;

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.banner,
        compact && styles.bannerCompact,
        {
          top: desktop ? 14 : Math.max(insets.top + 8, 12),
          backgroundColor: c.isDark
            ? "rgba(8,12,23,0.97)"
            : "rgba(255,255,255,0.98)",
          borderColor: color + "66",
          shadowColor: color,
        },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: color + "18" }]}>
        <Feather
          name={positive ? "wifi" : "wifi-off"}
          size={17}
          color={color}
        />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: c.foreground }]}>
          {positive ? "Back online" : "You’re offline"}
        </Text>
        <Text
          style={[styles.body, { color: c.mutedForeground }]}
          numberOfLines={compact ? 2 : 1}
        >
          {positive
            ? "Connection restored. You can try the change again."
            : "You can view loaded information. Changes are blocked until the connection returns."}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    zIndex: 200,
    alignSelf: "center",
    width: "auto",
    maxWidth: 620,
    minHeight: 54,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 18,
  },
  bannerCompact: { left: 12, right: 12, maxWidth: undefined },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flexShrink: 1, minWidth: 0 },
  title: { fontFamily: "Inter_700Bold", fontSize: 13 },
  body: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
});
