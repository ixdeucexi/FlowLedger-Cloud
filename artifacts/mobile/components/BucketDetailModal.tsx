import { moneyPrivacySearchSensitive } from "@/lib/moneyPrivacy";
import { PrivacyPressable as Pressable, PrivacyText as Text, PrivacyTextInput as TextInput, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import { createTransactionNameResolver } from "@/lib/transactionNames";
import Feather from "@expo/vector-icons/Feather";
import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Modal, ScrollView, StyleSheet } from "react-native";

import { AddTransactionModal } from "@/components/AddTransactionModal";
import { GoalModal } from "@/components/GoalModal";
import { useAuth } from "@/context/AuthContext";
import { useBudget, type Goal } from "@/context/BudgetContext";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import { bucketPurchaseCandidates, bucketPurchaseHistory } from "@/lib/bucketPurchases";
import { createPlaidTransactionAccountKindClassifier } from "@/lib/billMatching";
import { DESKTOP_MODAL_OVERLAY, DESKTOP_MODAL_REGULAR } from "@/lib/desktopModal";
import { localDateString } from "@/lib/dateLabels";
import { spendingBucketSummary } from "@/lib/spendingBuckets";

type Props = {
  bucketId: string;
  suspended?: boolean;
  busy?: boolean;
  routed?: boolean;
  onClose: () => void;
  onCloseBucket: (goal: Goal) => void;
  onConfirmCloseBucket: (goal: Goal) => Promise<boolean>;
  onReopenBucket: (goal: Goal) => void | Promise<void>;
};
type Screen = "detail" | "add" | "record" | "budget";
const money = (value: number) => `$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function purchaseDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** A bucket owns its purchase journey; the transaction and goal editors remain
 * the same scoped editors used elsewhere in the app. */
export function BucketDetailModal({ bucketId, suspended = false, busy = false, routed = false, onClose, onCloseBucket, onConfirmCloseBucket, onReopenBucket }: Props) {
  const c = useColors();
  const desktop = useDesktopExperience();
  const { user } = useAuth();
  const { bills, incomes, goals, transactions, transactionAccountIdentities, activeHousehold, canEditHousehold, addBucketPurchase, removeBucketPurchase, updateGoal } = useBudget();
  const purchaseName = useMemo(() => createTransactionNameResolver(bills, incomes), [bills, incomes]);
  const goal = goals.find(item => item.id === bucketId && item.goal_type === "planned_expense");
  const [screen, setScreen] = useState<Screen>("detail");
  const [kind, setKind] = useState<"bank" | "manual" | null>(null);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(40);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const recordId = useRef<string | null>(null);
  const scope = `${user?.id ?? "demo"}:${activeHousehold?.householdId ?? "personal"}:${activeHousehold?.budgetId ?? "personal"}`;
  const originalScope = useRef(scope);
  const access = useRef({ scope, canEdit: canEditHousehold, goal, routed });
  access.current = { scope, canEdit: canEditHousehold, goal, routed };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!canEditHousehold) {
      setScreen("detail"); setSelectedId(null); setRemoveId(null); setConfirmClose(false); setError(null); recordId.current = null;
    }
  }, [canEditHousehold]);
  const isCurrent = () => mounted.current && access.current.scope === originalScope.current;
  const assertEditable = () => {
    const live = access.current;
    if (!isCurrent() || !live.canEdit || !live.goal) throw new Error("Your household or editing access changed. Open the bucket again.");
    if (live.goal.archived_at) throw new Error("Restore this bucket before changing its purchases.");
    if (live.goal.closed_at || live.routed) throw new Error("Reopen this bucket before changing its purchases.");
    return live.goal;
  };
  const summary = spendingBucketSummary(goal ?? { target_amount: 0, current_amount: 0 });
  const mutable = Boolean(canEditHousehold && goal && !goal.archived_at && !goal.closed_at && !routed);
  const pending = saving || busy;
  const managementBlocked = pending || confirmClose;
  const activeScreen = canEditHousehold ? screen : "detail";
  const mainVisible = Boolean(goal && !suspended && activeScreen !== "record" && activeScreen !== "budget");
  const deferredSearch = useDeferredValue(search);
  const classifyAccount = useMemo(() => createPlaidTransactionAccountKindClassifier(transactionAccountIdentities), [transactionAccountIdentities]);
  const candidates = useMemo(() => kind ? bucketPurchaseCandidates(transactions, kind, deferredSearch).filter(tx => tx.source !== "plaid" || classifyAccount(tx) === "checking") : [], [transactions, kind, deferredSearch, classifyAccount]);
  const history = useMemo(() => bucketPurchaseHistory(transactions, bucketId), [transactions, bucketId]);
  const earlierSpending = Math.max(0, Math.round((summary.spent - history.reduce((sum, row) => sum + row.allocated, 0)) * 100) / 100);
  const selected = selectedId ? transactions.find(item => item.id === selectedId) : undefined;
  const selectedCost = Math.abs(selected?.amount ?? 0);
  const tooLarge = selectedCost > summary.remaining + 0.005;
  const initialRecordValues = useMemo(() => ({ note: goal ? `${goal.name} purchase` : "", category: "Other" }), [goal?.name]);

  const back = () => {
    if (inFlight.current || busy) return;
    setError(null);
    if (confirmClose) setConfirmClose(false);
    else if (removeId) setRemoveId(null);
    else if (activeScreen === "add") { setScreen("detail"); setSelectedId(null); }
    else onClose();
  };
  useBackDismiss(mainVisible, back, true, activeScreen === "add" || Boolean(removeId) || confirmClose);

  const openAdd = () => {
    if (!mutable || pending || confirmClose || summary.remaining <= 0.005) return;
    setError(null); setNotice(null); setKind(null); setSelectedId(null); setSearch(""); setLimit(40); setScreen("add");
  };
  const chooseKind = (next: "bank" | "manual") => {
    if (pending) return;
    setKind(next); setSearch(""); setSelectedId(null); setLimit(40); setError(null);
  };
  const openRecord = () => {
    if (!mutable || pending || confirmClose) return;
    setConfirmClose(false);
    recordId.current = `bucket-purchase-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setScreen("record"); setError(null);
  };
  const addExisting = async () => {
    if (!selected || !kind || inFlight.current || busy) return;
    inFlight.current = true; setSaving(true); setError(null);
    try {
      const live = assertEditable();
      const candidate = bucketPurchaseCandidates(transactions, kind).find(item => item.id === selected.id && (item.source !== "plaid" || classifyAccount(item) === "checking"));
      if (!candidate) throw new Error("This transaction is no longer available. Choose another purchase.");
      if (Math.abs(candidate.amount) > spendingBucketSummary(live).remaining + 0.005) throw new Error("This purchase is more than the money left. Adjust the bucket budget first.");
      await addBucketPurchase({ bucketId, transactionId: candidate.id });
      if (isCurrent()) { setScreen("detail"); setSelectedId(null); setNotice("Purchase added. Your bucket stays open."); }
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : "Couldn’t add this purchase. Please try again.");
    } finally { inFlight.current = false; if (isCurrent()) setSaving(false); }
  };
  const removePurchase = async () => {
    if (!removeId || inFlight.current || busy) return;
    inFlight.current = true; setSaving(true); setError(null);
    try {
      assertEditable();
      await removeBucketPurchase(removeId);
      if (isCurrent()) { setRemoveId(null); setNotice("Purchase removed from this bucket. The transaction stays in Activity."); }
    } catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : "Couldn’t remove this purchase. Please try again."); }
    finally { inFlight.current = false; if (isCurrent()) setSaving(false); }
  };
  const confirmFullClose = async () => {
    if (inFlight.current || busy || !confirmClose) return;
    inFlight.current = true; setSaving(true); setError(null);
    try {
      const live = assertEditable();
      if (spendingBucketSummary(live).remaining > 0.005) {
        setConfirmClose(false);
        setNotice("Bucket budget changed. Review the remaining amount and choose Close bucket again.");
        return;
      }
      const closed = await onConfirmCloseBucket(live);
      if (closed && isCurrent()) setConfirmClose(false);
    } catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : "Couldn’t close this bucket. Please try again."); }
    finally { inFlight.current = false; if (isCurrent()) setSaving(false); }
  };
  if (!goal) return null;

  return <>
    <Modal visible={mainVisible} transparent animationType={desktop ? "fade" : "slide"} onRequestClose={back}>
      <View style={[styles.overlay, desktop && DESKTOP_MODAL_OVERLAY]}>
        <Pressable accessibilityRole="button" accessibilityLabel={confirmClose ? "Cancel closing bucket" : "Close bucket details"} disabled={pending} onPress={() => { if (!pending) { if (confirmClose) setConfirmClose(false); else onClose(); } }} style={StyleSheet.absoluteFillObject} />
        <View style={[styles.sheet, { backgroundColor: c.background, borderColor: c.border }, desktop && DESKTOP_MODAL_REGULAR]}>
          <View style={styles.header}>
            {activeScreen === "add" ? <Pressable accessibilityRole="button" accessibilityLabel="Back to bucket details" disabled={pending} onPress={back} style={styles.iconButton}><Feather name="arrow-left" size={21} color={c.foreground} /></Pressable> : <View style={[styles.headingIcon, { backgroundColor: c.primary + "18" }]}><Feather name="shopping-bag" size={21} color={c.primary} /></View>}
            <View style={styles.headerCopy}>
              <Text style={[styles.eyebrow, { color: c.mutedForeground }]}>{activeScreen === "add" ? "ADD PURCHASE" : goal.archived_at ? "ARCHIVED BUCKET" : goal.closed_at ? "CLOSED BUCKET" : "SPENDING BUCKET"}</Text>
              <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>{goal.name}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={confirmClose ? "Cancel closing bucket" : "Close bucket details"} disabled={pending} onPress={() => { if (!pending) { if (confirmClose) setConfirmClose(false); else onClose(); } }} style={styles.iconButton}><Feather name="x" size={21} color={c.mutedForeground} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content} showsVerticalScrollIndicator={desktop}>
            {activeScreen === "detail" ? <>
              <View style={[styles.metrics, !desktop && styles.metricsCompact, { backgroundColor: c.card, borderColor: c.border }]}>
                {[{ label: "Planned", value: summary.planned, color: c.foreground }, { label: "Spent", value: summary.spent, color: c.foreground }, { label: summary.closed ? "Released" : "Remaining", value: summary.closed ? summary.released : summary.remaining, color: summary.closed ? c.mutedForeground : c.success }].map(item => <View key={item.label} style={[styles.metric, !desktop && styles.metricCompact]}><Text style={[styles.metricLabel, !desktop && styles.metricLabelCompact, { color: c.mutedForeground }]}>{item.label}</Text><Text style={[styles.metricValue, !desktop && styles.metricValueCompact, { color: item.color }]}>{money(item.value)}</Text></View>)}
              </View>
              {notice ? <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: c.success, backgroundColor: c.success + "12" }]}>{notice}</Text> : null}
              {mutable && summary.remaining > 0.005 ? <Pressable accessibilityRole="button" accessibilityLabel={`Add purchase to ${goal.name}`} disabled={managementBlocked} onPress={openAdd} style={({ pressed }) => [styles.primary, { backgroundColor: c.primary, opacity: pending ? 0.55 : pressed ? 0.8 : 1 }]}><Feather name="plus" size={19} color={c.primaryForeground} /><Text style={[styles.primaryText, { color: c.primaryForeground }]}>Add purchase</Text></Pressable> : null}
              {canEditHousehold && !goal.archived_at && (goal.closed_at || summary.remaining <= 0.005) ? <View style={[styles.contextBox, { backgroundColor: c.card, borderColor: c.border }]}><Text style={[styles.copy, { color: c.mutedForeground }]}>{goal.closed_at ? "Reopen this bucket to add more purchases." : "All the planned money has been used. Adjust the budget before adding another purchase."}</Text></View> : null}
              {!canEditHousehold ? <Text style={[styles.copy, { color: c.mutedForeground }]}>You can view this bucket. A household editor can add or change purchases.</Text> : null}
              <View style={styles.sectionHeading}><Text style={[styles.sectionTitle, { color: c.foreground }]}>Purchases</Text><Text style={[styles.copy, { color: c.mutedForeground }]}>{history.length}</Text></View>
              {!history.length && earlierSpending <= 0.005 ? <View style={[styles.empty, { borderColor: c.border }]}><Feather name="shopping-bag" size={24} color={c.mutedForeground} /><Text style={[styles.emptyTitle, { color: c.foreground }]}>No purchases yet</Text><Text style={[styles.copy, { color: c.mutedForeground, textAlign: "center" }]}>Purchases added to this bucket will appear here.</Text></View> : null}
              {history.map(({ transaction, allocated }) => <View key={transaction.id} style={[styles.purchaseRow, { borderColor: c.border, backgroundColor: c.card }]}>
                <View style={styles.purchaseTop}><View style={styles.flexCopy}><Text style={[styles.purchaseName, { color: c.foreground }]}>{purchaseName(transaction)}</Text><Text style={[styles.meta, { color: c.mutedForeground }]}>{purchaseDate(transaction.date)} · {transaction.source === "plaid" || transaction.source === "statement" ? "Bank transaction" : "Manual transaction"}</Text></View><Text style={[styles.purchaseAmount, { color: c.foreground }]}>{money(allocated)}</Text></View>
                {Math.abs(Math.abs(transaction.amount) - allocated) > 0.005 ? <Text style={[styles.meta, { color: c.mutedForeground }]}>{money(allocated)} from the {money(transaction.amount)} transaction</Text> : null}
                {mutable ? <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${purchaseName(transaction)} from bucket`} disabled={managementBlocked} onPress={() => { setError(null); setRemoveId(transaction.id); }} style={styles.removeButton}><Feather name="minus-circle" size={13} color={c.mutedForeground} /><Text style={[styles.secondaryText, { color: c.mutedForeground }]}>Remove from bucket</Text></Pressable> : null}
                {removeId === transaction.id ? <View style={[styles.confirmBox, { borderColor: c.warning + "55", backgroundColor: c.warning + "10" }]}><Text style={[styles.copy, { color: c.foreground }]}>Remove this purchase from {goal.name}? Its transaction will stay in Activity.</Text><View style={styles.buttonRow}><Pressable accessibilityRole="button" accessibilityLabel="Keep purchase in bucket" disabled={pending} onPress={() => setRemoveId(null)} style={[styles.secondary, { borderColor: c.border }]}><Text style={[styles.secondaryText, { color: c.foreground }]}>Keep purchase</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Confirm remove purchase from bucket" disabled={pending} onPress={() => void removePurchase()} style={[styles.secondary, { borderColor: c.destructive + "66" }]}><Text style={[styles.secondaryText, { color: c.destructive }]}>{pending ? "Removing…" : "Remove"}</Text></Pressable></View></View> : null}
              </View>)}
              {earlierSpending > 0.005 ? <View style={[styles.purchaseRow, { borderColor: c.border, backgroundColor: c.card }]}><View style={styles.purchaseTop}><View style={styles.flexCopy}><Text style={[styles.purchaseName, { color: c.foreground }]}>Earlier spending</Text><Text style={[styles.meta, { color: c.mutedForeground }]}>Spending already recorded before this purchase list.</Text></View><Text style={[styles.purchaseAmount, { color: c.mutedForeground }]}>{money(earlierSpending)}</Text></View></View> : null}
              {canEditHousehold && !goal.archived_at ? <View style={[styles.management, { borderTopColor: c.border }]}>
                {!goal.closed_at && !routed ? <Pressable accessibilityRole="button" accessibilityLabel={`Adjust ${goal.name} budget`} disabled={managementBlocked} onPress={() => { setConfirmClose(false); setError(null); setScreen("budget"); }} style={[styles.secondary, { borderColor: c.border }]}><Feather name="sliders" size={15} color={c.primary} /><Text style={[styles.secondaryText, { color: c.primary }]}>Adjust budget</Text></Pressable> : null}
                <Pressable accessibilityRole="button" accessibilityLabel={`${goal.closed_at ? "Reopen" : "Close"} ${goal.name} bucket`} disabled={managementBlocked} onPress={() => { if (goal.closed_at) void onReopenBucket(goal); else if (summary.remaining <= 0.005) { setError(null); setConfirmClose(true); } else onCloseBucket(goal); }} style={[styles.secondary, { borderColor: c.border }]}><Feather name={goal.closed_at ? "rotate-ccw" : "check-circle"} size={15} color={c.mutedForeground} /><Text style={[styles.secondaryText, { color: c.mutedForeground }]}>{goal.closed_at ? "Reopen bucket" : "Close bucket"}</Text></Pressable>
              </View> : null}
              {confirmClose ? <View style={[styles.confirmBox, { borderColor: c.border, backgroundColor: c.card }]}>
                <Text accessibilityRole="header" style={[styles.sectionTitle, { color: c.foreground }]}>Close {goal.name}?</Text>
                <Text style={[styles.copy, { color: c.mutedForeground }]}>{summary.remaining > 0.005 ? `The budget changed. Review where the ${money(summary.remaining)} remaining should go before closing.` : `${money(summary.spent)} was matched from ${money(summary.planned)} planned. There is no money left to release. Your purchases stay in this bucket.`}</Text>
                <View style={styles.buttonRow}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Keep bucket open" disabled={pending} onPress={() => setConfirmClose(false)} style={[styles.secondary, { borderColor: c.border }]}><Text style={[styles.secondaryText, { color: c.foreground }]}>Keep open</Text></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Confirm close bucket" disabled={pending} onPress={() => void confirmFullClose()} style={[styles.primary, { backgroundColor: c.primary, opacity: pending ? 0.55 : 1 }]}><Text style={[styles.primaryText, { color: c.primaryForeground }]}>{pending ? "Closing…" : summary.remaining > 0.005 ? "Review remainder" : "Close bucket"}</Text></Pressable>
                </View>
              </View> : null}
            </> : <>
              <Text style={[styles.copy, { color: c.mutedForeground }]}>{money(summary.remaining)} left in this bucket. Choose a transaction or record a purchase.</Text>
              {kind === null ? <View style={styles.choiceList}>
                {[{ id: "bank" as const, icon: "credit-card" as const, label: "Bank transaction", copy: "Choose a posted bank charge." }, { id: "manual" as const, icon: "file-text" as const, label: "Manual transaction", copy: "Choose a transaction you already entered." }].map(option => <Pressable key={option.id} accessibilityRole="button" accessibilityLabel={option.label} disabled={pending} onPress={() => chooseKind(option.id)} style={({ pressed }) => [styles.choice, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.75 : 1 }]}><View style={[styles.choiceIcon, { backgroundColor: c.primary + "15" }]}><Feather name={option.icon} size={20} color={c.primary} /></View><View style={styles.flexCopy}><Text style={[styles.purchaseName, { color: c.foreground }]}>{option.label}</Text><Text style={[styles.meta, { color: c.mutedForeground }]}>{option.copy}</Text></View><Feather name="chevron-right" size={18} color={c.mutedForeground} /></Pressable>)}
                <Pressable accessibilityRole="button" accessibilityLabel="Record purchase" disabled={pending} onPress={openRecord} style={({ pressed }) => [styles.choice, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.75 : 1 }]}><View style={[styles.choiceIcon, { backgroundColor: c.primary + "15" }]}><Feather name="plus-circle" size={20} color={c.primary} /></View><View style={styles.flexCopy}><Text style={[styles.purchaseName, { color: c.foreground }]}>Record purchase</Text><Text style={[styles.meta, { color: c.mutedForeground }]}>Enter a new purchase for this bucket.</Text></View><Feather name="chevron-right" size={18} color={c.mutedForeground} /></Pressable>
              </View> : <>
                <View style={styles.buttonRow}>{(["bank", "manual"] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: kind === value }} accessibilityLabel={`${value === "bank" ? "Bank" : "Manual"} transaction filter`} disabled={pending} onPress={() => chooseKind(value)} style={[styles.secondary, { borderColor: kind === value ? c.primary : c.border, backgroundColor: kind === value ? c.primary + "15" : c.card }]}><Text style={[styles.secondaryText, { color: kind === value ? c.primary : c.foreground }]}>{value === "bank" ? "Bank" : "Manual"}</Text></Pressable>)}</View>
                <TextInput accessibilityLabel="Search bucket purchase transactions" value={search} sensitive={moneyPrivacySearchSensitive(search)} onChangeText={value => { setSearch(value); setLimit(40); }} editable={!pending} placeholder="Search name, amount, or date" placeholderTextColor={c.mutedForeground} style={[styles.search, { color: c.foreground, backgroundColor: c.card, borderColor: c.border }]} />
                {selected ? <View style={[styles.confirmBox, { backgroundColor: c.primary + "10", borderColor: c.primary + "55" }]}><Text style={[styles.sectionTitle, { color: c.foreground }]}>Add this purchase?</Text><Text style={[styles.purchaseName, { color: c.foreground }]}>{purchaseName(selected)}</Text><Text style={[styles.copy, { color: c.mutedForeground }]}>{money(selectedCost)} from this bucket · {purchaseDate(selected.date)}</Text><Text style={[styles.copy, { color: tooLarge ? c.warning : c.success }]}>{tooLarge ? "This is more than the money left. Adjust the budget first." : `${money(summary.remaining - selectedCost)} will remain. The transaction is counted once.`}</Text><Pressable accessibilityRole="button" accessibilityLabel="Confirm add purchase to bucket" disabled={pending || tooLarge || !mutable} onPress={() => void addExisting()} style={[styles.primary, { backgroundColor: c.primary, opacity: pending || tooLarge ? 0.5 : 1 }]}><Text style={[styles.primaryText, { color: c.primaryForeground }]}>{pending ? "Adding…" : "Add to bucket"}</Text></Pressable>{tooLarge ? <Pressable accessibilityRole="button" accessibilityLabel={`Adjust ${goal.name} budget`} disabled={pending} onPress={() => setScreen("budget")} style={[styles.secondary, { borderColor: c.border }]}><Text style={[styles.secondaryText, { color: c.primary }]}>Adjust budget</Text></Pressable> : null}<Pressable accessibilityRole="button" accessibilityLabel="Choose a different purchase" disabled={pending} onPress={() => { setSelectedId(null); setError(null); }} style={[styles.secondary, { borderColor: c.border }]}><Text style={[styles.secondaryText, { color: c.foreground }]}>Choose another</Text></Pressable></View> : <>
                  <Text style={[styles.meta, { color: c.mutedForeground }]}>{candidates.length} available · Transactions matched elsewhere are excluded.</Text>
                  {candidates.slice(0, limit).map(transaction => <Pressable key={transaction.id} accessibilityRole="button" accessibilityLabel={`Select ${purchaseName(transaction)}, ${money(transaction.amount)}`} disabled={pending} onPress={() => { setSelectedId(transaction.id); setError(null); }} style={({ pressed }) => [styles.choice, { borderColor: c.border, backgroundColor: c.card, opacity: pressed ? 0.75 : 1 }]}><View style={styles.flexCopy}><Text style={[styles.purchaseName, { color: c.foreground }]}>{purchaseName(transaction)}</Text><Text style={[styles.meta, { color: c.mutedForeground }]}>{purchaseDate(transaction.date)} · {transaction.category}</Text></View><Text style={[styles.purchaseAmount, { color: c.foreground }]}>{money(transaction.amount)}</Text><Feather name="chevron-right" size={16} color={c.mutedForeground} /></Pressable>)}
                  {!candidates.length ? <View style={[styles.empty, { borderColor: c.border }]}><Text style={[styles.emptyTitle, { color: c.foreground }]}>{search.trim() ? "No matching transactions" : `No ${kind === "bank" ? "bank" : "manual"} transactions available`}</Text><Text style={[styles.copy, { color: c.mutedForeground, textAlign: "center" }]}>{search.trim() ? "Try another name, amount, or date." : kind === "bank" ? "Only posted charges that are available for a bucket appear here." : "Record a purchase to add a new transaction."}</Text></View> : null}
                  {candidates.length > limit ? <Pressable accessibilityRole="button" accessibilityLabel="Show more purchase transactions" onPress={() => setLimit(value => value + 40)} style={[styles.secondary, { borderColor: c.border }]}><Text style={[styles.secondaryText, { color: c.primary }]}>Show more</Text></Pressable> : null}
                </>}
                <Pressable accessibilityRole="button" accessibilityLabel="Record purchase" disabled={pending} onPress={openRecord} style={[styles.secondary, { borderColor: c.border }]}><Feather name="plus-circle" size={16} color={c.primary} /><Text style={[styles.secondaryText, { color: c.primary }]}>Record a new purchase</Text></Pressable>
              </>}
            </>}
            {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[styles.error, { color: c.destructive, backgroundColor: c.destructive + "10" }]}>{error}</Text> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
    {activeScreen === "record" && canEditHousehold ? <AddTransactionModal visible={!suspended} bucketId={bucketId} creationContext="bucket_purchase" initialValues={initialRecordValues} defaultDate={localDateString()} onClose={() => { if (isCurrent()) setScreen("detail"); }} onSave={async payload => {
      const live = assertEditable();
      if (!recordId.current) throw new Error("Open a new purchase and try again.");
      if (Math.abs(payload.amount) > spendingBucketSummary(live).remaining + 0.005) throw new Error("This purchase is more than the money left. Adjust the bucket budget first.");
      const id = await addBucketPurchase({ bucketId, transactionId: recordId.current, transaction: payload });
      if (isCurrent()) setNotice("Purchase recorded. Your bucket stays open.");
      return id;
    }} /> : null}
    {activeScreen === "budget" && canEditHousehold ? <GoalModal visible={!suspended} editGoal={goal} hideBucketLifecycle lockedMode="budget" minimumTargetAmount={summary.spent} title="Adjust bucket budget" saveLabel="Save budget" hint="Changing the planned amount keeps the purchases already recorded in this bucket." onClose={() => { if (isCurrent()) setScreen("detail"); }} onSave={async payload => { assertEditable(); await updateGoal(payload as Goal); if (isCurrent()) setNotice("Bucket budget updated."); }} /> : null}
  </>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(2,6,23,0.72)" },
  sheet: { width: "100%", maxHeight: "92%", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, overflow: "hidden" },
  header: { padding: 18, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(148,163,184,0.15)" },
  headerCopy: { flex: 1, minWidth: 0 }, title: { fontSize: 20, lineHeight: 26, fontFamily: "Inter_800ExtraBold" },
  eyebrow: { fontSize: 10, lineHeight: 15, fontFamily: "Inter_700Bold", letterSpacing: 0.8, marginBottom: 2 },
  headingIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  content: { padding: 18, paddingBottom: 28, gap: 14 },
  metrics: { flexDirection: "row", borderWidth: 1, borderRadius: 16, paddingHorizontal: 8, paddingVertical: 15 },
  metricsCompact: { flexDirection: "column", gap: 9, paddingHorizontal: 13, paddingVertical: 12 },
  metricCompact: { flex: 0, flexBasis: "auto", flexShrink: 0, minHeight: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  metricLabelCompact: { fontSize: 12, lineHeight: 18 },
  metricValueCompact: { marginTop: 0, fontSize: 17, lineHeight: 24, textAlign: "right" },
  metric: { flex: 1, minWidth: 0, paddingHorizontal: 5 }, metricLabel: { fontSize: 10, lineHeight: 15, fontFamily: "Inter_600SemiBold" },
  metricValue: { fontSize: 18, lineHeight: 25, fontFamily: "Inter_800ExtraBold", marginTop: 3 },
  primary: { minHeight: 48, borderRadius: 14, paddingHorizontal: 15, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryText: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  secondary: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, flexShrink: 1 },
  secondaryText: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  copy: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_500Medium" }, meta: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_500Medium", marginTop: 3 },
  contextBox: { padding: 13, borderRadius: 14, borderWidth: 1 },
  sectionHeading: { marginTop: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 16, lineHeight: 22, fontFamily: "Inter_700Bold" },
  choiceList: { gap: 10 }, choice: { minHeight: 64, padding: 13, borderWidth: 1, borderRadius: 14, flexDirection: "row", alignItems: "center", gap: 11 },
  choiceIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  flexCopy: { flex: 1, minWidth: 0 }, purchaseName: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_700Bold" },
  purchaseAmount: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_700Bold", flexShrink: 0 },
  purchaseRow: { borderWidth: 1, borderRadius: 14, padding: 13, gap: 4 }, purchaseTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  removeButton: { alignSelf: "flex-start", minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 },
  confirmBox: { borderWidth: 1, borderRadius: 14, padding: 13, gap: 12 },
  empty: { borderWidth: 1, borderStyle: "dashed", borderRadius: 14, padding: 22, gap: 9, alignItems: "center" },
  emptyTitle: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  search: { minHeight: 46, paddingHorizontal: 13, borderWidth: 1, borderRadius: 12, fontSize: 14, fontFamily: "Inter_500Medium" },
  management: { borderTopWidth: 1, paddingTop: 16, marginTop: 6, flexDirection: "row", flexWrap: "wrap", gap: 9 },
  notice: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_600SemiBold", padding: 12, borderRadius: 12 },
  error: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_600SemiBold", padding: 12, borderRadius: 12 },
});
