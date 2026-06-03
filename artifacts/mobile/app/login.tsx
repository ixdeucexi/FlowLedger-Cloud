import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function LoginScreen() {
  const { login } = useAuth();
  const c = useColors();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert("Required", "Please enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (e: any) {
      Alert.alert("Login Failed", e.message ?? "Please check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: c.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo / heading */}
        <View style={styles.header}>
          <View style={[styles.logoCircle, { backgroundColor: "#1e3a5f" }]}>
            <Feather name="trending-up" size={36} color="#2563eb" />
          </View>
          <Text style={[styles.appName, { color: c.foreground }]}>FlowLedger</Text>
          <Text style={[styles.tagline, { color: c.mutedForeground }]}>Sign in to your account</Text>
        </View>

        {/* Form */}
        <View style={[styles.card, { backgroundColor: c.card }]}>
          <Text style={[styles.label, { color: c.mutedForeground }]}>Email</Text>
          <TextInput
            style={[styles.input, { backgroundColor: c.background, color: c.foreground, borderColor: c.border }]}
            placeholder="you@example.com"
            placeholderTextColor={c.mutedForeground}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            editable={!loading}
          />

          <Text style={[styles.label, { color: c.mutedForeground, marginTop: 14 }]}>Password</Text>
          <View style={[styles.passwordRow, { backgroundColor: c.background, borderColor: c.border }]}>
            <TextInput
              style={[styles.passwordInput, { color: c.foreground }]}
              placeholder="••••••••"
              placeholderTextColor={c.mutedForeground}
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
              editable={!loading}
              onSubmitEditing={handleLogin}
              returnKeyType="go"
            />
            <Pressable onPress={() => setShowPassword(v => !v)} hitSlop={8}>
              <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={c.mutedForeground} />
            </Pressable>
          </View>

          <Pressable
            style={[styles.btn, { backgroundColor: "#2563eb", opacity: loading ? 0.7 : 1 }]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnText}>Sign In</Text>}
          </Pressable>
        </View>

        {/* Register link */}
        <Pressable style={styles.linkRow} onPress={() => router.push("/register")}>
          <Text style={[styles.linkText, { color: c.mutedForeground }]}>
            Don't have an account?{" "}
            <Text style={{ color: "#2563eb", fontWeight: "600" }}>Create one</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { paddingHorizontal: 24 },
  header: { alignItems: "center", marginBottom: 32 },
  logoCircle: {
    width: 76, height: 76, borderRadius: 38,
    alignItems: "center", justifyContent: "center", marginBottom: 14,
  },
  appName: { fontSize: 28, fontWeight: "700", letterSpacing: 0.3, marginBottom: 4 },
  tagline: { fontSize: 15 },
  card: {
    borderRadius: 16, padding: 20, marginBottom: 20,
  },
  label: { fontSize: 13, fontWeight: "600", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  input: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15,
  },
  passwordRow: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14,
  },
  passwordInput: { flex: 1, paddingVertical: 12, fontSize: 15 },
  btn: {
    marginTop: 20, borderRadius: 12, paddingVertical: 14,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  linkRow: { alignItems: "center" },
  linkText: { fontSize: 14 },
});
