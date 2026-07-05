import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

export default function StartupRoute() {
  return (
    <View style={styles.root}>
      <Image
        source={require("../assets/images/startup_f_transparent.png")}
        style={styles.logo}
        resizeMode="contain"
      />
      <Text style={styles.appName}>FlowLedger Algo</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#050816",
  },
  logo: {
    width: 118,
    height: 118,
    borderRadius: 30,
    marginBottom: 14,
    shadowColor: "#38bdf8",
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  appName: {
    color: "#f8fafc",
    fontSize: 20,
    fontWeight: "800",
  },
});
