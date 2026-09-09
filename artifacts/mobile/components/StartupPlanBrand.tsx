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
    flexShrink: 0,
  },
  logo: {
    width: STARTUP_LOGO_SIZE,
    height: STARTUP_LOGO_SIZE,
    flexShrink: 0,
    marginBottom: 18,
    backgroundColor: "transparent",
  },
  status: {
    color: "#f8fafc",
    fontFamily: "Inter_800ExtraBold",
    fontSize: 20,
    fontWeight: "800",
  },
});
