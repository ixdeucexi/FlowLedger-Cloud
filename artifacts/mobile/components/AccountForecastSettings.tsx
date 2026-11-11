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
import { PlannedTransferManager } from "@/components/PlannedTransferManager";
import { AccountNameModal } from "@/components/AccountNameModal";
import { useBudget, type Account } from "@/context/BudgetContext";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import type {
  ForecastAccountDescriptor,
  ForecastAccountRef,
  ForecastRoutingEntity,
  ForecastRoutingPatch,
  ForecastRoutingChange,
} from "@/lib/accountForecasts";
import { resolveForecastAccountReference } from "@/lib/accountForecasts";
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
  readOnlyReason?: string;
  date?: string;
  amount?: number;
}

function AccountPlanningCard({
  account,
  initialOpen,
  onEditManualAccount,
  onReconcileManualAccount,
  onNavigate,
}: {
  account: ForecastAccountDescriptor;
  initialOpen: boolean;
  onEditManualAccount?: (account: Account) => void;
  onReconcileManualAccount?: (account: Account) => void;
  onNavigate?: () => void;
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
  const [renaming, setRenaming] = useState(false);
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
      (item) =>
        item.account_ref === account.ref ||
        account.aliases.includes(item.account_ref),
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
    setRenaming(false);
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
            Show in Forecast menu
          </Text>
          <Text style={[styles.detail, { color: c.mutedForeground }]}>
            Show this account in your Forecast menu.
          </Text>
        </View>
        <Switch
          accessibilityLabel={`Show ${account.name} in Forecast menu`}
          value={forecastVisible}
          disabled={visibilitySaving || !forecastVisibilityReady}
          onValueChange={(value) => void changeVisibility(value)}
          trackColor={{ false: c.border, true: c.primary }}
        />
      </View>
      {forecastVisibilityError ? (
        <Text
          accessibilityRole="alert"
          style={[styles.detail, { color: c.warning }]}
        >
          {forecastVisibilityError}
        </Text>
      ) : null}
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
            onNavigate?.();
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
        {canEditHousehold ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Rename ${account.name}`}
            disabled={
              saving ||
              !accountForecastReady ||
              !account.active ||
              Boolean(account.unavailableReason)
            }
            onPress={() => setRenaming(true)}
            style={[styles.action, { borderColor: c.border }]}
          >
            <Feather name="edit-2" size={14} color={c.primary} />
            <Text style={[styles.actionText, { color: c.primary }]}>
              Rename
            </Text>
          </Pressable>
        ) : null}
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
      <AccountNameModal
        account={renaming ? account : null}
        onClose={() => setRenaming(false)}
      />
    </View>
  );
}

function RoutingRow({
  item,
  disabled = false,
  onOpenActivity,
}: {
  item: RoutingItem;
  disabled?: boolean;
  onOpenActivity?: () => void;
}) {
  const c = useColors();
  const { user } = useAuth();
  const router = useRouter();
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
      disabled ||
      !accountForecastReady ||
      Boolean(item.readOnlyReason) ||
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
          disabled={
            !canEditHousehold ||
            saving ||
            disabled ||
            !accountForecastReady ||
            Boolean(item.readOnlyReason)
          }
        />
      ))}
      {item.readOnlyReason ? (
        <Text style={[styles.detail, { color: c.warning }]}>
          {item.readOnlyReason}
        </Text>
      ) : null}
      {item.readOnlyReason && item.type === "transaction" ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            onOpenActivity?.();
            router.push({
              pathname: "/(tabs)/transactions",
              params: {
                activityId: item.id,
                activityDate: item.date,
                activityAt: String(Date.now()),
              },
            });
          }}
          style={styles.reload}
        >
          <Text style={[styles.actionText, { color: c.primary }]}>
            Review in Activity
          </Text>
        </Pressable>
      ) : null}
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
      {changed && canEditHousehold && !disabled && !item.readOnlyReason ? (
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

type BatchSelection = { item: RoutingItem; expected: ForecastRoutingPatch };
type BatchReview = {
  scope: string;
  ref: ForecastAccountRef;
  name: string;
  changes: ForecastRoutingChange[];
  rows: RoutingItem[];
};
const planKey = (item: Pick<RoutingItem, "type" | "id">) =>
  `${item.type}:${item.id}`;
const sourceValue = (
  item: RoutingItem,
  field: RoutingItem["fields"][number],
) =>
  field === "funding_account_ref"
    ? (item.funding ?? null)
    : field === "deposit_account_ref"
      ? (item.deposit ?? null)
      : (item.forecast ?? null);
const batchEligible = (item: RoutingItem) =>
  item.type !== "transaction" &&
  item.fields.length === 1 &&
  item.fields[0] !== "forecast_account_ref" &&
  !item.readOnlyReason;

export function AccountForecastSettings({
  initialAccountRef,
  initialSection = "accounts",
  month,
  year,
  onEditManualAccount,
  onReconcileManualAccount,
  onNavigate,
}: {
  initialAccountRef?: ForecastAccountRef;
  initialSection?: "accounts" | "assignments";
  month?: number;
  year?: number;
  onEditManualAccount?: (account: Account) => void;
  onReconcileManualAccount?: (account: Account) => void;
  onNavigate?: () => void;
}) {
  const c = useColors();
  const { user } = useAuth();
  const {
    forecastAccounts,
    accountForecastReady,
    accountForecastError,
    activeHousehold,
    canEditHousehold,
    getForecastPlanCoverage,
    setForecastAccountRoutingBatch,
    settings,
    householdTimeZone,
    retryBudgetLoad,
  } = useBudget();
  const today = safeLocalDateInTimeZone(new Date(), householdTimeZone);
  const [currentYear, currentMonth] = today.split("-").map(Number);
  const defaultEnd = new Date(
    currentYear,
    currentMonth - 1 + Math.max(12, settings.forecast_horizon_months) - 1,
    1,
  );
  const coverageMonth = month ?? defaultEnd.getMonth(),
    coverageYear = year ?? defaultEnd.getFullYear();
  const coverage = useMemo(
    () =>
      getForecastPlanCoverage(
        coverageMonth,
        coverageYear,
        initialAccountRef ?? null,
      ),
    [getForecastPlanCoverage, coverageMonth, coverageYear, initialAccountRef],
  );
  const items: RoutingItem[] = coverage.plans;
  const missingKeys = new Set(coverage.unassigned.map((item) => planKey(item)));
  const scope = `${user?.id ?? "demo"}:${activeHousehold?.householdId ?? "personal"}:${activeHousehold?.budgetId ?? "budget"}:${initialAccountRef ?? "household"}:${coverageYear}-${coverageMonth}`;
  const accessRef = useRef({ scope, canEdit: canEditHousehold });
  accessRef.current = { scope, canEdit: canEditHousehold };
  const [showAssignments, setShowAssignments] = useState(
    initialSection === "assignments",
  );
  const [showAccounts, setShowAccounts] = useState(
    initialSection === "accounts",
  );
  const [manualAccountsOpen, setManualAccountsOpen] = useState(false);
  const [showTransfers, setShowTransfers] = useState(false);
  const [showAllAccountCards, setShowAllAccountCards] =
    useState(!initialAccountRef);
  const [search, setSearch] = useState("");
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const [typeFilter, setTypeFilter] = useState<ForecastRoutingEntity | "all">(
    "all",
  );
  const [selected, setSelected] = useState<Record<string, BatchSelection>>({});
  const [destination, setDestination] = useState<ForecastAccountRef | null>(
    null,
  );
  const [review, setReview] = useState<BatchReview | null>(null);
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchSuccess, setBatchSuccess] = useState<string | null>(null);
  const batchSavingRef = useRef(false);
  useEffect(() => {
    setShowAssignments(initialSection === "assignments");
    setShowAccounts(initialSection === "accounts");
    setShowAllAccountCards(!initialAccountRef);
    setManualAccountsOpen(false);
    setShowTransfers(false);
    setSearch("");
    setOnlyUnassigned(true);
    setTypeFilter("all");
    setSelected({});
    setDestination(null);
    setReview(null);
    setBatchError(null);
    setBatchSuccess(null);
    setBatchSaving(false);
  }, [scope, initialSection, initialAccountRef, coverageMonth, coverageYear]);
  const contextAccount = forecastAccounts.find(
    (account) =>
      account.ref === initialAccountRef ||
      Boolean(initialAccountRef && account.aliases.includes(initialAccountRef)),
  );
  const visible = items.filter(
    (item) =>
      (!onlyUnassigned || missingKeys.has(planKey(item))) &&
      (typeFilter === "all" || item.type === typeFilter) &&
      (!search.trim() ||
        `${item.name} ${item.detail}`
          .toLowerCase()
          .includes(search.trim().toLowerCase())),
  );
  const activeAccounts = forecastAccounts.filter((account) => account.active);
  const count = coverage.unassigned.length;
  const selectedRows = Object.values(selected);
  const toggleRow = (item: RoutingItem) => {
    if (
      batchSavingRef.current ||
      !canEditHousehold ||
      !accountForecastReady ||
      !batchEligible(item)
    )
      return;
    setReview(null);
    setBatchError(null);
    setBatchSuccess(null);
    setSelected((previous) => {
      const key = planKey(item),
        next = { ...previous };
      if (next[key]) delete next[key];
      else if (Object.keys(next).length < 100)
        next[key] = {
          item: { ...item },
          expected: { [item.fields[0]]: sourceValue(item, item.fields[0]) },
        };
      return next;
    });
  };
  const selectShown = () => {
    if (batchSavingRef.current || !canEditHousehold || !accountForecastReady)
      return;
    setReview(null);
    setBatchError(null);
    setBatchSuccess(null);
    setSelected((previous) => {
      const next = { ...previous };
      for (const item of visible.filter(batchEligible))
        if (!next[planKey(item)] && Object.keys(next).length < 100)
          next[planKey(item)] = {
            item: { ...item },
            expected: { [item.fields[0]]: sourceValue(item, item.fields[0]) },
          };
      return next;
    });
  };
  const reviewSelection = () => {
    if (
      batchSavingRef.current ||
      !canEditHousehold ||
      !accountForecastReady ||
      accessRef.current.scope !== scope ||
      !selectedRows.length
    )
      return;
    const ref = resolveForecastAccountReference(destination, forecastAccounts),
      account = forecastAccounts.find((row) => row.ref === ref);
    if (!ref || !account) {
      setBatchError("Choose the account for these plans.");
      return;
    }
    const rows = selectedRows.filter(
      ({ item, expected }) =>
        resolveForecastAccountReference(
          expected[item.fields[0]],
          forecastAccounts,
        ) !== ref,
    );
    if (!rows.length) {
      setBatchError("These plans are already assigned to that account.");
      return;
    }
    const changes: ForecastRoutingChange[] = rows.map(({ item, expected }) => ({
      entityType: item.type as ForecastRoutingChange["entityType"],
      entityId: item.id,
      expected,
      patch: { [item.fields[0]]: ref },
    }));
    setReview({
      scope,
      ref,
      name: accountForecastLabel(account),
      changes,
      rows: rows.map((row) => row.item),
    });
    setBatchError(null);
  };
  const saveBatch = async () => {
    if (
      !review ||
      batchSavingRef.current ||
      accessRef.current.scope !== review.scope ||
      !accessRef.current.canEdit ||
      !accountForecastReady ||
      !resolveForecastAccountReference(review.ref, forecastAccounts)
    )
      return;
    const intent = review;
    batchSavingRef.current = true;
    setBatchSaving(true);
    setBatchError(null);
    try {
      await setForecastAccountRoutingBatch(intent.changes);
      if (accessRef.current.scope === intent.scope) {
        setSelected({});
        setReview(null);
        setDestination(null);
        setBatchSuccess(
          `Updated ${intent.changes.length} plan ${intent.changes.length === 1 ? "account" : "accounts"}.`,
        );
      }
    } catch (caught) {
      if (accessRef.current.scope === intent.scope)
        setBatchError(
          caught instanceof Error
            ? caught.message
            : "These account choices could not be saved.",
        );
    } finally {
      batchSavingRef.current = false;
      if (accessRef.current.scope === intent.scope) setBatchSaving(false);
    }
  };
  const assignments = (
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
        aria-expanded={showAssignments}
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
              : items.length
                ? "Upcoming plans have an account"
                : "No upcoming plans in this range"}
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
            {contextAccount
              ? `Setting up ${accountForecastLabel(contextAccount)}. `
              : ""}
            Upcoming activity from {coverage.startDate} through{" "}
            {coverage.endDate}. Unassigned plans stay in the Household plan
            until saved.
          </Text>
          <View accessibilityRole="radiogroup" style={styles.filters}>
            {[
              { label: "Needs account", value: true },
              { label: "All plans", value: false },
            ].map((option) => (
              <Pressable
                key={option.label}
                accessibilityRole="radio"
                accessibilityState={{
                  checked: onlyUnassigned === option.value,
                }}
                aria-checked={onlyUnassigned === option.value}
                disabled={batchSaving}
                onPress={() => setOnlyUnassigned(option.value)}
                style={[
                  styles.filter,
                  {
                    backgroundColor:
                      onlyUnassigned === option.value
                        ? c.primary
                        : c.background,
                    borderColor: c.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.actionText,
                    {
                      color:
                        onlyUnassigned === option.value
                          ? c.primaryForeground
                          : c.foreground,
                    },
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.typeFilters}
          >
            {(
              [
                { value: "all", label: "All types" },
                { value: "bill", label: "Bills & debts" },
                { value: "income", label: "Income" },
                { value: "goal", label: "Buckets" },
                { value: "decision", label: "Calendar plans" },
                { value: "extra_payment", label: "Extra payments" },
                { value: "transaction", label: "Activity" },
              ] as const
            ).map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: typeFilter === option.value }}
                aria-checked={typeFilter === option.value}
                disabled={batchSaving}
                onPress={() => setTypeFilter(option.value)}
                style={[
                  styles.filter,
                  {
                    backgroundColor:
                      typeFilter === option.value
                        ? c.primary + "20"
                        : c.background,
                    borderColor:
                      typeFilter === option.value ? c.primary : c.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.actionText,
                    {
                      color:
                        typeFilter === option.value ? c.primary : c.foreground,
                    },
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <TextInput
            accessibilityLabel="Search planned account assignments"
            value={search}
            onChangeText={setSearch}
            editable={!batchSaving}
            placeholder="Search upcoming plans"
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
          {canEditHousehold &&
          (visible.some(batchEligible) || selectedRows.length > 0) ? (
            <View style={[styles.batchSetup, { borderColor: c.border }]}>
              <Text style={[styles.fieldLabel, { color: c.foreground }]}>
                Set up several plans
              </Text>
              <Text style={[styles.detail, { color: c.mutedForeground }]}>
                Select plans, choose one account, then review before saving.
                Transfers and Activity are handled individually.
              </Text>
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={batchSaving || !accountForecastReady}
                  onPress={selectShown}
                  style={[styles.action, { borderColor: c.border }]}
                >
                  <Text style={[styles.actionText, { color: c.primary }]}>
                    Select shown · up to 100
                  </Text>
                </Pressable>
                {selectedRows.length ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={batchSaving}
                    onPress={() => {
                      setSelected({});
                      setReview(null);
                      setBatchError(null);
                    }}
                    style={[styles.action, { borderColor: c.border }]}
                  >
                    <Text
                      style={[styles.actionText, { color: c.mutedForeground }]}
                    >
                      Clear {selectedRows.length} selected
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              {selectedRows.length ? (
                <>
                  <AccountForecastPicker
                    label="Assign selected plans to"
                    value={destination}
                    onChange={(value) => {
                      setDestination(value);
                      setReview(null);
                      setBatchError(null);
                    }}
                    includeHousehold={false}
                    allowUnassigned={false}
                    disabled={batchSaving}
                  />
                  <Pressable
                    accessibilityRole="button"
                    disabled={batchSaving || !destination}
                    onPress={reviewSelection}
                    style={[
                      styles.save,
                      {
                        backgroundColor: c.primary,
                        opacity: destination ? 1 : 0.5,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.saveText, { color: c.primaryForeground }]}
                    >
                      Review {selectedRows.length} account choices
                    </Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          ) : null}
          {review ? (
            <View
              style={[
                styles.batchReview,
                { borderColor: c.primary, backgroundColor: c.primary + "0b" },
              ]}
            >
              <Text style={[styles.subheading, { color: c.foreground }]}>
                Review account choices
              </Text>
              <Text style={[styles.detail, { color: c.foreground }]}>
                {review.changes.length}{" "}
                {review.changes.length === 1 ? "plan" : "plans"} → {review.name}
              </Text>
              <Text style={[styles.detail, { color: c.mutedForeground }]}>
                Only the payment or deposit account will change. Amounts and
                dates stay the same.
              </Text>
              <ScrollView
                style={{ maxHeight: 180 }}
                contentContainerStyle={{ gap: 6 }}
              >
                {review.rows.map((item) => (
                  <Text
                    key={planKey(item)}
                    style={[styles.detail, { color: c.foreground }]}
                  >
                    {item.name}
                    {item.date ? ` · ${item.date}` : ""}
                  </Text>
                ))}
              </ScrollView>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Save ${review.changes.length} reviewed account choices`}
                disabled={batchSaving || !canEditHousehold}
                onPress={() => void saveBatch()}
                style={[
                  styles.save,
                  {
                    backgroundColor: c.primary,
                    opacity: batchSaving ? 0.6 : 1,
                  },
                ]}
              >
                {batchSaving ? (
                  <ActivityIndicator color={c.primaryForeground} />
                ) : (
                  <Text
                    style={[styles.saveText, { color: c.primaryForeground }]}
                  >
                    Save these account choices
                  </Text>
                )}
              </Pressable>
            </View>
          ) : null}
          {batchError ? (
            <View>
              <Text
                accessibilityRole="alert"
                style={[styles.error, { color: c.destructive }]}
              >
                {batchError}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={batchSaving}
                onPress={() => {
                  setSelected({});
                  setReview(null);
                  setBatchError(null);
                  retryBudgetLoad();
                }}
                style={styles.reload}
              >
                <Text style={[styles.actionText, { color: c.primary }]}>
                  Reload latest plans
                </Text>
              </Pressable>
            </View>
          ) : null}
          {batchSuccess ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.detail, { color: c.success }]}
            >
              {batchSuccess}
            </Text>
          ) : null}
          {visible.map((item) => (
            <View key={`${scope}:${planKey(item)}`} style={{ gap: 4 }}>
              {canEditHousehold && batchEligible(item) ? (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={`Select ${item.name} for account setup`}
                  accessibilityState={{
                    checked: Boolean(selected[planKey(item)]),
                    disabled: batchSaving,
                  }}
                  aria-checked={Boolean(selected[planKey(item)])}
                  disabled={batchSaving || !accountForecastReady}
                  onPress={() => toggleRow(item)}
                  style={styles.selection}
                >
                  <Feather
                    name={selected[planKey(item)] ? "check-square" : "square"}
                    size={20}
                    color={c.primary}
                  />
                  <Text
                    style={[styles.actionText, { color: c.mutedForeground }]}
                  >
                    Select for setup
                  </Text>
                </Pressable>
              ) : null}
              <RoutingRow
                item={item}
                disabled={batchSaving}
                onOpenActivity={onNavigate}
              />
            </View>
          ))}
          {!visible.length ? (
            <Text style={[styles.detail, { color: c.mutedForeground }]}>
              {onlyUnassigned
                ? "No matching upcoming plans need an account."
                : "No matching upcoming plans."}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
  const accountsSection = (
    <View style={{ gap: 14 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showAccounts }}
        aria-expanded={showAccounts}
        onPress={() => setShowAccounts((value) => !value)}
        style={styles.sectionHeading}
      >
        <View style={styles.flex}>
          <Text style={[styles.subheading, { color: c.foreground }]}>
            {contextAccount && !showAllAccountCards
              ? `Settings for ${contextAccount.name}`
              : "Your accounts"}
          </Text>
          <Text style={[styles.detail, { color: c.mutedForeground }]}>
            Names, menu visibility, and planning settings
          </Text>
        </View>
        <Feather
          name={showAccounts ? "chevron-up" : "chevron-down"}
          size={20}
          color={c.primary}
        />
      </Pressable>
      {showAccounts ? (
        <>
          {(["bank", "manual"] as const).map((source) => {
            const rows = (
              contextAccount && !showAllAccountCards
                ? [contextAccount]
                : activeAccounts
            ).filter((account) => account.source === source);
            if (!rows.length) return null;
            const expanded =
              source === "bank" ||
              manualAccountsOpen ||
              contextAccount?.source === "manual" ||
              !activeAccounts.some((account) => account.source === "bank");
            return (
              <View key={source} style={{ gap: 12 }}>
                {source === "manual" ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Manual accounts (${rows.length})`}
                    accessibilityState={{ expanded }}
                    aria-expanded={expanded}
                    onPress={() => setManualAccountsOpen((value) => !value)}
                    style={styles.sectionHeading}
                  >
                    <View style={styles.flex}>
                      <Text
                        style={[styles.fieldLabel, { color: c.foreground }]}
                      >
                        Manual accounts ({rows.length})
                      </Text>
                      <Text
                        style={[styles.detail, { color: c.mutedForeground }]}
                      >
                        Added in FlowLedger · not bank connections
                      </Text>
                    </View>
                    <Feather
                      name={expanded ? "chevron-up" : "chevron-down"}
                      size={18}
                      color={c.primary}
                    />
                  </Pressable>
                ) : (
                  <Text
                    style={[styles.fieldLabel, { color: c.mutedForeground }]}
                  >
                    Connected accounts ({rows.length})
                  </Text>
                )}
                {expanded
                  ? rows.map((account) => (
                      <AccountPlanningCard
                        key={`${scope}:${account.ref}`}
                        account={account}
                        initialOpen={
                          initialSection === "accounts" &&
                          initialAccountRef === account.ref
                        }
                        onEditManualAccount={onEditManualAccount}
                        onReconcileManualAccount={onReconcileManualAccount}
                        onNavigate={onNavigate}
                      />
                    ))
                  : null}
              </View>
            );
          })}
          {contextAccount && activeAccounts.length > 1 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowAllAccountCards((value) => !value)}
              style={[styles.action, { borderColor: c.border }]}
            >
              <Text style={[styles.actionText, { color: c.primary }]}>
                {showAllAccountCards
                  ? `Only ${contextAccount.name}`
                  : "Show all accounts"}
              </Text>
            </Pressable>
          ) : null}
          {accountForecastReady && !activeAccounts.length ? (
            <Text style={[styles.detail, { color: c.mutedForeground }]}>
              Connect a bank or add a manual account to see its forecast.
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
  return (
    <View style={styles.container}>
      <View style={styles.sectionHeading}>
        <View style={styles.flex}>
          <Text style={[styles.heading, { color: c.foreground }]}>
            {initialSection === "assignments"
              ? "Assign plan accounts"
              : "Accounts & forecasts"}
          </Text>
          <Text style={[styles.detail, { color: c.mutedForeground }]}>
            {initialSection === "assignments"
              ? "Choose where upcoming payments and deposits belong."
              : "Name your accounts and see where your money is going."}
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
      {initialSection === "accounts" && count > 0 && !showAssignments ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setShowAssignments(true);
            setShowAccounts(false);
          }}
          style={[
            styles.notice,
            {
              backgroundColor: c.primary + "12",
              borderColor: c.primary + "40",
            },
          ]}
        >
          <View style={styles.flex}>
            <Text style={[styles.fieldLabel, { color: c.foreground }]}>
              {count} upcoming {count === 1 ? "plan needs" : "plans need"} an
              account
            </Text>
            <Text style={[styles.detail, { color: c.mutedForeground }]}>
              Set up payment and deposit accounts
            </Text>
          </View>
          <Feather name="arrow-right" size={18} color={c.primary} />
        </Pressable>
      ) : null}
      {initialSection === "assignments" ? (
        <>
          {assignments}
          {accountsSection}
        </>
      ) : (
        <>
          {accountsSection}
          {assignments}
        </>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Planned account transfers"
        accessibilityState={{ expanded: showTransfers }}
        aria-expanded={showTransfers}
        onPress={() => setShowTransfers((value) => !value)}
        style={styles.sectionHeading}
      >
        <View style={styles.flex}>
          <Text style={[styles.subheading, { color: c.foreground }]}>
            Planned account transfers
          </Text>
          <Text style={[styles.detail, { color: c.mutedForeground }]}>
            Choose where money will move each month
          </Text>
        </View>
        <Feather
          name={showTransfers ? "chevron-up" : "chevron-down"}
          size={20}
          color={c.primary}
        />
      </Pressable>
      {showTransfers ? (
        <PlannedTransferManager
          accountRef={initialAccountRef}
          month={month}
          year={year}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 14 },
  typeFilters: { gap: 8, paddingVertical: 3 },
  batchSetup: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  batchReview: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  selection: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  reload: { paddingVertical: 9 },
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
