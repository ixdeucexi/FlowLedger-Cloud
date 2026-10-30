import Feather from "@expo/vector-icons/Feather";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMoneyPrivacy } from "@/context/MoneyPrivacyContext";
import { useColors } from "@/hooks/useColors";

export function MoneyPrivacyToggle({ label = false }: { label?: boolean }) {
  const c = useColors();
  const { hidden, toggle } = useMoneyPrivacy();
  return <Pressable accessibilityRole="button" accessibilityLabel={hidden ? "Show amounts" : "Hide amounts"} accessibilityState={{ selected: hidden }} aria-pressed={hidden} onPress={toggle} hitSlop={4} style={({ pressed }) => [styles.toggle, { borderColor: c.border, backgroundColor: hidden ? c.primary + "16" : c.card, opacity: pressed ? 0.75 : 1 }]}><Feather name={hidden ? "eye-off" : "eye"} size={17} color={c.primary} />{label ? <Text style={[styles.toggleText, { color: c.foreground }]}>{hidden ? "Show amounts" : "Hide amounts"}</Text> : null}</Pressable>;
}

export function MoneyPrivacySetting() {
  const c = useColors();
  const { hidden, toggle } = useMoneyPrivacy();
  return <View style={[styles.setting, { backgroundColor: c.card, borderColor: c.border }]}><View style={styles.copy}><Text accessibilityRole="header" style={[styles.settingTitle, { color: c.foreground }]}>Privacy Mode</Text><Text style={[styles.description, { color: c.mutedForeground }]}>Hide amounts on every screen. Saved for this household on this device.</Text></View><Pressable accessibilityRole="switch" accessibilityLabel="Privacy Mode" accessibilityState={{ checked: hidden }} aria-checked={hidden} onPress={toggle} style={[styles.switch, { backgroundColor: hidden ? c.primary : c.muted }]}><View style={[styles.thumb, hidden && { alignSelf: "flex-end" }]} /></Pressable></View>;
}

/** Always available while private, without covering the current screen or a modal. */
export function MoneyPrivacyBar() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { hidden, ready, loadError, saveError, retryLoad, retrySave } = useMoneyPrivacy();
  if (!hidden && !loadError && !saveError) return null;
  return <View style={[styles.bar, { backgroundColor: c.card, borderBottomColor: c.border, paddingTop: Platform.OS === "web" ? 5 : insets.top + 5 }]}><View style={styles.copy}><Text accessibilityLiveRegion="polite" style={[styles.barTitle, { color: c.foreground }]}>{!ready ? "Loading privacy…" : loadError ? "Privacy setting could not be loaded" : saveError ? "Privacy setting could not be saved" : "Amounts hidden"}</Text>{loadError || saveError ? <Text style={[styles.barDescription, { color: c.mutedForeground }]}>Your current view stays as shown.</Text> : null}</View>{loadError || saveError ? <Pressable accessibilityRole="button" accessibilityLabel={loadError ? "Retry loading privacy" : "Retry saving privacy"} onPress={loadError ? retryLoad : retrySave} style={styles.retry}><Text style={{ color: c.primary }}>Retry</Text></Pressable> : null}<MoneyPrivacyToggle label /></View>;
}

const styles = StyleSheet.create({
  toggle: { minWidth: 36, minHeight: 36, paddingHorizontal: 9, borderRadius: 12, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  toggleText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  setting: { padding: 14, borderWidth: 1, borderRadius: 16, flexDirection: "row", gap: 14, alignItems: "center" },
  copy: { flex: 1, minWidth: 0 },
  settingTitle: { fontFamily: "Inter_700Bold", fontSize: 16 },
  description: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, marginTop: 4 },
  switch: { width: 46, height: 28, borderRadius: 14, padding: 3, justifyContent: "center" },
  thumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff" },
  bar: { paddingHorizontal: 14, paddingVertical: 5, minHeight: 44, flexDirection: "row", gap: 9, alignItems: "center", borderBottomWidth: 1 },
  barTitle: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  barDescription: { fontFamily: "Inter_400Regular", fontSize: 10, marginTop: 2 },
  retry: { minHeight: 36, paddingHorizontal: 6, justifyContent: "center" },
});
