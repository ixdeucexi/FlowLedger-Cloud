import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";

type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISSED_KEY = "flowledger_pwa_install_dismissed_at";
export const PWA_INSTALL_EVENT = "flowledger-show-pwa-install";
const DISMISS_DAYS = 7;

function isStandaloneDisplay() {
  if (Platform.OS !== "web" || typeof window === "undefined") return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true;
}

function recentlyDismissed() {
  if (Platform.OS !== "web" || typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function markDismissed() {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  try { window.localStorage.setItem(DISMISSED_KEY, String(Date.now())); } catch {}
}

export function PwaInstallPrompt() {
  const c = useColors();
  const [visible, setVisible] = useState(false);
  const [installEvent, setInstallEvent] = useState<DeferredInstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  useBackDismiss(visible, () => setVisible(false));

  const platform = useMemo(() => {
    if (Platform.OS !== "web" || typeof navigator === "undefined") return "other";
    const ua = navigator.userAgent || "";
    const isIOS = /iphone|ipad|ipod/i.test(ua);
    const isAndroid = /android/i.test(ua);
    if (isIOS) return "ios";
    if (isAndroid) return "android";
    return "desktop";
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    if (isStandaloneDisplay()) return;
    const shouldAutoShow = !recentlyDismissed();
    const showTimer = shouldAutoShow ? window.setTimeout(() => setVisible(true), 1400) : undefined;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as DeferredInstallPrompt);
      setVisible(true);
    };
    const onInstalled = () => {
      setInstalled(true);
      setVisible(false);
    };
    const onManualShow = () => {
      if (!isStandaloneDisplay()) setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener(PWA_INSTALL_EVENT, onManualShow);
    return () => {
      if (showTimer) window.clearTimeout(showTimer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener(PWA_INSTALL_EVENT, onManualShow);
    };
  }, []);

  if (Platform.OS !== "web" || installed || platform === "desktop") return null;

  const close = () => {
    markDismissed();
    setVisible(false);
  };

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice.catch(() => null);
    setInstallEvent(null);
    if (choice?.outcome !== "accepted") close();
  };

  const isAndroid = platform === "android";
  const title = isAndroid ? "Install FlowLedger" : "Add FlowLedger to your iPhone";
  const description = isAndroid
    ? "Install FlowLedger as an app for quicker access and a cleaner full-screen experience."
    : "Use Safari’s Share button, then choose Add to Home Screen to install FlowLedger.";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Pressable onPress={close} style={styles.close} hitSlop={12}>
            <Feather name="x" size={20} color={c.mutedForeground} />
          </Pressable>
          <View style={[styles.iconWrap, { backgroundColor: c.primary + "18" }]}>
            <Feather name="download" size={24} color={c.primary} />
          </View>
          <Text style={[styles.title, { color: c.foreground }]}>{title}</Text>
          <Text style={[styles.description, { color: c.mutedForeground }]}>{description}</Text>

          {isAndroid && installEvent ? (
            <Pressable onPress={() => void install()} style={[styles.primary, { backgroundColor: c.primary }]}>
              <Text style={[styles.primaryText, { color: c.primaryForeground }]}>Install App</Text>
            </Pressable>
          ) : (
            <View style={[styles.steps, { backgroundColor: c.muted }]}>
              {isAndroid ? (
                <>
                  <Text style={[styles.step, { color: c.foreground }]}>1. Tap the browser menu ⋮</Text>
                  <Text style={[styles.step, { color: c.foreground }]}>2. Tap Install app or Add to Home screen</Text>
                  <Text style={[styles.step, { color: c.foreground }]}>3. Open FlowLedger from your phone</Text>
                </>
              ) : (
                <>
                  <Text style={[styles.step, { color: c.foreground }]}>1. Open this site in Safari</Text>
                  <Text style={[styles.step, { color: c.foreground }]}>2. Tap Share</Text>
                  <Text style={[styles.step, { color: c.foreground }]}>3. Tap Add to Home Screen</Text>
                </>
              )}
            </View>
          )}

          <Pressable onPress={close} style={styles.secondary}>
            <Text style={[styles.secondaryText, { color: c.mutedForeground }]}>Maybe later</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 22, backgroundColor: "rgba(2,6,23,0.72)" },
  card: { width: "100%", maxWidth: 430, borderWidth: 1, borderRadius: 24, padding: 22, alignItems: "center", shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 24, shadowOffset: { width: 0, height: 14 } },
  close: { position: "absolute", right: 18, top: 18, zIndex: 2 },
  iconWrap: { width: 58, height: 58, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  title: { fontSize: 24, fontFamily: "Inter_800ExtraBold", textAlign: "center" },
  description: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21, textAlign: "center", marginTop: 8 },
  primary: { alignSelf: "stretch", height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 18 },
  primaryText: { fontSize: 16, fontFamily: "Inter_800ExtraBold" },
  steps: { alignSelf: "stretch", borderRadius: 16, padding: 14, gap: 8, marginTop: 18 },
  step: { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 20 },
  secondary: { marginTop: 14, paddingVertical: 8, paddingHorizontal: 14 },
  secondaryText: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
