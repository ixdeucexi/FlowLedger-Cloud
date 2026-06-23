import { Feather } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

export function SaveStatusBanner() {
  const c = useColors();
  const { saveStatus, saveError, retryLastSave, clearSaveError } = useBudget();
  if (saveStatus === "idle") return null;

  const failed = saveStatus === "failed";
  return (
    <View pointerEvents="box-none" style={styles.layer}>
      <View style={[styles.banner, { backgroundColor: failed ? c.destructive : c.card, borderColor: failed ? c.destructive : c.border }]}>
        {saveStatus === "saving" ? <ActivityIndicator size="small" color={c.primary} /> : (
          <Feather name={failed ? "alert-circle" : "check-circle"} size={16} color={failed ? "#fff" : c.success} />
        )}
        <View style={styles.copy}>
          <Text style={[styles.title, { color: failed ? "#fff" : c.foreground }]}>
            {saveStatus === "saving" ? "Saving…" : failed ? "Couldn’t save" : "Saved"}
          </Text>
          {failed && saveError ? <Text numberOfLines={1} style={styles.error}>{saveError}</Text> : null}
        </View>
        {failed ? (
          <>
            <Pressable onPress={retryLastSave} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable>
            <Pressable onPress={clearSaveError} hitSlop={8}><Feather name="x" size={17} color="#fff" /></Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute", left: 12, right: 12, bottom: Platform.OS === "web" ? 90 : 76, zIndex: 1000, alignItems: "center" },
  banner: { minHeight: 42, maxWidth: 520, width: "100%", borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 9, shadowColor: "#000", shadowOpacity: 0.16, shadowRadius: 8, elevation: 8 },
  copy: { flex: 1 },
  title: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  error: { marginTop: 1, color: "#fff", opacity: 0.88, fontSize: 10, fontFamily: "Inter_400Regular" },
  retry: { backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  retryText: { color: "#fff", fontSize: 12, fontFamily: "Inter_700Bold" },
});
