import Feather from "@expo/vector-icons/Feather";
import React, { useEffect, useRef, useState } from "react";
import { Modal, ScrollView, StyleSheet } from "react-native";
import {
  PrivacyPressable as Pressable,
  PrivacyText as Text,
  PrivacyView as View,
} from "@/components/privacy/PrivacyPrimitives";
import { accountForecastLabel } from "@/components/AccountForecastPicker";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import {
  plannedTransferScheduledDate,
  type PlannedAccountTransfer,
  type PlannedTransferOccurrence,
  type PlannedTransferOccurrencePatch,
} from "@/lib/plannedAccountTransfers";

const money = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function PlannedTransferOccurrenceModal({
  transferId,
  date,
  onClose,
  onEditSeries,
}: {
  transferId: string | null;
  date: string | null;
  onClose: () => void;
  onEditSeries?: (transfer: PlannedAccountTransfer) => void;
}) {
  const c = useColors();
  const { user } = useAuth();
  const {
    activeHousehold,
    canEditHousehold,
    accountForecastReady,
    forecastAccounts,
    plannedAccountTransfers,
    plannedTransferOccurrences,
    plannedTransfersReady,
    savePlannedTransferOccurrence,
  } = useBudget();
  const scope = `${user?.id ?? "demo"}:${activeHousehold?.householdId ?? "none"}:${activeHousehold?.budgetId ?? "none"}`;
  const visible = Boolean(transferId && date);
  const transfer = plannedAccountTransfers.find((row) => row.id === transferId);
  const occurrence = plannedTransferOccurrences.find(
    (row) => row.transfer_id === transferId && row.occurrence_date === date,
  );
  const [baseline, setBaseline] = useState<PlannedTransferOccurrence | null>(
    null,
  );
  const [template, setTemplate] = useState<PlannedAccountTransfer | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [fromReflected, setFromReflected] = useState(false);
  const [toReflected, setToReflected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetReview, setResetReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef<object | null>(null);
  const access = useRef({ scope, visible, canEdit: false, ready: false });
  access.current = {
    scope,
    visible,
    canEdit: canEditHousehold,
    ready: Boolean(
      activeHousehold && plannedTransfersReady && accountForecastReady,
    ),
  };
  useEffect(() => {
    savingRef.current = null;
    if (!visible) return;
    setTemplate(transfer ?? null);
    setBaseline(occurrence ?? null);
    setSkipped(occurrence?.skipped ?? false);
    setFromReflected(occurrence?.from_reflected ?? false);
    setToReflected(occurrence?.to_reflected ?? false);
    setSaving(false);
    setError(null);
    setResetReview(false);
  }, [transferId, date, scope, visible]);
  useBackDismiss(visible && !saving, onClose);
  const fromRef =
    baseline?.from_account_ref_snapshot ?? template?.from_account_ref;
  const toRef = baseline?.to_account_ref_snapshot ?? template?.to_account_ref;
  const from = forecastAccounts.find(
    (account) =>
      account.ref === fromRef ||
      Boolean(fromRef && account.aliases.includes(fromRef)),
  );
  const to = forecastAccounts.find(
    (account) =>
      account.ref === toRef ||
      Boolean(toRef && account.aliases.includes(toRef)),
  );
  const amount = baseline?.amount_snapshot ?? template?.amount ?? 0;
  const effectiveDate = baseline?.scheduled_date_snapshot ?? date;
  const currentScheduledDate =
    template && date
      ? plannedTransferScheduledDate(
          template,
          Number(date.slice(5, 7)) - 1,
          Number(date.slice(0, 4)),
        )
      : null;
  const fromAsOf =
    fromReflected && baseline?.from_reflected
      ? baseline.from_balance_as_of
      : (from?.asOfDate ?? null);
  const toAsOf =
    toReflected && baseline?.to_reflected
      ? baseline.to_balance_as_of
      : (to?.asOfDate ?? null);
  const locked =
    saving || !canEditHousehold || !access.current.ready || !template;
  const snapshotChanged = Boolean(
    baseline &&
    template &&
    (baseline.amount_snapshot !== template.amount ||
      baseline.from_account_ref_snapshot !== template.from_account_ref ||
      baseline.to_account_ref_snapshot !== template.to_account_ref ||
      baseline.template_revision_snapshot !== template.revision),
  );
  const canResetCurrentPlan = Boolean(
    transfer &&
    transfer.status === "active" &&
    !transfer.deleted_at &&
    date &&
    plannedTransferScheduledDate(
      transfer,
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(0, 4)),
    ),
  );
  const save = async (reset = false) => {
    if (
      savingRef.current ||
      locked ||
      access.current.scope !== scope ||
      !access.current.visible ||
      !template ||
      !date
    )
      return;
    if (reset && !canResetCurrentPlan) {
      setError(
        "The current plan has no active transfer in this month. You can skip this outstanding date instead.",
      );
      return;
    }
    if (!reset && ((fromReflected && !fromAsOf) || (toReflected && !toAsOf))) {
      setError(
        "A dated account balance is needed before marking that side included. You can still skip this date.",
      );
      return;
    }
    const patch: PlannedTransferOccurrencePatch = reset
      ? { use_current_plan: true }
      : {
          skipped,
          from_reflected: fromReflected,
          to_reflected: toReflected,
          from_balance_as_of: fromReflected ? fromAsOf : null,
          to_balance_as_of: toReflected ? toAsOf : null,
        };
    const startedScope = scope;
    const operation = {};
    savingRef.current = operation;
    setSaving(true);
    setError(null);
    try {
      await savePlannedTransferOccurrence(
        template.id,
        date,
        patch,
        template.revision,
        baseline?.revision ?? null,
      );
      if (
        savingRef.current === operation &&
        access.current.scope === startedScope &&
        access.current.visible
      )
        onClose();
    } catch (caught) {
      if (
        savingRef.current === operation &&
        access.current.scope === startedScope &&
        access.current.visible
      )
        setError(
          caught instanceof Error
            ? caught.message
            : "This transfer date could not be updated.",
        );
    } finally {
      if (savingRef.current === operation) {
        savingRef.current = null;
        if (access.current.scope === startedScope) setSaving(false);
      }
    }
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={saving ? undefined : onClose}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="Close transfer date"
          onPress={onClose}
          disabled={saving}
          style={StyleSheet.absoluteFillObject}
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: c.background, borderColor: c.border },
          ]}
        >
          <View style={styles.heading}>
            <View style={styles.flex}>
              <Text style={[styles.title, { color: c.foreground }]}>
                {template?.name ?? "Transfer date"}
              </Text>
              <Text style={[styles.date, { color: c.primary }]}>
                {effectiveDate !== date ? `Scheduled ${effectiveDate}` : date}
              </Text>
              {effectiveDate !== date ? (
                <Text style={[styles.help, { color: c.mutedForeground }]}>
                  Reviewed date {date}
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close transfer date"
              onPress={onClose}
              disabled={saving}
              style={styles.close}
            >
              <Feather name="x" size={22} color={c.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={styles.body}
          >
            <Text style={[styles.help, { color: c.mutedForeground }]}>
              Planning controls only. These do not move money or change Activity
              transactions.
            </Text>
            <View
              style={[
                styles.preview,
                { backgroundColor: c.card, borderColor: c.border },
              ]}
            >
              <View style={styles.row}>
                <Text
                  numberOfLines={2}
                  style={[styles.account, { color: c.foreground }]}
                >
                  {from
                    ? accountForecastLabel(from)
                    : "Source account unavailable"}
                </Text>
                <Text
                  sensitive
                  style={[styles.amount, { color: c.foreground }]}
                >
                  −{money(amount)}
                </Text>
              </View>
              <View style={styles.row}>
                <Text
                  numberOfLines={2}
                  style={[styles.account, { color: c.foreground }]}
                >
                  {to
                    ? accountForecastLabel(to)
                    : "Destination account unavailable"}
                </Text>
                <Text sensitive style={[styles.amount, { color: c.success }]}>
                  +{money(amount)}
                </Text>
              </View>
            </View>
            {template?.deleted_at || template?.status === "paused" ? (
              <Text style={[styles.help, { color: c.warning }]}>
                This plan is {template.deleted_at ? "deleted" : "paused"}. A
                side already included in a balance keeps the other side pending
                until you mark it included or skip this date.
              </Text>
            ) : null}
            {snapshotChanged ? (
              <Text style={[styles.help, { color: c.mutedForeground }]}>
                This date keeps the schedule, amount, and accounts you
                previously reviewed, even though the recurring plan has changed.
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel="Skip this transfer date"
              accessibilityState={{ checked: skipped, disabled: locked }}
              aria-checked={skipped}
              disabled={locked}
              onPress={() => setSkipped((value) => !value)}
              style={[styles.check, { borderColor: c.border }]}
            >
              <Feather
                name={skipped ? "check-square" : "square"}
                size={21}
                color={c.primary}
              />
              <View style={styles.flex}>
                <Text style={[styles.checkTitle, { color: c.foreground }]}>
                  Skip this date
                </Text>
                <Text style={[styles.help, { color: c.mutedForeground }]}>
                  Skip this occurrence. Later monthly transfers keep their
                  schedule.
                </Text>
              </View>
            </Pressable>
            <Text style={[styles.help, { color: c.mutedForeground }]}>
              While this plan is active, past reviewed sides you leave unsettled
              stay planned against each account’s current dated balance until
              skipped or marked included.
            </Text>
            <Text style={[styles.checkTitle, { color: c.foreground }]}>
              Already in the dated balance?
            </Text>
            <Text style={[styles.help, { color: c.mutedForeground }]}>
              Mark each side only if its displayed account balance already
              includes this transfer. FlowLedger does not check this with the
              bank.
            </Text>
            {(["from", "to"] as const).map((leg) => {
              const account = leg === "from" ? from : to;
              const checked = leg === "from" ? fromReflected : toReflected;
              const asOf = leg === "from" ? fromAsOf : toAsOf;
              const canMark = Boolean(
                account?.active &&
                !account.unavailableReason &&
                account.asOfDate,
              );
              const disabled = locked || skipped || (!checked && !canMark);
              return (
                <Pressable
                  key={leg}
                  accessibilityRole="checkbox"
                  accessibilityLabel={`${leg === "from" ? "Outgoing" : "Incoming"} side already included in ${account?.name ?? "unavailable account"} balance${asOf ? ` as of ${asOf}` : ""}`}
                  accessibilityState={{ checked, disabled }}
                  aria-checked={checked}
                  disabled={disabled}
                  onPress={() =>
                    leg === "from"
                      ? setFromReflected((value) => !value)
                      : setToReflected((value) => !value)
                  }
                  style={[
                    styles.check,
                    { borderColor: c.border, opacity: disabled ? 0.55 : 1 },
                  ]}
                >
                  <Feather
                    name={checked ? "check-square" : "square"}
                    size={21}
                    color={c.primary}
                  />
                  <View style={styles.flex}>
                    <Text style={[styles.checkTitle, { color: c.foreground }]}>
                      {leg === "from" ? "Outgoing" : "Incoming"} side included
                    </Text>
                    <Text style={[styles.help, { color: c.mutedForeground }]}>
                      {account
                        ? accountForecastLabel(account)
                        : "Account unavailable"}
                      {asOf
                        ? ` · balance as of ${asOf}`
                        : " · dated balance unavailable"}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
            {baseline && canEditHousehold ? (
              <View style={styles.body}>
                <Pressable
                  accessibilityRole="button"
                  disabled={locked || !canResetCurrentPlan}
                  accessibilityState={{
                    disabled: locked || !canResetCurrentPlan,
                  }}
                  onPress={() => setResetReview((value) => !value)}
                  style={styles.link}
                >
                  <Text style={[styles.linkText, { color: c.primary }]}>
                    Use current plan for this date
                  </Text>
                </Pressable>
                {!canResetCurrentPlan ? (
                  <Text style={[styles.help, { color: c.mutedForeground }]}>
                    The current plan has no active transfer in this month. You
                    can skip this outstanding date instead.
                  </Text>
                ) : null}
                {resetReview && template && canResetCurrentPlan ? (
                  <View
                    style={[
                      styles.preview,
                      {
                        borderColor: c.warning + "66",
                        backgroundColor: c.warning + "0d",
                      },
                    ]}
                  >
                    <Text style={[styles.help, { color: c.foreground }]}>
                      Replace this date’s saved schedule with{" "}
                      {currentScheduledDate}, using {money(template.amount)}{" "}
                      from{" "}
                      {forecastAccounts.find(
                        (account) =>
                          account.ref === template.from_account_ref ||
                          account.aliases.includes(template.from_account_ref),
                      )?.name ?? "unavailable account"}{" "}
                      to{" "}
                      {forecastAccounts.find(
                        (account) =>
                          account.ref === template.to_account_ref ||
                          account.aliases.includes(template.to_account_ref),
                      )?.name ?? "unavailable account"}
                      . This clears Skip and both included-in-balance
                      selections. Past unsettled sides stay planned against each
                      account’s current dated balance until skipped or marked
                      included.
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Confirm use current transfer plan"
                      disabled={locked}
                      onPress={() => {
                        void save(true);
                      }}
                      style={[styles.action, { borderColor: c.warning }]}
                    >
                      <Text style={[styles.linkText, { color: c.warning }]}>
                        Use current plan and clear adjustments
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : null}
            {error ? (
              <Text
                accessibilityRole="alert"
                style={[styles.help, { color: c.destructive }]}
              >
                {error}
              </Text>
            ) : null}
            {!transfer && plannedTransfersReady ? (
              <Text
                accessibilityRole="alert"
                style={[styles.help, { color: c.warning }]}
              >
                This transfer is no longer available in this household.
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save transfer date"
              disabled={locked}
              accessibilityState={{ disabled: locked }}
              onPress={() => {
                void save();
              }}
              style={[
                styles.save,
                { backgroundColor: c.primary, opacity: locked ? 0.5 : 1 },
              ]}
            >
              <Text style={[styles.saveText, { color: c.primaryForeground }]}>
                {saving ? "Saving…" : "Save date"}
              </Text>
            </Pressable>
            {template && onEditSeries && !template.deleted_at ? (
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={() => {
                  onClose();
                  onEditSeries(template);
                }}
                style={styles.link}
              >
                <Text style={[styles.linkText, { color: c.primary }]}>
                  Edit recurring plan
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    padding: 16,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,.65)",
  },
  sheet: {
    width: "100%",
    maxWidth: 540,
    maxHeight: "88%",
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
    gap: 14,
  },
  heading: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  flex: { flex: 1, minWidth: 0, gap: 4 },
  title: { fontSize: 21, lineHeight: 28, fontFamily: "Inter_700Bold" },
  date: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { gap: 13, paddingBottom: 5 },
  help: { fontSize: 12, lineHeight: 19 },
  preview: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  account: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 19 },
  amount: { flexShrink: 0, fontSize: 15, fontFamily: "Inter_700Bold" },
  check: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  checkTitle: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
  link: { minHeight: 44, justifyContent: "center", alignItems: "center" },
  linkText: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_700Bold" },
  action: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  save: {
    minHeight: 48,
    borderRadius: 14,
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
