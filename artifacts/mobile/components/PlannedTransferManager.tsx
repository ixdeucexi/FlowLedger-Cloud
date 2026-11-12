import Feather from "@expo/vector-icons/Feather";
import React, { useEffect, useRef, useState } from "react";
import { Modal, ScrollView, StyleSheet } from "react-native";
import {
  PrivacyPressable as Pressable,
  PrivacyText as Text,
  PrivacyView as View,
} from "@/components/privacy/PrivacyPrimitives";
import { accountForecastLabel } from "@/components/AccountForecastPicker";
import { PlannedTransferModal } from "@/components/PlannedTransferModal";
import { PlannedTransferOccurrenceModal } from "@/components/PlannedTransferOccurrenceModal";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import { safeLocalDateInTimeZone } from "@/lib/financialProjection";
import {
  resolveForecastAccountReference,
  type ForecastAccountRef,
} from "@/lib/accountForecasts";
import {
  plannedTransferOccurrenceDates,
  plannedTransferHasOutstandingReview,
  type PlannedAccountTransfer,
} from "@/lib/plannedAccountTransfers";

const money = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const partial = (row: {
  skipped: boolean;
  from_reflected: boolean;
  to_reflected: boolean;
}) => !row.skipped && row.from_reflected !== row.to_reflected;

export function PlannedTransferManager({
  accountRef,
  month,
  year,
  title = "Planned transfers",
}: {
  title?: string;
  accountRef?: ForecastAccountRef | null;
  month?: number;
  year?: number;
}) {
  const c = useColors();
  const { user } = useAuth();
  const {
    activeHousehold,
    householdTimeZone,
    canEditHousehold,
    accountForecastReady,
    forecastAccounts,
    plannedAccountTransfers,
    plannedTransferOccurrences,
    plannedTransfersReady,
    plannedTransfersError,
    savePlannedAccountTransfer,
    deletePlannedAccountTransfer,
  } = useBudget();
  const today = safeLocalDateInTimeZone(new Date(), householdTimeZone);
  const [todayYear, todayMonth] = today.split("-").map(Number);
  const displayMonth = month ?? todayMonth - 1,
    displayYear = year ?? todayYear;
  const periodLabel = new Date(displayYear, displayMonth, 1).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric" },
  );
  const scope = `${user?.id ?? "demo"}:${activeHousehold?.householdId ?? "none"}:${activeHousehold?.budgetId ?? "none"}`;
  const access = useRef({ scope, ready: false, canEdit: false });
  access.current = {
    scope,
    ready: Boolean(
      activeHousehold && plannedTransfersReady && accountForecastReady,
    ),
    canEdit: canEditHousehold,
  };
  const [editor, setEditor] = useState<PlannedAccountTransfer | "new" | null>(
    null,
  );
  const [historyPlan, setHistoryPlan] = useState<PlannedAccountTransfer | null>(null);
  const [dateEditor, setDateEditor] = useState<{
    transferId: string;
    date: string;
  } | null>(null);
  const [deleting, setDeleting] = useState<PlannedAccountTransfer | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef<object | null>(null);
  useEffect(() => {
    busyRef.current = null;
    setEditor(null);
    setHistoryPlan(null);
    setDateEditor(null);
    setDeleting(null);
    setError(null);
    setBusy(null);
  }, [scope, accountRef]);
  const resolve = (ref: string) =>
    resolveForecastAccountReference(ref, forecastAccounts, true);
  const selectedRef = accountRef ? (resolve(accountRef) ?? accountRef) : null;
  const name = (ref: string) => {
    const account = forecastAccounts.find(
      (row) => row.ref === ref || row.aliases.includes(ref),
    );
    return account ? accountForecastLabel(account) : "Account unavailable";
  };
  const planInScope = (plan: PlannedAccountTransfer) => plan.household_id === activeHousehold?.householdId && plan.budget_id === activeHousehold?.budgetId;
  const plans = plannedAccountTransfers.filter((plan) => {
    if (!planInScope(plan)) return false;
    const adjustments = plannedTransferOccurrences.filter(
      (row) => row.transfer_id === plan.id,
    );
    if (
      plan.deleted_at &&
      !adjustments.some((row) => plannedTransferHasOutstandingReview(plan, row))
    )
      return false;
    if (!selectedRef) return true;
    const matches = (ref: string) => (resolve(ref) ?? ref) === selectedRef;
    return (
      matches(plan.from_account_ref) ||
      matches(plan.to_account_ref) ||
      adjustments.some(
        (row) =>
          plannedTransferHasOutstandingReview(plan, row) &&
          (matches(row.from_account_ref_snapshot) ||
            matches(row.to_account_ref_snapshot)),
      )
    );
  });
  // Retired plans carry a durable link to earlier Bill payments, without
  // reappearing as scheduled transfers or outstanding money.
  const retiredBillHistory = plannedAccountTransfers.filter(plan =>
    planInScope(plan) && Boolean(plan.deleted_at && plan.source_bill_id)
    && !plannedTransferOccurrences.some(row => row.transfer_id === plan.id && plannedTransferHasOutstandingReview(plan, row))
    && (!selectedRef || (resolve(plan.from_account_ref) ?? plan.from_account_ref) === selectedRef
      || (resolve(plan.to_account_ref) ?? plan.to_account_ref) === selectedRef));
  const openHistory = (plan: PlannedAccountTransfer) => {
    if (access.current.scope !== scope || !planInScope(plan) || !plannedTransfersReady || busyRef.current) return;
    setEditor(null);
    setHistoryPlan(plan);
  };
  const run = async (plan: PlannedAccountTransfer, remove: boolean) => {
    if (
      busyRef.current ||
      !access.current.ready ||
      !access.current.canEdit ||
      access.current.scope !== scope
    )
      return;
    const startedScope = scope;
    const operation = {};
    busyRef.current = operation;
    setBusy(plan.id);
    setError(null);
    try {
      if (remove) await deletePlannedAccountTransfer(plan.id, plan.revision);
      else
        await savePlannedAccountTransfer(
          plan.id,
          { status: plan.status === "paused" ? "active" : "paused" },
          plan.revision,
        );
      if (
        busyRef.current === operation &&
        access.current.scope === startedScope
      )
        setDeleting(null);
    } catch (caught) {
      if (
        busyRef.current === operation &&
        access.current.scope === startedScope
      )
        setError(
          caught instanceof Error
            ? caught.message
            : "This transfer plan could not be updated.",
        );
    } finally {
      if (busyRef.current === operation) {
        busyRef.current = null;
        if (access.current.scope === startedScope) setBusy(null);
      }
    }
  };
  const locked = !access.current.ready || !canEditHousehold || Boolean(busy);
  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <View style={styles.flex}>
          <Text style={[styles.title, { color: c.foreground }]}>
            {title}
          </Text>
          <Text style={[styles.help, { color: c.mutedForeground }]}>
            Between your accounts · {periodLabel}
          </Text>
        </View>
        {canEditHousehold ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Plan a transfer"
            accessibilityState={{ disabled: locked }}
            disabled={locked}
            onPress={() => setEditor("new")}
            style={[
              styles.add,
              {
                borderColor: c.primary + "55",
                backgroundColor: c.primary + "12",
                opacity: locked ? 0.5 : 1,
              },
            ]}
          >
            <Feather name="plus" size={18} color={c.primary} />
            <Text style={[styles.actionText, { color: c.primary }]}>Plan</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={[styles.help, { color: c.mutedForeground }]}>
        Planned only. FlowLedger does not move money. Open a date to skip it or
        mark a side already included in its account balance.
      </Text>
      {!plannedTransfersReady ? (
        <Text style={[styles.help, { color: c.mutedForeground }]}>
          Loading transfer plans…
        </Text>
      ) : null}
      {plannedTransfersError ? (
        <Text
          accessibilityRole="alert"
          style={[styles.help, { color: c.warning }]}
        >
          {plannedTransfersError}
        </Text>
      ) : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          style={[styles.help, { color: c.destructive }]}
        >
          {error}
        </Text>
      ) : null}
      {plans.map((plan) => {
        const adjustments = plannedTransferOccurrences.filter(
          (row) => row.transfer_id === plan.id,
        );
        const outstanding = adjustments.filter((row) =>
          plannedTransferHasOutstandingReview(plan, row),
        );
        const dates = plannedTransferOccurrenceDates(
          plan,
          adjustments,
          displayMonth,
          displayYear,
        );
        return (
          <View
            key={plan.id}
            style={[
              styles.card,
              { borderColor: c.border, backgroundColor: c.card },
            ]}
          >
            <View style={styles.planHeading}>
              <Text
                numberOfLines={2}
                accessibilityLabel={plan.name}
                style={[styles.planName, { color: c.foreground }]}
              >
                {plan.name}
              </Text>
              <Text sensitive style={[styles.amount, { color: c.foreground }]}>
                {money(plan.amount)}
              </Text>
            </View>
            <Text style={[styles.help, { color: c.mutedForeground }]}>
              {name(plan.from_account_ref)} → {name(plan.to_account_ref)}
            </Text>
            <Text
              style={[
                styles.help,
                {
                  color:
                    plan.deleted_at || plan.status === "paused"
                      ? c.warning
                      : c.mutedForeground,
                },
              ]}
            >
              {plan.deleted_at
                ? "Deleted · outstanding date retained"
                : plan.status === "paused"
                  ? "Paused"
                  : plan.frequency === "monthly"
                    ? `Monthly · day ${Number(plan.start_date.slice(8))}`
                    : "One time"}
              {plan.end_date ? ` · ends ${plan.end_date}` : ""}
            </Text>
            {outstanding.length ? (
              <Text style={[styles.help, { color: c.warning }]}>
                {outstanding.length} reviewed{" "}
                {outstanding.length === 1
                  ? "transfer still planned"
                  : "transfers still planned"}
              </Text>
            ) : null}
            {dates.map((date) => {
              const state = adjustments.find(
                (row) => row.occurrence_date === date,
              );
              const effectiveDate = state?.scheduled_date_snapshot ?? date;
              const status = state?.skipped
                ? "Skipped"
                : state?.from_reflected && state.to_reflected
                  ? "Both sides included in balances"
                  : state && partial(state)
                    ? "One side still pending"
                    : state && plannedTransferHasOutstandingReview(plan, state)
                      ? "Reviewed transfer still planned"
                      : state
                        ? "Not projected"
                        : "Planned";
              return (
                <Pressable
                  key={date}
                  accessibilityRole="button"
                  accessibilityLabel={`Adjust ${plan.name}, ${effectiveDate}${effectiveDate !== date ? `, reviewed date ${date}` : ""}, ${status}`}
                  onPress={() => setDateEditor({ transferId: plan.id, date })}
                  style={[styles.dateRow, { borderColor: c.border }]}
                >
                  <View style={styles.flex}>
                    <Text style={[styles.dateText, { color: c.foreground }]}>
                      {effectiveDate}
                    </Text>
                    {state ? (
                      <Text style={[styles.help, { color: c.mutedForeground }]}>
                        Saved scheduled date
                      </Text>
                    ) : null}
                    {effectiveDate !== date ? (
                      <Text style={[styles.help, { color: c.mutedForeground }]}>
                        Reviewed date {date}
                      </Text>
                    ) : null}
                    <Text
                      style={[
                        styles.help,
                        {
                          color:
                            state &&
                            plannedTransferHasOutstandingReview(plan, state)
                              ? c.warning
                              : c.mutedForeground,
                        },
                      ]}
                    >
                      {status}
                    </Text>
                  </View>
                  <Text
                    sensitive
                    style={[styles.dateAmount, { color: c.foreground }]}
                  >
                    {money(state?.amount_snapshot ?? plan.amount)}
                  </Text>
                  <Feather
                    name="chevron-right"
                    size={17}
                    color={c.mutedForeground}
                  />
                </Pressable>
              );
            })}
            {!dates.length ? (
              <Text style={[styles.help, { color: c.mutedForeground }]}>
                No planned transfer in {periodLabel}.
              </Text>
            ) : null}
            {canEditHousehold && !plan.deleted_at ? (
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${plan.name} transfer plan`}
                  disabled={locked}
                  onPress={() => setEditor(plan)}
                  style={[styles.action, { borderColor: c.border }]}
                >
                  <Feather name="edit-2" size={14} color={c.primary} />
                  <Text style={[styles.actionText, { color: c.primary }]}>
                    Edit
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${plan.status === "paused" ? "Resume" : "Pause"} ${plan.name}`}
                  disabled={locked}
                  onPress={() => {
                    void run(plan, false);
                  }}
                  style={[styles.action, { borderColor: c.border }]}
                >
                  <Feather
                    name={plan.status === "paused" ? "play" : "pause"}
                    size={14}
                    color={c.primary}
                  />
                  <Text style={[styles.actionText, { color: c.primary }]}>
                    {busy === plan.id
                      ? "Saving…"
                      : plan.status === "paused"
                        ? "Resume"
                        : "Pause"}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${plan.name} transfer plan`}
                  disabled={locked}
                  onPress={() => setDeleting(plan)}
                  style={[styles.action, { borderColor: c.destructive + "55" }]}
                >
                  <Feather name="trash-2" size={14} color={c.destructive} />
                  <Text style={[styles.actionText, { color: c.destructive }]}>
                    Delete
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {plan.source_bill_id ? <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Earlier bill payments for ${plan.name}`}
              disabled={!plannedTransfersReady || Boolean(busy)}
              onPress={() => openHistory(plan)}
              style={[styles.action, { borderColor: c.primary + "35", alignSelf: "flex-start" }]}
            >
              <Feather name="clock" size={15} color={c.primary} />
              <Text style={[styles.actionText, { color: c.primary }]}>Earlier bill payments</Text>
            </Pressable> : null}
            {deleting?.id === plan.id ? (
              <View
                style={[styles.confirm, { borderColor: c.destructive + "55" }]}
              >
                <Text style={[styles.help, { color: c.foreground }]}>
                  Delete this future plan? It will not delete bank activity.
                  Dates with one side already included in a balance stay
                  available to finish or skip.
                </Text>
                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={Boolean(busy)}
                    onPress={() => setDeleting(null)}
                    style={[styles.action, { borderColor: c.border }]}
                  >
                    <Text style={[styles.actionText, { color: c.foreground }]}>
                      Keep plan
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Confirm delete transfer plan"
                    disabled={locked}
                    onPress={() => {
                      void run(plan, true);
                    }}
                    style={[styles.action, { borderColor: c.destructive }]}
                  >
                    <Text style={[styles.actionText, { color: c.destructive }]}>
                      Delete plan
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
      {retiredBillHistory.length ? <View style={styles.historySection}>
        <Text style={[styles.help, { color: c.mutedForeground }]}>Earlier bill payments</Text>
        {retiredBillHistory.map(plan => <Pressable
          key={plan.id}
          accessibilityRole="button"
          accessibilityLabel={`Earlier bill payments for ${plan.name}`}
          disabled={!plannedTransfersReady || Boolean(busy)}
          onPress={() => openHistory(plan)}
          style={[styles.historyRow, { borderColor: c.border, backgroundColor: c.card }]}
        >
          <Feather name="clock" size={18} color={c.primary} />
          <View style={styles.flex}>
            <Text numberOfLines={2} style={[styles.planName, { color: c.foreground }]}>{plan.name}</Text>
            <Text style={[styles.help, { color: c.mutedForeground }]}>View earlier bill payments</Text>
          </View>
          <Feather name="chevron-right" size={18} color={c.mutedForeground} />
        </Pressable>)}
      </View> : null}
      {plannedTransfersReady && !plannedTransfersError && !plans.length && !retiredBillHistory.length ? (
        <Text style={[styles.help, { color: c.mutedForeground }]}>
          No transfer plans {accountRef ? "for this account" : "yet"}. Choose
          the accounts, amount, and first date to see future transfers on the
          calendar.
        </Text>
      ) : null}
      <PlannedTransferModal
        key={`${scope}:${historyPlan ? "history" : "edit"}:${historyPlan?.id ?? (editor && editor !== "new" ? editor.id : "new")}`}
        visible={Boolean(editor || historyPlan)}
        transfer={historyPlan ?? (editor && editor !== "new" ? editor : null)}
        initialHistory={Boolean(historyPlan)}
        historyOnly={Boolean(historyPlan?.deleted_at)}
        initialToAccountRef={accountRef}
        onClose={() => { setEditor(null); setHistoryPlan(null); }}
      />
      <PlannedTransferOccurrenceModal
        transferId={dateEditor?.transferId ?? null}
        date={dateEditor?.date ?? null}
        onClose={() => setDateEditor(null)}
        onEditSeries={(plan) => setEditor(plan)}
      />
    </View>
  );
}

export function PlannedTransferManagerModal({
  visible,
  onClose,
  accountRef,
  month,
  year,
}: {
  visible: boolean;
  onClose: () => void;
  accountRef?: ForecastAccountRef | null;
  month?: number;
  year?: number;
}) {
  const c = useColors();
  useBackDismiss(visible, onClose);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="Close planned transfers"
          onPress={onClose}
          style={StyleSheet.absoluteFillObject}
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: c.background, borderColor: c.border },
          ]}
        >
          <View style={styles.modalHeading}>
            <Text style={[styles.title, { color: c.foreground }]}>
              Transfer plans
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close planned transfers"
              onPress={onClose}
              style={styles.close}
            >
              <Feather name="x" size={22} color={c.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingBottom: 8 }}
          >
            {visible ? (
              <PlannedTransferManager
                accountRef={accountRef}
                month={month}
                year={year}
              />
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  historySection: { gap: 8 },
  historyRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, borderWidth: 1, borderRadius: 14, padding: 13 },
  section: { gap: 12 },
  heading: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  flex: { flex: 1, minWidth: 0, gap: 4 },
  title: { fontSize: 18, lineHeight: 25, fontFamily: "Inter_700Bold" },
  help: { fontSize: 12, lineHeight: 19 },
  add: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 12,
  },
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  planHeading: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  planName: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: "Inter_700Bold",
  },
  amount: { fontSize: 16, flexShrink: 0, fontFamily: "Inter_700Bold" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: {
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
  },
  actionText: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderTopWidth: 1,
    paddingVertical: 10,
  },
  dateText: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
  dateAmount: { flexShrink: 0, fontSize: 13, fontFamily: "Inter_700Bold" },
  confirm: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
  overlay: {
    flex: 1,
    padding: 16,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,.65)",
  },
  sheet: {
    width: "100%",
    maxWidth: 620,
    maxHeight: "88%",
    borderWidth: 1,
    borderRadius: 24,
    padding: 18,
    gap: 12,
  },
  modalHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
