import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PlannedTransferManager } from "@/components/PlannedTransferManager";
import {
  PrivacyPressable as Pressable,
  PrivacyText as Text,
  PrivacyView as View,
} from "@/components/privacy/PrivacyPrimitives";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

export default function TransfersScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { activeHousehold } = useBudget();
  const scope = `${user?.id ?? "demo"}:${activeHousehold?.householdId ?? "none"}:${activeHousehold?.budgetId ?? "none"}`;
  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: c.background }]}
      contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 112 }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.content}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/bills")}
          style={({ pressed }) => [styles.back, { opacity: pressed ? 0.72 : 1 }]}
        >
          <Feather name="chevron-left" size={20} color={c.primary} />
          <Text style={[styles.backText, { color: c.primary }]}>Back</Text>
        </Pressable>
        <PlannedTransferManager key={scope} title="Transfers" presentation="page" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 20 },
  content: { width: "100%", maxWidth: 840, alignSelf: "center", gap: 16 },
  back: { minHeight: 44, flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 3 },
  backText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
