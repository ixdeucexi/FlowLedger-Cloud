import Feather from "@expo/vector-icons/Feather";
import React, { useEffect, useState } from "react";
import { Modal, ScrollView, StyleSheet } from "react-native";
import {
  PrivacyPressable as Pressable,
  PrivacyText as Text,
  PrivacyTextInput as TextInput,
  PrivacyView as View,
} from "@/components/privacy/PrivacyPrimitives";
import { useBudget } from "@/context/BudgetContext";
import { useAuth } from "@/context/AuthContext";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import type {
  ForecastAccountDescriptor,
  ForecastAccountRef,
} from "@/lib/accountForecasts";

export interface AccountForecastPickerProps {
  value: ForecastAccountRef | null;
  onChange: (value: ForecastAccountRef | null) => void;
  accounts?: readonly ForecastAccountDescriptor[];
  includeHousehold?: boolean;
  /** Display preference applies only to Forecast, never funding or Activity. */
  visibleOnly?: boolean;
  allowUnassigned?: boolean;
  disabled?: boolean;
  label?: string;
  /** Keep the label inside the trigger for compact Forecast controls. */
  compact?: boolean;
  nullLabel?: string;
}

export function accountForecastLabel(
  account: Pick<ForecastAccountDescriptor, "name" | "mask">,
): string {
  return `${account.name}${account.mask ? ` · ••${account.mask}` : ""}`;
}

/** One picker for viewing an account and explicitly assigning future activity. */
export function AccountForecastPicker({
  value,
  onChange,
  accounts: suppliedAccounts,
  includeHousehold = false,
  visibleOnly = false,
  allowUnassigned = true,
  disabled = false,
  label = "Account",
  compact = false,
  nullLabel,
}: AccountForecastPickerProps) {
  const c = useColors();
  const { user } = useAuth();
  const {
    forecastAccounts,
    accountForecastReady,
    forecastVisibilityReady,
    activeHousehold,
    hiddenForecastAccountRefs = [],
  } = useBudget();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [manualExpanded, setManualExpanded] = useState(false);
  const accounts = suppliedAccounts ?? forecastAccounts;
  const current = accounts.find(
    (account) =>
      account.ref === value ||
      Boolean(value && account.aliases.includes(value)),
  );
  const unavailable = Boolean(
    value && (!current || !current.active || current.unavailableReason),
  );
  const selectedLabel = value
    ? current
      ? accountForecastLabel(current)
      : "Unavailable account"
    : (nullLabel ?? (includeHousehold ? "Household plan" : "Unassigned"));
  const blocked =
    disabled ||
    !accountForecastReady ||
    (visibleOnly && !forecastVisibilityReady);
  useBackDismiss(open, () => setOpen(false));
  useEffect(() => {
    setOpen(false);
    setSearch("");
    setManualExpanded(false);
  }, [user?.id, activeHousehold?.householdId, activeHousehold?.budgetId]);
  const needle = search.trim().toLowerCase();
  const choices = accounts.filter(
    (account) =>
      account.active &&
      !account.unavailableReason &&
      (!visibleOnly || !hiddenForecastAccountRefs.includes(account.ref)) &&
      (!needle ||
        `${account.name} ${account.mask ?? ""} ${account.type}`
          .toLowerCase()
          .includes(needle)),
  );
  const connectedChoices = choices.filter(
    (account) => account.source === "bank",
  );
  const manualChoices = choices.filter(
    (account) => account.source === "manual",
  );
  const showManual =
    !visibleOnly ||
    !connectedChoices.length ||
    manualExpanded ||
    Boolean(needle) ||
    current?.source === "manual";
  const renderChoice = (account: ForecastAccountDescriptor) => (
    <Pressable
      key={account.ref}
      accessibilityRole="button"
      accessibilityLabel={`${accountForecastLabel(account)}, ${account.source === "bank" ? "connected" : "manual"} account`}
      accessibilityState={{ selected: current?.ref === account.ref }}
      onPress={() => {
        onChange(account.ref);
        setOpen(false);
      }}
      style={[
        styles.option,
        {
          backgroundColor:
            current?.ref === account.ref ? c.primary + "14" : "transparent",
          borderColor: c.border,
        },
      ]}
    >
      <Feather
        name={account.type === "savings" ? "heart" : "credit-card"}
        size={19}
        color={c.primary}
      />
      <View style={styles.optionCopy}>
        <Text style={[styles.optionName, { color: c.foreground }]}>
          {accountForecastLabel(account)}
        </Text>
        <Text style={[styles.hint, { color: c.mutedForeground }]}>
          {account.source === "bank" ? "Connected" : "Manual"} ·{" "}
          {account.type === "cash"
            ? "Cash"
            : account.type === "savings"
              ? "Savings"
              : "Checking"}
          {account.currentBalance === null ? " · balance unavailable" : ""}
        </Text>
      </View>
      {current?.ref === account.ref ? (
        <Feather name="check" size={19} color={c.primary} />
      ) : null}
    </Pressable>
  );

  return (
    <View style={styles.field}>
      {!compact ? <Text style={[styles.label, { color: c.mutedForeground }]}>{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selectedLabel}`}
        accessibilityState={{ disabled: blocked, expanded: open }}
        disabled={blocked}
        onPress={() => {
          setSearch("");
          setManualExpanded(false);
          setOpen(true);
        }}
        style={[
          styles.trigger,
          compact && styles.compactTrigger,
          {
            backgroundColor: c.card,
            borderColor: unavailable ? c.warning : c.border,
            opacity: blocked ? 0.55 : 1,
          },
        ]}
      >
        <Feather
          name={
            value
              ? current?.type === "savings"
                ? "heart"
                : "credit-card"
              : includeHousehold
                ? "home"
                : "help-circle"
          }
          size={17}
          color={unavailable ? c.warning : c.primary}
        />
        <View style={styles.triggerCopy}>
          {compact ? <Text style={[styles.compactLabel, { color: c.mutedForeground }]}>{label}</Text> : null}
          <Text
            style={[styles.triggerText, { color: c.foreground }]}
            numberOfLines={1}
          >
            {selectedLabel}
          </Text>
          {unavailable ? (
            <Text style={[styles.hint, { color: c.warning }]}>
              Choose an available account
            </Text>
          ) : null}
        </View>
        <Feather name="chevron-down" size={17} color={c.mutedForeground} />
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.overlay}>
          <Pressable
            accessibilityLabel="Close account choices"
            style={StyleSheet.absoluteFillObject}
            onPress={() => setOpen(false)}
          />
          <View
            style={[
              styles.sheet,
              { backgroundColor: c.background, borderColor: c.border },
            ]}
          >
            <View style={styles.heading}>
              <Text style={[styles.title, { color: c.foreground }]}>
                Choose an account
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close account choices"
                onPress={() => setOpen(false)}
                style={styles.close}
              >
                <Feather name="x" size={22} color={c.mutedForeground} />
              </Pressable>
            </View>
            {accounts.length > 3 ? (
              <TextInput
                accessibilityLabel="Search accounts"
                value={search}
                onChangeText={setSearch}
                placeholder="Search accounts"
                placeholderTextColor={c.mutedForeground}
                style={[
                  styles.search,
                  {
                    color: c.foreground,
                    borderColor: c.border,
                    backgroundColor: c.card,
                  },
                ]}
              />
            ) : null}
            <ScrollView
              style={styles.options}
              keyboardShouldPersistTaps="handled"
            >
              {(includeHousehold || allowUnassigned) && !needle ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: value === null }}
                  onPress={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  style={[
                    styles.option,
                    {
                      backgroundColor:
                        value === null ? c.primary + "14" : "transparent",
                      borderColor: c.border,
                    },
                  ]}
                >
                  <Feather
                    name={includeHousehold ? "home" : "help-circle"}
                    size={19}
                    color={c.primary}
                  />
                  <View style={styles.optionCopy}>
                    <Text style={[styles.optionName, { color: c.foreground }]}>
                      {nullLabel ??
                        (includeHousehold ? "Household plan" : "Unassigned")}
                    </Text>
                    <Text style={[styles.hint, { color: c.mutedForeground }]}>
                      {nullLabel
                        ? "Activity across your household accounts"
                        : includeHousehold
                          ? "Combined checking and cash plan"
                          : "Choose later · shown in Needs account"}
                    </Text>
                  </View>
                  {value === null ? (
                    <Feather name="check" size={19} color={c.primary} />
                  ) : null}
                </Pressable>
              ) : null}
              {connectedChoices.length ? (
                <View>
                  <Text
                    style={[styles.groupLabel, { color: c.mutedForeground }]}
                  >
                    Connected accounts ({connectedChoices.length})
                  </Text>
                  {connectedChoices.map(renderChoice)}
                </View>
              ) : null}
              {manualChoices.length ? (
                <View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Manual accounts (${manualChoices.length})`}
                    accessibilityState={{ expanded: showManual }}
                    aria-expanded={showManual}
                    onPress={() => setManualExpanded((value) => !value)}
                    disabled={
                      !visibleOnly ||
                      current?.source === "manual" ||
                      Boolean(needle) ||
                      !connectedChoices.length
                    }
                    style={styles.groupHeading}
                  >
                    <View style={styles.optionCopy}>
                      <Text
                        style={[
                          styles.groupLabel,
                          { color: c.mutedForeground },
                        ]}
                      >
                        Manual accounts ({manualChoices.length})
                      </Text>
                      {!showManual ? (
                        <Text
                          style={[styles.hint, { color: c.mutedForeground }]}
                        >
                          Added in FlowLedger · not bank connections
                        </Text>
                      ) : null}
                    </View>
                    {visibleOnly && connectedChoices.length ? (
                      <Feather
                        name={showManual ? "chevron-up" : "chevron-down"}
                        size={18}
                        color={c.mutedForeground}
                      />
                    ) : null}
                  </Pressable>
                  {showManual ? manualChoices.map(renderChoice) : null}
                </View>
              ) : null}
              {choices.length === 0 ? (
                <Text style={[styles.empty, { color: c.mutedForeground }]}>
                  {needle
                    ? "No matching accounts."
                    : "No available accounts in this household."}
                </Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  groupLabel: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "Inter_700Bold",
    paddingVertical: 8,
  },
  groupHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
  },
  field: { minWidth: 0, gap: 7 },
  label: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  trigger: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  triggerCopy: { flex: 1, minWidth: 0 },
  compactTrigger: { minHeight: 60 },
  compactLabel: { fontSize: 10, lineHeight: 14, fontFamily: "Inter_500Medium", marginBottom: 2 },
  triggerText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  hint: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: 18,
  },
  sheet: {
    width: "100%",
    maxWidth: 460,
    maxHeight: "80%",
    borderWidth: 1,
    borderRadius: 24,
    padding: 18,
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  title: { flex: 1, fontSize: 20, fontFamily: "Inter_700Bold" },
  close: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  search: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 44,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  options: { flexGrow: 0 },
  option: {
    minHeight: 66,
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
    borderRadius: 10,
  },
  optionCopy: { flex: 1, minWidth: 0, gap: 3 },
  optionName: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  empty: { paddingVertical: 20, textAlign: "center" },
});
