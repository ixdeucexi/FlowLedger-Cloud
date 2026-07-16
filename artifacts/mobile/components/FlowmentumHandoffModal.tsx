import { Feather } from "@expo/vector-icons";
import React from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/AppText";
import { FLOWMENTUM_PROTECTED_DAYS } from "@/lib/flowmentumHandoff";

interface FlowmentumHandoffModalProps {
  visible: boolean;
  isAdminPreview?: boolean;
  onDismiss: () => void;
  onExplore: () => void;
}

export function FlowmentumHandoffModal({
  visible,
  isAdminPreview = false,
  onDismiss,
  onExplore,
}: FlowmentumHandoffModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.icon}>
              <Feather name="trending-up" size={20} color="#67e8f9" />
            </View>
            <View style={styles.headerCopy}>
              <AppText tone="label" style={styles.eyebrow}>
                {isAdminPreview ? "ADMIN ALERT PREVIEW" : "FLOWLEDGER MILESTONE"}
              </AppText>
              <AppText tone="title" style={styles.title}>Your financial foundation is protected</AppText>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close Flowmentum introduction" onPress={onDismiss} hitSlop={10}>
              <Feather name="x" size={21} color="#94a3b8" />
            </Pressable>
          </View>

          <View style={styles.milestone}>
            <AppText tone="number" style={styles.milestoneNumber}>{FLOWMENTUM_PROTECTED_DAYS}</AppText>
            <View style={styles.milestoneCopy}>
              <AppText tone="title" style={styles.milestoneTitle}>protected days</AppText>
              <AppText style={styles.milestoneText}>Required expenses are protected for approximately three months.</AppText>
            </View>
          </View>

          <AppText style={styles.body}>
            If you're interested in options-market intelligence, meet Flowmentum, FlowLedger's sister platform for disciplined trade evaluation.
          </AppText>

          <View style={styles.protectionNote}>
            <Feather name="shield" size={17} color="#fbbf24" />
            <AppText style={styles.protectionText}>
              Keep your protected reserve in FlowLedger. Never use bill money, your safety floor, or your stability reserve for trading.
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
  card: { width: "100%", maxWidth: 500, borderRadius: 28, borderWidth: 1, borderColor: "rgba(34,211,238,0.32)", backgroundColor: "rgba(15,23,42,0.98)", padding: 18, shadowColor: "#22d3ee", shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.24, shadowRadius: 34, elevation: 16 },
  handle: { alignSelf: "center", width: 44, height: 4, borderRadius: 999, backgroundColor: "rgba(148,163,184,0.42)", marginBottom: 16 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 11 },
  icon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(103,232,249,0.28)", backgroundColor: "rgba(6,182,212,0.14)" },
  headerCopy: { flex: 1 },
  eyebrow: { color: "#67e8f9", fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.05 },
  title: { color: "#f8fafc", fontSize: 20, lineHeight: 25, fontFamily: "Inter_800ExtraBold", marginTop: 3 },
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
