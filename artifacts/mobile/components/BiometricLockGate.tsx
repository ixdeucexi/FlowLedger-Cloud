import { PrivacyPressable as Pressable, PrivacyText as Text, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import Feather from "@expo/vector-icons/Feather";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, Platform, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useBiometricLock } from "@/context/BiometricLockContext";
import { useColors } from "@/hooks/useColors";
import { isolateAppLockWebPortals } from "@/lib/appLockWebIsolation";

const FLOWLEDGER_LOGO = require("../assets/images/startup_f_transparent.png");

export function BiometricLockGate() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const { locked, busy, error, initializationError, retryLoad, unlock } = useBiometricLock();
  const unlockRef = useRef(unlock);
  const autoUnlockStarted = useRef(false);
  const gateRef = useRef<View>(null);
  const [showFallback, setShowFallback] = useState(false);

  useLayoutEffect(() => {
    if (Platform.OS !== "web" || !locked) return;
    const gate = gateRef.current as unknown as HTMLElement | null;
    if (gate) return isolateAppLockWebPortals(gate);
  }, [locked]);

  useEffect(() => {
    unlockRef.current = unlock;
  }, [unlock]);

  useEffect(() => {
    if (!locked) {
      autoUnlockStarted.current = false;
      setShowFallback(false);
      return;
    }
    if (initializationError) {
      setShowFallback(true);
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
  }, [initializationError, locked]);

  if (!locked) return null;

  // Keep one modal mounted through the automatic check and retry screen so the
  // lock owns focus and system back handling until authentication succeeds.
  return (
    <Modal
      visible
      accessibilityLabel="App Lock"
      animationType="none"
      transparent
      presentationStyle="overFullScreen"
      onRequestClose={() => {}}
    >
      <View
        ref={gateRef}
        accessibilityViewIsModal
        {...(Platform.OS === "web" ? { tabIndex: -1 } : {})}
        style={[styles.modalRoot, { backgroundColor: colors.background }]}
      >
        {!showFallback && !initializationError ? (
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
        ) : (
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
            <Text style={[styles.title, { color: colors.foreground }]}>{initializationError ? "Check App Lock" : "Unlock FlowLedger"}</Text>
            <Text style={[styles.description, { color: colors.mutedForeground }]}>Your bank and plan are hidden.</Text>

            {initializationError || error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{initializationError || error}</Text> : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={initializationError ? "Try checking App Lock again" : "Unlock FlowLedger with fingerprint, face, or device screen lock"}
              disabled={busy}
              onPress={() => initializationError ? retryLoad() : void unlock()}
              style={({ pressed }) => [styles.unlock, { backgroundColor: colors.primary, opacity: pressed || busy ? 0.72 : 1 }]}
            >
              {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Feather name={initializationError ? "refresh-cw" : "unlock"} size={20} color={colors.primaryForeground} />}
              <Text style={[styles.unlockText, { color: colors.primaryForeground }]}>{busy ? "Checking…" : initializationError ? "Try again" : "Unlock"}</Text>
            </Pressable>

            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void signOut()} style={styles.signOut}>
              <Text style={[styles.signOutText, { color: colors.mutedForeground }]}>Sign out instead</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
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
    marginBottom: 22,
    backgroundColor: "transparent",
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
