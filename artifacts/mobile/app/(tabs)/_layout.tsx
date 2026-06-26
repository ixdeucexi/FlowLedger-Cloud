import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import React from "react";
import { Platform, StyleSheet, Text, View, useColorScheme } from "react-native";

import { BudgetProvider, useBudget } from "@/context/BudgetContext";
import { SaveStatusBanner } from "@/components/SaveStatusBanner";
import { DecisionDueModal } from "@/components/DecisionDueModal";
import { useColors } from "@/hooks/useColors";

const TABS = [
  { name: "index",        title: "Dashboard",    icon: "bar-chart-2"     },
  { name: "bills",        title: "Bills",        icon: "file-text"       },
  { name: "flo",          title: "Flo",          icon: "message-circle"  },
  { name: "transactions", title: "Transactions", icon: "repeat"          },
  { name: "monthly",      title: "Monthly",      icon: "calendar"        },
  { name: "more",         title: "More",         icon: "more-horizontal" },
] as const;

function BudgetLoadingScreen() {
  const colors = useColors();
  return (
    <View style={[styles.loadingScreen, { backgroundColor: colors.background }]}>
      <View style={styles.loadingMark}>
        <Text style={styles.loadingMarkText}>F</Text>
      </View>
      <Text style={[styles.loadingTitle, { color: colors.foreground }]}>FlowLedger</Text>
      <Text style={[styles.loadingSub, { color: colors.mutedForeground }]}>Loading your plan…</Text>
    </View>
  );
}

function TabContent() {
  const colors = useColors();
  const { loading } = useBudget();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  if (loading) return <BudgetLoadingScreen />;

  return (
    <>
      <Tabs
        detachInactiveScreens={false}
        screenOptions={{
          animation: "none",
          freezeOnBlur: !isWeb,
          lazy: true,
          tabBarActiveTintColor: "#22c55e",
          tabBarInactiveTintColor: colors.mutedForeground,
          headerShown: false,
          tabBarStyle: {
            position: "absolute",
            backgroundColor: isIOS ? "transparent" : colors.background,
            borderTopWidth: isWeb ? 1 : 0,
            borderTopColor: colors.border,
            elevation: 0,
            ...(isWeb ? { height: 84 } : {}),
          },
          tabBarBackground: () =>
            isIOS ? (
              <BlurView
                intensity={100}
                tint={isDark ? "dark" : "light"}
                style={StyleSheet.absoluteFill}
              />
            ) : isWeb ? (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
            ) : null,
        }}
      >
        {TABS.map(tab => (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: tab.title,
              tabBarActiveTintColor: tab.name === "flo" ? colors.primary : undefined,
              tabBarInactiveTintColor: tab.name === "flo" ? colors.primary : undefined,
              tabBarIcon: ({ color }) => <Feather name={tab.icon} size={22} color={tab.name === "flo" ? colors.primary : color} />,
            }}
          />
        ))}
      </Tabs>
      <SaveStatusBanner />
      <DecisionDueModal />
    </>
  );
}

export default function TabLayout() {
  return (
    <BudgetProvider>
      <TabContent />
    </BudgetProvider>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingMark: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(37,99,235,0.18)",
    borderWidth: 1,
    borderColor: "rgba(37,99,235,0.35)",
    marginBottom: 12,
  },
  loadingMarkText: {
    color: "#2563eb",
    fontSize: 28,
    fontWeight: "800",
  },
  loadingTitle: {
    fontSize: 28,
    fontWeight: "800",
  },
  loadingSub: {
    fontSize: 14,
    marginTop: 4,
  },
});
