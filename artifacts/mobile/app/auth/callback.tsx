import { useGlobalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppLoadingIntro } from "@/components/AppLoadingIntro";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { getAccountTipForWeek } from "@/lib/accountTips";

export default function AuthCallbackScreen() {
  const colors = useColors();
  const router = useRouter();
  const { accountTip } = useGlobalSearchParams<{ accountTip?: string | string[] }>();
  const { session, loading } = useAuth();

  // AuthObserver owns authenticated callback navigation, including a pending tip.
  // A second redirect here could overwrite its one-use notification destination.

  if (loading || session) {
    return <AppLoadingIntro phase="privacy" accessibilityLabel="FlowLedger is finishing your sign in" />;
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.foreground }]}>Sign in wasn’t completed</Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>Return to sign in and try again.</Text>
      <Pressable accessibilityRole="button" onPress={() => {
        const tip = getAccountTipForWeek(accountTip);
        router.replace((tip ? `/login?accountTip=${tip.week}` : "/login") as any);
      }} style={[styles.button, { backgroundColor: colors.primary }]}>
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
