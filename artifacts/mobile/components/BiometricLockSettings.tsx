import { Feather } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useBiometricLock } from "@/context/BiometricLockContext";
import { useColors } from "@/hooks/useColors";

export function BiometricLockSettings() {
  const colors = useColors();
  const { supported, enabled, busy, error, enable, disable, lockNow, clearError } = useBiometricLock();

  const toggle = async () => {
    clearError();
    if (enabled) await disable();
    else await enable();
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: colors.primary + "1C" }]}>
          <Feather name="unlock" size={22} color={colors.primary} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.foreground }]}>Biometric App Lock</Text>
          <Text style={[styles.description, { color: colors.mutedForeground }]}>Fingerprint, face, or your phone’s screen lock.</Text>
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Biometric App Lock"
          accessibilityState={{ checked: enabled, disabled: busy || !supported }}
          disabled={busy || !supported}
          onPress={() => void toggle()}
          style={[
            styles.toggle,
            { backgroundColor: enabled ? colors.primary : colors.border, opacity: busy || !supported ? 0.55 : 1 },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={enabled ? colors.primaryForeground : colors.mutedForeground} />
          ) : (
            <View style={[styles.knob, { backgroundColor: enabled ? colors.primaryForeground : colors.mutedForeground, transform: [{ translateX: enabled ? 20 : 0 }] }]} />
          )}
        </Pressable>
      </View>

      <View style={[styles.note, { backgroundColor: colors.muted }]}>
        <Feather name={supported ? "smartphone" : "info"} size={15} color={supported ? colors.primary : colors.mutedForeground} />
        <Text style={[styles.noteText, { color: colors.mutedForeground }]}>
          {supported
            ? enabled
              ? "On for this device. FlowLedger locks after 2 minutes away."
              : "This setting applies only to this device."
            : "Device unlock is not supported in this browser."}
        </Text>
      </View>

      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

      {enabled ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={lockNow}
          style={({ pressed }) => [styles.testButton, { borderColor: colors.primary + "66", opacity: pressed || busy ? 0.7 : 1 }]}
        >
          <Feather name="lock" size={16} color={colors.primary} />
          <Text style={[styles.testText, { color: colors.primary }]}>Lock now to test</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 15,
  },
  description: {
    marginTop: 3,
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    lineHeight: 17,
  },
  toggle: {
    width: 52,
    height: 30,
    borderRadius: 15,
    padding: 3,
    justifyContent: "center",
  },
  knob: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  note: {
    minHeight: 48,
    borderRadius: 12,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  noteText: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    lineHeight: 17,
  },
  error: {
    marginTop: 10,
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    lineHeight: 17,
  },
  testButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  testText: {
    fontFamily: "Inter_700Bold",
    fontSize: 13,
  },
});
