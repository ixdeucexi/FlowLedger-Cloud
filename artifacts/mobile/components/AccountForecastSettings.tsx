import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
} from "react-native";
import {
  PrivacyPressable as Pressable,
  PrivacyText as Text,
  PrivacyTextInput as TextInput,
  PrivacyView as View,
} from "@/components/privacy/PrivacyPrimitives";
import {
  AccountForecastPicker,
  accountForecastLabel,
} from "@/components/AccountForecastPicker";
import { useBudget, type Account } from "@/context/BudgetContext";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import type {
  ForecastAccountDescriptor,
  ForecastAccountRef,
  ForecastRoutingEntity,
  ForecastRoutingPatch,
} from "@/lib/accountForecasts";
import { safeLocalDateInTimeZone } from "@/lib/financialProjection";

const money = (value: number | null) =>
  value === null || !Number.isFinite(value)
    ? "Unavailable"
    : value.toLocaleString("en-US", { style: "currency", currency: "USD" });

interface RoutingItem {
  type: ForecastRoutingEntity;
  id: string;
  name: string;
  detail: string;
  funding?: string | null;
  deposit?: string | null;
  forecast?: string | null;
  accountId?: string | null;
  fields: (
    | "funding_account_ref"
    | "deposit_account_ref"
    | "forecast_account_ref"
  )[];
  optional?: boolean;
}

function AccountPlanningCard({
  account,
  initialOpen,
  onEditManualAccount,
  onReconcileManualAccount,
}: {
  account: ForecastAccountDescriptor;
  initialOpen: boolean;
  onEditManualAccount?: (account: Account) => void;
  onReconcileManualAccount?: (account: Account) => void;
}) {
  const c = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const {
    accounts,
    accountForecastPreferences,
    accountForecastReady,
    saveAccountForecastPreference,
    setSelectedForecastAccountRef,
    canEditHousehold,
    activeHousehold,
    hiddenForecastAccountRefs = [],
    forecastVisibilityReady,
    forecastVisibilityError,
    setAccountForecastVisible,
  } = useBudget();
  const [expanded, setExpanded] = useState(initialOpen);
  const [apy, setApy] = useState("");
  const [floor, setFloor] = useState("");
  const [expectedRevision, setExpectedRevision] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [visibilityError, setVisibilityError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const scope = `${user?.id ?? "demo"}:${activeHousehold?.householdId ?? "personal"}:${activeHousehold?.budgetId ?? "budget"}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const accessRef = useRef(canEditHousehold);
  accessRef.current = canEditHousehold;
  const forecastVisible = !hiddenForecastAccountRefs.includes(account.ref);
  const changeVisibility = async (visible: boolean) => {
    if (visibilitySaving || scopeRef.current !== scope) return;
    const startedScope = scope;
    setVisibilitySaving(true);
    setVisibilityError(null);
    try {
      await setAccountForecastVisible(account.ref, visible);
    } catch (caught) {
      if (scopeRef.current === startedScope)
        setVisibilityError(
          caught instanceof Error
            ? caught.message
            : "Could not save your display preference.",
        );
    } finally {
      if (scopeRef.current === startedScope) setVisibilitySaving(false);
    }
  };
  const manual = account.manualAccountId
    ? accounts.find((item) => item.id === account.manualAccountId)
    : undefined;
  const openEditor = () => {
    if (savingRef.current || !accountForecastReady) return;
    const preference = accountForecastPreferences.find(
      (item) => item.account_ref === account.ref || account.aliases.includes(item.account_ref),
    );
    setExpectedRevision(preference?.updated_at ?? null);
    setApy(account.savingsApy === null ? "" : String(account.savingsApy));
    setFloor(account.safetyFloor === null ? "" : String(account.safetyFloor));
    setError(null);
    setExpanded(true);
  };
  useEffect(() => {
    setExpanded(false);
    setError(null);
    setVisibilityError(null);
  }, [scope, account.ref]);
  useEffect(() => {
    if (initialOpen) openEditor();
  }, [initialOpen]);
  const save = async () => {
    if (
      savingRef.current ||
      scopeRef.current !== scope ||
      !accessRef.current ||
      account.unavailableReason ||
      !account.active
    )
      return;
    const parse = (value: string) =>
      value.trim() === ""
        ? null
        : /^\d+(?:\.\d{1,6})?$/.test(value.trim())
          ? Number(value)
          : NaN;
    const rate = parse(apy),
      cushion = parse(floor);
    if (
      account.type === "savings" &&
      rate !== null &&
      (!Number.isFinite(rate) || rate < 0 || rate > 100)
    ) {
      setError("Enter an APY from 0% to 100%, or leave it blank.");
      return;
    }
    if (cushion !== null && (!Number.isFinite(cushion) || cushion < 0)) {
      setError("Enter a minimum balance of zero or more, or leave it blank.");
      return;
    }
    const startedScope = scope;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await saveAccountForecastPreference(
        account.ref,
        {
          ...(account.type === "savings" ? { savings_apy: rate } : {}),
          safety_floor: cushion,
        },
        expectedRevision,
      );
      if (scopeRef.current === startedScope) setExpanded(false);
    } catch (caught) {
      if (scopeRef.current === startedScope)
        setError(
          caught instanceof Error
            ? caught.message
            : "Account planning could not be saved. Try again.",
        );
    } finally {
      savingRef.current = false;
      if (scopeRef.current === startedScope) setSaving(false);
    }
  };
  return (
    <View
      style={[
        styles.accountCard,
        { backgroundColor: c.card, borderColor: c.border },
      ]}
    >
      <View style={styles.accountHeader}>
        <View
          style={[styles.accountIcon, { backgroundColor: c.primary + "14" }]}
        >
          <Feather
            name={account.type === "savings" ? "heart" : "credit-card"}
            size={20}
            color={c.primary}
          />
        </View>
        <View style={styles.flex}>
          <Text style={[styles.accountName, { color: c.foreground }]}>
            {accountForecastLabel(account)}
          </Text>
          <Text style={[styles.detail, { color: c.mutedForeground }]}>
            {account.source === "bank" ? "Connected" : "Manual"} ·{" "}
            {account.type === "savings"
              ? "Savings"
              : account.type === "cash"
                ? "Cash"
                : "Checking"}
          </Text>
        </View>
      </View>
      <View style={styles.balanceRow}>
        <View style={styles.balance}>
          <Text style={[styles.smallLabel, { color: c.mutedForeground }]}>
            Current
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text
              sensitive
              style={[styles.balanceValue, { color: c.foreground }]}
            >
              {money(account.currentBalance)}
            </Text>
          </ScrollView>
        </View>
        <View style={styles.balance}>
          <Text style={[styles.smallLabel, { color: c.mutedForeground }]}>
            Available
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text
              sensitive
              style={[styles.balanceValue, { color: c.foreground }]}
            >
              {money(account.availableBalance)}
            </Text>
          </ScrollView>
        </View>
      </View>
      <Text style={[styles.detail, { color: c.mutedForeground }]}>
        {account.asOfDate
          ? `Balance as of ${account.asOfDate}`
          : "Balance date unavailable"}
        {account.type === "savings" && account.savingsApy !== null
          ? ` · ${account.savingsApy}% APY`
          : ""}
      </Text>
      {account.unavailableReason ? (
        <Text style={[styles.detail, { color: c.warning }]}>
          {account.unavailableReason}
        </Text>
      ) : null}
      <View style={styles.sectionHeading}>
        <View style={styles.flex}>
          <Text style={[styles.fieldLabel, { color: c.foreground }]}>
            Show future forecast
          </Text>
          <Text style={[styles.detail, { color: c.mutedForeground }]}>
            Show this account in your Forecast menu.
          </Text>
        </View>
        <Switch
          accessibilityLabel={`Show future forecast for ${account.name}`}
          value={forecastVisible}
          disabled={visibilitySaving || !forecastVisibilityReady}
          onValueChange={(value) => void changeVisibility(value)}
          trackColor={{ false: c.border, true: c.primary }}
        />
      </View>
      {forecastVisibilityError ? <Text accessibilityRole="alert" style={[styles.detail, { color: c.warning }]}>{forecastVisibilityError}</Text> : null}
      {visibilityError ? (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: c.destructive }]}
        >
          {visibilityError}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View forecast for ${account.name}`}
          disabled={!forecastVisible || Boolean(account.unavailableReason)}
          onPress={() => {
            setSelectedForecastAccountRef(account.ref);
            router.push("/(tabs)/monthly");
          }}
          style={[
            styles.action,
            {
              backgroundColor: c.primary + "14",
              borderColor: c.primary + "30",
            },
          ]}
        >
          <Feather name="calendar" size={15} color={c.primary} />
          <Text style={[styles.actionText, { color: c.primary }]}>
            View forecast
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Planning settings for ${account.name}`}
          disabled={saving || !accountForecastReady}
          onPress={() => (expanded ? setExpanded(false) : openEditor())}
          style={[styles.action, { borderColor: c.border }]}
        >
          <Feather name="sliders" size={15} color={c.primary} />
          <Text style={[styles.actionText, { color: c.primary }]}>
            Planning
          </Text>
        </Pressable>
        {account.source === "manual" &&
        manual &&
        canEditHousehold &&
        onEditManualAccount ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit ${account.name}`}
            onPress={() => onEditManualAccount(manual)}
            style={[styles.action, { borderColor: c.border }]}
          >
            <Feather name="edit-2" size={14} color={c.primary} />
            <Text style={[styles.actionText, { color: c.primary }]}>Edit</Text>
          </Pressable>
        ) : null}
        {account.source === "manual" &&
        manual &&
        canEditHousehold &&
        onReconcileManualAccount ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Reconcile ${account.name}`}
            onPress={() => onReconcileManualAccount(manual)}
            style={[styles.action, { borderColor: c.border }]}
          >
            <Text style={[styles.actionText, { color: c.primary }]}>
              Reconcile
            </Text>
          </Pressable>
        ) : null}
      </View>
      {expanded ? (
        <View style={[styles.editor, { borderColor: c.border }]}>
          {account.type === "savings" ? (
            <>
              <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>
                APY (%)
              </Text>
              <TextInput
                accessibilityLabel={`APY for ${account.name}`}
                value={apy}
                onChangeText={setApy}
                editable={canEditHousehold && !saving}
                keyboardType="decimal-pad"
                placeholder="Optional, e.g. 4.5"
                placeholderTextColor={c.mutedForeground}
                style={[
                  styles.input,
                  {
                    color: c.foreground,
                    backgroundColor: c.background,
                    borderColor: c.border,
                  },
                ]}
              />
              <Text style={[styles.detail, { color: c.mutedForeground }]}>
                Annual percentage yield. Interest is estimated and credited
                monthly in Forecast; your bank’s credits may differ.
              </Text>
            </>
          ) : null}
          <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>
            Minimum balance (optional)
          </Text>
          <TextInput
            sensitive
            accessibilityLabel={`Minimum balance for ${account.name}`}
            value={floor}
            onChangeText={setFloor}
            editable={canEditHousehold && !saving}
            keyboardType="decimal-pad"
            placeholder="No account minimum"
            placeholderTextColor={c.mutedForeground}
            style={[
              styles.input,
              {
                color: c.foreground,
                backgroundColor: c.background,
                borderColor: c.border,
              },
            ]}
          />
          <Text style={[styles.detail, { color: c.mutedForeground }]}>
            Mark days this account falls below your chosen cushion.
          </Text>
          {error ? (
            <Text
              accessibilityRole="alert"
              style={[styles.error, { color: c.destructive }]}
            >
              {error}
            </Text>
          ) : null}
          {canEditHousehold ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Save planning for ${account.name}`}
              disabled={saving}
              onPress={() => void save()}
              style={[
                styles.save,
                { backgroundColor: c.primary, opacity: saving ? 0.6 : 1 },
              ]}
            >
              {saving ? (
                <ActivityIndicator color={c.primaryForeground} />
              ) : (
                <Text style={[styles.saveText, { color: c.primaryForeground }]}>
                  Save planning
                </Text>
              )}
            </Pressable>
          ) : (
            <Text style={[styles.detail, { color: c.mutedForeground }]}>
              A household editor can change these settings.
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

function RoutingRow({ item }: { item: RoutingItem }) {
  const c = useColors();
  const { user } = useAuth();
  const {
    activeHousehold,
    canEditHousehold,
    setForecastAccountRouting,
    accountForecastReady,
  } = useBudget();
  const scope = `${user?.id ?? "demo"}:${activeHousehold?.householdId ?? "personal"}:${activeHousehold?.budgetId ?? "budget"}:${item.type}:${item.id}`;
  const [draft, setDraft] = useState<ForecastRoutingPatch>({});
  const [baseline, setBaseline] = useState<ForecastRoutingPatch>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const initializedScope = useRef<string | null>(null);
  const accessRef = useRef(canEditHousehold);
  accessRef.current = canEditHousehold;
  const sourceValues = {
    funding_account_ref: item.funding ?? null,
    deposit_account_ref: item.deposit ?? null,
    forecast_account_ref: item.forecast ?? null,
  };
  const changed = item.fields.some((field) => draft[field] !== baseline[field]);
  const reloadSavedAccount = () => {
    const values = Object.fromEntries(
      item.fields.map((field) => [field, sourceValues[field]]),
    ) as ForecastRoutingPatch;
    setDraft(values);
    setBaseline({
      ...values,
      ...(item.type === "transaction"
        ? { account_id: item.accountId ?? null }
        : {}),
    });
    setError(null);
  };
  useEffect(() => {
    if (initializedScope.current === scope && (changed || savingRef.current))
      return;
    initializedScope.current = scope;
    const values = Object.fromEntries(
      item.fields.map((field) => [field, sourceValues[field]]),
    ) as ForecastRoutingPatch;
    setDraft(values);
    setBaseline({
      ...values,
      ...(item.type === "transaction"
        ? { account_id: item.accountId ?? null }
        : {}),
    });
    setError(null);
  }, [
    scope,
    item.funding,
    item.deposit,
    item.forecast,
    item.accountId,
    changed,
  ]);
  const save = async () => {
    if (
      savingRef.current ||
      currentScope.current !== scope ||
      !accessRef.current ||
      !changed ||
      initializedScope.current !== scope
    )
      return;
    const startedScope = scope;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const patch = Object.fromEntries(
      item.fields
        .filter((field) => draft[field] !== baseline[field])
        .map((field) => [field, draft[field] ?? null]),
    ) as ForecastRoutingPatch;
    const expected = Object.fromEntries(
      Object.keys(patch).map((field) => [
        field,
        baseline[field as keyof ForecastRoutingPatch] ?? null,
      ]),
    ) as ForecastRoutingPatch;
    if (item.type === "transaction")
      expected.account_id = baseline.account_id ?? null;
    try {
      await setForecastAccountRouting(item.type, item.id, patch, expected);
      if (currentScope.current === startedScope)
        setBaseline({ ...baseline, ...patch });
    } catch (caught) {
      if (currentScope.current === startedScope)
        setError(
          caught instanceof Error
            ? caught.message
            : "This account choice could not be saved.",
        );
    } finally {
      savingRef.current = false;
      if (currentScope.current === startedScope) setSaving(false);
    }
  };
  return (
    <View style={[styles.routingRow, { borderColor: c.border }]}>
      <Text style={[styles.routingName, { color: c.foreground }]}>
        {item.name}
      </Text>
      <Text style={[styles.detail, { color: c.mutedForeground }]}>
        {item.detail}
      </Text>
      {item.fields.map((field) => (
        <AccountForecastPicker
          key={field}
          label={
            field === "deposit_account_ref"
              ? item.type === "goal" && item.optional
                ? "Held in (optional)"
                : "Deposited to"
              : field === "funding_account_ref"
                ? "Paid from"
                : "Account"
          }
          value={
            (draft[field] as ForecastAccountRef | null | undefined) ?? null
          }
          onChange={(value) =>
            setDraft((previous) => ({ ...previous, [field]: value }))
          }
          disabled={!canEditHousehold || saving || !accountForecastReady}
        />
      ))}
      {item.optional ? (
        <Text style={[styles.detail, { color: c.mutedForeground }]}>
          A savings goal tracks progress. Linking it doesn’t schedule a deposit
          or create money.
        </Text>
      ) : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: c.destructive }]}
        >
          {error}
        </Text>
      ) : null}
      {changed && !saving ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Reload saved account for ${item.name}`}
          onPress={reloadSavedAccount}
          style={styles.action}
        >
          <Text style={[styles.actionText, { color: c.primary }]}>
            Reload saved account
          </Text>
        </Pressable>
      ) : null}
      {changed && canEditHousehold ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Save account for ${item.name}`}
          disabled={saving}
          onPress={() => void save()}
          style={[
            styles.save,
            { backgroundColor: c.primary, opacity: saving ? 0.6 : 1 },
          ]}
        >
          {saving ? (
            <ActivityIndicator color={c.primaryForeground} />
          ) : (
            <Text style={[styles.saveText, { color: c.primaryForeground }]}>
              Save account
            </Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

export function AccountForecastSettings({
  initialAccountRef,
  onEditManualAccount,
  onReconcileManualAccount,
}: {
  initialAccountRef?: ForecastAccountRef;
  onEditManualAccount?: (account: Account) => void;
  onReconcileManualAccount?: (account: Account) => void;
}) {
  const c = useColors();
  const {
    forecastAccounts,
    accountForecastReady,
    accountForecastError,
    activeHousehold,
    bills,
    incomes,
    goals,
    decisions,
    extraPayments,
    transactions,
    resolveTransactionAccountRef,
    canEditHousehold,
    householdTimeZone,
  } = useBudget();
  const [showAssignments, setShowAssignments] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  useEffect(() => {
    setShowAssignments(false);
    setSearch("");
    setOnlyUnassigned(true);
  }, [activeHousehold?.householdId]);
  const today = safeLocalDateInTimeZone(new Date(), householdTimeZone);
  const items = useMemo<RoutingItem[]>(
    () => [
      ...bills
        .filter(
          (item) =>
            (!item.end_date || item.end_date >= today) &&
            (!item.is_debt || item.balance > 0.005),
        )
        .map((item) => ({
          type: "bill" as const,
          id: item.id,
          name: item.name,
          detail: item.is_debt ? "Debt payment" : "Bill",
          funding: item.funding_account_ref,
          fields: ["funding_account_ref" as const],
        })),
      ...incomes.map((item) => ({
        type: "income" as const,
        id: item.id,
        name: item.name,
        detail: "Income",
        deposit: item.deposit_account_ref,
        fields: ["deposit_account_ref" as const],
      })),
      ...goals
        .filter((item) => !item.archived_at && !item.closed_at)
        .map((item) => ({
          type: "goal" as const,
          id: item.id,
          name: item.name,
          detail:
            item.goal_type === "savings"
              ? "Savings goal · progress only"
              : "Spending bucket",
          funding: item.funding_account_ref,
          deposit: item.deposit_account_ref,
          optional: item.goal_type === "savings",
          fields: [
            item.goal_type === "savings"
              ? ("deposit_account_ref" as const)
              : ("funding_account_ref" as const),
          ],
        })),
      ...decisions
        .filter(
          (item) => item.status === "planned" || item.status === "calendar",
        )
        .map((item) => ({
          type: "decision" as const,
          id: item.id,
          name: item.name,
          detail: "Calendar plan",
          funding: item.funding_account_ref,
          deposit: item.deposit_account_ref,
          fields:
            item.scenario.type === "savings_contribution"
              ? ["funding_account_ref" as const, "deposit_account_ref" as const]
              : [
                  item.scenario.type === "income_change"
                    ? ("deposit_account_ref" as const)
                    : ("funding_account_ref" as const),
                ],
        })),
      ...extraPayments.map((item) => ({
        type: "extra_payment" as const,
        id: item.id,
        name: `Extra debt payment · ${item.month + 1}/${item.year}`,
        detail: "Planned extra payment",
        funding: item.funding_account_ref,
        fields: ["funding_account_ref" as const],
      })),
      ...transactions
        .filter(
          (item) =>
            item.source !== "plaid" &&
            item.date >= today &&
            !item.deleted_at &&
            !item.removed_at &&
            !item.transfer_group_id,
        )
        .map((item) => ({
          type: "transaction" as const,
          id: item.id,
          name: item.note || item.category || "Activity",
          detail: `${item.date} · Planned activity`,
          forecast: resolveTransactionAccountRef(item),
          accountId: item.account_id,
          fields: ["forecast_account_ref" as const],
        })),
    ],
    [
      bills,
      incomes,
      goals,
      decisions,
      extraPayments,
      transactions,
      resolveTransactionAccountRef,
      today,
    ],
  );
  const validAccount = (ref: string | null | undefined) =>
    Boolean(
      ref &&
      forecastAccounts.some(
        (account) =>
          account.active &&
          !account.unavailableReason &&
          (account.ref === ref || account.aliases.includes(ref)),
      ),
    );
  const missing = (item: RoutingItem) =>
    !item.optional &&
    item.fields.some(
      (field) =>
        !validAccount(
          field === "funding_account_ref"
            ? item.funding
            : field === "deposit_account_ref"
              ? item.deposit
              : item.forecast,
        ),
    );
  const count = items.filter(missing).length;
  const visible = items.filter(
    (item) =>
      (!onlyUnassigned || missing(item)) &&
      (!search.trim() ||
        `${item.name} ${item.detail}`
          .toLowerCase()
          .includes(search.trim().toLowerCase())),
  );
  const activeAccounts = forecastAccounts.filter((account) => account.active);
  return (
    <View style={styles.container}>
      <View style={styles.sectionHeading}>
        <View style={styles.flex}>
          <Text style={[styles.heading, { color: c.foreground }]}>
            Accounts & forecasts
          </Text>
          <Text style={[styles.detail, { color: c.mutedForeground }]}>
            See where your money is going, account by account.
          </Text>
        </View>
        <Feather name="layers" size={22} color={c.primary} />
      </View>
      {accountForecastError ? (
        <View
          accessibilityRole="alert"
          style={[
            styles.notice,
            {
              backgroundColor: c.warning + "12",
              borderColor: c.warning + "40",
            },
          ]}
        >
          <Text style={[styles.detail, { color: c.foreground }]}>
            {accountForecastError}
          </Text>
        </View>
      ) : null}
      {!accountForecastReady ? (
        <View style={styles.loading}>
          <ActivityIndicator color={c.primary} />
          <Text style={[styles.detail, { color: c.mutedForeground }]}>
            Loading household accounts…
          </Text>
        </View>
      ) : null}
      {activeAccounts.map((account) => (
        <AccountPlanningCard
          key={`${activeHousehold?.householdId}:${account.ref}`}
          account={account}
          initialOpen={initialAccountRef === account.ref}
          onEditManualAccount={onEditManualAccount}
          onReconcileManualAccount={onReconcileManualAccount}
        />
      ))}
      {accountForecastReady && activeAccounts.length === 0 ? (
        <Text style={[styles.detail, { color: c.mutedForeground }]}>
          Connect a bank or add a manual account to see its forecast.
        </Text>
      ) : null}
      <View
        style={[
          styles.assignments,
          { backgroundColor: c.card, borderColor: c.border },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Assign accounts to planned activity"
          accessibilityState={{ expanded: showAssignments }}
          onPress={() => setShowAssignments((value) => !value)}
          style={styles.sectionHeading}
        >
          <View style={styles.flex}>
            <Text style={[styles.subheading, { color: c.foreground }]}>
              Plan accounts
            </Text>
            <Text style={[styles.detail, { color: c.mutedForeground }]}>
              {count
                ? `${count} ${count === 1 ? "item needs" : "items need"} an account`
                : "Review the accounts for your planned activity"}
            </Text>
          </View>
          <Feather
            name={showAssignments ? "chevron-up" : "chevron-down"}
            size={20}
            color={c.primary}
          />
        </Pressable>
        {showAssignments ? (
          <>
            <Text style={[styles.detail, { color: c.mutedForeground }]}>
              Choose where each payment comes from and where income arrives.
              Unassigned plans stay in the household plan.
            </Text>
            <View style={styles.filters}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: onlyUnassigned }}
                onPress={() => setOnlyUnassigned(true)}
                style={[
                  styles.filter,
                  {
                    backgroundColor: onlyUnassigned ? c.primary : c.background,
                    borderColor: c.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.actionText,
                    {
                      color: onlyUnassigned
                        ? c.primaryForeground
                        : c.foreground,
                    },
                  ]}
                >
                  Needs account
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: !onlyUnassigned }}
                onPress={() => setOnlyUnassigned(false)}
                style={[
                  styles.filter,
                  {
                    backgroundColor: !onlyUnassigned ? c.primary : c.background,
                    borderColor: c.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.actionText,
                    {
                      color: !onlyUnassigned
                        ? c.primaryForeground
                        : c.foreground,
                    },
                  ]}
                >
                  All plans
                </Text>
              </Pressable>
            </View>
            <TextInput
              accessibilityLabel="Search planned account assignments"
              value={search}
              onChangeText={setSearch}
              placeholder="Search plans"
              placeholderTextColor={c.mutedForeground}
              style={[
                styles.input,
                {
                  color: c.foreground,
                  backgroundColor: c.background,
                  borderColor: c.border,
                },
              ]}
            />
            {!canEditHousehold ? (
              <Text style={[styles.detail, { color: c.mutedForeground }]}>
                View only. A household editor can assign accounts.
              </Text>
            ) : null}
            {visible.map((item) => (
              <RoutingRow
                key={`${activeHousehold?.householdId}:${item.type}:${item.id}`}
                item={item}
              />
            ))}
            {visible.length === 0 ? (
              <Text style={[styles.detail, { color: c.mutedForeground }]}>
                {onlyUnassigned
                  ? "No matching plans need an account."
                  : "No matching plans."}
              </Text>
            ) : null}
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 14 },
  flex: { flex: 1, minWidth: 0 },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  heading: { fontSize: 20, fontFamily: "Inter_700Bold" },
  subheading: { fontSize: 17, fontFamily: "Inter_700Bold" },
  detail: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },
  accountCard: { padding: 16, borderRadius: 20, borderWidth: 1, gap: 12 },
  accountHeader: { flexDirection: "row", gap: 11, alignItems: "center" },
  accountIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
  },
  accountName: { fontSize: 16, lineHeight: 22, fontFamily: "Inter_700Bold" },
  balanceRow: { flexDirection: "row", gap: 18 },
  balance: { flex: 1, minWidth: 0, gap: 5 },
  smallLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  balanceValue: {
    flexShrink: 0,
    fontSize: 20,
    fontFamily: "Inter_800ExtraBold",
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: {
    minHeight: 40,
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  actionText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  editor: { borderTopWidth: 1, paddingTop: 14, gap: 9 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 5 },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  save: {
    minHeight: 44,
    borderRadius: 12,
    padding: 11,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 4,
  },
  saveText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  error: { fontSize: 12, lineHeight: 18 },
  notice: { borderRadius: 14, borderWidth: 1, padding: 13 },
  loading: { padding: 18, flexDirection: "row", gap: 10, alignItems: "center" },
  assignments: { borderRadius: 20, borderWidth: 1, padding: 16, gap: 14 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filter: {
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  routingRow: { borderTopWidth: 1, paddingTop: 15, gap: 9 },
  routingName: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_700Bold" },
});
