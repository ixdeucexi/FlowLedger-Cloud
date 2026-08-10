import { Feather } from "@expo/vector-icons";
import { useGlobalSearchParams, usePathname, useRouter } from "expo-router";
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
import { useAppDiscovery } from "@/context/AppDiscoveryContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import {
  desktopTabsForPlanning,
  isDesktopPlanningTabActive,
  type DesktopPlanningTabName,
} from "@/lib/appTabs";
import { readInterfacePreferences, updateInterfacePreferences } from "@/lib/interfacePreferences";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

type NavigationItem = {
  label: string;
  icon: FeatherName;
  pathname: string;
  tab: DesktopPlanningTabName;
  view?: "bills" | "debt";
};

export function DesktopChrome({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ view?: string }>();
  const { width } = useWindowDimensions();
  const { signOut, user } = useAuth();
  const { activeHousehold, settings } = useBudget();
  const colors = useColors();
  const { openCommands, openNotifications, openSearch, unreadNotificationCount } = useAppDiscovery();
  const [collapsed, setCollapsed] = useState(width < 1180);

  const preferenceScope = user && activeHousehold
    ? { userId: user.id, householdId: activeHousehold.householdId }
    : null;

  useEffect(() => {
    if (!preferenceScope) return;
    let active = true;
    void readInterfacePreferences(preferenceScope.userId, preferenceScope.householdId).then(preferences => {
      if (active && typeof preferences.sidebarCollapsed === "boolean") {
        setCollapsed(preferences.sidebarCollapsed);
      }
    });
    return () => { active = false; };
  }, [preferenceScope?.householdId, preferenceScope?.userId]);

  const navigation = useMemo<NavigationItem[]>(
    () =>
      desktopTabsForPlanning(settings.zeroBasedBudgetEnabled).map((tab) => ({
        label: tab.title,
        icon: tab.icon as FeatherName,
        pathname: tab.pathname,
        tab: tab.name,
        view: tab.view,
      })),
    [settings.zeroBasedBudgetEnabled],
  );
  const isCollapsed = collapsed;
  const sidebarWidth = isCollapsed ? 76 : 244;

  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (preferenceScope) {
      void updateInterfacePreferences(preferenceScope.userId, preferenceScope.householdId, {
        sidebarCollapsed: next,
      });
    }
  };

  return (
    <View
      style={[
        styles.root,
        desktopThemeVariables(colors.isDark),
        { backgroundColor: palette.canvas },
      ]}
    >
      <View style={[styles.sidebar, { width: sidebarWidth }]}>
        <View style={[styles.brand, isCollapsed && styles.brandCollapsed]}>
          <Image
            accessibilityLabel="FlowLedger Algo logo"
            resizeMode="contain"
            source={require("../../assets/images/startup_f_transparent.png")}
            style={styles.logo}
          />
          {!isCollapsed ? (
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
          <View style={[styles.discoveryActions, isCollapsed && styles.discoveryActionsCollapsed]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search FlowLedger"
              accessibilityHint="Search this household's bills, debts, goals, activity, reports, and settings"
              onPress={openSearch}
              style={({ pressed }) => [styles.discoveryButton, isCollapsed && styles.discoveryButtonCollapsed, pressed && styles.pressed]}
            >
              <Feather name="search" size={17} color={palette.muted} />
              {!isCollapsed ? <Text style={styles.discoveryText}>Search</Text> : null}
              {!isCollapsed ? <Text style={styles.discoveryShortcut}>/</Text> : null}
            </Pressable>
            <View style={[styles.discoverySecondaryRow, isCollapsed && styles.discoverySecondaryColumn]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open quick actions"
                onPress={openCommands}
                style={({ pressed }) => [styles.discoverySmallButton, isCollapsed && styles.discoverySmallButtonCollapsed, pressed && styles.pressed]}
              >
                <Feather name="zap" size={16} color={palette.purple} />
                {!isCollapsed ? <Text style={styles.discoverySmallText}>Actions</Text> : null}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open notifications${unreadNotificationCount ? `, ${unreadNotificationCount} unread` : ""}`}
                onPress={openNotifications}
                style={({ pressed }) => [styles.discoverySmallButton, isCollapsed && styles.discoverySmallButtonCollapsed, pressed && styles.pressed]}
              >
                <View>
                  <Feather name="bell" size={16} color={palette.muted} />
                  {unreadNotificationCount ? <View style={styles.notificationDot} /> : null}
                </View>
                {!isCollapsed ? <Text style={styles.discoverySmallText}>Alerts</Text> : null}
                {!isCollapsed && unreadNotificationCount ? <View style={styles.notificationBadge}><Text style={styles.notificationBadgeText}>{Math.min(unreadNotificationCount, 99)}</Text></View> : null}
              </Pressable>
            </View>
          </View>
          {!isCollapsed ? <Text style={styles.navEyebrow}>Workspace</Text> : null}
          {navigation.map((item) => {
            const active = isDesktopPlanningTabActive(item.tab, pathname, params.view ?? null);
            return (
              <Pressable
                key={item.tab}
                accessibilityRole="link"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: active }}
                onPress={() => {
                  router.push(item.view
                    ? { pathname: item.pathname, params: { view: item.view } } as never
                    : item.pathname as never);
                }}
                style={({ pressed }) => [
                  styles.navItem,
                  isCollapsed && styles.navItemCollapsed,
                  active && styles.navItemActive,
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.activeRail, !active && styles.activeRailInactive]} />
                <View style={[styles.navIcon, active && styles.navIconActive]}>
                  <Feather
                    name={item.icon}
                    size={18}
                    color={active ? palette.purple : palette.muted}
                  />
                </View>
                {!isCollapsed ? (
                  <Text
                    style={[styles.navLabel, active && styles.navLabelActive]}
                  >
                    {item.label}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}

          {!isCollapsed ? (
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
              isCollapsed && styles.footerButtonCollapsed,
              pressed && styles.pressed,
            ]}
          >
            <Feather name="log-out" size={18} color={palette.muted} />
            {!isCollapsed ? (
              <Text style={styles.footerText}>Sign Out</Text>
            ) : null}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
            onPress={toggleSidebar}
            style={({ pressed }) => [
              styles.footerButton,
              isCollapsed && styles.footerButtonCollapsed,
              pressed && styles.pressed,
            ]}
          >
            <Feather
              name={isCollapsed ? "chevrons-right" : "chevrons-left"}
              size={18}
              color={palette.muted}
            />
            {!isCollapsed ? (
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
  discoveryActions: { gap: 7, marginBottom: 10 },
  discoveryActionsCollapsed: { alignItems: "center" },
  discoveryButton: { minHeight: 42, borderWidth: 1, borderColor: palette.border, borderRadius: 11, backgroundColor: palette.surfaceMuted, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 9 },
  discoveryButtonCollapsed: { width: 48, justifyContent: "center", paddingHorizontal: 0 },
  discoveryText: { flex: 1, color: palette.textSecondary, fontFamily: "Inter_600SemiBold", fontSize: 13 },
  discoveryShortcut: { color: palette.faint, fontFamily: "Inter_700Bold", fontSize: 12 },
  discoverySecondaryRow: { flexDirection: "row", gap: 7 },
  discoverySecondaryColumn: { flexDirection: "column" },
  discoverySmallButton: { flex: 1, minHeight: 38, borderWidth: 1, borderColor: palette.borderSoft, borderRadius: 10, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  discoverySmallButtonCollapsed: { width: 48, flex: 0, paddingHorizontal: 0 },
  discoverySmallText: { color: palette.muted, fontFamily: "Inter_600SemiBold", fontSize: 11 },
  notificationDot: { position: "absolute", right: -4, top: -4, width: 7, height: 7, borderRadius: 4, backgroundColor: palette.red },
  notificationBadge: { minWidth: 19, height: 19, borderRadius: 10, backgroundColor: palette.red, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  notificationBadgeText: { color: "#ffffff", fontFamily: "Inter_800ExtraBold", fontSize: 9 },
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
  activeRailInactive: { opacity: 0 },
  navIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  navIconActive: { backgroundColor: palette.surface },
  navLabel: {
    flex: 1,
    minWidth: 0,
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
