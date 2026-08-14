import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { BiometricLockSettings } from "@/components/BiometricLockSettings";
import { HouseholdSwitcher } from "@/components/HouseholdSwitcher";
import { AdminMembershipTools } from "@/components/AdminMembershipTools";
import { AdminMoneyHealth } from "@/components/AdminMoneyHealth";
import { LegalDocumentModal } from "@/components/LegalDocumentModal";
import { NotificationSettings } from "@/components/NotificationSettings";
import { PlaidLinkButton } from "@/components/PlaidLinkButton";
import {
  CardHeader,
  DesktopCard,
  DesktopPage,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  desktopPalette as palette,
} from "@/components/desktop/DesktopUI";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { useMembership } from "@/context/MembershipContext";
import {
  type AppFontStyle,
  type ThemeMode,
  useThemeMode,
} from "@/context/ThemeContext";
import { supabase } from "@/lib/supabase";
import { flowLedgerUserGuideTarget } from "@/lib/userGuide";
import * as Haptics from "@/lib/haptics";

export type DesktopSettingsSection =
  | "Profile"
  | "Account"
  | "Preferences"
  | "Notifications"
  | "Security"
  | "Data & Privacy"
  | "Connections"
  | "Subscription"
  | "About"
  | "Admin";
type FeatherName = React.ComponentProps<typeof Feather>["name"];

const SECTIONS: Array<{
  label: DesktopSettingsSection;
  description: string;
  icon: FeatherName;
}> = [
  { label: "Profile", description: "Your personal information", icon: "user" },
  {
    label: "Account",
    description: "Account details and email",
    icon: "user-check",
  },
  {
    label: "Preferences",
    description: "App display preferences",
    icon: "sliders",
  },
  {
    label: "Notifications",
    description: "Manage notification settings",
    icon: "bell",
  },
  { label: "Security", description: "Device authentication", icon: "shield" },
  {
    label: "Data & Privacy",
    description: "Data, export, and privacy",
    icon: "lock",
  },
  { label: "Connections", description: "Connected accounts", icon: "link" },
  {
    label: "Subscription",
    description: "Plan information",
    icon: "credit-card",
  },
  { label: "About", description: "About FlowLedger Algo", icon: "info" },
  { label: "Admin", description: "Authorized administration", icon: "shield" },
];

const desktopColors = {
  background: palette.canvas,
  card: palette.surface,
  foreground: palette.text,
  mutedForeground: palette.muted,
  muted: palette.surfaceMuted,
  border: palette.border,
  primary: palette.purple,
  primaryForeground: "#ffffff",
  success: palette.green,
  destructive: palette.red,
  warning: palette.amber,
};

function nameFor(user: ReturnType<typeof useAuth>["user"]) {
  const candidate =
    user?.user_metadata?.full_name ??
    user?.user_metadata?.name ??
    user?.user_metadata?.display_name;
  return typeof candidate === "string" ? candidate : "";
}

function initialsFor(name: string, email?: string) {
  const source = name.trim() || email?.split("@")[0] || "FL";
  return (
    source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "FL"
  );
}

export function DesktopSettingsPage({
  initialSection = "Profile",
  onExport,
  onSync,
  isAdmin = false,
  onOpenAdmin,
}: {
  initialSection?: DesktopSettingsSection;
  onExport: () => void;
  onSync: () => Promise<void>;
  isAdmin?: boolean;
  onOpenAdmin?: () => void;
}) {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { accounts, connectedBankAccounts, activeHousehold } = useBudget();
  const { actualPlan, loading: membershipLoading } = useMembership();
  const { themeMode, setThemeMode, fontStyle, setFontStyle } = useThemeMode();
  const {
    enabled: hapticsEnabled,
    ready: hapticsReady,
    setEnabled: setHapticsEnabled,
  } = Haptics.useHapticsPreference();
  const [section, setSection] = useState<DesktopSettingsSection>("Profile");
  const [fullName, setFullName] = useState(() => nameFor(user));
  const [savingName, setSavingName] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [legalDoc, setLegalDoc] = useState<"terms" | "privacy" | null>(null);
  const [syncing, setSyncing] = useState(false);
  const timezone = useMemo(
    () =>
      Intl.DateTimeFormat().resolvedOptions().timeZone || "Device time zone",
    [],
  );

  useEffect(() => setSection(initialSection), [initialSection]);

  const saveProfile = async () => {
    if (!fullName.trim() || savingName) return;
    setSavingName(true);
    setMessage(null);
    const { error } = await supabase.auth.updateUser({
      data: { ...user?.user_metadata, full_name: fullName.trim() },
    });
    setSavingName(false);
    setMessage(error ? error.message : "Profile saved.");
  };

  const syncConnections = async () => {
    if (syncing) return;
    setSyncing(true);
    setMessage(null);
    try {
      await onSync();
      setMessage("Connected accounts synced.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not sync connected accounts.",
      );
    } finally {
      setSyncing(false);
    }
  };

  const openUserGuide = () => {
    const target = flowLedgerUserGuideTarget("website");
    void Linking.openURL(target.href).catch(() => {
      setMessage(
        "The FlowLedger User Guide could not be opened. Please try again.",
      );
    });
  };

  return (
    <DesktopPage>
      <ScrollView
        style={styles.pageScroll}
        contentContainerStyle={styles.pageContent}
        showsVerticalScrollIndicator
      >
        <PageHeader
          title="Settings"
          description="Manage your account, preferences, and security."
        />
        <View style={styles.settingsLayout}>
          <DesktopCard style={styles.secondaryNav}>
            {SECTIONS.filter((item) => item.label !== "Admin" || isAdmin).map(
              (item) => (
                <Pressable
                  key={item.label}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: section === item.label }}
                  onPress={() => {
                    setSection(item.label);
                    setMessage(null);
                  }}
                  style={({ pressed }) => [
                    styles.navRow,
                    section === item.label && styles.navRowActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather
                    name={item.icon}
                    size={16}
                    color={
                      section === item.label ? palette.purple : palette.muted
                    }
                  />
                  <View style={styles.navCopy}>
                    <Text
                      style={[
                        styles.navTitle,
                        section === item.label && styles.navTitleActive,
                      ]}
                    >
                      {item.label}
                    </Text>
                    <Text style={styles.navDescription}>
                      {item.description}
                    </Text>
                  </View>
                </Pressable>
              ),
            )}
          </DesktopCard>

          <View style={styles.settingsMain}>
            {message ? (
              <View accessibilityRole="alert" style={styles.message}>
                <Feather name="info" size={14} color={palette.purple} />
                <Text style={styles.messageText}>{message}</Text>
              </View>
            ) : null}
            {section === "Profile" ? (
              <>
                <DesktopCard>
                  <CardHeader title="Profile Information" />
                  <View style={styles.profileBody}>
                    <View style={styles.avatarColumn}>
                      <View style={styles.largeAvatar}>
                        <Text style={styles.largeAvatarText}>
                          {initialsFor(fullName, user?.email)}
                        </Text>
                      </View>
                      <Text style={styles.avatarHint}>
                        Your FlowLedger profile
                      </Text>
                    </View>
                    <View style={styles.profileFields}>
                      <View style={styles.fieldRow}>
                        <Field
                          label="Full Name"
                          value={fullName}
                          onChangeText={setFullName}
                        />
                        <Field
                          label="Email Address"
                          value={user?.email ?? ""}
                          editable={false}
                        />
                      </View>
                      <View style={styles.fieldRow}>
                        <Field
                          label="Time Zone"
                          value={timezone}
                          editable={false}
                        />
                        <Field
                          label="Household"
                          value={activeHousehold?.name ?? "Personal household"}
                          editable={false}
                        />
                      </View>
                      <View style={styles.saveRow}>
                        <PrimaryButton
                          label={savingName ? "Saving..." : "Save Changes"}
                          icon="save"
                          onPress={() => void saveProfile()}
                          disabled={savingName || !fullName.trim()}
                        />
                      </View>
                    </View>
                  </View>
                </DesktopCard>
                <View style={styles.previewGrid}>
                  <SettingsPreview
                    title="Preferences"
                    rows={[`Theme: ${themeMode}`, `Text style: ${fontStyle}`]}
                    action="Manage preferences"
                    onPress={() => setSection("Preferences")}
                  />
                  <SettingsPreview
                    title="Notifications"
                    rows={[
                      "Real device alerts",
                      "Choices sync to your account",
                    ]}
                    action="Manage notifications"
                    onPress={() => setSection("Notifications")}
                  />
                  <SettingsPreview
                    title="Security"
                    rows={["Biometric app lock", "Device-specific protection"]}
                    action="Manage security"
                    onPress={() => setSection("Security")}
                  />
                  <SettingsPreview
                    title="Data & Privacy"
                    rows={[
                      "Export your FlowLedger data",
                      "Review privacy terms",
                    ]}
                    action="Manage data"
                    onPress={() => setSection("Data & Privacy")}
                  />
                  <SettingsPreview
                    title="Subscription"
                    rows={[
                      membershipLoading
                        ? "Loading plan..."
                        : `${actualPlan.tier === "pro" ? "Pro" : "Free"} Plan`,
                      actualPlan.source === "default"
                        ? "No paid billing record"
                        : `Source: ${actualPlan.source}`,
                    ]}
                    action="View plan"
                    onPress={() => setSection("Subscription")}
                  />
                </View>
              </>
            ) : null}

            {section === "Account" ? (
              <DesktopCard>
                <CardHeader title="Account" />
                <View style={styles.sectionBody}>
                  <SettingsLine
                    icon="mail"
                    title="Email address"
                    description={user?.email ?? "No email available"}
                  />
                  <SettingsLine
                    icon="users"
                    title="Household"
                    description={activeHousehold?.name ?? "Personal household"}
                    action={<HouseholdSwitcher appearance="settings" />}
                  />
                  <SettingsLine
                    icon="log-out"
                    title="Sign out"
                    description="End your FlowLedger session on this device"
                    action={
                      <SecondaryButton
                        label="Sign Out"
                        icon="log-out"
                        onPress={() => void signOut()}
                      />
                    }
                  />
                </View>
              </DesktopCard>
            ) : null}

            {section === "Preferences" ? (
              <DesktopCard>
                <CardHeader title="Preferences" />
                <View style={styles.sectionBody}>
                  <OptionGroup
                    label="Theme"
                    value={themeMode}
                    values={[
                      { label: "Light", value: "light" },
                      { label: "Dark", value: "dark" },
                      { label: "Auto", value: "auto" },
                    ]}
                    onChange={(value) => void setThemeMode(value as ThemeMode)}
                  />
                  <OptionGroup
                    label="Text style"
                    value={fontStyle}
                    values={[
                      { label: "Flow", value: "default" },
                      { label: "Classic", value: "elegant" },
                      { label: "Strong", value: "bold" },
                      { label: "Friendly", value: "playful" },
                      { label: "Comfort", value: "soft" },
                    ]}
                    onChange={(value) =>
                      void setFontStyle(value as AppFontStyle)
                    }
                  />
                  <SettingsLine
                    icon="smartphone"
                    title="Haptic feedback"
                    description="Gentle feedback for navigation, saves, and confirmations on this device."
                    action={
                      <SecondaryButton
                        label={hapticsReady ? (hapticsEnabled ? "On" : "Off") : "Loading..."}
                        icon={hapticsEnabled ? "toggle-right" : "toggle-left"}
                        onPress={() => {
                          if (hapticsReady) void setHapticsEnabled(!hapticsEnabled);
                        }}
                      />
                    }
                  />
                  <Text style={styles.supportNote}>
                    Currency, date format, and week start are not stored
                    settings yet, so they are not shown as inactive controls.
                  </Text>
                </View>
              </DesktopCard>
            ) : null}

            {section === "Notifications" ? (
              <NotificationSettings appearance="desktop" />
            ) : null}
            {section === "Security" ? (
              <>
                <BiometricLockSettings appearance="desktop" />
                <DesktopCard>
                  <View style={styles.sectionBody}>
                    <Text style={styles.supportNote}>
                      Two-factor authentication and active-session management
                      are not exposed by the current app, so no non-working
                      controls are shown.
                    </Text>
                  </View>
                </DesktopCard>
              </>
            ) : null}

            {section === "Data & Privacy" ? (
              <DesktopCard>
                <CardHeader title="Data & Privacy" />
                <View style={styles.sectionBody}>
                  <SettingsLine
                    icon="download"
                    title="Export your data"
                    description="Download accounts, income, bills, activity, overrides, and goals as CSV"
                    action={
                      <SecondaryButton
                        label="Export"
                        icon="download"
                        onPress={onExport}
                      />
                    }
                  />
                  <SettingsLine
                    icon="shield"
                    title="Privacy Policy"
                    description="Read how FlowLedger handles your financial data"
                    action={
                      <SecondaryButton
                        label="Open"
                        icon="arrow-up-right"
                        onPress={() => setLegalDoc("privacy")}
                      />
                    }
                  />
                  <SettingsLine
                    icon="file-text"
                    title="Terms of Service"
                    description="Review FlowLedger terms and financial disclaimers"
                    action={
                      <SecondaryButton
                        label="Open"
                        icon="arrow-up-right"
                        onPress={() => setLegalDoc("terms")}
                      />
                    }
                  />
                </View>
              </DesktopCard>
            ) : null}

            {section === "Connections" ? (
              <>
                <DesktopCard>
                  <CardHeader title="Bank Connections" />
                  <View style={styles.connectionActions}>
                    <PlaidLinkButton
                      colors={desktopColors as never}
                      onConnected={onSync}
                    />
                    <SecondaryButton
                      label={syncing ? "Syncing..." : "Sync Accounts"}
                      icon="refresh-cw"
                      onPress={() => void syncConnections()}
                    />
                  </View>
                </DesktopCard>
                <DesktopCard>
                  <CardHeader
                    title={`Connected Accounts (${connectedBankAccounts.length})`}
                  />
                  <View style={styles.sectionBody}>
                    {connectedBankAccounts.length ? (
                      connectedBankAccounts.map((account) => (
                        <SettingsLine
                          key={account.id}
                          icon="credit-card"
                          title={account.name}
                          description={`${account.account_subtype ?? account.account_type ?? "Account"}${account.mask ? ` •••• ${account.mask}` : ""}`}
                          action={
                            <StatusBadge
                              label={
                                account.is_active ? "Connected" : "Inactive"
                              }
                              tone={account.is_active ? "green" : "gray"}
                            />
                          }
                        />
                      ))
                    ) : (
                      <Text style={styles.supportNote}>
                        No bank accounts are connected.
                      </Text>
                    )}
                  </View>
                </DesktopCard>
                {accounts.length ? (
                  <DesktopCard>
                    <CardHeader
                      title={`Manual Accounts (${accounts.length})`}
                    />
                    <View style={styles.sectionBody}>
                      {accounts.map((account) => (
                        <SettingsLine
                          key={account.id}
                          icon="briefcase"
                          title={account.name}
                          description={account.account_type}
                          action={
                            <StatusBadge
                              label={account.is_active ? "Active" : "Inactive"}
                              tone={account.is_active ? "blue" : "gray"}
                            />
                          }
                        />
                      ))}
                    </View>
                  </DesktopCard>
                ) : null}
              </>
            ) : null}

            {section === "Subscription" ? (
              <DesktopCard>
                <CardHeader title="Subscription" />
                <View style={styles.planBody}>
                  <View style={styles.planIcon}>
                    <Feather name="award" size={24} color={palette.purple} />
                  </View>
                  <View style={styles.planCopy}>
                    <Text style={styles.planName}>
                      {membershipLoading
                        ? "Loading your plan..."
                        : `${actualPlan.tier === "pro" ? "Pro" : "Free"} Plan`}
                    </Text>
                    <Text style={styles.planDescription}>
                      {actualPlan.tier === "pro"
                        ? "Your household has FlowLedger Pro access."
                        : "Your household is using FlowLedger's free plan."}
                    </Text>
                    <Text style={styles.supportNote}>
                      {actualPlan.source === "billing"
                        ? "Plan status is connected to billing."
                        : actualPlan.source === "grandfathered"
                          ? "Grandfathered plan access."
                          : actualPlan.source === "admin"
                            ? "Admin-provided plan access."
                            : "Paid upgrades are coming soon. No billing date or payment status is recorded."}
                    </Text>
                  </View>
                </View>
              </DesktopCard>
            ) : null}

            {section === "About" ? (
              <DesktopCard>
                <CardHeader title="About FlowLedger Algo" />
                <View style={styles.sectionBody}>
                  <SettingsLine
                    icon="activity"
                    title="FlowLedger Algo"
                    description="A financial planning workspace built around your real cash flow."
                  />
                  <SettingsLine
                    icon="book-open"
                    title="FlowLedger User Guide"
                    description="Everyday steps with pictures for Dashboard, Activity, Forecast, debt planning, savings, and Flo"
                    action={
                      <SecondaryButton
                        label="Open Guide"
                        icon="external-link"
                        onPress={openUserGuide}
                      />
                    }
                  />
                  <SettingsLine
                    icon="shield"
                    title="Privacy Policy"
                    description="How your information is handled"
                    action={
                      <SecondaryButton
                        label="Read"
                        onPress={() => setLegalDoc("privacy")}
                      />
                    }
                  />
                  <SettingsLine
                    icon="file-text"
                    title="Terms of Service"
                    description="Terms and financial disclaimers"
                    action={
                      <SecondaryButton
                        label="Read"
                        onPress={() => setLegalDoc("terms")}
                      />
                    }
                  />
                </View>
              </DesktopCard>
            ) : null}

            {section === "Admin" && isAdmin ? (
              <>
                <DesktopCard>
                  <CardHeader title="Access & Testers" />
                  <AdminMembershipTools appearance="settings" />
                </DesktopCard>
                <View style={styles.previewGrid}>
                  <DesktopCard style={styles.previewCard}>
                    <CardHeader title="Test Labs" />
                    <View style={styles.sectionBody}>
                      <SettingsLine
                        icon="shield"
                        title="Zero Budget Lab"
                        description="Test Zero Budget with isolated sample money."
                        action={
                          <SecondaryButton
                            label="Open Lab"
                            icon="arrow-up-right"
                            onPress={() =>
                              router.push("/(tabs)/zero-budget-lab" as never)
                            }
                          />
                        }
                      />
                    </View>
                  </DesktopCard>
                  {onOpenAdmin ? (
                    <DesktopCard style={styles.previewCard}>
                      <CardHeader title="Feedback Inbox" />
                      <View style={styles.sectionBody}>
                        <SettingsLine
                          icon="message-square"
                          title="App admin inbox"
                          description="Review, respond to, and archive tester feedback."
                          action={
                            <SecondaryButton
                              label="Open Inbox"
                              icon="arrow-right"
                              onPress={onOpenAdmin}
                            />
                          }
                        />
                      </View>
                    </DesktopCard>
                  ) : null}
                </View>
                <DesktopCard>
                  <CardHeader title="System Integrity" />
                  <AdminMoneyHealth
                    householdId={activeHousehold?.householdId}
                    appearance="settings"
                  />
                </DesktopCard>
                <DesktopCard>
                  <CardHeader title="Admin Notifications" />
                  <NotificationSettings scope="admin" appearance="settings" />
                </DesktopCard>
              </>
            ) : null}
          </View>
        </View>
      </ScrollView>
      <LegalDocumentModal
        documentId={legalDoc}
        onClose={() => setLegalDoc(null)}
      />
    </DesktopPage>
  );
}

function Field({
  label,
  value,
  onChangeText,
  editable = true,
}: {
  label: string;
  value: string;
  onChangeText?: (value: string) => void;
  editable?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        style={[styles.input, !editable && styles.inputDisabled]}
      />
    </View>
  );
}

function SettingsPreview({
  title,
  rows,
  action,
  onPress,
}: {
  title: string;
  rows: string[];
  action: string;
  onPress: () => void;
}) {
  return (
    <DesktopCard style={styles.previewCard}>
      <CardHeader title={title} />
      <View style={styles.previewBody}>
        {rows.map((row) => (
          <Text key={row} style={styles.previewLine}>
            {row}
          </Text>
        ))}
        <Pressable
          onPress={onPress}
          style={({ pressed }) => [
            styles.previewLink,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.previewLinkText}>{action}</Text>
          <Feather name="arrow-right" size={13} color={palette.purple} />
        </Pressable>
      </View>
    </DesktopCard>
  );
}

function SettingsLine({
  icon,
  title,
  description,
  action,
}: {
  icon: FeatherName;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.settingsLine}>
      <View style={styles.lineIcon}>
        <Feather name={icon} size={16} color={palette.purple} />
      </View>
      <View style={styles.lineCopy}>
        <Text style={styles.lineTitle}>{title}</Text>
        <Text style={styles.lineDescription}>{description}</Text>
      </View>
      {action}
    </View>
  );
}

function OptionGroup({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.optionGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.optionRow}>
        {values.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === option.value }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.option,
              value === option.value && styles.optionActive,
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.optionText,
                value === option.value && styles.optionTextActive,
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pageScroll: { flex: 1, margin: -22 },
  pageContent: { padding: 22 },
  settingsLayout: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  secondaryNav: { width: 220, padding: 8 },
  navRow: {
    minHeight: 55,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    marginBottom: 2,
  },
  navRowActive: { backgroundColor: palette.purpleSoft },
  navCopy: { flex: 1, minWidth: 0 },
  navTitle: {
    color: palette.textSecondary,
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  navTitleActive: { color: palette.purpleDark, fontFamily: "Inter_700Bold" },
  navDescription: { color: palette.muted, fontSize: 11, marginTop: 2 },
  settingsMain: { flex: 1, minWidth: 0, gap: 12 },
  message: {
    minHeight: 38,
    borderWidth: 1,
    borderColor: palette.purple,
    borderRadius: 8,
    backgroundColor: palette.purpleSoft,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  messageText: {
    flex: 1,
    color: palette.purpleDark,
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  profileBody: { flexDirection: "row", padding: 16, gap: 20 },
  avatarColumn: {
    width: 145,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 1,
    borderRightColor: palette.borderSoft,
  },
  largeAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: palette.purpleSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  largeAvatarText: {
    color: palette.purple,
    fontSize: 26,
    fontFamily: "Inter_700Bold",
  },
  avatarHint: { color: palette.muted, fontSize: 11, marginTop: 8 },
  profileFields: { flex: 1, minWidth: 0 },
  fieldRow: { flexDirection: "row", gap: 12, marginBottom: 11 },
  field: { flex: 1, minWidth: 0 },
  fieldLabel: {
    color: palette.textSecondary,
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 6,
  },
  input: {
    height: 38,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 7,
    backgroundColor: palette.surface,
    paddingHorizontal: 10,
    color: palette.text,
    fontSize: 12,
    outlineStyle: "none",
  } as never,
  inputDisabled: {
    backgroundColor: palette.surfaceMuted,
    color: palette.muted,
  },
  saveRow: { alignItems: "flex-end" },
  previewGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  previewCard: { width: "48.8%" as never, minHeight: 150 },
  previewBody: { padding: 14, flex: 1 },
  previewLine: { color: palette.textSecondary, fontSize: 12, lineHeight: 20 },
  previewLink: {
    marginTop: "auto",
    paddingTop: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
  },
  previewLinkText: {
    color: palette.purple,
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  sectionBody: { paddingHorizontal: 15 },
  settingsLine: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
    paddingVertical: 11,
  },
  lineIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: palette.purpleSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  lineCopy: { flex: 1, minWidth: 0 },
  lineTitle: { color: palette.text, fontSize: 13, fontFamily: "Inter_700Bold" },
  lineDescription: {
    color: palette.muted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  optionGroup: { marginBottom: 20, paddingTop: 15 },
  optionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: {
    minWidth: 86,
    minHeight: 38,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  optionActive: {
    borderColor: palette.purple,
    backgroundColor: palette.purpleSoft,
  },
  optionText: {
    color: palette.textSecondary,
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  optionTextActive: { color: palette.purpleDark, fontFamily: "Inter_700Bold" },
  supportNote: {
    color: palette.muted,
    fontSize: 11,
    lineHeight: 17,
    marginVertical: 12,
  },
  connectionActions: {
    padding: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  planBody: {
    minHeight: 170,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 22,
  },
  planIcon: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: palette.purpleSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  planCopy: { flex: 1, minWidth: 0 },
  planName: {
    color: palette.text,
    fontSize: 21,
    fontFamily: "Inter_800ExtraBold",
  },
  planDescription: { color: palette.textSecondary, fontSize: 13, marginTop: 5 },
  pressed: { opacity: 0.68 },
});
