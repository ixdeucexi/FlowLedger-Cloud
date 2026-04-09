import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import colors from "@/constants/colors";
import type { Goal } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (goal: Omit<Goal, "id" | "created_at"> | Goal) => void;
  onDelete?: (id: string) => void;
  editGoal?: Goal | null;
}

export function GoalModal({ visible, onClose, onSave, onDelete, editGoal }: Props) {
  const c = useColors();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [current, setCurrent] = useState("");
  const [targetDate, setTargetDate] = useState("");

  useEffect(() => {
    if (editGoal) {
      setName(editGoal.name);
      setTarget(editGoal.target_amount.toString());
      setCurrent(editGoal.current_amount > 0 ? editGoal.current_amount.toString() : "");
      setTargetDate(editGoal.target_date.split("T")[0]);
    } else {
      setName(""); setTarget(""); setCurrent("");
      const d = new Date(); d.setFullYear(d.getFullYear() + 1);
      setTargetDate(d.toISOString().split("T")[0]);
    }
  }, [editGoal, visible]);

  const handleSave = () => {
    const t = parseFloat(target);
    if (!name.trim() || isNaN(t) || t <= 0 || !targetDate) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const data: Omit<Goal, "id" | "created_at"> = {
      name: name.trim(),
      target_amount: t,
      current_amount: parseFloat(current) || 0,
      target_date: new Date(targetDate).toISOString(),
    };
    if (editGoal) onSave({ ...data, id: editGoal.id, created_at: editGoal.created_at });
    else onSave(data);
    onClose();
  };

  const handleDelete = () => {
    if (!editGoal || !onDelete) return;
    const doDelete = () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onDelete(editGoal.id);
      onClose();
    };
    if (Platform.OS === "web") { doDelete(); return; }
    Alert.alert("Delete Goal", `Remove "${editGoal.name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: doDelete },
    ]);
  };

  const input = [styles.input, { backgroundColor: c.muted, color: c.foreground }];
  const label = [styles.label, { color: c.mutedForeground }];

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: c.background }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={[styles.title, { color: c.foreground }]}>{editGoal ? "Edit Goal" : "New Financial Goal"}</Text>
            <Pressable onPress={onClose} hitSlop={8}><Feather name="x" size={22} color={c.mutedForeground} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={label}>Goal Name</Text>
            <TextInput style={input} value={name} onChangeText={setName} placeholder='e.g. Christmas Fund' placeholderTextColor={c.mutedForeground} />

            <Text style={label}>Target Amount ($)</Text>
            <TextInput style={input} value={target} onChangeText={setTarget} placeholder='2000.00' placeholderTextColor={c.mutedForeground} keyboardType="decimal-pad" />

            <Text style={label}>Already Saved ($)</Text>
            <TextInput style={input} value={current} onChangeText={setCurrent} placeholder='0.00' placeholderTextColor={c.mutedForeground} keyboardType="decimal-pad" />

            <Text style={label}>Target Date (YYYY-MM-DD)</Text>
            <TextInput style={input} value={targetDate} onChangeText={setTargetDate} placeholder='2025-12-25' placeholderTextColor={c.mutedForeground} />

            <View style={[styles.hint, { backgroundColor: c.primary + "15", borderRadius: 8 }]}>
              <Feather name="info" size={13} color={c.primary} />
              <Text style={[styles.hintText, { color: c.mutedForeground }]}>
                The app will check if your projected balance (income − bills) covers this goal amount.
              </Text>
            </View>

            <Pressable
              onPress={handleSave}
              style={({ pressed }) => [styles.saveBtn, { backgroundColor: c.primary, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={[styles.saveBtnText, { color: c.primaryForeground }]}>{editGoal ? "Update Goal" : "Create Goal"}</Text>
            </Pressable>

            {editGoal && onDelete && (
              <Pressable
                onPress={handleDelete}
                style={({ pressed }) => [styles.deleteBtn, { borderColor: c.destructive, opacity: pressed ? 0.7 : 1 }]}
              >
                <Feather name="trash-2" size={16} color={c.destructive} />
                <Text style={[styles.deleteBtnText, { color: c.destructive }]}>Delete Goal</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.65)" },
  container: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingTop: 12, maxHeight: "85%" },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#444", alignSelf: "center", marginBottom: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginBottom: 6, marginTop: 14, textTransform: "uppercase", letterSpacing: 0.7 },
  input: { height: 48, borderRadius: 10, paddingHorizontal: 14, fontSize: 16, fontFamily: "Inter_400Regular" },
  hint: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, marginTop: 14 },
  hintText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  saveBtn: { height: 52, alignItems: "center", justifyContent: "center", marginTop: 20 },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  deleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderWidth: 1.5, borderRadius: 12, marginTop: 12, marginBottom: 32 },
  deleteBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
