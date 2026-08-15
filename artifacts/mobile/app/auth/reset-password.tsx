import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function ResetPasswordScreen() {
  const colors = useColors();
  const router = useRouter();
  const { session, loading: authLoading, updatePassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const savePassword = async () => {
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSaving(true);
    const nextError = await updatePassword(password);
    setSaving(false);
    if (nextError) setError(nextError);
    else setSaved(true);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.icon, { backgroundColor: `${colors.primary}1f` }]}>
          <Feather name={saved ? "check" : "lock"} size={28} color={saved ? "#34d399" : colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>{saved ? "Password updated" : "Choose a new password"}</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          {saved ? "Your FlowLedger account is ready." : "Use at least 8 characters. This changes your sign-in password only."}
        </Text>

        {!saved && session ? (
          <>
            <View style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <TextInput
                accessibilityLabel="New password"
                autoCapitalize="none"
                autoComplete="new-password"
                placeholder="New password"
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry={!showPassword}
                style={[styles.input, { color: colors.foreground }]}
                value={password}
                onChangeText={setPassword}
              />
              <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? "Hide password" : "Show password"} onPress={() => setShowPassword(value => !value)} style={styles.eye}>
                <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <TextInput
              accessibilityLabel="Confirm new password"
              autoCapitalize="none"
              autoComplete="new-password"
              placeholder="Confirm new password"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry={!showPassword}
              style={[styles.confirmInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              value={confirm}
              onChangeText={setConfirm}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable accessibilityRole="button" disabled={saving} onPress={savePassword} style={[styles.button, { backgroundColor: colors.primary, opacity: saving ? 0.75 : 1 }]}>
              {saving ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Update password</Text>}
            </Pressable>
          </>
        ) : null}

        {!saved && !session && !authLoading ? (
          <Text style={[styles.error, { textAlign: "center" }]}>This reset link is invalid or expired. Request a new one from sign in.</Text>
        ) : null}
        {authLoading ? <ActivityIndicator color={colors.primary} /> : null}
        {saved || (!session && !authLoading) ? (
          <Pressable accessibilityRole="button" onPress={() => router.replace(saved ? "/(tabs)" as any : "/login" as any)} style={[styles.secondaryButton, { borderColor: colors.border }]}>
            <Text style={[styles.secondaryText, { color: colors.foreground }]}>{saved ? "Open FlowLedger" : "Back to sign in"}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 430, borderRadius: 24, borderWidth: 1, padding: 24, alignItems: "stretch" },
  icon: { width: 58, height: 58, borderRadius: 18, alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 14 },
  title: { fontSize: 26, fontFamily: "Inter_800ExtraBold", textAlign: "center" },
  body: { marginTop: 8, marginBottom: 22, fontSize: 14, lineHeight: 21, fontFamily: "Inter_500Medium", textAlign: "center" },
  inputRow: { minHeight: 52, borderRadius: 14, borderWidth: 1, flexDirection: "row", alignItems: "center" },
  input: { flex: 1, minHeight: 52, paddingHorizontal: 16, fontSize: 16, fontFamily: "Inter_500Medium" },
  eye: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  confirmInput: { minHeight: 52, marginTop: 12, borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, fontSize: 16, fontFamily: "Inter_500Medium" },
  error: { marginTop: 12, color: "#f87171", fontSize: 13, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  button: { minHeight: 52, marginTop: 18, borderRadius: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  buttonText: { fontSize: 16, fontFamily: "Inter_800ExtraBold" },
  secondaryButton: { minHeight: 48, marginTop: 14, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  secondaryText: { fontSize: 15, fontFamily: "Inter_700Bold" },
});
