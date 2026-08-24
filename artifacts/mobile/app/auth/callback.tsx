import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppLoadingIntro } from "@/components/AppLoadingIntro";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function AuthCallbackScreen() {
  const colors = useColors();
  const router = useRouter();
  const { session, loading } = useAuth();

  useEffect(() => {
    if (session && !loading) router.replace("/(tabs)" as any);
  }, [loading, router, session]);

  if (loading || session) {
    return <AppLoadingIntro phase="privacy" accessibilityLabel="FlowLedger is finishing your sign in" />;
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.foreground }]}>Sign in wasn’t completed</Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>Return to sign in and try again.</Text>
      <Pressable accessibilityRole="button" onPress={() => router.replace("/login" as any)} style={[styles.button, { backgroundColor: colors.primary }]}>
        <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Back to sign in</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 12 },
  title: { marginTop: 8, fontSize: 24, fontFamily: "Inter_800ExtraBold", textAlign: "center" },
  body: { fontSize: 15, lineHeight: 22, fontFamily: "Inter_500Medium", textAlign: "center" },
  button: { minHeight: 48, minWidth: 180, marginTop: 14, borderRadius: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  buttonText: { fontSize: 15, fontFamily: "Inter_700Bold" },
});
