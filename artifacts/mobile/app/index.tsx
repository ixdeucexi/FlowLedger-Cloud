import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function StartupScreen() {
  const router = useRouter();

  return (
    <Pressable style={{ flex: 1 }} onPress={() => router.replace("/(tabs)")}>
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0e1a" />

        <View style={styles.top}>
          <View style={styles.logoCircle}>
            <Feather name="trending-up" size={44} color="#2563eb" />
          </View>
          <Text style={styles.appName}>FlowLedger</Text>
          <Text style={styles.tagline}>Your money, clearly.</Text>
        </View>

        <View style={styles.pillsRow}>
          {["Bills & Debts", "Income Tracking", "Monthly View", "Goals"].map(label => (
            <View key={label} style={styles.pill}>
              <Text style={styles.pillText}>{label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.bottom}>
          <Text style={styles.sub}>Your data stays on your device</Text>
        </View>
      </SafeAreaView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0a0e1a",
    paddingHorizontal: 28,
    justifyContent: "space-between",
    paddingBottom: 40,
  },
  top: {
    alignItems: "center",
    marginTop: 80,
  },
  logoCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#0f1a35",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
    borderWidth: 1.5,
    borderColor: "#1e3a6e",
  },
  appName: {
    fontSize: 40,
    fontWeight: "800",
    color: "#f8fafc",
    letterSpacing: -1,
    marginBottom: 10,
  },
  tagline: {
    fontSize: 17,
    color: "#64748b",
    fontWeight: "500",
  },
  pillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "center",
    marginVertical: 20,
  },
  pill: {
    backgroundColor: "#0f172a",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#1e3a6e",
  },
  pillText: {
    color: "#93c5fd",
    fontSize: 13,
    fontWeight: "600",
  },
  bottom: {
    alignItems: "center",
  },
  sub: {
    color: "#475569",
    fontSize: 13,
  },
});
