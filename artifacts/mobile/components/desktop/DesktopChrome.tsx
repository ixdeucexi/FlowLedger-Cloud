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

type FeatherName = React.ComponentProps<typeof Feather>["name"];

type NavigationItem = {
  id: string;
  label: string;
  icon: FeatherName;
  href: string;
  match: (
    pathname: string,
    params: Record<string, string | string[] | undefined>,
  ) => boolean;
};

const NAVIGATION: NavigationItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: "home",
    href: "/(tabs)",
    match: (path) => path === "/" || path === "/index",
  },
  {
    id: "bills",
    label: "Bills",
    icon: "file-text",
    href: "/(tabs)/bills?view=bills",
    match: (path, params) => path === "/bills" && params.view !== "debt",
  },
  {
    id: "income",
    label: "Income",
    icon: "upload",
    href: "/(tabs)/more?section=money",
    match: (path, params) => path === "/more" && params.section === "money",
  },
  {
    id: "debts",
    label: "Debts",
    icon: "credit-card",
    href: "/(tabs)/bills?view=debt",
    match: (path, params) => path === "/bills" && params.view === "debt",
  },
  {
    id: "goals",
    label: "Goals",
    icon: "target",
    href: "/(tabs)/more?section=goals",
    match: (path, params) => path === "/more" && params.section === "goals",
  },
  {
    id: "afford",
    label: "Can I Afford It?",
    icon: "help-circle",
    href: "/(tabs)/flo?prompt=Can%20I%20afford%20it%3F",
    match: (path) => path === "/flo",
  },
  {
    id: "calendar",
    label: "Calendar",
    icon: "calendar",
    href: "/(tabs)/monthly",
    match: (path) => path === "/monthly",
  },
  {
    id: "activity",
    label: "Activity",
    icon: "repeat",
    href: "/(tabs)/transactions",
    match: (path) => path === "/transactions",
  },
  {
    id: "reports",
    label: "Reports",
    icon: "bar-chart-2",
    href: "/(tabs)/more?section=reports",
    match: (path, params) => path === "/more" && params.section === "reports",
  },
  {
    id: "settings",
    label: "Settings",
    icon: "settings",
    href: "/(tabs)/more?section=overview",
    match: (path, params) =>
      path === "/more" &&
      !["money", "goals", "reports"].includes(
        String(params.section ?? "overview"),
      ),
  },
];

function normalizedPath(pathname: string) {
  const path = pathname.replace(/^\/\(tabs\)/, "");
  return path || "/";
}

function displayNameFor(user: ReturnType<typeof useAuth>["user"]) {
  const metadata = user?.user_metadata ?? {};
  const candidate =
    metadata.full_name ?? metadata.name ?? metadata.display_name;
  if (typeof candidate === "string" && candidate.trim())
    return candidate.trim();
  return (
    user?.email?.split("@")[0].replace(/[._-]+/g, " ") || "FlowLedger member"
  );
}

function initialsFor(name: string) {
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
  const pathname = normalizedPath(usePathname());
  const params = useGlobalSearchParams() as Record<
    string,
    string | string[] | undefined
  >;
  const { width } = useWindowDimensions();
  const { user, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(width < 1120);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    if (width < 1080) setCollapsed(true);
  }, [width]);

  const displayName = displayNameFor(user);
  const sidebarWidth = collapsed ? 76 : 252;
  const searchResults = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (
      query
        ? NAVIGATION.filter((item) => item.label.toLowerCase().includes(query))
        : NAVIGATION
    ).slice(0, 6);
  }, [search]);

  const closeMenus = () => {
    setSearchOpen(false);
    setProfileOpen(false);
  };

  const navigate = (href: string) => {
    closeMenus();
    setSearch("");
    router.push(href as never);
  };

  return (
    <View style={styles.root}>
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
          {NAVIGATION.map((item) => {
            const active = item.match(pathname, params);
            return (
              <Pressable
                key={item.id}
                accessibilityRole="link"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: active }}
                onPress={() => navigate(item.href)}
                style={({ pressed }) => [
                  styles.navItem,
                  collapsed && styles.navItemCollapsed,
                  active && styles.navItemActive,
                  pressed && styles.pressed,
                ]}
              >
                <Feather
                  name={item.icon}
                  size={18}
                  color={active ? "#6d3bea" : "#657083"}
                />
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
        </ScrollView>

        <View style={styles.sidebarFooter}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            onPress={() => void signOut()}
            style={({ pressed }) => [
              styles.navItem,
              collapsed && styles.navItemCollapsed,
              pressed && styles.pressed,
            ]}
          >
            <Feather name="log-out" size={18} color="#657083" />
            {!collapsed ? <Text style={styles.navLabel}>Sign Out</Text> : null}
          </Pressable>
        </View>
      </View>

      <View style={styles.workspace}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              collapsed ? "Expand sidebar" : "Collapse sidebar"
            }
            onPress={() => setCollapsed((value) => !value)}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && styles.pressed,
            ]}
          >
            <Feather name="menu" size={20} color="#1e293b" />
          </Pressable>

          <View style={styles.searchAnchor}>
            <View
              style={[styles.searchBox, searchOpen && styles.searchBoxFocused]}
            >
              <Feather name="search" size={16} color="#667085" />
              <TextInput
                accessibilityLabel="Search FlowLedger pages"
                value={search}
                onChangeText={setSearch}
                onFocus={() => {
                  setSearchOpen(true);
                  setProfileOpen(false);
                }}
                onSubmitEditing={() =>
                  searchResults[0] && navigate(searchResults[0].href)
                }
                placeholder="Search anything..."
                placeholderTextColor="#98a2b3"
                style={styles.searchInput}
              />
              <View style={styles.shortcut}>
                <Text style={styles.shortcutText}>⌘K</Text>
              </View>
            </View>
            {searchOpen ? (
              <View style={styles.searchMenu}>
                {searchResults.length ? (
                  searchResults.map((item) => (
                    <Pressable
                      key={item.id}
                      onPress={() => navigate(item.href)}
                      style={({ pressed }) => [
                        styles.searchResult,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Feather name={item.icon} size={16} color="#6d3bea" />
                      <Text style={styles.searchResultText}>{item.label}</Text>
                      <Feather
                        name="arrow-up-right"
                        size={14}
                        color="#98a2b3"
                      />
                    </Pressable>
                  ))
                ) : (
                  <Text style={styles.searchEmpty}>No matching page.</Text>
                )}
              </View>
            ) : null}
          </View>

          <View style={styles.headerSpacer} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Help"
            onPress={() => navigate("/(tabs)/more?section=help")}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && styles.pressed,
            ]}
          >
            <Feather name="help-circle" size={20} color="#344054" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            onPress={() => navigate("/(tabs)/more?section=notifications")}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && styles.pressed,
            ]}
          >
            <Feather name="bell" size={20} color="#344054" />
          </Pressable>
          <View style={styles.profileAnchor}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open account menu"
              accessibilityState={{ expanded: profileOpen }}
              onPress={() => {
                setProfileOpen((value) => !value);
                setSearchOpen(false);
              }}
              style={({ pressed }) => [
                styles.profileButton,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {initialsFor(displayName)}
                </Text>
              </View>
              {width >= 1160 ? (
                <Text style={styles.profileName} numberOfLines={1}>
                  {displayName}
                </Text>
              ) : null}
              <Feather name="chevron-down" size={15} color="#667085" />
            </Pressable>
            {profileOpen ? (
              <View style={styles.profileMenu}>
                <Text style={styles.menuEyebrow}>Signed in as</Text>
                <Text style={styles.menuName}>{displayName}</Text>
                <Text style={styles.menuEmail} numberOfLines={1}>
                  {user?.email}
                </Text>
                <View style={styles.divider} />
                <Pressable
                  onPress={() => navigate("/(tabs)/more?section=overview")}
                  style={({ pressed }) => [
                    styles.menuRow,
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather name="settings" size={16} color="#475467" />
                  <Text style={styles.menuRowText}>Account settings</Text>
                </Pressable>
                <Pressable
                  onPress={() => void signOut()}
                  style={({ pressed }) => [
                    styles.menuRow,
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather name="log-out" size={16} color="#dc2626" />
                  <Text style={[styles.menuRowText, styles.danger]}>
                    Sign out
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.main}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "#f8fafc",
    overflow: "hidden",
  },
  sidebar: {
    backgroundColor: "#ffffff",
    borderRightWidth: 1,
    borderRightColor: "#e5e7eb",
    overflow: "hidden",
  },
  brand: {
    height: 70,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eef0f3",
  },
  brandCollapsed: { justifyContent: "center", paddingHorizontal: 0 },
  logo: { width: 32, height: 32 },
  brandName: {
    color: "#101828",
    fontSize: 17,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.5,
  },
  brandAccent: { color: "#6d3bea" },
  navScroll: { flex: 1 },
  navContent: { padding: 14, gap: 3 },
  navItem: {
    minHeight: 42,
    borderRadius: 8,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  navItemCollapsed: { justifyContent: "center", paddingHorizontal: 0 },
  navItemActive: { backgroundColor: "#f1edff" },
  navLabel: { color: "#475467", fontSize: 13, fontFamily: "Inter_500Medium" },
  navLabelActive: { color: "#5b2fc7", fontFamily: "Inter_700Bold" },
  sidebarFooter: { padding: 14, borderTopWidth: 1, borderTopColor: "#eef0f3" },
  workspace: { flex: 1, minWidth: 0 },
  header: {
    height: 70,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    zIndex: 50,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  searchAnchor: { position: "relative", marginLeft: 14, zIndex: 70 },
  searchBox: {
    width: 300,
    height: 38,
    borderWidth: 1,
    borderColor: "#e4e7ec",
    borderRadius: 8,
    backgroundColor: "#f9fafb",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 11,
    gap: 8,
  },
  searchBoxFocused: { borderColor: "#9b87f5", backgroundColor: "#ffffff" },
  searchInput: {
    flex: 1,
    color: "#101828",
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    outlineStyle: "none",
  } as never,
  shortcut: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 5,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e4e7ec",
  },
  shortcutText: {
    color: "#98a2b3",
    fontSize: 9,
    fontFamily: "Inter_600SemiBold",
  },
  searchMenu: {
    position: "absolute",
    top: 44,
    left: 0,
    width: 300,
    borderWidth: 1,
    borderColor: "#e4e7ec",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    padding: 6,
    shadowColor: "#101828",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  searchResult: {
    minHeight: 42,
    borderRadius: 7,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  searchResultText: {
    flex: 1,
    color: "#344054",
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  searchEmpty: { color: "#667085", fontSize: 12, padding: 12 },
  headerSpacer: { flex: 1 },
  profileAnchor: { position: "relative", zIndex: 80 },
  profileButton: {
    minHeight: 42,
    maxWidth: 210,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 5,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1edff",
  },
  avatarText: {
    color: "#5b2fc7",
    fontSize: 11,
    fontFamily: "Inter_800ExtraBold",
  },
  profileName: {
    maxWidth: 120,
    color: "#101828",
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
  profileMenu: {
    position: "absolute",
    top: 47,
    right: 0,
    width: 240,
    borderWidth: 1,
    borderColor: "#e4e7ec",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    padding: 13,
    shadowColor: "#101828",
    shadowOpacity: 0.13,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  menuEyebrow: {
    color: "#98a2b3",
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  menuName: {
    color: "#101828",
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    marginTop: 5,
  },
  menuEmail: { color: "#667085", fontSize: 11, marginTop: 2 },
  divider: { height: 1, backgroundColor: "#eaecf0", marginVertical: 10 },
  menuRow: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  menuRowText: {
    color: "#475467",
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  danger: { color: "#dc2626" },
  main: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    backgroundColor: "#f8fafc",
  },
  pressed: { opacity: 0.66 },
});
