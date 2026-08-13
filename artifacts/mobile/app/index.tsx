import React from "react";
import { StyleSheet, View } from "react-native";

import { StartupPlanBrand } from "@/components/StartupPlanBrand";

export default function StartupRoute() {
  return (
    <View style={styles.root}>
      <StartupPlanBrand />
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
});
