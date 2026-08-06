import { Feather } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import {
  desktopPalette as palette,
  desktopThemeVariables,
} from "@/components/desktop/DesktopUI";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import {
  appTabsForPlanning,
  isAppTabActive,
  type AppTabName,
} from "@/lib/appTabs";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

type NavigationItem = {
  label: string;
  icon: FeatherName;
  pathname: string;
  tab: AppTabName;
};

export function DesktopChrome({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const { signOut } = useAuth();
  const { settings } = useBudget();
  const colors = useColors();
  const [collapsed, setCollapsed] = useState(width < 1180);

  useEffect(() => {
    if (width < 1180) setCollapsed(true);
  }, [width]);

  const navigation = useMemo<NavigationItem[]>(
    () =>
      appTabsForPlanning(settings.zeroBasedBudgetEnabled).map((tab) => ({
        label: tab.title,
        icon: tab.icon as FeatherName,
        pathname: tab.pathname,
        tab: tab.name,
      })),
    [settings.zeroBasedBudgetEnabled],
  );
  const sidebarWidth = collapsed ? 76 : 244;

  return (
    <View
      style={[
        styles.root,
        desktopThemeVariables(colors.isDark),
        { backgroundColor: palette.canvas },
      ]}
    >
      <View style={[styles.sidebar, { width: sidebarWidth }]}>
        <View style={[styles.brand, collapsed && styles.brandCollapsed]}>
          <Image
            accessibilityLabel="FlowLedger Algo logo"
            resizeMode="contain"
            source={require("../../assets/images/startup_f_transparent.png")}
            style={styles.logo}
          />
          {!collapsed ? (
            <Text style={styles.brandName} numberOfLines={1}>
              FlowLedger <Text style={styles.brandAccent}>Algo</Text>
            </Text>
          ) : null}
        </View>

        <ScrollView
          style={styles.navScroll}
          contentContainerStyle={styles.navContent}
          showsVerticalScrollIndicator={false}
        >
          {!collapsed ? <Text style={styles.navEyebrow}>Workspace</Text> : null}
          {navigation.map((item) => {
            const active = isAppTabActive(item.tab, pathname);
            return (
              <Pressable
                key={item.tab}
                accessibilityRole="link"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: active }}
                onPress={() => router.push(item.pathname as never)}
                style={({ pressed }) => [
                  styles.navItem,
                  collapsed && styles.navItemCollapsed,
                  active && styles.navItemActive,
                  pressed && styles.pressed,
                ]}
              >
                {active ? <View style={styles.activeRail} /> : null}
                <View style={[styles.navIcon, active && styles.navIconActive]}>
                  <Feather
                    name={item.icon}
                    size={18}
                    color={active ? palette.purple : palette.muted}
                  />
                </View>
                {!collapsed ? (
                  <Text
                    style={[styles.navLabel, active && styles.navLabelActive]}
                  >
                    {item.label}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}

          {!collapsed ? (
            <View style={styles.promoCard}>
              <View style={styles.promoIcon}>
                <Feather name="trending-up" size={16} color={palette.purple} />
              </View>
              <Text style={styles.promoTitle}>Your plan, one clear flow</Text>
              <Text style={styles.promoCopy}>
                Desktop and PWA share the same money, calculations, and plan.
              </Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.sidebarFooter}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            onPress={() => void signOut()}
            style={({ pressed }) => [
              styles.footerButton,
              collapsed && styles.footerButtonCollapsed,
              pressed && styles.pressed,
            ]}
          >
            <Feather name="log-out" size={18} color={palette.muted} />
            {!collapsed ? (
              <Text style={styles.footerText}>Sign Out</Text>
            ) : null}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              collapsed ? "Expand sidebar" : "Collapse sidebar"
            }
            onPress={() => setCollapsed((value) => !value)}
            style={({ pressed }) => [
              styles.footerButton,
              collapsed && styles.footerButtonCollapsed,
              pressed && styles.pressed,
            ]}
          >
            <Feather
              name={collapsed ? "chevrons-right" : "chevrons-left"}
              size={18}
              color={palette.muted}
            />
            {!collapsed ? (
              <Text style={styles.footerText}>Collapse sidebar</Text>
            ) : null}
          </Pressable>
        </View>
      </View>

      <View style={styles.main}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: "row",
    overflow: "hidden",
  },
  sidebar: {
    backgroundColor: palette.surface,
    borderRightWidth: 1,
    borderRightColor: palette.border,
    overflow: "hidden",
  },
  brand: {
    minHeight: 78,
    paddingHorizontal: 17,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  brandCollapsed: { justifyContent: "center", paddingHorizontal: 0 },
  logo: { width: 34, height: 34 },
  brandName: {
    color: palette.text,
    fontSize: 19,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.5,
  },
  brandAccent: { color: palette.purple },
  navScroll: { flex: 1 },
  navContent: { padding: 12, gap: 5 },
  navEyebrow: {
    color: palette.faint,
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.7,
    textTransform: "uppercase",
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 4,
  },
  navItem: {
    minHeight: 46,
    borderRadius: 11,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    position: "relative",
    overflow: "hidden",
  },
  navItemCollapsed: { justifyContent: "center", paddingHorizontal: 0 },
  navItemActive: { backgroundColor: palette.purpleSoft },
  activeRail: {
    position: "absolute",
    left: 0,
    top: 9,
    bottom: 9,
    width: 3,
    borderRadius: 2,
    backgroundColor: palette.purple,
  },
  navIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  navIconActive: { backgroundColor: palette.surface },
  navLabel: {
    color: palette.textSecondary,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  navLabelActive: {
    color: palette.purpleDark,
    fontFamily: "Inter_700Bold",
  },
  promoCard: {
    marginTop: 20,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 14,
    backgroundColor: palette.surfaceMuted,
    padding: 14,
  },
  promoIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.purpleSoft,
    marginBottom: 12,
  },
  promoTitle: {
    color: palette.text,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: "Inter_700Bold",
  },
  promoCopy: {
    color: palette.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
  },
  sidebarFooter: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
    gap: 3,
  },
  footerButton: {
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  footerButtonCollapsed: { justifyContent: "center", paddingHorizontal: 0 },
  footerText: {
    color: palette.muted,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  main: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    backgroundColor: palette.canvas,
  },
  pressed: { opacity: 0.66 },
});
