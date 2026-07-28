import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/AppText";
import { FloLogo } from "@/components/FloLogo";
import { FLOWMENTUM_PROTECTED_DAYS } from "@/lib/flowmentumHandoff";

interface FlowmentumHandoffModalProps {
  visible: boolean;
  isAdminPreview?: boolean;
  onDismiss: () => void;
  onExplore: () => void;
}

const CELEBRATION_PARTICLES = [
  { color: "#a855f7", x: -126, y: -42 }, { color: "#22d3ee", x: -100, y: -96 },
  { color: "#facc15", x: -52, y: -124 }, { color: "#fb7185", x: 4, y: -132 },
  { color: "#34d399", x: 62, y: -116 }, { color: "#60a5fa", x: 108, y: -76 },
  { color: "#f97316", x: 132, y: -18 }, { color: "#e879f9", x: 118, y: 42 },
  { color: "#2dd4bf", x: 76, y: 88 }, { color: "#fde047", x: 20, y: 108 },
  { color: "#818cf8", x: -44, y: 98 }, { color: "#fb7185", x: -106, y: 54 },
] as const;

export function FlowmentumHandoffModal({
  visible,
  isAdminPreview = false,
  onDismiss,
  onExplore,
}: FlowmentumHandoffModalProps) {
  const celebration = useRef(new Animated.Value(0)).current;
  const floEntrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      celebration.stopAnimation();
      floEntrance.stopAnimation();
      celebration.setValue(0);
      floEntrance.setValue(0);
      return;
    }

    celebration.setValue(0);
    floEntrance.setValue(0);
    Animated.parallel([
      Animated.spring(floEntrance, {
        toValue: 1,
        friction: 5,
        tension: 72,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(120),
        Animated.timing(celebration, {
          toValue: 1,
          duration: 1_650,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [celebration, floEntrance, visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View pointerEvents="none" style={styles.fireworks}>
            {CELEBRATION_PARTICLES.map((particle, index) => (
              <Animated.View
                key={`${particle.x}:${particle.y}`}
                style={[
                  styles.particle,
                  {
                    backgroundColor: particle.color,
                    opacity: celebration.interpolate({
                      inputRange: [0, 0.08, 0.72, 1],
                      outputRange: [0, 1, 0.92, 0],
                    }),
                    transform: [
                      { translateX: celebration.interpolate({ inputRange: [0, 1], outputRange: [0, particle.x] }) },
                      { translateY: celebration.interpolate({ inputRange: [0, 1], outputRange: [0, particle.y] }) },
                      { rotate: celebration.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${180 + index * 37}deg`] }) },
                      { scale: celebration.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0.3, 1.15, 0.7] }) },
                    ],
                  },
                ]}
              />
            ))}
          </View>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Animated.View
              style={[
                styles.floIcon,
                {
                  opacity: floEntrance,
                  transform: [
                    { scale: floEntrance.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) },
                    { rotate: floEntrance.interpolate({ inputRange: [0, 1], outputRange: ["-12deg", "0deg"] }) },
                  ],
                },
              ]}
            >
              <FloLogo size={58} />
              <View style={styles.floSpark}>
                <Feather name="star" size={11} color="#422006" />
              </View>
            </Animated.View>
            <View style={styles.headerCopy}>
              <AppText tone="label" style={styles.eyebrow}>
                {isAdminPreview ? "ADMIN PREVIEW · FLO'S CELEBRATION" : "FLO IS CELEBRATING WITH YOU"}
              </AppText>
              <AppText tone="title" style={styles.title}>You did it!</AppText>
              <AppText style={styles.floMessage}>Your foundation is protected.</AppText>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close milestone introduction" onPress={onDismiss} hitSlop={10}>
              <Feather name="x" size={21} color="#94a3b8" />
            </Pressable>
          </View>

          <View style={styles.milestone}>
            <AppText tone="number" style={styles.milestoneNumber}>{FLOWMENTUM_PROTECTED_DAYS}</AppText>
            <View style={styles.milestoneCopy}>
              <AppText tone="title" style={styles.milestoneTitle}>protected days</AppText>
              <AppText style={styles.milestoneText}>Six months of Must Pay expenses are backed up.</AppText>
            </View>
          </View>

          <AppText style={styles.body}>
            You can now explore Flowmentum, FlowLedger&apos;s sister platform for disciplined market research.
          </AppText>

          <View style={styles.protectionNote}>
            <Feather name="shield" size={17} color="#fbbf24" />
            <AppText style={styles.protectionText}>
              Keep your FlowLedger backup protected. Never use bill money or your safety floor.
            </AppText>
          </View>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={onDismiss}
              style={({ pressed }) => [styles.secondaryButton, { opacity: pressed ? 0.72 : 1 }]}
            >
              <AppText style={styles.secondaryText}>Not now</AppText>
            </Pressable>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Explore Flowmentum website"
              onPress={onExplore}
              style={({ pressed }) => [styles.primaryButton, { opacity: pressed ? 0.78 : 1 }]}
            >
              <AppText style={styles.primaryText}>Explore Flowmentum</AppText>
              <Feather name="external-link" size={15} color="#f8fafc" />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(2,6,23,0.78)", alignItems: "center", justifyContent: "center", padding: 20 },
  card: { width: "100%", maxWidth: 500, borderRadius: 28, borderWidth: 1, borderColor: "rgba(34,211,238,0.38)", backgroundColor: "rgba(15,23,42,0.98)", padding: 18, overflow: "hidden", shadowColor: "#8b5cf6", shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.32, shadowRadius: 34, elevation: 16 },
  fireworks: { position: "absolute", left: "50%", top: 98, zIndex: 0 },
  particle: { position: "absolute", width: 8, height: 14, borderRadius: 3 },
  handle: { alignSelf: "center", width: 44, height: 4, borderRadius: 999, backgroundColor: "rgba(148,163,184,0.42)", marginBottom: 16 },
  header: { flexDirection: "row", alignItems: "center", gap: 13, zIndex: 1 },
  floIcon: { width: 66, height: 66, borderRadius: 33, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(2,6,23,0.88)", shadowColor: "#22d3ee", shadowOpacity: 0.55, shadowRadius: 16, shadowOffset: { width: 0, height: 5 }, elevation: 8 },
  floSpark: { position: "absolute", right: -1, top: -2, width: 23, height: 23, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#fde047", borderWidth: 2, borderColor: "#0f172a" },
  headerCopy: { flex: 1 },
  eyebrow: { color: "#67e8f9", fontSize: 8, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.9 },
  title: { color: "#f8fafc", fontSize: 25, lineHeight: 29, fontFamily: "Inter_800ExtraBold", marginTop: 3 },
  floMessage: { color: "#c4b5fd", fontSize: 13, lineHeight: 18, fontFamily: "Inter_700Bold", marginTop: 2 },
  milestone: { flexDirection: "row", alignItems: "center", gap: 13, borderRadius: 18, borderWidth: 1, borderColor: "rgba(52,211,153,0.25)", backgroundColor: "rgba(16,185,129,0.10)", padding: 14, marginTop: 17 },
  milestoneNumber: { color: "#6ee7b7", fontSize: 34, lineHeight: 38, fontFamily: "Inter_800ExtraBold", letterSpacing: -1 },
  milestoneCopy: { flex: 1 },
  milestoneTitle: { color: "#ecfdf5", fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  milestoneText: { color: "#94a3b8", fontSize: 11, lineHeight: 16, fontFamily: "Inter_500Medium", marginTop: 2 },
  body: { color: "#cbd5e1", fontSize: 13, lineHeight: 19, fontFamily: "Inter_500Medium", marginTop: 15 },
  protectionNote: { flexDirection: "row", alignItems: "flex-start", gap: 9, borderRadius: 16, borderWidth: 1, borderColor: "rgba(251,191,36,0.24)", backgroundColor: "rgba(245,158,11,0.09)", padding: 12, marginTop: 14 },
  protectionText: { flex: 1, color: "#fde68a", fontSize: 11, lineHeight: 16, fontFamily: "Inter_600SemiBold" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 17 },
  secondaryButton: { flex: 1, minWidth: 110, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: "rgba(148,163,184,0.24)", backgroundColor: "rgba(148,163,184,0.10)", alignItems: "center", justifyContent: "center", paddingHorizontal: 13 },
  secondaryText: { color: "#cbd5e1", fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  primaryButton: { flex: 1.5, minWidth: 190, minHeight: 46, borderRadius: 14, backgroundColor: "#4f46e5", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 14 },
  primaryText: { color: "#f8fafc", fontSize: 12, fontFamily: "Inter_800ExtraBold" },
});
