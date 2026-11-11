import Feather from "@expo/vector-icons/Feather";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
} from "react-native";
import {
  PrivacyPressable as Pressable,
  PrivacyText as Text,
  PrivacyTextInput as TextInput,
  PrivacyView as View,
} from "@/components/privacy/PrivacyPrimitives";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import {
  DESKTOP_MODAL_COMPACT,
  DESKTOP_MODAL_OVERLAY,
} from "@/lib/desktopModal";
import type { ForecastAccountDescriptor } from "@/lib/accountForecasts";

export function AccountNameModal({
  account,
  onClose,
}: {
  account: ForecastAccountDescriptor | null;
  onClose: () => void;
}) {
  const c = useColors();
  const desktop = useDesktopExperience();
  const { user } = useAuth();
  const {
    activeHousehold,
    canEditHousehold,
    accountForecastReady,
    transactionAccountIdentities,
    renameForecastAccount,
  } = useBudget();
  const scope = `${user?.id ?? "demo"}:${activeHousehold?.householdId ?? "personal"}:${activeHousehold?.budgetId ?? "budget"}`;
  const access = useRef({
    scope,
    canEdit: canEditHousehold,
    ready: accountForecastReady,
    ref: account?.ref,
  });
  access.current = {
    scope,
    canEdit: canEditHousehold,
    ready: accountForecastReady,
    ref: account?.ref,
  };
  const savingRef = useRef(false);
  const [name, setName] = useState("");
  const [expectedName, setExpectedName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setName(account?.name ?? "");
    setExpectedName(account?.name ?? "");
    setError(null);
    setSaving(false);
  }, [account?.ref, scope]);
  const visible = Boolean(account);
  useBackDismiss(visible && !saving, onClose);
  const provider =
    account?.source === "bank"
      ? transactionAccountIdentities.find(
          (row) => row.id === account.bankAccountId,
        )
      : undefined;
  const providerName = provider?.name || provider?.official_name;
  const canReset = Boolean(provider?.display_name && providerName);
  const save = async (reset = false) => {
    if (!account || savingRef.current) return;
    if (
      access.current.scope !== scope ||
      access.current.ref !== account.ref ||
      !access.current.canEdit ||
      !access.current.ready ||
      !account.active ||
      account.unavailableReason
    ) {
      setError(
        "Your household or editing access changed. Close this editor and try again.",
      );
      return;
    }
    const normalized = name.trim().replace(/\s+/g, " ");
    if (!reset && (!normalized || normalized.length > 80)) {
      setError(
        !normalized ? "Enter an account name." : "Use 80 characters or fewer.",
      );
      return;
    }
    if (reset && (!canReset || account.source !== "bank")) return;
    const startedScope = scope,
      startedRef = account.ref;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await renameForecastAccount(
        startedRef,
        reset ? null : normalized,
        expectedName,
      );
      if (
        access.current.scope === startedScope &&
        access.current.ref === startedRef
      )
        onClose();
    } catch (caught) {
      if (
        access.current.scope === startedScope &&
        access.current.ref === startedRef
      )
        setError(
          caught instanceof Error
            ? caught.message
            : "The account name could not be saved. Try again.",
        );
    } finally {
      savingRef.current = false;
      if (
        access.current.scope === startedScope &&
        access.current.ref === startedRef
      )
        setSaving(false);
    }
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType={desktop ? "fade" : "slide"}
      onRequestClose={saving ? undefined : onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[styles.overlay, desktop && DESKTOP_MODAL_OVERLAY]}
      >
        <Pressable
          accessibilityLabel="Close account name editor"
          disabled={saving}
          onPress={onClose}
          style={StyleSheet.absoluteFillObject}
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: c.background, borderColor: c.border },
            desktop && DESKTOP_MODAL_COMPACT,
          ]}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ gap: 10 }}
            style={{ flexGrow: 0 }}
          >
            <View style={styles.header}>
              <View style={styles.flex}>
                <Text style={[styles.title, { color: c.foreground }]}>
                  Rename account
                </Text>
                <Text style={[styles.help, { color: c.mutedForeground }]}>
                  Choose a name your household recognizes.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close account name editor"
                disabled={saving}
                onPress={onClose}
                style={styles.close}
              >
                <Feather name="x" size={22} color={c.mutedForeground} />
              </Pressable>
            </View>
            {account?.source === "bank" && providerName ? (
              <View
                style={[
                  styles.provider,
                  { backgroundColor: c.card, borderColor: c.border },
                ]}
              >
                <Text style={[styles.label, { color: c.mutedForeground }]}>
                  Bank name
                </Text>
                <Text style={[styles.providerName, { color: c.foreground }]}>
                  {providerName}
                  {account.mask ? ` · ••${account.mask}` : ""}
                </Text>
              </View>
            ) : null}
            <Text style={[styles.label, { color: c.mutedForeground }]}>
              FlowLedger name
            </Text>
            <TextInput
              accessibilityLabel="Account name"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              selectTextOnFocus
              maxLength={80}
              editable={!saving && canEditHousehold}
              onSubmitEditing={() => void save()}
              returnKeyType="done"
              style={[
                styles.input,
                {
                  color: c.foreground,
                  backgroundColor: c.card,
                  borderColor: error ? c.destructive : c.border,
                },
              ]}
            />
            <Text style={[styles.help, { color: c.mutedForeground }]}>
              {account?.source === "bank"
                ? "This changes the name in FlowLedger, not at your bank."
                : "This updates the shared account name. Its balance and plan stay the same."}
            </Text>
            {error ? (
              <Text
                accessibilityRole="alert"
                style={[styles.error, { color: c.destructive }]}
              >
                {error}
              </Text>
            ) : null}
            {!canEditHousehold ? (
              <Text style={[styles.help, { color: c.mutedForeground }]}>
                A household editor can change this name.
              </Text>
            ) : null}
          </ScrollView>
          <View style={styles.actions}>
            {canReset ? (
              <Pressable
                accessibilityRole="button"
                disabled={saving || !canEditHousehold || !accountForecastReady}
                onPress={() => void save(true)}
                style={[styles.secondary, { borderColor: c.border }]}
              >
                <Text style={[styles.actionText, { color: c.foreground }]}>
                  Use bank name
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={saving || !canEditHousehold || !accountForecastReady}
              onPress={() => void save()}
              style={[
                styles.primary,
                { backgroundColor: c.primary, opacity: saving ? 0.6 : 1 },
              ]}
            >
              {saving ? (
                <ActivityIndicator color={c.primaryForeground} />
              ) : (
                <Text
                  style={[styles.actionText, { color: c.primaryForeground }]}
                >
                  Save name
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,.65)",
  },
  sheet: {
    padding: 22,
    paddingBottom: 32,
    maxHeight: "90%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    gap: 10,
  },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  title: { fontFamily: "Inter_700Bold", fontSize: 22 },
  help: { fontSize: 12, lineHeight: 18 },
  close: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  provider: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginVertical: 6,
    gap: 4,
  },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  providerName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  input: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 13,
    fontSize: 16,
  },
  error: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 12,
  },
  secondary: {
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
  },
  primary: {
    minHeight: 46,
    minWidth: 120,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: { fontSize: 13, fontFamily: "Inter_700Bold" },
});
