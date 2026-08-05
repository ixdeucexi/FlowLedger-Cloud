import { Feather } from "@expo/vector-icons";
import { useGlobalSearchParams, usePathname, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useBudget, type DashboardFilter } from "@/context/BudgetContext";
import { DesktopAddMenu } from "@/components/desktop/DesktopAddMenu";
import { DesktopWorkspacePage } from "@/components/desktop/DesktopWorkspacePage";
import {
  desktopAddDestination,
  desktopPlannerDestination,
  type DesktopAddAction,
} from "@/lib/desktopActions";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

type NavigationItem = {
  label: string;
  icon: FeatherName;
  pathname: string;
  section?: string;
  filter?: DashboardFilter;
  prompt?: string;
};

const NAVIGATION: NavigationItem[] = [
  { label: "Dashboard", icon: "grid", pathname: "/" },
  { label: "Bills", icon: "file-text", pathname: "/bills", filter: "bills" },
  {
    label: "Income",
    icon: "arrow-down-left",
    pathname: "/more",
    section: "money",
  },
  { label: "Debt", icon: "credit-card", pathname: "/bills", filter: "debt" },
  { label: "Goals", icon: "target", pathname: "/more", section: "goals" },
  {
    label: "Can I Afford It?",
    icon: "help-circle",
    pathname: "/flo",
    prompt: "Can I afford a purchase? Help me choose a safe amount and date.",
  },
  { label: "Calendar", icon: "calendar", pathname: "/monthly" },
  { label: "Activity", icon: "activity", pathname: "/transactions" },
  {
    label: "Reports",
    icon: "bar-chart-2",
    pathname: "/more",
    section: "reports",
  },
  { label: "Settings", icon: "settings", pathname: "/more" },
];

function userDisplayName(user: ReturnType<typeof useAuth>["user"]) {
  const metadata = user?.user_metadata ?? {};
  const candidate =
    metadata.full_name ?? metadata.name ?? metadata.display_name;
  if (typeof candidate === "string" && candidate.trim())
    return candidate.trim();
  if (user?.email) return user.email.split("@")[0].replace(/[._-]+/g, " ");
  return "John";
}

function userInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "FL"
  );
}

export function DesktopChrome({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ section?: string; mode?: string }>();
  const { width } = useWindowDimensions();
  const { user, signOut } = useAuth();
  const { dashboardFilter, setDashboardFilter } = useBudget();
  const [collapsed, setCollapsed] = useState(width < 1180);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    if (width < 1180) setCollapsed(true);
  }, [width]);

  const displayName = userDisplayName(user);
  const firstName = displayName.split(/\s+/)[0] || displayName;
  const section = Array.isArray(params.section)
    ? params.section[0]
    : params.section;
  const mode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const sidebarWidth = collapsed ? 76 : 244;
  const compactActions = width < 1120;
  const websitePage = ["/bills", "/transactions", "/monthly", "/more"].includes(pathname);
  const searchResults = searchQuery.trim()
    ? NAVIGATION.filter((item) =>
        item.label.toLowerCase().includes(searchQuery.trim().toLowerCase()),
      ).slice(0, 5)
    : NAVIGATION.slice(0, 5);

  const navigateTo = (item: NavigationItem) => {
    if (item.filter !== undefined) setDashboardFilter(item.filter);
    if (item.pathname === "/") {
      router.push("/(tabs)" as never);
    } else {
      const nextParams: Record<string, string> = {};
      if (item.section) nextParams.section = item.section;
      if (item.prompt) nextParams.prompt = item.prompt;
      router.push({
        pathname: `/(tabs)${item.pathname}` as never,
        params: nextParams,
      } as never);
    }
    setNotificationsOpen(false);
    setProfileOpen(false);
    setAddOpen(false);
    setSearchOpen(false);
    setSearchQuery("");
  };

  const launchAddAction = (action: DesktopAddAction) => {
    router.push(desktopAddDestination(action) as never);
    setAddOpen(false);
    setNotificationsOpen(false);
    setProfileOpen(false);
  };

  const isActive = (item: NavigationItem) => {
    const normalizedPath =
      pathname === "/" || pathname === "/(tabs)" ? "/" : pathname;
    if (item.pathname === "/") return normalizedPath === "/";
    if (item.pathname === "/more") {
      if (normalizedPath !== "/more") return false;
      if (item.section) return section === item.section;
      return !section;
    }
    if (item.pathname === "/bills" && item.filter) {
      return normalizedPath === "/bills" && dashboardFilter === item.filter;
    }
    return normalizedPath === item.pathname;
  };

  const desktopTransition = {
    transitionProperty: "width",
    transitionDuration: "220ms",
    transitionTimingFunction: "ease",
  } as never;

  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={styles.ambientBackdrop}>
        <View style={styles.ambientPurple} />
        <View style={styles.ambientBlue} />
        <View style={styles.ambientCyan} />
      </View>

      <View style={styles.topbar}>
        <View
          style={[styles.brandArea, { width: sidebarWidth }, desktopTransition]}
        >
          <View style={styles.logoMark} accessibilityLabel="FlowLedger Algo logo">
            <View style={[styles.logoStroke, styles.logoStrokeTop]} />
            <View style={[styles.logoStroke, styles.logoStrokeMiddle]} />
            <View style={[styles.logoStroke, styles.logoStrokeBottom]} />
          </View>
          {!collapsed ? (
            <View style={styles.brandCopy}>
              <Text style={styles.brandName}>
                FlowLedger <Text style={styles.brandAlgo}>Algo</Text>
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.topbarCenter}>
          <View style={styles.searchWrap}>
            <Feather name="search" size={16} color="#69758d" />
            <TextInput
              accessibilityLabel="Search FlowLedger"
              onFocus={() => {
                setSearchOpen(true);
                setAddOpen(false);
              }}
              onChangeText={setSearchQuery}
              onSubmitEditing={() => {
                if (searchResults[0]) navigateTo(searchResults[0]);
              }}
              placeholder="Search bills, goals, reports..."
              placeholderTextColor="#66738a"
              returnKeyType="go"
              style={styles.searchInput}
              value={searchQuery}
            />
            <View style={styles.searchShortcut}>
              <Text style={styles.searchShortcutText}>⌘ K</Text>
            </View>
            {searchOpen ? (
              <View style={styles.searchResults}>
                <Text style={styles.searchResultEyebrow}>
                  {searchQuery.trim() ? "Search results" : "Quick navigation"}
                </Text>
                {searchResults.length ? (
                  searchResults.map((item) => (
                    <Pressable
                      key={`${item.label}-${item.pathname}`}
                      onPress={() => navigateTo(item)}
                      style={({ pressed }) => [
                        styles.searchResult,
                        { opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      <View style={styles.searchResultIcon}>
                        <Feather name={item.icon} size={15} color="#b9a7ff" />
                      </View>
                      <Text style={styles.searchResultText}>{item.label}</Text>
                      <Feather name="arrow-up-right" size={14} color="#65738b" />
                    </Pressable>
                  ))
                ) : (
                  <Text style={styles.searchEmpty}>No matching workspace page.</Text>
                )}
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.topbarActions}>
          <View style={styles.actionAnchor}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add to your plan"
              accessibilityState={{ expanded: addOpen }}
              onPress={() => {
                setAddOpen((value) => !value);
                setNotificationsOpen(false);
                setProfileOpen(false);
              }}
              style={({ pressed }) => [styles.addButton, { opacity: pressed ? 0.78 : 1 }]}
            >
              <Feather name="plus" size={17} color="#ffffff" />
              {!compactActions ? <Text style={styles.addButtonText}>Add</Text> : null}
            </Pressable>
            {addOpen ? <DesktopAddMenu onSelect={launchAddAction} style={styles.topAddMenu} /> : null}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            onPress={() => navigateTo(NAVIGATION[NAVIGATION.length - 1])}
            style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.72 : 1 }]}
          >
            <Feather name="settings" size={18} color="#c7d2e6" />
          </Pressable>

          <View style={styles.actionAnchor}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              onPress={() => {
                setNotificationsOpen((value) => !value);
                setProfileOpen(false);
                setAddOpen(false);
              }}
              style={({ pressed }) => [
                styles.iconButton,
                { opacity: pressed ? 0.72 : 1 },
              ]}
            >
              <Feather name="bell" size={18} color="#c7d2e6" />
            </Pressable>
            {notificationsOpen ? (
              <View style={[styles.popover, styles.notificationPopover]}>
                <Text style={styles.popoverEyebrow}>Notifications</Text>
                <Text style={styles.popoverTitle}>Notification center</Text>
                <Text style={styles.popoverBody}>
                  Your alert preferences are shared with the PWA, so you see
                  the same plan on every device.
                </Text>
                <Pressable
                  onPress={() => {
                    router.push(desktopPlannerDestination("notifications") as never);
                    setNotificationsOpen(false);
                  }}
                  style={styles.notificationSettingsRow}
                >
                  <Feather name="settings" size={14} color="#9db2d0" />
                  <Text style={styles.notificationSettingsText}>Notification settings</Text>
                  <Feather name="arrow-up-right" size={13} color="#64748b" />
                </Pressable>
              </View>
            ) : null}
          </View>

          <View style={styles.actionAnchor}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open profile menu"
              onPress={() => {
                setProfileOpen((value) => !value);
                setNotificationsOpen(false);
                setAddOpen(false);
              }}
              style={({ pressed }) => [
                styles.profileButton,
                { opacity: pressed ? 0.76 : 1 },
              ]}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {userInitials(displayName)}
                </Text>
              </View>
              {!compactActions ? (
                <View style={styles.profileCopy}>
                  <Text style={styles.profileName}>{firstName}</Text>
                  <Text style={styles.profilePlan}>Personal plan</Text>
                </View>
              ) : null}
              <Feather name="chevron-down" size={14} color="#77839b" />
            </Pressable>
            {profileOpen ? (
              <View style={[styles.popover, styles.profilePopover]}>
                <Text style={styles.popoverEyebrow}>Signed in as</Text>
                <Text style={styles.popoverTitle}>{displayName}</Text>
                <Text style={styles.profileEmail} numberOfLines={1}>
                  {user?.email ?? "FlowLedger member"}
                </Text>
                <View style={styles.popoverDivider} />
                <Pressable
                  onPress={() => {
                    router.push(desktopPlannerDestination("accounts") as never);
                    setProfileOpen(false);
                  }}
                  style={styles.profileMenuRow}
                >
                  <Feather name="settings" size={15} color="#aab7cc" />
                  <Text style={styles.profileMenuText}>Account settings</Text>
                </Pressable>
                <Pressable
                  onPress={() => void signOut()}
                  style={styles.profileMenuRow}
                >
                  <Feather name="log-out" size={15} color="#fb7185" />
                  <Text style={[styles.profileMenuText, { color: "#fda4af" }]}>
                    Sign out
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.body}>
        <View
          style={[styles.sidebar, { width: sidebarWidth }, desktopTransition]}
        >
          <ScrollView
            style={styles.sidebarNav}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.sidebarScroll}
          >
            <Text
              style={[
                styles.sidebarLabel,
                collapsed && styles.sidebarLabelCollapsed,
              ]}
            >
              {collapsed ? "" : "Workspace"}
            </Text>
            {NAVIGATION.map((item) => {
              const active = isActive(item);
              return (
                <Pressable
                  key={item.label}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  accessibilityState={{ selected: active }}
                  onPress={() => navigateTo(item)}
                  style={({ pressed }) => [
                    styles.navItem,
                    collapsed && styles.navItemCollapsed,
                    active && styles.navItemActive,
                    { opacity: pressed ? 0.76 : 1 },
                  ]}
                >
                  {active ? <View style={styles.activeRail} /> : null}
                  <View
                    style={[styles.navIcon, active && styles.navIconActive]}
                  >
                    <Feather
                      name={item.icon}
                      size={17}
                      color={active ? "#d9e7ff" : "#7f8ca5"}
                    />
                  </View>
                  {!collapsed ? (
                    <Text
                      style={[styles.navText, active && styles.navTextActive]}
                      numberOfLines={1}
                    >
                      {item.label}
                    </Text>
                  ) : null}
                  {!collapsed && active ? (
                    <View style={styles.activeDot} />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.sidebarFooter}>
            {!collapsed ? (
              <Pressable
                onPress={() => router.push("/(tabs)/flo" as never)}
                style={({ pressed }) => [styles.brandPromo, { opacity: pressed ? 0.76 : 1 }]}
              >
                <View pointerEvents="none" style={styles.brandPromoGlow} />
                <Text style={styles.brandPromoTitle}>FlowLedger Algo</Text>
                <Text style={styles.brandPromoText}>
                  Take control. Build wealth.{"\n"}Make every decision count.
                </Text>
                <View style={styles.brandPromoLink}>
                  <Text style={styles.brandPromoLinkText}>Ask Flo</Text>
                  <Feather name="arrow-up-right" size={13} color="#c4b5fd" />
                </View>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign out"
              onPress={() => void signOut()}
              style={({ pressed }) => [
                styles.signOutButton,
                collapsed && styles.collapseButtonCentered,
                { opacity: pressed ? 0.72 : 1 },
              ]}
            >
              <Feather name="log-out" size={16} color="#8b9ab3" />
              {!collapsed ? <Text style={styles.signOutText}>Sign Out</Text> : null}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                collapsed ? "Expand sidebar" : "Collapse sidebar"
              }
              onPress={() => setCollapsed((value) => !value)}
              style={({ pressed }) => [
                styles.collapseButton,
                collapsed && styles.collapseButtonCentered,
                { opacity: pressed ? 0.72 : 1 },
              ]}
            >
              <Feather
                name={collapsed ? "chevrons-right" : "chevrons-left"}
                size={16}
                color="#8b9ab3"
              />
              {!collapsed ? (
                <Text style={styles.collapseText}>Collapse sidebar</Text>
              ) : null}
            </Pressable>
          </View>
        </View>

        <View style={styles.main}>
          {websitePage && mode !== "planner" ? (
            <DesktopWorkspacePage
              pathname={pathname}
              section={section}
              onOpenPlanner={() => router.setParams({ mode: "planner" } as never)}
            />
          ) : websitePage ? (
            <View style={styles.plannerShell}>
              <View style={styles.plannerToolbar}>
                <View style={styles.plannerToolbarCopy}>
                  <Text style={styles.plannerEyebrow}>PLANNER MODE</Text>
                  <Text style={styles.plannerTitle}>Detailed editing workspace</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.setParams({ mode: "" } as never)}
                  style={({ pressed }) => [styles.returnButton, { opacity: pressed ? 0.72 : 1 }]}
                >
                  <Feather name="arrow-left" size={14} color="#b9c7da" />
                  <Text style={styles.returnButtonText}>Return to website view</Text>
                </Pressable>
              </View>
              <View style={styles.plannerContent}>{children}</View>
            </View>
          ) : children}
        </View>
      </View>
    </View>
  );
}

const glassSurface = {
  backgroundColor: "rgba(8, 13, 31, 0.92)",
  borderWidth: 1,
  borderColor: "rgba(148, 163, 184, 0.14)",
} as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#03040b", overflow: "hidden" },
  ambientBackdrop: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  ambientPurple: {
    position: "absolute",
    width: 680,
    height: 680,
    borderRadius: 340,
    top: -390,
    right: 60,
    backgroundColor: "rgba(159, 92, 255, 0.08)",
    shadowColor: "#6d28d9",
    shadowOpacity: 0.35,
    shadowRadius: 120,
    shadowOffset: { width: 0, height: 0 },
  },
  ambientBlue: {
    position: "absolute",
    width: 540,
    height: 540,
    borderRadius: 270,
    bottom: -310,
    left: 170,
    backgroundColor: "rgba(47, 111, 255, 0.07)",
    shadowColor: "#2563eb",
    shadowOpacity: 0.32,
    shadowRadius: 120,
    shadowOffset: { width: 0, height: 0 },
  },
  ambientCyan: {
    position: "absolute",
    width: 340,
    height: 340,
    borderRadius: 170,
    top: 240,
    right: -230,
    backgroundColor: "rgba(34, 211, 238, 0.05)",
    shadowColor: "#0891b2",
    shadowOpacity: 0.25,
    shadowRadius: 100,
    shadowOffset: { width: 0, height: 0 },
  },
  topbar: {
    height: 72,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(148,163,184,0.12)",
    backgroundColor: "rgba(3,4,11,0.96)",
    zIndex: 40,
  },
  brandArea: {
    height: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    borderRightWidth: 1,
    borderRightColor: "rgba(148,163,184,0.10)",
    overflow: "hidden",
  },
  logoMark: { width: 36, height: 36, justifyContent: "center", gap: 3, transform: [{ rotate: "-9deg" }] },
  logoStroke: { height: 6, borderRadius: 4, shadowOpacity: 0.55, shadowRadius: 7, shadowOffset: { width: 0, height: 0 } },
  logoStrokeTop: { width: 31, backgroundColor: "#2dd4bf", shadowColor: "#2dd4bf" },
  logoStrokeMiddle: { width: 25, marginLeft: 3, backgroundColor: "#3b82f6", shadowColor: "#3b82f6" },
  logoStrokeBottom: { width: 18, marginLeft: 6, backgroundColor: "#8b5cf6", shadowColor: "#8b5cf6" },
  brandCopy: { minWidth: 150 },
  brandName: {
    color: "#f8fafc",
    fontSize: 17,
    lineHeight: 21,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.45,
  },
  brandAlgo: { color: "#bca7ff", fontFamily: "Inter_700Bold" },
  topbarCenter: {
    flex: 1,
    minWidth: 80,
    maxWidth: 720,
    paddingHorizontal: 24,
    zIndex: 80,
  },
  searchWrap: {
    width: "100%",
    maxWidth: 620,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.15)",
    backgroundColor: "rgba(15,23,42,0.68)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 13,
    position: "relative",
  },
  searchInput: {
    flex: 1,
    color: "#e5edf9",
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    outlineStyle: "none",
  } as never,
  searchShortcut: {
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.14)",
    backgroundColor: "rgba(2,6,23,0.58)",
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  searchShortcutText: {
    color: "#69758d",
    fontSize: 9,
    fontFamily: "Inter_700Bold",
  },
  searchResults: {
    ...glassSurface,
    position: "absolute",
    left: 0,
    right: 0,
    top: 51,
    borderRadius: 17,
    padding: 7,
    shadowColor: "#000",
    shadowOpacity: 0.38,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
    zIndex: 100,
  },
  searchResult: {
    minHeight: 45,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
  },
  searchResultIcon: {
    width: 29,
    height: 29,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(124,58,237,0.16)",
  },
  searchResultText: {
    flex: 1,
    color: "#dbe6f6",
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
  searchResultEyebrow: {
    color: "#68758d",
    fontSize: 9,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 1,
    textTransform: "uppercase",
    paddingHorizontal: 10,
    paddingTop: 7,
    paddingBottom: 5,
  },
  searchEmpty: {
    color: "#77859d",
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    paddingHorizontal: 10,
    paddingVertical: 14,
  },
  topbarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingRight: 20,
    zIndex: 60,
  },
  actionAnchor: { position: "relative" },
  topAddMenu: { top: 50, right: 0 },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.13)",
    backgroundColor: "rgba(15,23,42,0.58)",
  },
  compactOnly: { display: "none" },
  addButton: {
    minWidth: 44,
    height: 40,
    paddingHorizontal: 13,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "#9f5cff",
    borderWidth: 1,
    borderColor: "rgba(216,180,254,0.36)",
    shadowColor: "#9f5cff",
    shadowOpacity: 0.46,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  addButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontFamily: "Inter_800ExtraBold",
  },
  profileButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderRadius: 14,
    paddingHorizontal: 7,
    paddingRight: 10,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#5530a8",
    borderWidth: 1,
    borderColor: "rgba(216,180,254,0.34)",
  },
  avatarText: {
    color: "#f5f3ff",
    fontSize: 11,
    fontFamily: "Inter_800ExtraBold",
  },
  profileCopy: { minWidth: 84 },
  profileName: { color: "#edf3fb", fontSize: 12, fontFamily: "Inter_700Bold" },
  profilePlan: {
    color: "#68758d",
    fontSize: 9,
    fontFamily: "Inter_600SemiBold",
    marginTop: 1,
  },
  popover: {
    ...glassSurface,
    position: "absolute",
    top: 50,
    right: 0,
    width: 290,
    borderRadius: 18,
    padding: 15,
    shadowColor: "#000",
    shadowOpacity: 0.42,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
    zIndex: 110,
  },
  notificationPopover: { width: 310 },
  notificationSettingsRow: {
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.12)",
    backgroundColor: "rgba(15,23,42,0.48)",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    marginTop: 12,
  },
  notificationSettingsText: {
    flex: 1,
    color: "#b9c6d9",
    fontSize: 10,
    fontFamily: "Inter_700Bold",
  },
  profilePopover: { width: 240 },
  popoverEyebrow: {
    color: "#9180e8",
    fontSize: 9,
    fontFamily: "Inter_800ExtraBold",
    textTransform: "uppercase",
    letterSpacing: 1.1,
    marginBottom: 6,
  },
  popoverTitle: {
    color: "#eef4fc",
    fontSize: 14,
    fontFamily: "Inter_800ExtraBold",
  },
  popoverBody: {
    color: "#8e9ab0",
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "Inter_500Medium",
    marginTop: 6,
  },
  profileEmail: {
    color: "#78859d",
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    marginTop: 4,
  },
  popoverDivider: {
    height: 1,
    backgroundColor: "rgba(148,163,184,0.12)",
    marginVertical: 11,
  },
  profileMenuRow: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  profileMenuText: {
    color: "#c4cfdf",
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  body: { flex: 1, flexDirection: "row" },
  sidebar: {
    borderRightWidth: 1,
    borderRightColor: "rgba(148,163,184,0.10)",
    backgroundColor: "rgba(5,8,20,0.86)",
    overflow: "hidden",
  },
  plannerShell: { flex: 1, backgroundColor: "#050816" },
  plannerToolbar: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    paddingHorizontal: 28,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(148,163,184,0.12)",
    backgroundColor: "rgba(7,12,27,0.94)",
  },
  plannerToolbarCopy: { flex: 1, minWidth: 0 },
  plannerEyebrow: {
    color: "#8f7ae8",
    fontSize: 8,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 1.15,
  },
  plannerTitle: {
    color: "#dce5f2",
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    marginTop: 2,
  },
  returnButton: {
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.14)",
    backgroundColor: "rgba(15,23,42,0.72)",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  returnButtonText: { color: "#b9c7da", fontSize: 9, fontFamily: "Inter_700Bold" },
  plannerContent: { flex: 1 },
  sidebarNav: { flex: 1 },
  sidebarScroll: { paddingHorizontal: 12, paddingTop: 14, paddingBottom: 12 },
  sidebarLabel: {
    height: 24,
    color: "#526078",
    fontSize: 9,
    fontFamily: "Inter_800ExtraBold",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    paddingHorizontal: 10,
  },
  sidebarLabelCollapsed: { paddingHorizontal: 0 },
  navItem: {
    minHeight: 43,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 8,
    marginBottom: 4,
    position: "relative",
    overflow: "hidden",
  },
  navItemCollapsed: { justifyContent: "center", paddingHorizontal: 0 },
  navItemActive: {
    backgroundColor: "rgba(124,58,237,0.17)",
    borderWidth: 1,
    borderColor: "rgba(159,92,255,0.22)",
  },
  activeRail: {
    position: "absolute",
    left: 0,
    top: 9,
    bottom: 9,
    width: 2,
    borderRadius: 2,
    backgroundColor: "#7c9cff",
    shadowColor: "#6d7dff",
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  navIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  navIconActive: { backgroundColor: "rgba(99,102,241,0.20)" },
  navText: {
    flex: 1,
    color: "#8390a7",
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  navTextActive: { color: "#edf3fb", fontFamily: "Inter_700Bold" },
  activeDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#70d9ff",
  },
  sidebarFooter: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(148,163,184,0.08)",
  },
  brandPromo: {
    minHeight: 142,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.24)",
    backgroundColor: "rgba(28,18,64,0.36)",
    justifyContent: "flex-end",
    padding: 14,
    marginBottom: 10,
    overflow: "hidden",
  },
  brandPromoGlow: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    right: -76,
    bottom: -82,
    backgroundColor: "rgba(124,58,237,0.2)",
    shadowColor: "#7c3aed",
    shadowOpacity: 0.7,
    shadowRadius: 48,
    shadowOffset: { width: 0, height: 0 },
  },
  brandPromoTitle: {
    color: "#c4b5fd",
    fontSize: 11,
    fontFamily: "Inter_800ExtraBold",
    marginBottom: 10,
  },
  brandPromoText: {
    color: "#e5e7eb",
    fontSize: 9,
    lineHeight: 15,
    fontFamily: "Inter_500Medium",
  },
  brandPromoLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 10,
  },
  brandPromoLinkText: {
    color: "#c4b5fd",
    fontSize: 9,
    fontFamily: "Inter_700Bold",
  },
  signOutButton: {
    minHeight: 38,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 10,
  },
  signOutText: {
    color: "#a5b1c4",
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
  floOrb: {
    width: 33,
    height: 33,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(124,58,237,0.24)",
  },
  floTitle: {
    color: "#ded7ff",
    fontSize: 11,
    fontFamily: "Inter_800ExtraBold",
  },
  floSub: {
    color: "#737f97",
    fontSize: 8,
    fontFamily: "Inter_600SemiBold",
    marginTop: 2,
  },
  collapseButton: {
    minHeight: 37,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 10,
  },
  collapseButtonCentered: { justifyContent: "center", paddingHorizontal: 0 },
  collapseText: {
    color: "#6f7d94",
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
  main: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    backgroundColor: "#03040b",
  },
});
