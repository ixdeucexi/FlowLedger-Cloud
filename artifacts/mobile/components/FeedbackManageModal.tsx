import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import type { AppFeedbackRow, FeedbackManagementAction } from "@/lib/feedback";

interface FeedbackManageModalProps {
  feedback: AppFeedbackRow | null;
  busy: boolean;
  onClose: () => void;
  onAction: (action: FeedbackManagementAction, note: string) => void;
}

const OUTCOMES: Array<{
  action: FeedbackManagementAction;
  icon: keyof typeof Feather.glyphMap;
  title: string;
  detail: string;
}> = [
  { action: "reviewing", icon: "eye", title: "Keep reviewing", detail: "Keep it active and save your reply." },
  { action: "updated", icon: "check-circle", title: "Updated", detail: "Close it and let the tester know the update is live." },
  { action: "not_planned", icon: "slash", title: "Not planned", detail: "Close it respectfully without promising a change." },
  { action: "archive", icon: "archive", title: "Archive", detail: "Hide it from the active inbox but preserve its history." },
];

export function FeedbackManageModal({ feedback, busy, onClose, onAction }: FeedbackManageModalProps) {
  const c = useColors();
  const [note, setNote] = useState("");
  useBackDismiss(Boolean(feedback), onClose);

  useEffect(() => {
    setNote(feedback?.admin_note ?? "");
  }, [feedback]);

  return (
    <Modal visible={Boolean(feedback)} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={[styles.eyebrow, { color: c.primary }]}>MANAGE FEEDBACK</Text>
              <Text style={[styles.title, { color: c.foreground }]}>Close the loop</Text>
              <Text style={[styles.subtitle, { color: c.mutedForeground }]} numberOfLines={2}>
                {feedback?.user_name || feedback?.user_email || "FlowLedger tester"}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close feedback options" onPress={onClose} hitSlop={8}>
              <Feather name="x" size={22} color={c.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            <Text style={[styles.label, { color: c.mutedForeground }]}>REPLY TO TESTER (OPTIONAL)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              maxLength={1000}
              multiline
              textAlignVertical="top"
              placeholder="Example: We fixed the Monthly balance calculation."
              placeholderTextColor={c.mutedForeground}
              style={[styles.noteInput, { color: c.foreground, backgroundColor: c.muted, borderColor: c.border }]}
            />
            <Text style={[styles.contactNote, { color: c.mutedForeground }]}>
              {feedback?.can_contact
                ? "They allowed contact. Outcome alerts open My Feedback, where this reply is visible."
                : "They chose not to be contacted. Your status and reply stay visible in My Feedback, but no phone alert is sent."}
            </Text>

            <Text style={[styles.label, { color: c.mutedForeground }]}>WHAT HAPPENED?</Text>
            <View style={styles.optionList}>
              {(feedback?.archived_at
                ? [{ action: "restore" as const, icon: "rotate-ccw" as const, title: "Restore to active inbox", detail: "Bring this feedback back for review." }]
                : OUTCOMES
              ).map(option => (
                <Pressable
                  key={option.action}
                  accessibilityRole="button"
                  accessibilityLabel={option.title}
                  disabled={busy}
                  onPress={() => onAction(option.action, note.trim())}
                  style={({ pressed }) => [
                    styles.option,
                    { backgroundColor: c.muted, borderColor: c.border, opacity: busy ? 0.5 : pressed ? 0.74 : 1 },
                  ]}
                >
                  <View style={[styles.optionIcon, { backgroundColor: c.primary + "18" }]}>
                    <Feather name={option.icon} size={16} color={c.primary} />
                  </View>
                  <View style={styles.optionCopy}>
                    <Text style={[styles.optionTitle, { color: c.foreground }]}>{option.title}</Text>
                    <Text style={[styles.optionDetail, { color: c.mutedForeground }]}>{option.detail}</Text>
                  </View>
                  <Feather name="chevron-right" size={17} color={c.mutedForeground} />
                </Pressable>
              ))}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete feedback permanently"
              disabled={busy}
              onPress={() => onAction("delete", note.trim())}
              style={({ pressed }) => [styles.deleteButton, { borderColor: c.destructive + "66", opacity: busy ? 0.5 : pressed ? 0.74 : 1 }]}
            >
              <Feather name="trash-2" size={16} color={c.destructive} />
              <View style={styles.optionCopy}>
                <Text style={[styles.deleteTitle, { color: c.destructive }]}>Delete permanently</Text>
                <Text style={[styles.optionDetail, { color: c.mutedForeground }]}>Only for spam, tests, mistakes, or sensitive information.</Text>
              </View>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.72)", padding: 18 },
  card: { width: "100%", maxWidth: 520, maxHeight: "88%", borderWidth: 1, borderRadius: 24, padding: 18 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
  title: { fontSize: 22, lineHeight: 28, fontFamily: "Inter_800ExtraBold", marginTop: 3 },
  subtitle: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 3 },
  scrollContent: { paddingBottom: 4 },
  label: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8, marginTop: 18, marginBottom: 8 },
  noteInput: { minHeight: 100, maxHeight: 180, borderWidth: 1, borderRadius: 15, padding: 12, fontSize: 14, lineHeight: 20, fontFamily: "Inter_500Medium" },
  contactNote: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_500Medium", marginTop: 7 },
  optionList: { gap: 8 },
  option: { minHeight: 66, borderWidth: 1, borderRadius: 15, padding: 11, flexDirection: "row", alignItems: "center", gap: 10 },
  optionIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  optionCopy: { flex: 1, minWidth: 0 },
  optionTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  optionDetail: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_500Medium", marginTop: 2 },
  deleteButton: { minHeight: 64, borderWidth: 1, borderRadius: 15, padding: 11, flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 },
  deleteTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
});
