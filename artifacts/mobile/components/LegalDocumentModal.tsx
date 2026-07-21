import { Feather } from "@expo/vector-icons";
import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { legalDocumentById, type LegalDocumentId } from "@/lib/legalDocuments";
import { LegalDocumentContent } from "./LegalDocumentContent";

interface LegalDocumentModalProps {
  documentId: LegalDocumentId | null;
  onClose: () => void;
}

export function LegalDocumentModal({ documentId, onClose }: LegalDocumentModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const document = documentId ? legalDocumentById(documentId) : null;

  return (
    <Modal visible={Boolean(document)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.overlay, { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 18 }]}>
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={[styles.icon, { backgroundColor: colors.primary + "18" }]}>
              <Feather name={documentId === "privacy" ? "shield" : "file-text"} size={19} color={colors.primary} />
            </View>
            <View style={styles.headerCopy}>
              <Text style={[styles.eyebrow, { color: colors.primary }]}>FLOWLEDGER ALGO</Text>
              <Text style={[styles.title, { color: colors.foreground }]}>{document?.title}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close legal document" onPress={onClose} style={[styles.close, { backgroundColor: colors.muted }]}>
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator>
            {documentId ? <LegalDocumentContent documentId={documentId} /> : null}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.done, { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 }]}>
              <Text style={[styles.doneText, { color: colors.primaryForeground }]}>Close</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", paddingHorizontal: 16, justifyContent: "center" },
  sheet: { width: "100%", maxWidth: 720, maxHeight: "94%", alignSelf: "center", borderWidth: 1, borderRadius: 24, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", gap: 11, padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  icon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
  title: { fontSize: 20, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.35, marginTop: 2 },
  close: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  scroll: { flexShrink: 1 },
  scrollContent: { padding: 18, paddingBottom: 8 },
  footer: { padding: 14, borderTopWidth: StyleSheet.hairlineWidth },
  done: { minHeight: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  doneText: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
});
