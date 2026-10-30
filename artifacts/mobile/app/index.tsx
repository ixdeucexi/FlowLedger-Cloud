import { PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import React from "react";
import { StyleSheet } from "react-native";

import { AppLoadingIntro } from "@/components/AppLoadingIntro";

export default function StartupRoute() {
  return (
    <View style={styles.root}>
      <AppLoadingIntro phase="app" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#050816",
  },
});
