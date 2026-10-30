import Feather from "@expo/vector-icons/Feather";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

export function DashboardLayoutStatus({ loading, saving, saveError, loadError, retrySave, retryLoad }: {
  loading?: boolean;
  saving?: boolean;
  saveError?: string | null;
  loadError?: string | null;
  retrySave?: () => void;
  retryLoad?: () => void;
}) {
  const c = useColors();
  const message = saveError || loadError;
  if (!message && !loading && !saving) return null;
  return (
    <View accessibilityRole={message ? "alert" : undefined} style={[styles.status, { borderColor: message ? c.warning + "66" : c.border, backgroundColor: c.card }]}>
      <Feather name={message ? "alert-circle" : "clock"} size={15} color={message ? c.warning : c.mutedForeground} />
      <Text style={[styles.copy, { color: c.mutedForeground }]}>{message || (loading ? "Loading your dashboard layout…" : "Saving your dashboard layout…")}</Text>
      {message ? <Pressable
        accessibilityRole="button"
        accessibilityLabel={saveError ? "Retry saving dashboard layout" : "Retry loading dashboard layout"}
        onPress={saveError ? retrySave : retryLoad}
        style={styles.retry}
      ><Text style={[styles.retryText, { color: c.primary }]}>Retry</Text></Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  status: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  copy: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 17, fontFamily: "Inter_500Medium" },
  retry: { minWidth: 44, minHeight: 36, alignItems: "center", justifyContent: "center" },
  retryText: { fontSize: 12, fontFamily: "Inter_700Bold" },
});
