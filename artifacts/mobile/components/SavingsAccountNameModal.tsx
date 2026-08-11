import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";

import { AppText } from "@/components/AppText";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import { DESKTOP_MODAL_COMPACT, DESKTOP_MODAL_OVERLAY } from "@/lib/desktopModal";
import type { DashboardSavingsAccount } from "@/lib/dashboardFinancialModel";

export function SavingsAccountNameModal({
  account,
  onClose,
  onSave,
  onReset,
}: {
  account: DashboardSavingsAccount | null;
  onClose: () => void;
  onSave: (account: DashboardSavingsAccount, name: string) => Promise<void>;
  onReset: (account: DashboardSavingsAccount) => Promise<void>;
}) {
  const c = useColors();
  const isDesktop = useDesktopExperience();
  const visible = Boolean(account);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useBackDismiss(visible && !saving, onClose);

  useEffect(() => {
    if (!account) return;
    setName(account.name);
    setError("");
  }, [account]);

  const save = async () => {
    if (!account || saving) return;
    const normalized = name.trim().replace(/\s+/g, " ");
    if (!normalized) {
      setError("Enter an account name.");
      return;
    }
    if (normalized.length > 80) {
      setError("Keep the account name under 80 characters.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(account, normalized);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not update the account name.");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!account || saving) return;
    setSaving(true);
    setError("");
    try {
      await onReset(account);
      onClose();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Could not reset the account name.");
    } finally {
      setSaving(false);
    }
  };

  const canReset = account?.source === "connected"
    && Boolean(account.providerName)
    && account.name !== account.providerName;

  return (
    <Modal visible={visible} animationType={isDesktop ? "fade" : "slide"} transparent onRequestClose={saving ? undefined : onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={[styles.overlay, isDesktop && DESKTOP_MODAL_OVERLAY]}>
        <Pressable accessibilityLabel="Close savings account name editor" disabled={saving} onPress={onClose} style={StyleSheet.absoluteFillObject} />
        <View style={[styles.sheet, { backgroundColor: c.background, borderColor: c.border }, isDesktop && DESKTOP_MODAL_COMPACT]}>
          <View style={styles.header}>
            <View style={styles.headingCopy}>
              <AppText tone="title" style={[styles.title, { color: c.foreground }]}>Name this savings account</AppText>
              <AppText style={[styles.subtitle, { color: c.mutedForeground }]}>Give each savings balance a name you recognize.</AppText>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" disabled={saving} onPress={onClose} hitSlop={10}>
              <Feather name="x" size={22} color={c.mutedForeground} />
            </Pressable>
          </View>

          {account?.source === "connected" && account.providerName ? (
            <View style={[styles.providerCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <AppText tone="label" style={[styles.providerLabel, { color: c.mutedForeground }]}>Bank name</AppText>
              <AppText style={[styles.providerName, { color: c.foreground }]}>{account.providerName}{account.mask ? ` •••• ${account.mask}` : ""}</AppText>
            </View>
          ) : null}

          <AppText tone="label" style={[styles.label, { color: c.mutedForeground }]}>FlowLedger name</AppText>
          <TextInput
            autoCapitalize="words"
            autoCorrect
            editable={!saving}
            maxLength={80}
            onChangeText={setName}
            onSubmitEditing={() => void save()}
            placeholder="Emergency fund"
            placeholderTextColor={c.mutedForeground}
            returnKeyType="done"
            selectTextOnFocus
            style={[styles.input, { color: c.foreground, backgroundColor: c.card, borderColor: error ? c.destructive : c.border }]}
            value={name}
          />
          <AppText style={[styles.help, { color: c.mutedForeground }]}>This changes the label in FlowLedger only. It does not rename the account at your bank.</AppText>
          {error ? <AppText style={[styles.error, { color: c.destructive }]}>{error}</AppText> : null}

          <View style={styles.actions}>
            {canReset ? (
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={() => void reset()}
                style={({ pressed }) => [styles.secondaryButton, { borderColor: c.border, opacity: saving || pressed ? 0.68 : 1 }]}
              >
                <AppText tone="title" style={[styles.secondaryButtonText, { color: c.foreground }]}>Use bank name</AppText>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={() => void save()}
              style={({ pressed }) => [styles.saveButton, { backgroundColor: c.primary, opacity: saving || pressed ? 0.72 : 1 }]}
            >
              <AppText tone="title" style={[styles.saveButtonText, { color: c.primaryForeground }]}>{saving ? "Saving..." : "Save name"}</AppText>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.62)" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 22, paddingBottom: 34 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 14, marginBottom: 18 },
  headingCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 20, lineHeight: 26 },
  subtitle: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  providerCard: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 14 },
  providerLabel: { fontSize: 9 },
  providerName: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_700Bold", marginTop: 2 },
  label: { fontSize: 10, marginBottom: 6 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 11, paddingHorizontal: 13, fontSize: 16, fontFamily: "Inter_600SemiBold" },
  help: { fontSize: 11, lineHeight: 16, marginTop: 7 },
  error: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_700Bold", marginTop: 10 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 18 },
  secondaryButton: { minHeight: 46, borderWidth: 1, borderRadius: 11, alignItems: "center", justifyContent: "center", paddingHorizontal: 15 },
  secondaryButtonText: { fontSize: 13 },
  saveButton: { minHeight: 46, minWidth: 120, borderRadius: 11, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  saveButtonText: { fontSize: 14 },
});
