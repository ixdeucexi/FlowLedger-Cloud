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

export default function RegisterScreen() {
  const { register } = useAuth();
  const c = useColors();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!name.trim() || !email.trim() || !password) {
      Alert.alert("Required", "Please fill in all fields.");
      return;
    }
    if (password.length < 6) {
      Alert.alert("Weak Password", "Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      Alert.alert("Mismatch", "Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await register(email.trim().toLowerCase(), password, name.trim());
    } catch (e: any) {
      Alert.alert("Registration Failed", e.message ?? "Please try again.");
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
        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.logoCircle, { backgroundColor: "#1e3a5f" }]}>
            <Feather name="user-plus" size={34} color="#2563eb" />
          </View>
          <Text style={[styles.appName, { color: c.foreground }]}>Create Account</Text>
          <Text style={[styles.tagline, { color: c.mutedForeground }]}>Your data stays private and secure</Text>
        </View>

        {/* Form */}
        <View style={[styles.card, { backgroundColor: c.card }]}>
          {(
            [
              { label: "Full Name", value: name, set: setName, placeholder: "Jane Smith", type: "default" as const },
              { label: "Email", value: email, set: setEmail, placeholder: "you@example.com", type: "email-address" as const },
            ] as const
          ).map(({ label, value, set, placeholder, type }) => (
            <View key={label} style={styles.field}>
              <Text style={[styles.label, { color: c.mutedForeground }]}>{label}</Text>
              <TextInput
                style={[styles.input, { backgroundColor: c.background, color: c.foreground, borderColor: c.border }]}
                placeholder={placeholder}
                placeholderTextColor={c.mutedForeground}
                autoCapitalize={type === "email-address" ? "none" : "words"}
                keyboardType={type}
                value={value}
                onChangeText={set}
                editable={!loading}
              />
            </View>
          ))}

          <View style={styles.field}>
            <Text style={[styles.label, { color: c.mutedForeground }]}>Password</Text>
            <View style={[styles.passwordRow, { backgroundColor: c.background, borderColor: c.border }]}>
              <TextInput
                style={[styles.passwordInput, { color: c.foreground }]}
                placeholder="Min 6 characters"
                placeholderTextColor={c.mutedForeground}
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
                editable={!loading}
              />
              <Pressable onPress={() => setShowPassword(v => !v)} hitSlop={8}>
                <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={c.mutedForeground} />
              </Pressable>
            </View>
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: c.mutedForeground }]}>Confirm Password</Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.background, color: c.foreground, borderColor: c.border }]}
              placeholder="Re-enter password"
              placeholderTextColor={c.mutedForeground}
              secureTextEntry={!showPassword}
              value={confirm}
              onChangeText={setConfirm}
              editable={!loading}
              onSubmitEditing={handleRegister}
              returnKeyType="go"
            />
          </View>

          <Pressable
            style={[styles.btn, { backgroundColor: "#2563eb", opacity: loading ? 0.7 : 1 }]}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnText}>Create Account</Text>}
          </Pressable>
        </View>

        <Pressable style={styles.linkRow} onPress={() => router.push("/login")}>
          <Text style={[styles.linkText, { color: c.mutedForeground }]}>
            Already have an account?{" "}
            <Text style={{ color: "#2563eb", fontWeight: "600" }}>Sign in</Text>
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
  card: { borderRadius: 16, padding: 20, marginBottom: 20 },
  field: { marginBottom: 2 },
  label: { fontSize: 13, fontWeight: "600", marginBottom: 6, marginTop: 14, textTransform: "uppercase", letterSpacing: 0.5 },
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
