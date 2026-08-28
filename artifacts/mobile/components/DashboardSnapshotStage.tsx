import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/AppText";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { useColors } from "@/hooks/useColors";

export function DashboardSnapshotStage({
  acknowledgeMounted,
  failed,
  onRetry,
  snapshotKey,
}: {
  acknowledgeMounted?: (snapshotKey: string) => () => void;
  failed: boolean;
  onRetry?: () => void;
  snapshotKey?: string;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPadding = Platform.OS === "web" ? 24 : insets.top + 16;

  React.useEffect(() => {
    if (!acknowledgeMounted || !snapshotKey) return undefined;
    return acknowledgeMounted(snapshotKey);
  }, [acknowledgeMounted, snapshotKey]);

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.screen,
        { backgroundColor: c.isDark ? "#030712" : "#f8fafc" },
      ]}
    >
      <PremiumBackdrop variant="purple" />
      <View
        style={[
          styles.content,
          { paddingTop: topPadding, paddingBottom: insets.bottom + 108 },
        ]}
      >
        <AppText tone="label" style={[styles.eyebrow, { color: c.primary }]}>YOUR MONEY</AppText>
        <AppText tone="title" style={[styles.title, { color: c.foreground }]}>Dashboard</AppText>
        <View
          style={[
            styles.card,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          <View
            accessible
            accessibilityRole={failed ? "alert" : "progressbar"}
            accessibilityLabel={failed
              ? "Dashboard details are not ready"
              : "Preparing your Dashboard details"}
            accessibilityLiveRegion="polite"
            style={styles.status}
          >
            <View style={[styles.icon, { backgroundColor: c.primary + "18" }]}>
              <Feather name={failed ? "alert-circle" : "activity"} size={22} color={c.primary} />
            </View>
            <AppText tone="title" style={[styles.heading, { color: c.foreground }]}>
              {failed ? "Dashboard details need another try" : "Preparing today's plan"}
            </AppText>
            <AppText style={[styles.copy, { color: c.mutedForeground }]}>
              {failed
                ? "Your other pages are ready. Try the Dashboard details again when you're ready."
                : "The app is ready to use while your exact Dashboard details finish preparing."}
            </AppText>
          </View>
          {failed && onRetry ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry Dashboard details"
              onPress={onRetry}
              style={({ pressed }) => [
                styles.primary,
                { backgroundColor: c.primary, opacity: pressed ? 0.82 : 1 },
              ]}
            >
              <AppText style={{ color: c.primaryForeground, fontFamily: "Inter_700Bold" }}>Try again</AppText>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open Forecast"
            onPress={() => router.push("/(tabs)/monthly" as never)}
            style={({ pressed }) => [
              styles.action,
              { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.82 : 1 },
            ]}
          >
            <Feather name="calendar" size={18} color={c.primary} />
            <AppText style={{ color: c.foreground, fontFamily: "Inter_700Bold" }}>Forecast</AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open Activity"
            onPress={() => router.push("/(tabs)/transactions" as never)}
            style={({ pressed }) => [
              styles.action,
              { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.82 : 1 },
            ]}
          >
            <Feather name="repeat" size={18} color={c.primary} />
            <AppText style={{ color: c.foreground, fontFamily: "Inter_700Bold" }}>Activity</AppText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { width: "100%", maxWidth: 560, alignSelf: "center", paddingHorizontal: 20 },
  eyebrow: { fontSize: 10, letterSpacing: 1.5, fontFamily: "Inter_800ExtraBold" },
  title: { fontSize: 36, lineHeight: 42, letterSpacing: -1.2, marginTop: 3 },
  card: { borderWidth: 1, borderRadius: 24, padding: 20, marginTop: 24, alignItems: "flex-start" },
  status: { width: "100%", alignItems: "flex-start" },
  icon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  heading: { fontSize: 20, lineHeight: 25 },
  copy: { fontSize: 14, lineHeight: 21, fontFamily: "Inter_500Medium", marginTop: 7 },
  primary: { minHeight: 46, borderRadius: 14, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", marginTop: 18 },
  actions: { flexDirection: "row", gap: 10, marginTop: 12 },
  action: { flex: 1, minHeight: 52, borderWidth: 1, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
});
