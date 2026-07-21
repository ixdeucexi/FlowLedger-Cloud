import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { DEV_DEMO_USER_ID } from "@/lib/demoMode";
import {
  LEGAL_EFFECTIVE_DATE,
  LEGAL_VERSION,
  legalAcceptanceMetadata,
  type LegalDocumentId,
} from "@/lib/legalDocuments";
import { supabase } from "@/lib/supabase";
import { LegalDocumentModal } from "./LegalDocumentModal";

export function LegalAcceptanceGate() {
  const colors = useColors();
  const { session, signOut } = useAuth();
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<LegalDocumentId | null>(null);

  const user = session?.user;
  const requiresAcceptance = Boolean(user && user.id !== DEV_DEMO_USER_ID && (
    user.user_metadata?.terms_version !== LEGAL_VERSION
    || user.user_metadata?.privacy_version !== LEGAL_VERSION
  ));

  if (!requiresAcceptance) return null;

  const accept = async () => {
    if (!checked || saving) return;
    setSaving(true);
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ data: legalAcceptanceMetadata() });
    setSaving(false);
    if (updateError) setError("We could not save your agreement. Check your connection and try again.");
  };

  return (
    <View style={styles.overlay} accessibilityViewIsModal>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <ScrollView contentContainerStyle={styles.cardContent} showsVerticalScrollIndicator>
          <View style={[styles.icon, { backgroundColor: colors.primary + "18" }]}>
            <Feather name="shield" size={24} color={colors.primary} />
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>Review our updated legal terms</Text>
          <Text style={[styles.updated, { color: colors.primary }]}>Effective {LEGAL_EFFECTIVE_DATE}</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            We expanded the documents to explain bank connections, Flo, household sharing, privacy rights, and financial-tool limitations.
          </Text>
          <View style={[styles.arbitrationNotice, { backgroundColor: colors.warning + "12", borderColor: colors.warning + "40" }]}>
            <Feather name="alert-circle" size={17} color={colors.warning} />
            <Text style={[styles.arbitrationText, { color: colors.foreground }]}>The Terms include binding individual arbitration, a class-action waiver, and a 30-day opt-out right.</Text>
          </View>

          <View style={styles.links}>
            <Pressable accessibilityRole="link" onPress={() => setDocumentId("terms")} style={[styles.linkButton, { borderColor: colors.border }]}>
              <Feather name="file-text" size={16} color={colors.primary} />
              <Text style={[styles.linkText, { color: colors.primary }]}>Read Terms</Text>
            </Pressable>
            <Pressable accessibilityRole="link" onPress={() => setDocumentId("privacy")} style={[styles.linkButton, { borderColor: colors.border }]}>
              <Feather name="shield" size={16} color={colors.primary} />
              <Text style={[styles.linkText, { color: colors.primary }]}>Read Privacy Policy</Text>
            </Pressable>
          </View>

          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => setChecked(value => !value)} style={styles.agreement}>
            <View style={[styles.checkbox, { borderColor: checked ? colors.primary : colors.border, backgroundColor: checked ? colors.primary : "transparent" }]}>
              {checked ? <Feather name="check" size={15} color={colors.primaryForeground} /> : null}
            </View>
            <Text style={[styles.agreementText, { color: colors.foreground }]}>I am at least 18, agree to the Terms of Service, and acknowledge the Privacy Policy.</Text>
          </Pressable>

          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

          <Pressable accessibilityRole="button" disabled={!checked || saving} onPress={accept} style={({ pressed }) => [styles.accept, { backgroundColor: colors.primary, opacity: !checked || saving ? 0.45 : pressed ? 0.82 : 1 }]}>
            {saving ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.acceptText, { color: colors.primaryForeground }]}>Agree and continue</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" disabled={saving} onPress={() => void signOut()} style={styles.signOut}>
            <Text style={[styles.signOutText, { color: colors.mutedForeground }]}>Sign out instead</Text>
          </Pressable>
        </ScrollView>
      </View>
      <LegalDocumentModal documentId={documentId} onClose={() => setDocumentId(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000, elevation: 1000, backgroundColor: "rgba(0,0,0,0.82)", alignItems: "center", justifyContent: "center", padding: 18 },
  card: { width: "100%", maxWidth: 520, maxHeight: "96%", borderWidth: 1, borderRadius: 24, overflow: "hidden" },
  cardContent: { padding: 20 },
  icon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  title: { fontSize: 24, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.6, lineHeight: 29 },
  updated: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.4, marginTop: 5 },
  body: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, marginTop: 12 },
  arbitrationNotice: { flexDirection: "row", alignItems: "flex-start", gap: 9, borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 14 },
  arbitrationText: { flex: 1, fontSize: 11, fontFamily: "Inter_600SemiBold", lineHeight: 17 },
  links: { flexDirection: "row", gap: 8, marginTop: 14 },
  linkButton: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 12, flexDirection: "row", gap: 7, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  linkText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  agreement: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 17 },
  checkbox: { width: 24, height: 24, borderWidth: 1.5, borderRadius: 7, alignItems: "center", justifyContent: "center", marginTop: 1 },
  agreementText: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", lineHeight: 18 },
  error: { fontSize: 11, fontFamily: "Inter_600SemiBold", lineHeight: 16, marginTop: 10 },
  accept: { minHeight: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 16 },
  acceptText: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  signOut: { minHeight: 38, alignItems: "center", justifyContent: "center", marginTop: 5 },
  signOutText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
