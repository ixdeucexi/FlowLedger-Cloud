import { PrivacyPressable as Pressable, PrivacyText as Text, PrivacyTextInput as TextInput, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import Feather from "@expo/vector-icons/Feather";
import React, { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet } from "react-native";

import { ConfirmActionOverlay } from "@/components/ConfirmActionModal";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import type { ConfirmActionOptions } from "@/lib/confirmAction";
import type { AppFeedbackRow, FeedbackManagementAction } from "@/lib/feedback";
import { copyFeedbackToUpdateCenter } from "@/lib/feedbackApi";
import { UPDATE_CENTER_SCREEN } from "@/lib/updateCenter";

interface FeedbackManageModalProps {
  feedback: AppFeedbackRow | null;
  busy: boolean;
  onClose: () => void;
  onAction: (action: FeedbackManagementAction, note: string) => void;
  updateCenterCopyAccess: { scopeKey: string; userId: string | null; allowed: boolean };
  onOpenUpdateCenter: () => void;
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

export function FeedbackManageModal({ feedback, busy, onClose, onAction, updateCenterCopyAccess, onOpenUpdateCenter }: FeedbackManageModalProps) {
  const c = useColors();
  const [note, setNote] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmActionOptions | null>(null);
  const [copyState, setCopyState] = useState<{ key: string; status: "saving" | "saved" | "error"; message: string } | null>(null);
  const copyScope = JSON.stringify([updateCenterCopyAccess.scopeKey, feedback?.id, updateCenterCopyAccess.allowed]);
  const currentCopy = useRef({ scope: copyScope, revision: 0, allowed: updateCenterCopyAccess.allowed });
  if (currentCopy.current.scope !== copyScope) {
    currentCopy.current = { scope: copyScope, revision: currentCopy.current.revision + 1, allowed: updateCenterCopyAccess.allowed };
  }
  const copyRevision = currentCopy.current.revision;
  const copyKey = JSON.stringify([copyScope, copyRevision]);
  const mounted = useRef(true);
  const pendingCopy = useRef<string | null>(null);
  const copying = copyState?.key === copyKey && copyState.status === "saving";
  const currentCopyState = copyState?.key === copyKey ? copyState : null;
  const blocked = busy || copying;
  const close = () => { if (pendingCopy.current !== copyKey && !busy) onClose(); };
  useBackDismiss(Boolean(feedback), () => confirmation ? setConfirmation(null) : close());

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const addToUpdateCenter = async () => {
    const userId = updateCenterCopyAccess.userId;
    const isCurrent = () => mounted.current && currentCopy.current.revision === copyRevision && currentCopy.current.allowed;
    if (!feedback || feedback.screen === UPDATE_CENTER_SCREEN || !userId || busy || pendingCopy.current === copyKey || !isCurrent()) return;
    pendingCopy.current = copyKey;
    setCopyState({ key: copyKey, status: "saving", message: "Adding to Update Center…" });
    try {
      const result = await copyFeedbackToUpdateCenter(feedback.id, userId, isCurrent);
      if (!isCurrent()) return;
      const archived = result.copiedRequest.archived_at;
      const pending = ["new", "reviewing"].includes(result.copiedRequest.status);
      const message = result.alreadyExists
        ? archived && pending ? "Already in Update Center. Restore the archived request there if needed."
          : archived ? "Already completed in Update Center. Open it to view the history."
          : pending ? "Already in Update Center. Its saved details are unchanged."
          : "Already completed in Update Center. Open it to view the history."
        : "Added to Update Center. The original feedback is unchanged.";
      setCopyState({ key: copyKey, status: "saved", message });
    } catch (error) {
      if (isCurrent()) setCopyState({ key: copyKey, status: "error", message: error instanceof Error ? error.message : "Could not add this feedback. Try again." });
    } finally {
      if (pendingCopy.current === copyKey) pendingCopy.current = null;
    }
  };

  const openUpdateCenter = () => {
    if (mounted.current && currentCopy.current.revision === copyRevision && currentCopy.current.allowed && pendingCopy.current !== copyKey && currentCopyState?.status === "saved") onOpenUpdateCenter();
  };
  const runAction = (action: FeedbackManagementAction, reply: string) => {
    if (pendingCopy.current !== copyKey) onAction(action, reply);
  };

  useEffect(() => {
    setNote(feedback?.admin_note ?? "");
    if (!feedback) setConfirmation(null);
  }, [feedback]);

  const confirmDelete = () => {
    setConfirmation({
      title: "Delete feedback permanently?",
      message: "Use this only for spam, test entries, mistakes, or sensitive information. It will disappear from the tester’s history and they will not be notified.",
      confirmText: "Delete permanently",
      destructive: true,
      onConfirm: () => runAction("delete", note.trim()),
    });
  };

  return (
    <Modal visible={Boolean(feedback)} transparent animationType="fade" onRequestClose={() => confirmation ? setConfirmation(null) : close()}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={[styles.eyebrow, { color: c.primary }]}>MANAGE FEEDBACK</Text>
              <Text style={[styles.title, { color: c.foreground }]}>Close the loop</Text>
              <Text style={[styles.subtitle, { color: c.mutedForeground }]} numberOfLines={2}>
                {feedback?.user_name || feedback?.user_email || "FlowLedger tester"}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close feedback options" onPress={close} hitSlop={8}>
              <Feather name="x" size={22} color={c.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            {feedback && feedback.screen !== UPDATE_CENTER_SCREEN ? (
              <View style={styles.copySection}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add to Update Center"
                  accessibilityState={{ disabled: blocked || !updateCenterCopyAccess.allowed, busy: copying }}
                  disabled={blocked || !updateCenterCopyAccess.allowed}
                  onPress={() => void addToUpdateCenter()}
                  style={({ pressed }) => [styles.option, { backgroundColor: c.primary + "18", borderColor: c.primary + "66", opacity: blocked || !updateCenterCopyAccess.allowed ? 0.5 : pressed ? 0.74 : 1 }]}
                >
                  <View style={[styles.optionIcon, { backgroundColor: c.primary + "22" }]}><Feather name="plus-circle" size={18} color={c.primary} /></View>
                  <View style={styles.optionCopy}>
                    <Text style={[styles.optionTitle, { color: c.foreground }]}>{copying ? "Adding…" : "Add to Update Center"}</Text>
                    <Text style={[styles.optionDetail, { color: c.mutedForeground }]}>Save a separate request for review.</Text>
                  </View>
                </Pressable>
                {currentCopyState ? <Text accessibilityLiveRegion="polite" style={[styles.contactNote, { color: currentCopyState.status === "error" ? c.destructive : c.mutedForeground }]}>{currentCopyState.message}</Text> : null}
                {currentCopyState?.status === "saved" ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Open Update Center" onPress={openUpdateCenter} style={[styles.openUpdateCenter, { backgroundColor: c.primary }]}>
                    <Text style={[styles.optionTitle, { color: c.primaryForeground }]}>Open Update Center</Text><Feather name="arrow-right" size={16} color={c.primaryForeground} />
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            <Text style={[styles.label, { color: c.mutedForeground }]}>REPLY TO TESTER (OPTIONAL)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              maxLength={1000}
              multiline
              textAlignVertical="top"
              placeholder="Example: We fixed the Forecast balance calculation."
              placeholderTextColor={c.mutedForeground}
              style={[styles.noteInput, { color: c.foreground, backgroundColor: c.muted, borderColor: c.border }]}
            />
            <Text style={[styles.contactNote, { color: c.mutedForeground }]}>Say what changed in 1–2 short sentences.</Text>
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
                  disabled={blocked}
                  onPress={() => runAction(option.action, note.trim())}
                  style={({ pressed }) => [
                    styles.option,
                    { backgroundColor: c.muted, borderColor: c.border, opacity: blocked ? 0.5 : pressed ? 0.74 : 1 },
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
              disabled={blocked}
              onPress={confirmDelete}
              style={({ pressed }) => [styles.deleteButton, { borderColor: c.destructive + "66", opacity: blocked ? 0.5 : pressed ? 0.74 : 1 }]}
            >
              <Feather name="trash-2" size={16} color={c.destructive} />
              <View style={styles.optionCopy}>
                <Text style={[styles.deleteTitle, { color: c.destructive }]}>Delete permanently</Text>
                <Text style={[styles.optionDetail, { color: c.mutedForeground }]}>Only for spam, tests, mistakes, or sensitive information.</Text>
              </View>
            </Pressable>
          </ScrollView>
        </View>
        <ConfirmActionOverlay request={confirmation} onClose={() => setConfirmation(null)} />
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
  copySection: { marginTop: 16 },
  openUpdateCenter: { minHeight: 44, borderRadius: 12, paddingHorizontal: 14, marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
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
