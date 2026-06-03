import { useRouter } from "expo-router";
import React, { useEffect } from "react";
import { Image, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SplashScreen() {
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => router.replace("/(tabs)"), 2000);
    return () => clearTimeout(t);
  }, []);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0e1a" />
      <View style={styles.center}>
        <Image
          source={require("@/assets/images/logo_cropped.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.tagline}>Your money, clearly.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0a0e1a",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 24,
  },
  logo: {
    width: "100%",
    height: 90,
  },
  tagline: {
    color: "#475569",
    fontSize: 15,
    fontWeight: "500",
    letterSpacing: 0.3,
  },
});
