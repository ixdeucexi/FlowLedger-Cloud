import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import colors from "@/constants/colors";
import { useColors } from "@/hooks/useColors";
import type { Bill } from "@/context/BudgetContext";

const CATEGORIES = [
  "Housing",
  "Utilities",
  "Insurance",
  "Transportation",
  "Food",
  "Entertainment",
  "Health",
  "Education",
  "Savings",
  "Debt",
  "Other",
];

interface AddBillModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (bill: Omit<Bill, "id"> | Bill) => void;
  editBill?: Bill | null;
}

export function AddBillModal({ visible, onClose, onSave, editBill }: AddBillModalProps) {
  const c = useColors();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Other");
  const [priority, setPriority] = useState("1");

  useEffect(() => {
    if (editBill) {
      setName(editBill.name);
      setAmount(editBill.amount.toString());
      setCategory(editBill.category);
      setPriority(editBill.priority.toString());
    } else {
      setName("");
      setAmount("");
      setCategory("Other");
      setPriority("1");
    }
  }, [editBill, visible]);

  const handleSave = () => {
    const parsedAmount = parseFloat(amount);
    if (!name.trim() || isNaN(parsedAmount) || parsedAmount <= 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const billData = {
      name: name.trim(),
      amount: parsedAmount,
      category,
      priority: parseInt(priority) || 1,
    };
    if (editBill) {
      onSave({ ...billData, id: editBill.id });
    } else {
      onSave(billData);
    }
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.overlay}
      >
        <View style={[styles.container, { backgroundColor: c.background }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: c.foreground }]}>
              {editBill ? "Edit Bill" : "Add Bill"}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Feather name="x" size={22} color={c.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={[styles.label, { color: c.mutedForeground }]}>Bill Name</Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.card, color: c.foreground, borderColor: c.border }]}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Electric Bill"
              placeholderTextColor={c.mutedForeground}
            />

            <Text style={[styles.label, { color: c.mutedForeground }]}>Amount ($)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.card, color: c.foreground, borderColor: c.border }]}
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor={c.mutedForeground}
              keyboardType="decimal-pad"
            />

            <Text style={[styles.label, { color: c.mutedForeground }]}>Priority (1 = highest)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.card, color: c.foreground, borderColor: c.border }]}
              value={priority}
              onChangeText={setPriority}
              placeholder="1"
              placeholderTextColor={c.mutedForeground}
              keyboardType="number-pad"
            />

            <Text style={[styles.label, { color: c.mutedForeground }]}>Category</Text>
            <View style={styles.categoryGrid}>
              {CATEGORIES.map(cat => (
                <Pressable
                  key={cat}
                  onPress={() => setCategory(cat)}
                  style={[
                    styles.categoryChip,
                    {
                      backgroundColor: category === cat ? c.primary : c.muted,
                      borderRadius: colors.radius,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.categoryText,
                      { color: category === cat ? c.primaryForeground : c.mutedForeground },
                    ]}
                  >
                    {cat}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              onPress={handleSave}
              style={({ pressed }) => [
                styles.saveBtn,
                { backgroundColor: c.primary, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[styles.saveBtnText, { color: c.primaryForeground }]}>
                {editBill ? "Update Bill" : "Add Bill"}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  container: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: "85%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginBottom: 6,
    marginTop: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  categoryText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  saveBtn: {
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
    marginBottom: 20,
  },
  saveBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
});
