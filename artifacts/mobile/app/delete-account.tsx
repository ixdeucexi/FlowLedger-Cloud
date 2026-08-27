import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { AccessibleIconButton, AccessiblePressable } from "@/components/AccessiblePressable";
import { useAuth } from "@/context/AuthContext";
import { useMembership } from "@/context/MembershipContext";
import { useColors } from "@/hooks/useColors";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { clearDeletedAccountStorage, deleteFlowLedgerAccount } from "@/lib/accountDeletion";
import { SUPPORT_EMAIL } from "@/lib/support";
import { supabase } from "@/lib/supabase";
import { openStoreSubscriptionSettings, resetBillingIdentityAfterDeletion } from "@/lib/nativeBilling";
import { purgeLocalPushNotifications } from "@/lib/pushNotifications";

const REQUEST_SUBJECT = "FlowLedger account deletion request";
const OAUTH_REAUTH_STARTED_KEY = "flowledger_account_deletion_oauth_reauth_started";

export default function DeleteAccountScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, session, demoMode, signInWithGoogle, signInWithApple } = useAuth();
  const { actualPlan } = useMembership();
  const { online } = useNetworkStatus();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauthAccessToken, setOauthAccessToken] = useState<string | null>(null);
  const [deletionSubjectId, setDeletionSubjectId] = useState<string | null>(() => user?.id ?? null);
  const oauthReauthKey = deletionSubjectId ? `${OAUTH_REAUTH_STARTED_KEY}:${deletionSubjectId}` : null;
  const requestUrl = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(REQUEST_SUBJECT)}&body=${encodeURIComponent("Please help with my FlowLedger account deletion. My deletion receipt, if one was issued, is: ")}`;

  const providers = Array.isArray(user?.app_metadata?.providers)
    ? user.app_metadata.providers.map(String)
    : [String(user?.app_metadata?.provider || "")];
  const usesPassword = providers.includes("email");
  const oauthProvider = providers.includes("apple") ? "apple" : providers.includes("google") ? "google" : null;

  useEffect(() => {
    if (!deletionSubjectId && user?.id) setDeletionSubjectId(user.id);
  }, [deletionSubjectId, user?.id]);

  useEffect(() => {
    if (!session?.access_token || !oauthReauthKey || session.user.id !== deletionSubjectId || usesPassword) return;
    void AsyncStorage.getItem(oauthReauthKey).then(value => {
      const startedAt = Number(value);
      if (Number.isFinite(startedAt) && Date.now() - startedAt <= 10 * 60 * 1000) {
        setOauthAccessToken(session.access_token);
      }
    });
  }, [deletionSubjectId, oauthReauthKey, session?.access_token, session?.user.id, usesPassword]);

  const reauthenticateOauth = async () => {
    if (!oauthProvider) return;
    setBusy(true);
    setError(null);
    if (!deletionSubjectId || !oauthReauthKey) { setError("Return to this screen from the account you want to delete."); setBusy(false); return; }
    await AsyncStorage.setItem(oauthReauthKey, String(Date.now()));
    const reauthError = oauthProvider === "apple"
      ? await signInWithApple()
      : await signInWithGoogle();
    if (reauthError) {
      await AsyncStorage.removeItem(oauthReauthKey).catch(() => undefined);
      setError(reauthError);
      setBusy(false);
      return;
    }
    const freshSession = (await supabase.auth.getSession()).data.session;
    if (!freshSession || freshSession.user.id !== deletionSubjectId) {
      await AsyncStorage.removeItem(oauthReauthKey).catch(() => undefined);
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      setOauthAccessToken(null);
      setError("That provider account does not match the FlowLedger account selected for deletion. No account was deleted; sign in to the original account and try again.");
      setBusy(false);
      return;
    }
    setOauthAccessToken(freshSession?.access_token || null);
    setBusy(false);
  };

  const deleteAccount = async () => {
    if (!user || !session || !deletionSubjectId || user.id !== deletionSubjectId || session.user.id !== deletionSubjectId || demoMode || confirmation.trim() !== "DELETE") return;
    setBusy(true);
    setError(null);
    try {
      let accessToken = session.access_token;
      if (usesPassword) {
        if (!password.trim() || !user.email) throw new Error("Enter your current password to verify your identity.");
        const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: user.email, password });
        if (signInError || !data.session || data.session.user.id !== deletionSubjectId) throw new Error("That password could not verify the original account identity.");
        accessToken = data.session.access_token;
      } else {
        if (!oauthAccessToken) throw new Error("Verify with your sign-in provider before deleting your account.");
        accessToken = oauthAccessToken;
      }
      const receipt = await deleteFlowLedgerAccount(accessToken);
      const deletedUserId = user.id;
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      await purgeLocalPushNotifications();
      await resetBillingIdentityAfterDeletion();
      await clearDeletedAccountStorage(deletedUserId);
      if (oauthReauthKey) await AsyncStorage.removeItem(oauthReauthKey).catch(() => undefined);
      Alert.alert(
        "Account deleted",
        `Your deletion receipt is ${receipt.receiptId}. Save a screenshot for support.`,
        [{ text: "Finish", onPress: () => router.replace({ pathname: "/login", params: { deleted: "true" } } as never) }],
        { cancelable: false },
      );
    } catch (nextError) {
      const partial = nextError as Error & { receiptId?: string; code?: string };
      if (partial.receiptId && partial.code === "AUTH_DELETION_PENDING" && deletionSubjectId) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
        await purgeLocalPushNotifications();
        await resetBillingIdentityAfterDeletion();
        await clearDeletedAccountStorage(deletionSubjectId);
        if (oauthReauthKey) await AsyncStorage.removeItem(oauthReauthKey).catch(() => undefined);
        Alert.alert(
          "Deletion is finishing",
          `Your financial data was removed, but account access still needs support cleanup. Receipt: ${partial.receiptId}. Save a screenshot and contact support if sign-in remains available.`,
          [{ text: "Finish", onPress: () => router.replace({ pathname: "/login", params: { deleted: "pending" } } as never) }],
          { cancelable: false },
        );
      } else {
        setError(nextError instanceof Error ? nextError.message : "Your account was not deleted. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const signedIn = Boolean(user && session && !demoMode);
  const identityVerified = usesPassword ? Boolean(password.trim()) : Boolean(oauthAccessToken);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <PremiumBackdrop variant="purple" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 28 }]}>
        <View style={styles.header}>
          <AccessibleIconButton accessibilityLabel="Go back" icon="arrow-left" size={22} color={colors.foreground} onPress={() => router.canGoBack() ? router.back() : router.replace("/login" as never)} style={[styles.backButton, { borderColor: colors.border, backgroundColor: colors.card }]} />
          <View style={styles.headerText}>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>ACCOUNT CONTROL</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>Delete my account</Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.icon, { backgroundColor: `${colors.destructive}18` }]}><Feather name="trash-2" size={24} color={colors.destructive} /></View>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>{signedIn ? "Permanent account deletion" : "Sign in to delete in the app"}</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            {signedIn
              ? "This disconnects your banks, removes your personal financial records, Flo history, notification registrations, simulations, preferences, household membership, and account access. Shared household plan data remains for the members who still belong to it. A private receipt is retained for support."
              : "FlowLedger offers in-app deletion after identity verification. If you cannot sign in, email support from your account address."}
          </Text>

          {signedIn ? (
            <View style={styles.form}>
              <View style={[styles.warning, { borderColor: `${colors.warning}55`, backgroundColor: `${colors.warning}10` }]}>
                <Feather name="users" size={18} color={colors.warning} />
                <Text style={[styles.warningText, { color: colors.foreground }]}>If you own a household with other members, remove every other member first. FlowLedger stops rather than deleting their shared plan.</Text>
              </View>
              {actualPlan.source === "billing" ? (
                <View style={[styles.warning, { marginTop: 10, borderColor: `${colors.warning}55`, backgroundColor: `${colors.warning}10` }]}>
                  <Feather name="credit-card" size={18} color={colors.warning} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.warningText, { color: colors.foreground }]}>Deleting FlowLedger does not cancel an App Store or Google Play subscription. Cancel it in your store first to stop future billing.</Text>
                    {Platform.OS !== "web" ? <Pressable accessibilityRole="button" onPress={() => void openStoreSubscriptionSettings().catch(nextError => setError(nextError instanceof Error ? nextError.message : "Could not open store subscription settings."))} style={styles.manageStore}><Text style={[styles.verifyText, { color: colors.primary }]}>Manage store subscription</Text></Pressable> : null}
                  </View>
                </View>
              ) : null}
              {usesPassword ? (
                <>
                  <Text style={[styles.label, { color: colors.foreground }]}>Current password (required)</Text>
                  <TextInput value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="Re-enter your password" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />
                </>
              ) : oauthProvider ? (
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => void reauthenticateOauth()} style={[styles.verifyButton, { borderColor: colors.primary }]}>
                  <Feather name="shield" size={17} color={colors.primary} />
                  <Text style={[styles.verifyText, { color: colors.primary }]}>{oauthAccessToken ? "Identity verified" : `Verify with ${oauthProvider === "apple" ? "Apple" : "Google"}`}</Text>
                </Pressable>
              ) : (
                <Text style={[styles.help, { color: colors.mutedForeground }]}>Sign out and sign in again with your account provider, then return here.</Text>
              )}
              <Text style={[styles.label, { color: colors.foreground }]}>Type DELETE to confirm</Text>
              <TextInput value={confirmation} onChangeText={setConfirmation} autoCapitalize="characters" autoCorrect={false} placeholder="DELETE" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />
              {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
              <Pressable accessibilityRole="button" accessibilityLabel="Permanently delete my account" disabled={busy || online !== true || !identityVerified || confirmation.trim() !== "DELETE"} onPress={() => void deleteAccount()} style={[styles.requestButton, { backgroundColor: colors.destructive, opacity: busy || online !== true || !identityVerified || confirmation.trim() !== "DELETE" ? 0.45 : 1 }]}>
                <Feather name="trash-2" size={18} color="#fff" />
                <Text style={styles.requestText}>{busy ? "Deleting securely…" : "Permanently delete account"}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => router.push("/login" as never)} style={[styles.requestButton, { backgroundColor: colors.primary }]}>
              <Feather name="log-in" size={18} color="#fff" />
              <Text style={styles.requestText}>Sign in</Text>
            </Pressable>
          )}
        </View>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>What happens</Text>
        <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {[
            "Recent authentication is required before any deletion begins.",
            "Every Plaid connection is revoked and its retained access token is cleared before financial cleanup.",
            "Application cleanup is atomic and retry-safe; Supabase Auth is deleted last.",
            "Security or legal records may be retained only when required or permitted, without active account access.",
          ].map((item, index) => (
            <View key={item} style={[styles.row, index ? { borderTopWidth: 1, borderTopColor: colors.border } : null]}>
              <View style={[styles.number, { backgroundColor: `${colors.primary}18` }]}><Text style={[styles.numberText, { color: colors.primary }]}>{index + 1}</Text></View>
              <Text style={[styles.rowText, { color: colors.mutedForeground }]}>{item}</Text>
            </View>
          ))}
        </View>

        <AccessiblePressable accessibilityRole="link" accessibilityLabel="Email account-deletion support" onPress={() => void Linking.openURL(requestUrl)} style={styles.supportButton}><Text style={[styles.support, { color: colors.primary }]}>Need help? Email account-deletion support</Text></AccessiblePressable>
        <Text style={[styles.note, { color: colors.mutedForeground }]}>Do not send passwords, bank credentials, Social Security numbers, or full account numbers. Account deletion cannot be undone.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { width: "100%", maxWidth: 720, alignSelf: "center", paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 20 }, backButton: { width: 48, height: 48, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  headerText: { flex: 1 }, eyebrow: { fontSize: 11, letterSpacing: 1.7, fontFamily: "Inter_800ExtraBold" }, title: { marginTop: 3, fontSize: 28, lineHeight: 34, fontFamily: "Inter_800ExtraBold" },
  card: { borderWidth: 1, borderRadius: 24, padding: 22, alignItems: "center" }, icon: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  cardTitle: { marginTop: 13, fontSize: 21, textAlign: "center", fontFamily: "Inter_800ExtraBold" }, body: { marginTop: 8, maxWidth: 560, fontSize: 14, lineHeight: 21, textAlign: "center", fontFamily: "Inter_500Medium" },
  form: { width: "100%", marginTop: 18 }, warning: { borderWidth: 1, borderRadius: 16, padding: 13, flexDirection: "row", gap: 10, alignItems: "flex-start" }, warningText: { flex: 1, fontSize: 12, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  label: { marginTop: 15, marginBottom: 7, fontSize: 13, fontFamily: "Inter_700Bold" }, input: { minHeight: 50, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, fontSize: 15, fontFamily: "Inter_500Medium" },
  help: { marginTop: 7, fontSize: 11, lineHeight: 17, fontFamily: "Inter_500Medium" }, error: { marginTop: 12, fontSize: 12, lineHeight: 18, fontFamily: "Inter_700Bold" },
  verifyButton: { minHeight: 48, marginTop: 15, borderWidth: 1, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }, verifyText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  manageStore: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center" },
  requestButton: { minHeight: 50, marginTop: 18, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, paddingHorizontal: 18 }, requestText: { color: "#fff", fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  sectionTitle: { marginTop: 26, marginBottom: 10, fontSize: 19, fontFamily: "Inter_800ExtraBold" }, list: { borderWidth: 1, borderRadius: 22, overflow: "hidden" }, row: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16 },
  number: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" }, numberText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" }, rowText: { flex: 1, fontSize: 13, lineHeight: 19, fontFamily: "Inter_500Medium" },
  supportButton: { marginTop: 12, alignItems: "center", justifyContent: "center" }, support: { textAlign: "center", fontSize: 13, fontFamily: "Inter_700Bold" }, note: { marginTop: 14, fontSize: 12, lineHeight: 18, textAlign: "center", fontFamily: "Inter_500Medium" },
});
