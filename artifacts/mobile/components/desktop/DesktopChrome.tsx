import { Feather } from "@expo/vector-icons";
import { useGlobalSearchParams, usePathname, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
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
  const params = useGlobalSearchParams<{ section?: string }>();
  const { width } = useWindowDimensions();
  const { user, signOut } = useAuth();
  const { dashboardFilter, setDashboardFilter } = useBudget();
  const [collapsed, setCollapsed] = useState(width < 1180);
  const [query, setQuery] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    if (width < 1180) setCollapsed(true);
  }, [width]);

  const displayName = userDisplayName(user);
  const firstName = displayName.split(/\s+/)[0] || displayName;
  const section = Array.isArray(params.section)
    ? params.section[0]
    : params.section;
  const sidebarWidth = collapsed ? 74 : 228;
  const compactActions = width < 1120;
  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return NAVIGATION.filter((item) =>
      item.label.toLowerCase().includes(normalized),
    ).slice(0, 5);
  }, [query]);

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
    setQuery("");
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
          <Image
            source={require("../../assets/brand/flowledger-dashboard-logo.jpg")}
            style={styles.logo}
            resizeMode="cover"
          />
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
            <Feather name="search" size={17} color="#71809d" />
            <TextInput
              accessibilityLabel="Search FlowLedger"
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => matches[0] && navigateTo(matches[0])}
              placeholder="Search bills, goals, reports..."
              placeholderTextColor="#65718a"
              style={styles.searchInput}
            />
            <View style={styles.searchShortcut}>
              <Text style={styles.searchShortcutText}>Ctrl K</Text>
            </View>
            {matches.length > 0 ? (
              <View style={styles.searchResults}>
                {matches.map((item) => (
                  <Pressable
                    key={item.label}
                    accessibilityRole="button"
                    onPress={() => navigateTo(item)}
                    style={({ pressed }) => [
                      styles.searchResult,
                      { opacity: pressed ? 0.72 : 1 },
                    ]}
                  >
                    <View style={styles.searchResultIcon}>
                      <Feather name={item.icon} size={15} color="#b7a6ff" />
                    </View>
                    <Text style={styles.searchResultText}>{item.label}</Text>
                    <Feather name="arrow-up-right" size={14} color="#64748b" />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.topbarActions}>
          <View style={styles.actionAnchor}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              onPress={() => {
                setNotificationsOpen((value) => !value);
                setProfileOpen(false);
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
                    router.push({
                      pathname: "/(tabs)/more",
                      params: { section: "notifications" },
                    } as never);
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

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open settings"
            onPress={() => navigateTo(NAVIGATION[NAVIGATION.length - 1])}
            style={({ pressed }) => [
              styles.iconButton,
              compactActions && styles.compactOnly,
              { opacity: pressed ? 0.72 : 1 },
            ]}
          >
            <Feather name="settings" size={18} color="#c7d2e6" />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a bill"
            onPress={() => navigateTo(NAVIGATION[1])}
            style={({ pressed }) => [
              styles.addButton,
              {
                opacity: pressed ? 0.78 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              },
            ]}
          >
            <Feather name="plus" size={18} color="#ffffff" />
            {!compactActions ? (
              <Text style={styles.addButtonText}>Add</Text>
            ) : null}
          </Pressable>

          <View style={styles.actionAnchor}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open profile menu"
              onPress={() => {
                setProfileOpen((value) => !value);
                setNotificationsOpen(false);
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
                  onPress={() => navigateTo(NAVIGATION[NAVIGATION.length - 1])}
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
                style={({ pressed }) => [styles.floCard, { opacity: pressed ? 0.72 : 1 }]}
              >
                <View style={styles.floOrb}>
                  <Feather name="message-circle" size={16} color="#d8b4fe" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.floTitle}>Ask Flo</Text>
                  <Text style={styles.floSub}>Your decision co-pilot</Text>
                </View>
                <Feather name="arrow-up-right" size={14} color="#8b9ab3" />
              </Pressable>
            ) : null}
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

        <View style={styles.main}>{children}</View>
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
    height: 76,
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
  logo: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.26)",
  },
  brandCopy: { minWidth: 150 },
  brandName: {
    color: "#f8fafc",
    fontSize: 16,
    lineHeight: 21,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.45,
  },
  brandAlgo: { color: "#bca7ff", fontFamily: "Inter_700Bold" },
  topbarCenter: {
    flex: 1,
    minWidth: 230,
    paddingHorizontal: 24,
    alignItems: "center",
    zIndex: 50,
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
  topbarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingRight: 18,
    zIndex: 60,
  },
  actionAnchor: { position: "relative" },
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
  sidebarNav: { flex: 1 },
  sidebarScroll: { paddingHorizontal: 12, paddingTop: 18, paddingBottom: 12 },
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
  floCard: {
    minHeight: 64,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.20)",
    backgroundColor: "rgba(91,33,182,0.10)",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    padding: 10,
    marginBottom: 9,
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
  main: { flex: 1, minWidth: 0, overflow: "hidden" },
});
