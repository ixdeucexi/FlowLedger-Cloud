import { PrivacyPressable as Pressable, PrivacyText as Text, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import Feather from "@expo/vector-icons/Feather";
import React, { useEffect, useRef } from "react";
import { AccessibilityInfo, findNodeHandle, Modal, Platform, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccessibleIconButton } from "@/components/AccessiblePressable";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { WeeklyAccountTip } from "@/lib/accountTips";

type Props = {
  tip: WeeklyAccountTip;
  onClose: () => void;
  onOpenDestination: () => void;
};

export function AccountTipModal({ tip, onClose, onOpenDestination }: Props) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const titleRef = useRef<Text>(null);
  useBackDismiss(true, onClose);

  useEffect(() => {
    if (Platform.OS === "web") {
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") onClose();
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }
    const timer = setTimeout(() => {
      const node = findNodeHandle(titleRef.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 120);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <Modal visible transparent animationType={reduceMotion ? "none" : "fade"} onRequestClose={onClose}>
      <View style={[styles.backdrop, { paddingTop: Math.max(insets.top, 20), paddingBottom: Math.max(insets.bottom, 20) }]}>
        <Pressable accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View accessibilityLabel="Weekly account tip dialog" accessibilityViewIsModal style={[styles.dialog, { backgroundColor: c.isDark ? "#080c17" : "#ffffff", borderColor: c.border }]}>
          <View style={[styles.header, { borderBottomColor: c.border }]}>
            <View style={[styles.icon, { backgroundColor: c.primary + "18" }]}><Feather name="book-open" size={20} color={c.primary} /></View>
            <Text style={[styles.eyebrow, { color: c.primary }]}>Weekly account tip</Text>
            <AccessibleIconButton accessibilityLabel="Close account tip" icon="x" color={c.mutedForeground} onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={styles.content}>
            <Text ref={titleRef} accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>{tip.title}</Text>
            <Text style={[styles.summary, { color: c.foreground }]}>{tip.body}</Text>
            <Text style={[styles.explanation, { color: c.mutedForeground }]}>{tip.explanation}</Text>
          </ScrollView>
          <View style={[styles.footer, { borderTopColor: c.border }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={tip.actionLabel} onPress={onOpenDestination} style={({ pressed }) => [styles.action, { backgroundColor: c.primary, opacity: pressed ? 0.78 : 1 }]}>
              <Text style={styles.actionText}>{tip.actionLabel}</Text>
              <Feather name="arrow-right" size={18} color="#ffffff" />
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeAction}><Text style={[styles.closeText, { color: c.mutedForeground }]}>Close</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(2,6,23,0.72)", paddingHorizontal: 16 },
  dialog: { width: "100%", maxWidth: 500, maxHeight: "90%", borderRadius: 24, borderWidth: 1, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderBottomWidth: 1 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  eyebrow: { flex: 1, fontFamily: "Inter_700Bold", fontSize: 13 },
  content: { padding: 22, gap: 16 },
  title: { fontFamily: "Inter_800ExtraBold", fontSize: 25, lineHeight: 32 },
  summary: { fontFamily: "Inter_600SemiBold", fontSize: 15, lineHeight: 23 },
  explanation: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 22 },
  footer: { padding: 16, gap: 4, borderTopWidth: 1 },
  action: { minHeight: 48, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  actionText: { color: "#ffffff", fontFamily: "Inter_700Bold", fontSize: 14, flexShrink: 1 },
  closeAction: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  closeText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
});
