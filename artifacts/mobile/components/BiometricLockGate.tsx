import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useBiometricLock } from "@/context/BiometricLockContext";
import { useColors } from "@/hooks/useColors";

const FLOWLEDGER_LOGO = require("../assets/images/startup_f_transparent.png");

export function BiometricLockGate() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const { locked, busy, error, unlock } = useBiometricLock();
  const unlockRef = useRef(unlock);
  const autoUnlockStarted = useRef(false);
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    unlockRef.current = unlock;
  }, [unlock]);

  useEffect(() => {
    if (!locked) {
      autoUnlockStarted.current = false;
      setShowFallback(false);
      return;
    }
    if (autoUnlockStarted.current) return;
    autoUnlockStarted.current = true;

    let active = true;
    setShowFallback(false);
    const timer = setTimeout(() => {
      void unlockRef.current().then(unlocked => {
        if (active && !unlocked) setShowFallback(true);
      });
    }, 50);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [locked]);

  if (!locked) return null;

  if (!showFallback) {
    return (
      <View
        accessibilityLabel="Unlocking FlowLedger"
        accessibilityViewIsModal
        style={[styles.root, { backgroundColor: colors.background }]}
      >
        <Image
          accessibilityIgnoresInvertColors
          accessibilityLabel="FlowLedger"
          source={FLOWLEDGER_LOGO}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>
    );
  }

  return (
    <View
      accessibilityLabel="Unlock FlowLedger"
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
      <Image
        accessibilityIgnoresInvertColors
        accessibilityLabel="FlowLedger"
        source={FLOWLEDGER_LOGO}
        style={styles.logo}
        resizeMode="contain"
      />
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
  logo: {
    width: 118,
    height: 118,
    borderRadius: 30,
    marginBottom: 22,
    shadowColor: "#38bdf8",
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
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
