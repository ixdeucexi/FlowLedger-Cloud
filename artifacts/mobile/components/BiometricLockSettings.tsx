import { PrivacyPressable as Pressable, PrivacyText as Text, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import Feather from "@expo/vector-icons/Feather";
import React from "react";
import { ActivityIndicator, StyleSheet } from "react-native";

import { useBiometricLock } from "@/context/BiometricLockContext";
import { useColors } from "@/hooks/useColors";
import { BIOMETRIC_LOCK_DELAY_OPTIONS, biometricLockDelayLabel } from "@/lib/biometricLock";

export function BiometricLockSettings({
  appearance: _appearance = "theme",
}: {
  appearance?: "theme" | "desktop";
}) {
  const colors = useColors();
  const {
    supported,
    enabled,
    busy,
    error,
    enable,
    disable,
    lockNow,
    clearError,
    timeoutMs,
    setAutoLockDelay,
  } = useBiometricLock();

  const toggle = async () => {
    clearError();
    if (enabled) await disable();
    else await enable();
  };

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: colors.primary + "1C" }]}>
          <Feather name="unlock" size={22} color={colors.primary} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            App Lock
          </Text>
          <Text style={[styles.description, { color: colors.mutedForeground }]}>
            Use fingerprint or face unlock, with your device PIN or passcode as backup.
          </Text>
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="App Lock"
          aria-checked={enabled}
          aria-disabled={busy || !supported}
          accessibilityState={{
            checked: enabled,
            disabled: busy || !supported,
          }}
          disabled={busy || !supported}
          onPress={() => void toggle()}
          style={[
            styles.toggle,
            {
              backgroundColor: enabled ? colors.primary : colors.border,
              opacity: busy || !supported ? 0.55 : 1,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator
              size="small"
              color={
                enabled ? colors.primaryForeground : colors.mutedForeground
              }
            />
          ) : (
            <View
              style={[
                styles.knob,
                {
                  backgroundColor: enabled
                    ? colors.primaryForeground
                    : colors.mutedForeground,
                  transform: [{ translateX: enabled ? 20 : 0 }],
                },
              ]}
            />
          )}
        </Pressable>
      </View>

      <View style={[styles.note, { backgroundColor: colors.muted }]}>
        <Feather
          name={supported ? "smartphone" : "info"}
          size={15}
          color={supported ? colors.primary : colors.mutedForeground}
        />
        <Text style={[styles.noteText, { color: colors.mutedForeground }]}>
          {supported
            ? enabled
              ? `On for this device. ${timeoutMs === 0 ? "Locks as soon as you leave the app." : `Locks after ${biometricLockDelayLabel(timeoutMs).toLowerCase()} away.`}`
              : "Off. App Lock stays off until you turn it on. This setting applies only to this device."
            : enabled
              ? "App Lock is on, but device unlock is unavailable here."
              : "Off. Device unlock is unavailable on this device or browser."}
        </Text>
      </View>

      <View style={styles.delaySection}>
        <Text style={[styles.delayTitle, { color: colors.foreground }]}>Lock after leaving the app</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="App Lock delay" style={styles.delayOptions}>
          {BIOMETRIC_LOCK_DELAY_OPTIONS.map(option => (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={`Lock after leaving: ${option.label}`}
              aria-checked={timeoutMs === option.value}
              aria-disabled={!enabled || busy}
              accessibilityState={{ checked: timeoutMs === option.value, disabled: !enabled || busy }}
              disabled={!enabled || busy}
              onPress={() => { void setAutoLockDelay(option.value); }}
              style={({ pressed }) => [styles.delayButton, {
                borderColor: timeoutMs === option.value ? colors.primary : colors.border,
                backgroundColor: timeoutMs === option.value ? colors.primary + "18" : colors.card,
                opacity: !enabled || busy ? 0.55 : pressed ? 0.75 : 1,
              }]}
            >
              <Text style={[styles.delayText, { color: timeoutMs === option.value ? colors.primary : colors.foreground }]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
        {!enabled ? <Text style={[styles.description, { color: colors.mutedForeground }]}>Turn on App Lock to change the delay.</Text> : null}
      </View>

      {error ? (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: colors.destructive }]}
        >
          {error}
        </Text>
      ) : null}

      {enabled ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Lock now"
          disabled={busy}
          onPress={lockNow}
          style={({ pressed }) => [
            styles.testButton,
            {
              borderColor: colors.primary + "66",
              opacity: pressed || busy ? 0.7 : 1,
            },
          ]}
        >
          <Feather name="lock" size={16} color={colors.primary} />
          <Text style={[styles.testText, { color: colors.primary }]}>
            Lock now
          </Text>
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
  delaySection: { marginTop: 16 },
  delayTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  delayOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  delayButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  delayText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
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
