import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import React, { useEffect } from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";

import { BudgetProvider } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

const TABS = [
  { name: "index",        title: "Dashboard",    icon: "bar-chart-2"     },
  { name: "bills",        title: "Bills",        icon: "file-text"       },
  { name: "transactions", title: "Transactions", icon: "repeat"          },
  { name: "monthly",      title: "Monthly",      icon: "calendar"        },
  { name: "more",         title: "More",         icon: "more-horizontal" },
] as const;

const TAB_MODULES = [
  () => import("./bills"),
  () => import("./transactions"),
  () => import("./monthly"),
  () => import("./more"),
] as const;

export default function TabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  useEffect(() => {
    let cancelled = false;
    let delayTimer: ReturnType<typeof setTimeout> | undefined;
    let idleHandle: number | undefined;

    const loadNextModule = (index: number) => {
      if (cancelled || index >= TAB_MODULES.length) return;
      const run = () => {
        if (cancelled) return;
        void TAB_MODULES[index]().finally(() => {
          if (!cancelled) delayTimer = setTimeout(() => loadNextModule(index + 1), 150);
        });
      };

      const browser = globalThis as typeof globalThis & {
        requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      };
      if (isWeb && browser.requestIdleCallback) {
        idleHandle = browser.requestIdleCallback(run, { timeout: 2500 });
      } else {
        delayTimer = setTimeout(run, 0);
      }
    };

    delayTimer = setTimeout(() => loadNextModule(0), 700);
    return () => {
      cancelled = true;
      if (delayTimer) clearTimeout(delayTimer);
      if (idleHandle !== undefined) {
        const browser = globalThis as typeof globalThis & { cancelIdleCallback?: (handle: number) => void };
        browser.cancelIdleCallback?.(idleHandle);
      }
    };
  }, [isWeb]);

  return (
    <BudgetProvider>
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
              tabBarIcon: ({ color }) => (
                <Feather name={tab.icon} size={22} color={color} />
              ),
            }}
          />
        ))}
      </Tabs>
    </BudgetProvider>
  );
}
