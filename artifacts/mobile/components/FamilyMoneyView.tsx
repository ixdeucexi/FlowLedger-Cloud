import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import colors from "@/constants/colors";
import { useColors } from "@/hooks/useColors";
import { buildChildMoneySummary, type ChildProfile } from "@/lib/competitiveGrowth";

type MoneyAction = "allowance" | "spend" | "save" | "edit";

interface NewChildProfile {
  name: string;
  allowanceAmount: number | null;
  savingsGoal: number | null;
}

interface FamilyMoneyViewProps {
  profiles: ChildProfile[];
  canEdit: boolean;
  notice?: string | null;
  onAdd: (profile: NewChildProfile) => Promise<void>;
  onUpdate: (profile: ChildProfile) => Promise<void>;
  onRemove: (profile: ChildProfile) => void;
}

const money = (value: number) => `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function FamilyMoneyView({
  profiles,
  canEdit,
  notice,
  onAdd,
  onUpdate,
  onRemove,
}: FamilyMoneyViewProps) {
  const c = useColors();
  const summaries = useMemo(() => buildChildMoneySummary(profiles), [profiles]);
  const totalSpend = summaries.reduce((sum, child) => sum + child.spendAvailable, 0);
  const totalSaved = summaries.reduce((sum, child) => sum + child.saved, 0);
  const [showAdd, setShowAdd] = useState(profiles.length === 0);
  const [name, setName] = useState("");
  const [allowance, setAllowance] = useState("");
  const [goal, setGoal] = useState("");
  const [selected, setSelected] = useState<ChildProfile | null>(null);
  const [action, setAction] = useState<MoneyAction | null>(null);
  const [amount, setAmount] = useState("");
  const [saveAmount, setSaveAmount] = useState("");
  const [editName, setEditName] = useState("");
  const [editAllowance, setEditAllowance] = useState("");
  const [editGoal, setEditGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const beginAction = (profile: ChildProfile, nextAction: MoneyAction) => {
    setSelected(profile);
    setAction(nextAction);
    setMessage(null);
    if (nextAction === "allowance") {
      const allowanceValue = Math.max(0, profile.allowanceAmount ?? 0);
      setAmount(allowanceValue ? allowanceValue.toFixed(2) : "");
      setSaveAmount(allowanceValue ? (allowanceValue * 0.2).toFixed(2) : "");
    } else if (nextAction === "edit") {
      setEditName(profile.name);
      setEditAllowance(profile.allowanceAmount ? profile.allowanceAmount.toFixed(2) : "");
      setEditGoal(profile.savingsGoal ? profile.savingsGoal.toFixed(2) : "");
    } else {
      setAmount("");
      setSaveAmount("");
    }
  };

  const closeAction = () => {
    if (busy) return;
    setAction(null);
    setSelected(null);
  };

  const submitNewChild = async () => {
    const cleanName = name.trim();
    if (!cleanName) {
      Alert.alert("Add a child", "Enter their name first.");
      return;
    }
    setBusy(true);
    try {
      await onAdd({
        name: cleanName,
        allowanceAmount: positiveNumber(allowance),
        savingsGoal: positiveNumber(goal),
      });
      setName("");
      setAllowance("");
      setGoal("");
      setShowAdd(false);
      setMessage(`${cleanName}'s money plan is ready.`);
    } finally {
      setBusy(false);
    }
  };

  const submitAction = async () => {
    if (!selected || !action) return;
    if (action === "edit") {
      const cleanName = editName.trim();
      if (!cleanName) {
        Alert.alert("Child name", "Enter a name.");
        return;
      }
      setBusy(true);
      try {
        await onUpdate({
          ...selected,
          name: cleanName,
          allowanceAmount: positiveNumber(editAllowance),
          allowanceFrequency: positiveNumber(editAllowance) ? selected.allowanceFrequency ?? "weekly" : null,
          savingsGoal: positiveNumber(editGoal),
        });
        setMessage(`${cleanName}'s plan was updated.`);
        closeAfterSave();
      } finally {
        setBusy(false);
      }
      return;
    }

    const value = positiveNumber(amount);
    if (!value) {
      Alert.alert("Amount", "Enter an amount greater than $0.");
      return;
    }
    const spendAvailable = Math.max(0, selected.spendingLimit ?? 0);
    const saved = Math.max(0, selected.currentSavings ?? 0);
    let next = selected;
    let successMessage = "";

    if (action === "allowance") {
      const saving = Math.max(0, positiveNumber(saveAmount) ?? 0);
      if (saving > value) {
        Alert.alert("Split the allowance", "The amount going to Save cannot be more than the allowance.");
        return;
      }
      next = {
        ...selected,
        spendingLimit: spendAvailable + (value - saving),
        currentSavings: saved + saving,
      };
      successMessage = `${money(value)} added for ${selected.name}.`;
    } else if (action === "spend") {
      if (value > spendAvailable) {
        Alert.alert("Not enough Spend money", `${selected.name} has ${money(spendAvailable)} available to spend.`);
        return;
      }
      next = { ...selected, spendingLimit: spendAvailable - value };
      successMessage = `${money(value)} purchase recorded.`;
    } else {
      if (value > spendAvailable) {
        Alert.alert("Not enough Spend money", `${selected.name} has ${money(spendAvailable)} available to move.`);
        return;
      }
      next = {
        ...selected,
        spendingLimit: spendAvailable - value,
        currentSavings: saved + value,
      };
      successMessage = `${money(value)} moved to Save.`;
    }

    setBusy(true);
    try {
      await onUpdate(next);
      setMessage(successMessage);
      closeAfterSave();
    } finally {
      setBusy(false);
    }
  };

  const closeAfterSave = () => {
    setAction(null);
    setSelected(null);
    setAmount("");
    setSaveAmount("");
  };

  return (
    <View style={styles.page}>
      <View style={[styles.hero, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={styles.heroTop}>
          <View style={[styles.heroIcon, { backgroundColor: c.success + "18" }]}>
            <Feather name="smile" size={22} color={c.success} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={[styles.eyebrow, { color: c.success }]}>FAMILY MONEY</Text>
            <Text style={[styles.heroTitle, { color: c.foreground }]}>Teach money by using it</Text>
            <Text style={[styles.heroText, { color: c.mutedForeground }]}>
              Give an allowance, choose what can be spent, and build a savings goal together.
            </Text>
          </View>
        </View>
        <View style={styles.familyTotals}>
          <HeroMetric label="Ready to spend" value={money(totalSpend)} color={c.success} background={c.success + "12"} />
          <HeroMetric label="Saved" value={money(totalSaved)} color={c.primary} background={c.primary + "12"} />
        </View>
      </View>

      {notice || message ? (
        <View style={[styles.notice, { backgroundColor: c.success + "12", borderColor: c.success + "35" }]}>
          <Feather name="check-circle" size={16} color={c.success} />
          <Text style={[styles.noticeText, { color: c.success }]}>{message ?? notice}</Text>
        </View>
      ) : null}

      <View style={styles.sectionHeading}>
        <View>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>Your kids</Text>
          <Text style={[styles.sectionCaption, { color: c.mutedForeground }]}>
            {profiles.length ? `${profiles.length} money plan${profiles.length === 1 ? "" : "s"}` : "Start with one simple plan"}
          </Text>
        </View>
        {canEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add child"
            onPress={() => setShowAdd(value => !value)}
            style={({ pressed }) => [styles.addButton, { backgroundColor: c.primary, opacity: pressed ? 0.78 : 1 }]}
          >
            <Feather name={showAdd ? "x" : "plus"} size={16} color={c.primaryForeground} />
            <Text style={[styles.addButtonText, { color: c.primaryForeground }]}>{showAdd ? "Close" : "Add child"}</Text>
          </Pressable>
        ) : null}
      </View>

      {showAdd && canEdit ? (
        <View style={[styles.addCard, { backgroundColor: c.card, borderColor: c.primary + "45" }]}>
          <Text style={[styles.cardTitle, { color: c.foreground }]}>Create a money plan</Text>
          <Text style={[styles.cardCaption, { color: c.mutedForeground }]}>Allowance and goal can be changed later.</Text>
          <LabeledInput label="Name" value={name} onChangeText={setName} placeholder="Child name" />
          <View style={styles.inputRow}>
            <View style={styles.inputHalf}>
              <LabeledInput label="Allowance" value={allowance} onChangeText={setAllowance} placeholder="$0.00" moneyInput />
            </View>
            <View style={styles.inputHalf}>
              <LabeledInput label="Savings goal" value={goal} onChangeText={setGoal} placeholder="$0.00" moneyInput />
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create child money plan"
            disabled={busy}
            onPress={() => void submitNewChild()}
            style={({ pressed }) => [styles.primaryButton, { backgroundColor: c.primary, opacity: busy ? 0.5 : pressed ? 0.78 : 1 }]}
          >
            <Text style={[styles.primaryButtonText, { color: c.primaryForeground }]}>{busy ? "Saving…" : "Create plan"}</Text>
          </Pressable>
        </View>
      ) : null}

      {profiles.map(profile => {
        const summary = summaries.find(item => item.id === profile.id);
        if (!summary) return null;
        return (
          <View key={profile.id} style={[styles.childCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.childTop}>
              <View style={[styles.avatar, { backgroundColor: c.primary + "1A" }]}>
                <Text style={[styles.avatarText, { color: c.primary }]}>{profile.name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={styles.childTitleCopy}>
                <Text style={[styles.childName, { color: c.foreground }]}>{profile.name}</Text>
                <View style={styles.readyRow}>
                  <View style={[styles.statusDot, { backgroundColor: summary.status === "ready" ? c.success : c.warning }]} />
                  <Text style={[styles.readyText, { color: summary.status === "ready" ? c.success : c.warning }]}>
                    {summary.status === "ready" ? "Ready to spend" : "Add money to get started"}
                  </Text>
                </View>
              </View>
              <Text style={[styles.totalValue, { color: c.foreground }]}>{money(summary.total)}</Text>
            </View>

            <View style={styles.bucketRow}>
              <Bucket
                icon="shopping-bag"
                label="Spend"
                value={money(summary.spendAvailable)}
                color={c.success}
                background={c.success + "12"}
              />
              <Bucket
                icon="star"
                label="Save"
                value={money(summary.saved)}
                color={c.primary}
                background={c.primary + "12"}
              />
            </View>

            <View style={styles.goalHeading}>
              <View>
                <Text style={[styles.goalLabel, { color: c.foreground }]}>
                  {profile.savingsGoal ? "Savings goal" : "No savings goal yet"}
                </Text>
                <Text style={[styles.goalDetail, { color: c.mutedForeground }]}>{summary.message}</Text>
              </View>
              {profile.savingsGoal ? <Text style={[styles.goalPercent, { color: c.primary }]}>{summary.progress}%</Text> : null}
            </View>
            {profile.savingsGoal ? (
              <View style={[styles.progressTrack, { backgroundColor: c.muted }]}>
                <View style={[styles.progressFill, { width: `${summary.progress}%`, backgroundColor: c.primary }]} />
              </View>
            ) : null}

            {profile.allowanceAmount ? (
              <View style={[styles.allowanceRow, { borderColor: c.border }]}>
                <Feather name="repeat" size={14} color={c.mutedForeground} />
                <Text style={[styles.allowanceText, { color: c.mutedForeground }]}>
                  {money(profile.allowanceAmount)} {profile.allowanceFrequency ?? "weekly"} allowance
                </Text>
              </View>
            ) : null}

            {canEdit ? (
              <View style={styles.actionRow}>
                <ActionButton icon="plus-circle" label="Allowance" onPress={() => beginAction(profile, "allowance")} />
                <ActionButton icon="shopping-cart" label="Purchase" onPress={() => beginAction(profile, "spend")} />
                <ActionButton icon="arrow-right" label="Move to Save" onPress={() => beginAction(profile, "save")} />
                <ActionButton icon="settings" label="Manage" onPress={() => beginAction(profile, "edit")} />
              </View>
            ) : null}
          </View>
        );
      })}

      {!profiles.length && !showAdd ? (
        <View style={[styles.empty, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={[styles.emptyIcon, { backgroundColor: c.primary + "18" }]}>
            <Feather name="users" size={26} color={c.primary} />
          </View>
          <Text style={[styles.emptyTitle, { color: c.foreground }]}>Start their first money plan</Text>
          <Text style={[styles.emptyText, { color: c.mutedForeground }]}>
            Track allowance, spending money, and a savings goal in one place.
          </Text>
          {canEdit ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowAdd(true)}
              style={({ pressed }) => [styles.emptyButton, { backgroundColor: c.primary + "18", opacity: pressed ? 0.72 : 1 }]}
            >
              <Text style={[styles.emptyButtonText, { color: c.primary }]}>Add a child</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.lessonCard, { backgroundColor: c.muted, borderColor: c.border }]}>
        <View style={[styles.lessonIcon, { backgroundColor: c.warning + "18" }]}>
          <Feather name="sun" size={18} color={c.warning} />
        </View>
        <View style={styles.lessonCopy}>
          <Text style={[styles.lessonTitle, { color: c.foreground }]}>A simple weekly habit</Text>
          <Text style={[styles.lessonText, { color: c.mutedForeground }]}>
            Add allowance together, choose a Save amount, then let them decide how to use Spend.
          </Text>
        </View>
      </View>

      <Modal visible={Boolean(selected && action)} transparent animationType="slide" onRequestClose={closeAction}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeAction} />
          <View style={[styles.sheet, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={[styles.sheetEyebrow, { color: c.primary }]}>{selected?.name.toUpperCase()}</Text>
                <Text style={[styles.sheetTitle, { color: c.foreground }]}>{actionTitle(action)}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={closeAction}>
                <Feather name="x" size={24} color={c.mutedForeground} />
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>
              {action === "edit" ? (
                <>
                  <LabeledInput label="Name" value={editName} onChangeText={setEditName} placeholder="Child name" />
                  <LabeledInput label="Allowance amount" value={editAllowance} onChangeText={setEditAllowance} placeholder="$0.00" moneyInput />
                  <LabeledInput label="Savings goal" value={editGoal} onChangeText={setEditGoal} placeholder="$0.00" moneyInput />
                  <Text style={[styles.helpText, { color: c.mutedForeground }]}>
                    Balances stay the same when you update the plan.
                  </Text>
                </>
              ) : (
                <>
                  <LabeledInput
                    label={action === "allowance" ? "Allowance amount" : action === "spend" ? "Purchase amount" : "Move to Save"}
                    value={amount}
                    onChangeText={setAmount}
                    placeholder="$0.00"
                    moneyInput
                  />
                  {action === "allowance" ? (
                    <>
                      <LabeledInput
                        label="Put this much in Save"
                        value={saveAmount}
                        onChangeText={setSaveAmount}
                        placeholder="$0.00"
                        moneyInput
                      />
                      <View style={[styles.splitPreview, { backgroundColor: c.muted }]}>
                        <Text style={[styles.splitText, { color: c.mutedForeground }]}>The rest goes to Spend.</Text>
                        <Text style={[styles.splitValue, { color: c.success }]}>
                          {money(Math.max(0, (positiveNumber(amount) ?? 0) - (positiveNumber(saveAmount) ?? 0)))}
                        </Text>
                      </View>
                    </>
                  ) : null}
                  {action === "spend" || action === "save" ? (
                    <Text style={[styles.helpText, { color: c.mutedForeground }]}>
                      Available in Spend: {money(Math.max(0, selected?.spendingLimit ?? 0))}
                    </Text>
                  ) : null}
                </>
              )}

              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void submitAction()}
                style={({ pressed }) => [styles.primaryButton, { backgroundColor: c.primary, opacity: busy ? 0.5 : pressed ? 0.78 : 1 }]}
              >
                <Text style={[styles.primaryButtonText, { color: c.primaryForeground }]}>{busy ? "Saving…" : actionButtonLabel(action)}</Text>
              </Pressable>

              {action === "edit" && selected ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    closeAction();
                    onRemove(selected);
                  }}
                  style={({ pressed }) => [styles.removeButton, { borderColor: c.destructive + "55", opacity: pressed ? 0.72 : 1 }]}
                >
                  <Feather name="trash-2" size={15} color={c.destructive} />
                  <Text style={[styles.removeButtonText, { color: c.destructive }]}>Remove profile</Text>
                </Pressable>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function positiveNumber(value: string): number | null {
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null;
}

function actionTitle(action: MoneyAction | null) {
  if (action === "allowance") return "Add allowance";
  if (action === "spend") return "Record a purchase";
  if (action === "save") return "Move money to Save";
  return "Manage money plan";
}

function actionButtonLabel(action: MoneyAction | null) {
  if (action === "allowance") return "Add allowance";
  if (action === "spend") return "Record purchase";
  if (action === "save") return "Move money";
  return "Save changes";
}

function HeroMetric({ label, value, color, background }: { label: string; value: string; color: string; background: string }) {
  return (
    <View style={[styles.heroMetric, { backgroundColor: background }]}>
      <Text style={[styles.heroMetricLabel, { color }]}>{label}</Text>
      <Text style={[styles.heroMetricValue, { color }]}>{value}</Text>
    </View>
  );
}

function Bucket({
  icon,
  label,
  value,
  color,
  background,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  value: string;
  color: string;
  background: string;
}) {
  return (
    <View style={[styles.bucket, { backgroundColor: background }]}>
      <View style={styles.bucketLabelRow}>
        <Feather name={icon} size={14} color={color} />
        <Text style={[styles.bucketLabel, { color }]}>{label}</Text>
      </View>
      <Text style={[styles.bucketValue, { color }]}>{value}</Text>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.actionButton, { backgroundColor: c.muted, opacity: pressed ? 0.7 : 1 }]}
    >
      <Feather name={icon} size={16} color={c.primary} />
      <Text style={[styles.actionButtonText, { color: c.foreground }]}>{label}</Text>
    </Pressable>
  );
}

function LabeledInput({
  label,
  value,
  onChangeText,
  placeholder,
  moneyInput,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  moneyInput?: boolean;
}) {
  const c = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>{label.toUpperCase()}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.mutedForeground}
        keyboardType={moneyInput ? "decimal-pad" : "default"}
        style={[styles.input, { backgroundColor: c.muted, borderColor: c.border, color: c.foreground }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 14 },
  hero: { borderWidth: 1, borderRadius: colors.radius, padding: 18 },
  heroTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  heroIcon: { width: 46, height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  heroCopy: { flex: 1 },
  eyebrow: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 1 },
  heroTitle: { fontFamily: "Inter_700Bold", fontSize: 21, marginTop: 3 },
  heroText: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19, marginTop: 6 },
  familyTotals: { flexDirection: "row", gap: 10, marginTop: 17 },
  heroMetric: { flex: 1, borderRadius: 14, padding: 13 },
  heroMetricLabel: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  heroMetricValue: { fontFamily: "Inter_700Bold", fontSize: 20, marginTop: 5 },
  notice: { borderWidth: 1, borderRadius: 13, padding: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  noticeText: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 12 },
  sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 2 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 20 },
  sectionCaption: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 },
  addButton: { minHeight: 42, paddingHorizontal: 13, borderRadius: 13, flexDirection: "row", alignItems: "center", gap: 6 },
  addButtonText: { fontFamily: "Inter_700Bold", fontSize: 12 },
  addCard: { borderWidth: 1, borderRadius: colors.radius, padding: 16, gap: 12 },
  cardTitle: { fontFamily: "Inter_700Bold", fontSize: 18 },
  cardCaption: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: -7 },
  inputRow: { flexDirection: "row", gap: 10 },
  inputHalf: { flex: 1 },
  field: { gap: 6 },
  fieldLabel: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.7 },
  input: { minHeight: 52, borderWidth: 1, borderRadius: 13, paddingHorizontal: 14, fontFamily: "Inter_500Medium", fontSize: 15 },
  primaryButton: { minHeight: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 3 },
  primaryButtonText: { fontFamily: "Inter_700Bold", fontSize: 14 },
  childCard: { borderWidth: 1, borderRadius: colors.radius, padding: 16 },
  childTop: { flexDirection: "row", alignItems: "center", gap: 11 },
  avatar: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: "Inter_700Bold", fontSize: 20 },
  childTitleCopy: { flex: 1 },
  childName: { fontFamily: "Inter_700Bold", fontSize: 19 },
  readyRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
  statusDot: { width: 7, height: 7, borderRadius: 99 },
  readyText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  totalValue: { fontFamily: "Inter_700Bold", fontSize: 18 },
  bucketRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  bucket: { flex: 1, borderRadius: 14, padding: 13 },
  bucketLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  bucketLabel: { fontFamily: "Inter_700Bold", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  bucketValue: { fontFamily: "Inter_700Bold", fontSize: 20, marginTop: 7 },
  goalHeading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginTop: 16 },
  goalLabel: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  goalDetail: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 3 },
  goalPercent: { fontFamily: "Inter_700Bold", fontSize: 13 },
  progressTrack: { height: 6, borderRadius: 99, overflow: "hidden", marginTop: 9 },
  progressFill: { height: "100%", borderRadius: 99 },
  allowanceRow: { borderTopWidth: 1, marginTop: 15, paddingTop: 12, flexDirection: "row", alignItems: "center", gap: 7 },
  allowanceText: { fontFamily: "Inter_500Medium", fontSize: 11 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 15 },
  actionButton: { width: "48%", minHeight: 46, borderRadius: 13, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  actionButtonText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  empty: { borderWidth: 1, borderRadius: colors.radius, padding: 24, alignItems: "center" },
  emptyIcon: { width: 54, height: 54, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontFamily: "Inter_700Bold", fontSize: 18, marginTop: 13 },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 6, maxWidth: 290 },
  emptyButton: { minHeight: 42, borderRadius: 13, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", marginTop: 15 },
  emptyButtonText: { fontFamily: "Inter_700Bold", fontSize: 13 },
  lessonCard: { borderWidth: 1, borderRadius: colors.radius, padding: 15, flexDirection: "row", alignItems: "center", gap: 11 },
  lessonIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  lessonCopy: { flex: 1 },
  lessonTitle: { fontFamily: "Inter_700Bold", fontSize: 14 },
  lessonText: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17, marginTop: 3 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "flex-end" },
  sheet: { maxHeight: "86%", borderTopWidth: 1, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingTop: 9 },
  sheetHandle: { width: 38, height: 4, borderRadius: 99, backgroundColor: "rgba(148,163,184,0.45)", alignSelf: "center", marginBottom: 14 },
  sheetHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", paddingHorizontal: 20 },
  sheetEyebrow: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.9 },
  sheetTitle: { fontFamily: "Inter_700Bold", fontSize: 22, marginTop: 4 },
  sheetContent: { padding: 20, gap: 13, paddingBottom: 34 },
  helpText: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17 },
  splitPreview: { borderRadius: 13, padding: 13, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  splitText: { fontFamily: "Inter_500Medium", fontSize: 12 },
  splitValue: { fontFamily: "Inter_700Bold", fontSize: 15 },
  removeButton: { minHeight: 48, borderWidth: 1, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  removeButtonText: { fontFamily: "Inter_700Bold", fontSize: 13 },
});
