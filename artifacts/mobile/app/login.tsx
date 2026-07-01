import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { useAuth } from "@/context/AuthContext";

function GoogleMark() {
  return (
    <View style={styles.googleMark}>
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
        <Path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <Path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
        <Path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
      </Svg>
    </View>
  );
}

export default function LoginScreen() {
  const { signIn, signUp, signInWithGoogle } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [mode,     setMode]     = useState<"signin" | "signup">("signin");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const oauthError = params.get("error_description") || params.get("error") || hashParams.get("error_description") || hashParams.get("error");
    if (!oauthError) return;
    setError("Google sign-in could not finish. Check the Google provider and redirect URL in Supabase.");
    window.history.replaceState({}, document.title, window.location.pathname);
  }, []);

  const handleSubmit = async () => {
    setError(null);
    if (!email.trim() || !password.trim()) {
      setError("Please enter your email and password.");
      return;
    }
    if (mode === "signup" && password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    const err = mode === "signin"
      ? await signIn(email.trim(), password)
      : await signUp(email.trim(), password);
    setLoading(false);
    if (err) {
      setError(err);
    } else {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        try { window.localStorage.setItem("flowledger_show_setup_after_login", "true"); } catch {}
      }
      router.replace("/setup");
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setLoading(true);
    const err = await signInWithGoogle();
    setLoading(false);
    if (err) setError(err);
  };

  return (
    <LinearGradient colors={["#0a0e1a", "#0f172a"]} style={{ flex: 1 }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Logo / hero */}
          <View style={styles.hero}>
            <View style={styles.logoRing}>
              <Feather name="bar-chart-2" size={32} color="#22c55e" />
            </View>
            <Text style={styles.appName}>FlowLedger</Text>
            <Text style={styles.tagline}>Your money, clearly.</Text>
          </View>

          {/* Card */}
          <View style={styles.card}>
            {/* Tab switcher */}
            <View style={styles.tabs}>
              {(["signin", "signup"] as const).map(m => (
                <Pressable
                  key={m}
                  style={[styles.tab, mode === m && styles.tabActive]}
                  onPress={() => { setMode(m); setError(null); }}
                >
                  <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>
                    {m === "signin" ? "Sign In" : "Create Account"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Email */}
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>Email</Text>
              <View style={styles.inputRow}>
                <Feather name="mail" size={16} color="#64748b" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor="#475569"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            </View>

            {/* Password */}
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.inputRow}>
                <Feather name="lock" size={16} color="#64748b" style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor="#475569"
                  secureTextEntry={!showPass}
                  autoCapitalize="none"
                />
                <Pressable onPress={() => setShowPass(v => !v)} style={styles.eyeBtn}>
                  <Feather name={showPass ? "eye-off" : "eye"} size={16} color="#64748b" />
                </Pressable>
              </View>
            </View>

            {/* Confirm password (signup only) */}
            {mode === "signup" && (
              <View style={styles.fieldWrap}>
                <Text style={styles.label}>Confirm Password</Text>
                <View style={styles.inputRow}>
                  <Feather name="lock" size={16} color="#64748b" style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    value={confirm}
                    onChangeText={setConfirm}
                    placeholder="••••••••"
                    placeholderTextColor="#475569"
                    secureTextEntry={!showPass}
                    autoCapitalize="none"
                  />
                </View>
              </View>
            )}

            {/* Error */}
            {error && (
              <View style={styles.errorBox}>
                <Feather name="alert-circle" size={14} color="#f87171" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Submit */}
            <Pressable
              style={({ pressed }) => [styles.btn, { opacity: pressed || loading ? 0.85 : 1 }]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.btnText}>{mode === "signin" ? "Sign In" : "Create Account"}</Text>
              }
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.googleBtn, { opacity: pressed || loading ? 0.85 : 1 }]}
              onPress={handleGoogle}
              disabled={loading}
            >
              <GoogleMark />
              <Text style={styles.googleBtnText}>Continue with Google</Text>
            </Pressable>

            {mode === "signup" && (
              <Text style={styles.hint}>
                Your data is stored securely and synced across all your devices.
              </Text>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container:     { flexGrow: 1, paddingHorizontal: 24, justifyContent: "center" },
  hero:          { alignItems: "center", marginBottom: 32 },
  logoRing:      { width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(34,197,94,0.15)", alignItems: "center", justifyContent: "center", marginBottom: 12, borderWidth: 1, borderColor: "rgba(34,197,94,0.3)" },
  appName:       { fontSize: 32, fontFamily: "Inter_700Bold", color: "#f8fafc" },
  tagline:       { fontSize: 14, fontFamily: "Inter_400Regular", color: "#64748b", marginTop: 4 },
  card:          { backgroundColor: "#111827", borderRadius: 20, padding: 24, borderWidth: 1, borderColor: "#1e293b" },
  tabs:          { flexDirection: "row", backgroundColor: "#0f172a", borderRadius: 10, padding: 3, marginBottom: 24 },
  tab:           { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: "center" },
  tabActive:     { backgroundColor: "#1e293b" },
  tabText:       { fontSize: 14, fontFamily: "Inter_500Medium", color: "#64748b" },
  tabTextActive: { color: "#f8fafc", fontFamily: "Inter_600SemiBold" },
  fieldWrap:     { marginBottom: 16 },
  label:         { fontSize: 12, fontFamily: "Inter_500Medium", color: "#94a3b8", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  inputRow:      { flexDirection: "row", alignItems: "center", backgroundColor: "#0f172a", borderRadius: 10, borderWidth: 1, borderColor: "#1e293b", paddingHorizontal: 12 },
  inputIcon:     { marginRight: 8 },
  input:         { flex: 1, height: 46, fontSize: 15, fontFamily: "Inter_400Regular", color: "#f8fafc" },
  eyeBtn:        { padding: 8 },
  errorBox:      { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(239,68,68,0.1)", borderRadius: 8, padding: 10, marginBottom: 16 },
  errorText:     { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#f87171" },
  btn:           { backgroundColor: "#2563eb", borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  btnText:       { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
  googleBtn:     { marginTop: 12, borderRadius: 12, paddingVertical: 13, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#334155" },
  googleMark:    { width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  googleBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#f8fafc" },
  hint:          { fontSize: 12, fontFamily: "Inter_400Regular", color: "#475569", textAlign: "center", marginTop: 14, lineHeight: 18 },
});
