import Feather from "@expo/vector-icons/Feather";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet } from "react-native";
import { PrivacyPressable as Pressable, PrivacyText as Text, PrivacyTextInput as TextInput, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DatePickerField } from "@/components/DatePickerField";
import { FloLogo } from "@/components/FloLogo";
import { useColors } from "@/hooks/useColors";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import {
  DESKTOP_MODAL_OVERLAY,
  DESKTOP_MODAL_REGULAR,
} from "@/lib/desktopModal";
import { createSimulatorEditorHistory as createFormHistory } from "@/lib/simulatorEditorHistory";
import {
  floFormAccounts,
  floFormInitialDraft,
  FLO_FORM_FIELDS,
  FLO_FORM_TITLES,
  validateFloForm,
  type FloFormAccount,
  type FloFormDraft,
} from "@/lib/floCreationForm";
import type {
  FloCreationFormInput,
  FloCreationResult,
} from "@/lib/floCreationProtocol";

type Props = {
  creation: FloCreationResult;
  visible: boolean;
  suspended?: boolean;
  busy?: boolean;
  error?: string | null;
  accounts: readonly FloFormAccount[];
  initialDraft?: FloFormDraft;
  onDraftChange?: (draft: FloFormDraft) => void;
  onClose: () => void;
  onBackFromSafety: () => void;
  onSave: (input: FloCreationFormInput) => Promise<void>;
};

export function FloCreationForm({
  creation,
  visible,
  suspended = false,
  busy = false,
  error,
  accounts,
  initialDraft,
  onDraftChange,
  onClose,
  onBackFromSafety,
  onSave,
}: Props) {
  const c = useColors(),
    desktop = useDesktopExperience(),
    insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<FloFormDraft>(() =>
    initialDraft ?? floFormInitialDraft(creation),
  );
  const { values, errors, errorSummary, saveError, typedDates, accountSearch } = draft;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // Publish in the interaction itself: hiding before an effect runs must retain
  // the latest edit even though Privacy Mode removes this form from the tree.
  const updateDraft = (changes: Partial<FloFormDraft>) => {
    const next = { ...draftRef.current, ...changes };
    draftRef.current = next;
    setDraft(next);
    onDraftChange?.(next);
  };
  const [saving, setSaving] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const savingRef = useRef(false),
    mountedRef = useRef(true);
  const inputsRef = useRef<Record<string, TextInput | null>>({});
  const scrollRef = useRef<ScrollView>(null);
  const fieldYRef = useRef<Record<string, number>>({});
  const handlersRef = useRef({ onClose, onBackFromSafety, suspended, busy });
  handlersRef.current = { onClose, onBackFromSafety, suspended, busy };
  const kind = creation.kind;
  const eligibleAccounts = useMemo(() => floFormAccounts(accounts), [accounts]);
  const shownAccounts = useMemo(
    () =>
      eligibleAccounts.filter((account) =>
        `${account.name} ${account.account_type}`
          .toLowerCase()
          .includes(accountSearch.trim().toLowerCase()),
      ),
    [eligibleAccounts, accountSearch],
  );
  const disabled = busy || saving;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (!visible || Platform.OS !== "web" || typeof window === "undefined")
      return;
    const editor = createFormHistory(window, () => {
      if (handlersRef.current.suspended) {
        handlersRef.current.onBackFromSafety();
        return;
      }
      if (handlersRef.current.busy || savingRef.current) {
        setHistoryRevision((value) => value + 1);
        return;
      }
      handlersRef.current.onClose();
    });
    return () => editor.dispose();
  }, [visible, suspended, historyRevision]);
  useEffect(() => {
    if (
      !visible ||
      suspended ||
      !kind ||
      Platform.OS !== "web" ||
      typeof window === "undefined"
    )
      return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!handlersRef.current.busy && !savingRef.current)
        handlersRef.current.onClose();
    };
    window.addEventListener("keydown", onKey, true);
    const frame = requestAnimationFrame(() => {
      const first =
        FLO_FORM_FIELDS[kind].find(
          (field) =>
            creation.missingFields.includes(field.key) &&
            inputsRef.current[field.key],
        ) ??
        FLO_FORM_FIELDS[kind].find((field) => inputsRef.current[field.key]);
      if (first) inputsRef.current[first.key]?.focus();
    });
    return () => {
      window.removeEventListener("keydown", onKey, true);
      cancelAnimationFrame(frame);
    };
  }, [visible, suspended, kind, creation.missingFields]);

  if (!kind) return null;
  const title = FLO_FORM_TITLES[kind];
  const update = (key: string, value: string | boolean) => {
    if (disabled || savingRef.current) return;
    const nextErrors = { ...draftRef.current.errors };
    delete nextErrors[key];
    updateDraft({
      values: { ...draftRef.current.values, [key]: value },
      errors: nextErrors,
      saveError: null,
      errorSummary: null,
    });
  };
  const requestClose = () => {
    if (!disabled && !savingRef.current) onClose();
  };
  const save = async () => {
    if (disabled || savingRef.current) return;
    const checked = validateFloForm(kind, values, accounts);
    updateDraft({ errors: checked.errors, saveError: null, errorSummary: null });
    const firstError = Object.keys(checked.errors)[0];
    if (firstError) {
      const field = FLO_FORM_FIELDS[kind].find(
        (item) => item.key === firstError,
      );
      updateDraft({ errorSummary: `${field?.label ?? "Details"}: ${checked.errors[firstError]}` });
      scrollRef.current?.scrollTo({
        y: Math.max(0, (fieldYRef.current[firstError] ?? 0) - 12),
        animated: true,
      });
      if (
        FLO_FORM_FIELDS[kind].some(
          (field) => field.key === firstError && field.type === "date",
        )
      )
        updateDraft({ typedDates: { ...draftRef.current.typedDates, [firstError]: true } });
      requestAnimationFrame(() => inputsRef.current[firstError]?.focus());
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await onSave(checked.input);
    } catch (cause) {
      if (mountedRef.current)
        updateDraft({ saveError: cause instanceof Error
            ? cause.message
            : "Could not save. Please try again." });
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };
  const choices = (
    key: string,
    options: { value: string; label: string }[],
  ) => (
    <View style={styles.choices}>
      {options.map((option) => {
        const selected =
          key === "frequency" && values.is_recurring === false
            ? option.value === "once"
            : values[key] === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            {...(Platform.OS === "web" ? { "aria-checked": selected } : {})}
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            onPress={() => {
              if (key === "frequency") {
                update("is_recurring", option.value !== "once");
                update(
                  "frequency",
                  option.value === "once" ? "monthly" : option.value,
                );
                if (option.value !== "monthly")
                  update("monthly_last_day", false);
              } else update(key, option.value);
            }}
            style={[
              styles.choice,
              {
                borderColor: selected ? c.primary : c.border,
                backgroundColor: selected ? c.primary + "18" : c.card,
                opacity: disabled ? 0.55 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.choiceText,
                { color: selected ? c.primary : c.foreground },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <Modal
      visible={visible && !suspended}
      transparent
      animationType={desktop ? "fade" : "slide"}
      onRequestClose={requestClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboard}
      >
        <Pressable
          style={[
            styles.overlay,
            desktop && DESKTOP_MODAL_OVERLAY,
            !desktop && { paddingTop: Math.max(20, insets.top) },
          ]}
          onPress={requestClose}
        >
          <Pressable
            accessibilityViewIsModal
            accessibilityLabel={`Add ${title} details`}
            style={[
              styles.sheet,
              desktop && DESKTOP_MODAL_REGULAR,
              { backgroundColor: c.background, borderColor: c.border },
            ]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={[styles.header, { borderColor: c.border }]}>
              <FloLogo size={34} />
              <View style={styles.heading}>
                <Text
                  accessibilityRole="header"
                  style={[styles.title, { color: c.foreground }]}
                >
                  Add {title}
                </Text>
                <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
                  Fill in the details below.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close creation form"
                disabled={disabled}
                onPress={requestClose}
                style={styles.close}
              >
                <Feather name="x" size={22} color={c.mutedForeground} />
              </Pressable>
            </View>
            <ScrollView
              ref={scrollRef}
              style={styles.scroll}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.content}
            >
              {FLO_FORM_FIELDS[kind].map((field) => (
                <View
                  key={field.key}
                  onLayout={(event) => {
                    fieldYRef.current[field.key] = event.nativeEvent.layout.y;
                  }}
                  style={styles.field}
                >
                  <Text
                    nativeID={`flo-form-label-${field.key}`}
                    style={[styles.label, { color: c.foreground }]}
                  >
                    {field.key === "first_date" &&
                    kind === "create_bill" &&
                    values.is_recurring === false
                      ? "Payment date"
                      : field.label}
                    {field.optional ? " (optional)" : " *"}
                  </Text>
                  {field.type === "frequency" ? (
                    choices(field.key, [
                      ...(kind === "create_bill"
                        ? [{ value: "once", label: "One time" }]
                        : []),
                      { value: "monthly", label: "Monthly" },
                      { value: "weekly", label: "Weekly" },
                      { value: "biweekly", label: "Every 2 weeks" },
                      ...(kind === "create_income"
                        ? []
                        : [{ value: "quarterly", label: "Quarterly" }]),
                    ])
                  ) : field.type === "direction" ? (
                    choices(field.key, [
                      { value: "expense", label: "Money out" },
                      { value: "inflow", label: "Money in" },
                    ])
                  ) : field.type === "date" ? (
                    <View style={styles.dateSection}>
                      {typedDates[field.key] ? (
                        <TextInput
                          ref={(input) => {
                            inputsRef.current[field.key] = input;
                          }}
                          accessibilityLabel={field.label}
                          editable={!disabled}
                          value={
                            typeof values[field.key] === "string"
                              ? String(values[field.key])
                              : ""
                          }
                          onChangeText={(value) => update(field.key, value)}
                          placeholder="YYYY-MM-DD"
                          placeholderTextColor={c.mutedForeground}
                          maxLength={10}
                          style={[
                            styles.input,
                            {
                              color: c.foreground,
                              backgroundColor: c.card,
                              borderColor: errors[field.key]
                                ? c.destructive
                                : c.border,
                            },
                          ]}
                        />
                      ) : disabled ? (
                        <View
                          style={[
                            styles.input,
                            { backgroundColor: c.card, borderColor: c.border },
                          ]}
                        >
                          <Text style={{ color: c.mutedForeground }}>
                            {String(values[field.key] || "Pick a date")}
                          </Text>
                        </View>
                      ) : (
                        <DatePickerField
                          value={String(values[field.key] || "")}
                          onChange={(value) => update(field.key, value)}
                          placeholder="Pick a date"
                        />
                      )}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${typedDates[field.key] ? "Pick" : "Type"} ${field.label.toLowerCase()}`}
                        disabled={disabled}
                        onPress={() => {
                          updateDraft({ typedDates: {
                            ...draftRef.current.typedDates,
                            [field.key]: !draftRef.current.typedDates[field.key],
                          } });
                        }}
                        style={styles.dateMode}
                      >
                        <Feather
                          name={typedDates[field.key] ? "calendar" : "edit-2"}
                          size={14}
                          color={c.primary}
                        />
                        <Text style={[styles.help, { color: c.primary }]}>
                          {typedDates[field.key]
                            ? "Use calendar"
                            : "Enter date instead"}
                        </Text>
                      </Pressable>
                    </View>
                  ) : field.type === "account" ? (
                    <View style={styles.accountSection}>
                      {!eligibleAccounts.length ? (
                        <Text
                          style={[styles.help, { color: c.mutedForeground }]}
                        >
                          No active accounts. Add a checking, savings, or cash
                          account in Accounts, then return to Flo.
                        </Text>
                      ) : (
                        <>
                          <TextInput
                            accessibilityLabel="Search accounts"
                            editable={!disabled}
                            value={accountSearch}
                            onChangeText={(accountSearch) => updateDraft({ accountSearch })}
                            placeholder="Search accounts"
                            placeholderTextColor={c.mutedForeground}
                            style={[
                              styles.input,
                              {
                                color: c.foreground,
                                backgroundColor: c.card,
                                borderColor: c.border,
                              },
                            ]}
                          />
                          {shownAccounts.map((account) => (
                            <Pressable
                              key={account.id}
                              accessibilityRole="radio"
                              {...(Platform.OS === "web"
                                ? {
                                    "aria-checked":
                                      values.account_id === account.id,
                                  }
                                : {})}
                              accessibilityLabel={`${account.name}, ${account.account_type}`}
                              accessibilityState={{
                                checked: values.account_id === account.id,
                                disabled,
                              }}
                              disabled={disabled}
                              onPress={() => update("account_id", account.id)}
                              style={[
                                styles.account,
                                {
                                  borderColor:
                                    values.account_id === account.id
                                      ? c.primary
                                      : c.border,
                                  backgroundColor:
                                    values.account_id === account.id
                                      ? c.primary + "12"
                                      : c.card,
                                },
                              ]}
                            >
                              <Feather
                                name={
                                  values.account_id === account.id
                                    ? "check-circle"
                                    : "circle"
                                }
                                size={18}
                                color={
                                  values.account_id === account.id
                                    ? c.primary
                                    : c.mutedForeground
                                }
                              />
                              <View style={styles.accountName}>
                                <Text
                                  style={[
                                    styles.accountTitle,
                                    { color: c.foreground },
                                  ]}
                                >
                                  {account.name}
                                </Text>
                                <Text
                                  style={[
                                    styles.help,
                                    { color: c.mutedForeground },
                                  ]}
                                >
                                  {account.account_type
                                    .charAt(0)
                                    .toUpperCase() +
                                    account.account_type.slice(1)}
                                </Text>
                              </View>
                            </Pressable>
                          ))}
                          {!shownAccounts.length ? (
                            <Text
                              style={[
                                styles.help,
                                { color: c.mutedForeground },
                              ]}
                            >
                              No accounts match your search.
                            </Text>
                          ) : null}
                        </>
                      )}
                    </View>
                  ) : (
                    <TextInput sensitive={field.type === "money"}
                      ref={(input) => {
                        inputsRef.current[field.key] = input;
                      }}
                      accessibilityLabel={field.label}
                      accessibilityLabelledBy={`flo-form-label-${field.key}`}
                      editable={!disabled}
                      value={
                        typeof values[field.key] === "string"
                          ? String(values[field.key])
                          : ""
                      }
                      onChangeText={(value) => update(field.key, value)}
                      placeholder={
                        field.type === "money" || field.type === "apr"
                          ? field.optional
                            ? "0.00"
                            : "Enter amount"
                          : field.label
                      }
                      placeholderTextColor={c.mutedForeground}
                      maxLength={field.maxLength ?? 80}
                      inputMode={
                        field.type === "money" || field.type === "apr"
                          ? "decimal"
                          : "text"
                      }
                      multiline={field.key === "note"}
                      style={[
                        styles.input,
                        field.key === "note" && styles.description,
                        {
                          color: c.foreground,
                          backgroundColor: c.card,
                          borderColor: errors[field.key]
                            ? c.destructive
                            : c.border,
                        },
                      ]}
                    />
                  )}
                  {field.type === "date" && typedDates[field.key] ? (
                    <Text style={[styles.help, { color: c.mutedForeground }]}>
                      Year-month-day, for example 2026-11-01.
                    </Text>
                  ) : null}
                  {field.type === "apr" ? (
                    <Text style={[styles.help, { color: c.mutedForeground }]}>
                      Enter 0 for an interest-free debt.
                    </Text>
                  ) : null}
                  {errors[field.key] ? (
                    <Text
                      accessibilityRole="alert"
                      style={[styles.error, { color: c.destructive }]}
                    >
                      {errors[field.key]}
                    </Text>
                  ) : null}
                </View>
              ))}
              {kind === "create_income" && values.frequency === "monthly" ? (
                <Pressable
                  accessibilityRole="checkbox"
                  {...(Platform.OS === "web"
                    ? { "aria-checked": values.monthly_last_day === true }
                    : {})}
                  accessibilityLabel="Paid on the last day of each month"
                  accessibilityState={{
                    checked: values.monthly_last_day === true,
                    disabled,
                  }}
                  disabled={disabled}
                  onPress={() =>
                    update("monthly_last_day", values.monthly_last_day !== true)
                  }
                  style={styles.checkRow}
                >
                  <Feather
                    name={
                      values.monthly_last_day === true
                        ? "check-square"
                        : "square"
                    }
                    size={20}
                    color={c.primary}
                  />
                  <Text style={[styles.choiceText, { color: c.foreground }]}>
                    Paid on the last day of each month
                  </Text>
                </Pressable>
              ) : null}
            </ScrollView>
            <View
              style={[
                styles.footer,
                {
                  borderColor: c.border,
                  paddingBottom: Math.max(14, insets.bottom),
                },
              ]}
            >
              {errorSummary || saveError || error ? (
                <Text
                  accessibilityRole="alert"
                  style={[styles.error, { color: c.destructive }]}
                >
                  {errorSummary || saveError || error}
                </Text>
              ) : null}
              <Text style={[styles.help, { color: c.mutedForeground }]}>
                * Required. Nothing is added until you save.
              </Text>
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={disabled}
                  onPress={requestClose}
                  style={[
                    styles.button,
                    { backgroundColor: c.muted, opacity: disabled ? 0.55 : 1 },
                  ]}
                >
                  <Text style={[styles.buttonText, { color: c.foreground }]}>
                    Cancel
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Save ${title}`}
                  disabled={disabled}
                  onPress={() => void save()}
                  style={[
                    styles.button,
                    {
                      backgroundColor: c.primary,
                      opacity: disabled ? 0.55 : 1,
                    },
                  ]}
                >
                  {disabled ? (
                    <ActivityIndicator
                      size="small"
                      color={c.primaryForeground}
                    />
                  ) : null}
                  <Text
                    style={[styles.buttonText, { color: c.primaryForeground }]}
                  >
                    {saving
                      ? "Saving…"
                      : busy
                        ? "Please wait…"
                        : `Save ${title}`}
                  </Text>
                </Pressable>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  keyboard: { flex: 1 },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(2,6,23,0.78)",
    justifyContent: "flex-end",
  },
  sheet: {
    width: "100%",
    maxHeight: "100%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  heading: { flex: 1, minWidth: 0 },
  title: { fontSize: 20, lineHeight: 26, fontFamily: "Inter_700Bold" },
  subtitle: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { flexShrink: 1 },
  content: { padding: 18, gap: 18 },
  field: { gap: 7 },
  label: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  description: { minHeight: 70, textAlignVertical: "top" },
  help: { fontSize: 11, lineHeight: 17, fontFamily: "Inter_400Regular" },
  error: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_500Medium" },
  dateSection: { gap: 4 },
  dateMode: {
    minHeight: 44,
    alignSelf: "flex-start",
    paddingHorizontal: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 11,
    borderWidth: 1,
    justifyContent: "center",
  },
  choiceText: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "Inter_600SemiBold",
    flexShrink: 1,
  },
  accountSection: { gap: 8 },
  account: {
    minHeight: 58,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  accountName: { flex: 1 },
  accountTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "Inter_600SemiBold",
  },
  checkRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  footer: { paddingHorizontal: 18, paddingTop: 12, gap: 10, borderTopWidth: 1 },
  actions: { flexDirection: "row", gap: 10 },
  button: {
    flex: 1,
    minHeight: 48,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  buttonText: { fontSize: 14, fontFamily: "Inter_700Bold", flexShrink: 1 },
});
