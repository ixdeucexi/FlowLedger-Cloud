import { Feather } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useBiometricLock } from "@/context/BiometricLockContext";
import { useColors } from "@/hooks/useColors";

export function BiometricLockGate() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const { locked, busy, error, unlock } = useBiometricLock();

  if (!locked) return null;

  return (
    <View
      accessibilityViewIsModal
      style={[
        styles.root,
        {
          backgroundColor: colors.background,
          paddingTop: Math.max(28, insets.top),
          paddingBottom: Math.max(28, insets.bottom),
        },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "55" }]}>
        <Feather name="shield" size={42} color={colors.primary} />
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>Unlock FlowLedger</Text>
      <Text style={[styles.description, { color: colors.mutedForeground }]}>Your bank and plan are hidden.</Text>

      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Unlock FlowLedger with fingerprint, face, or device screen lock"
        disabled={busy}
        onPress={() => void unlock()}
        style={({ pressed }) => [styles.unlock, { backgroundColor: colors.primary, opacity: pressed || busy ? 0.72 : 1 }]}
      >
        {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Feather name="unlock" size={20} color={colors.primaryForeground} />}
        <Text style={[styles.unlockText, { color: colors.primaryForeground }]}>{busy ? "Checking…" : "Unlock"}</Text>
      </Pressable>

      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void signOut()} style={styles.signOut}>
        <Text style={[styles.signOutText, { color: colors.mutedForeground }]}>Sign out instead</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100_000,
    elevation: 100_000,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
  },
  icon: {
    width: 86,
    height: 86,
    borderRadius: 30,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
  },
  title: {
    fontFamily: "Inter_800ExtraBold",
    fontSize: 28,
    textAlign: "center",
  },
  description: {
    marginTop: 8,
    fontFamily: "Inter_500Medium",
    fontSize: 15,
    textAlign: "center",
  },
  error: {
    marginTop: 18,
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  unlock: {
    width: "100%",
    maxWidth: 360,
    minHeight: 56,
    borderRadius: 18,
    marginTop: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  unlockText: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  signOut: {
    minHeight: 44,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  signOutText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
});
