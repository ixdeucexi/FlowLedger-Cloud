import React from "react";
import { StyleSheet, Text, View } from "react-native";

export default function StartupRoute() {
  return (
    <View style={styles.root}>
      <View style={styles.logoRing}>
        <Text style={styles.logoMark}>F</Text>
      </View>
      <Text style={styles.appName}>FlowLedger</Text>
      <Text style={styles.tagline}>Your money, clearly.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0a0e1a",
  },
  logoRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(34,197,94,0.15)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.3)",
    marginBottom: 14,
  },
  logoMark: {
    color: "#22c55e",
    fontSize: 30,
    fontWeight: "800",
  },
  appName: {
    color: "#f8fafc",
    fontSize: 30,
    fontWeight: "800",
  },
  tagline: {
    color: "#64748b",
    fontSize: 14,
    marginTop: 4,
  },
});
