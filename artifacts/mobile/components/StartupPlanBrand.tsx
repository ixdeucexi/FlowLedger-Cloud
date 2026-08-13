import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

const STARTUP_LOGO_SIZE = 200;

export function StartupPlanBrand() {
  return (
    <View style={styles.brand}>
      <Image
        accessibilityIgnoresInvertColors
        accessibilityLabel="FlowLedger"
        source={require("../assets/images/startup_f_transparent.png")}
        style={styles.logo}
        resizeMode="contain"
      />
      <Text style={styles.status}>Loading Plan...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: {
    alignItems: "center",
  },
  logo: {
    width: STARTUP_LOGO_SIZE,
    height: STARTUP_LOGO_SIZE,
    flexShrink: 0,
    borderRadius: 48,
    marginBottom: 18,
    shadowColor: "#38bdf8",
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  status: {
    color: "#f8fafc",
    fontFamily: "Inter_800ExtraBold",
    fontSize: 20,
    fontWeight: "800",
  },
});
