import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import colors from "@/constants/colors";
import { useColors } from "@/hooks/useColors";
import { useBackDismiss } from "@/hooks/useBackDismiss";

interface ExtraPaymentModalProps {
  visible: boolean;
  onClose: () => void;
  onApply: (amount: number, method: "smallest" | "priority") => void;
}

export function ExtraPaymentModal({ visible, onClose, onApply }: ExtraPaymentModalProps) {
  const c = useColors();
  useBackDismiss(visible, onClose);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"smallest" | "priority">("smallest");

  const handleApply = () => {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onApply(parsed, method);
    setAmount("");
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.overlay}
      >
        <View style={[styles.container, { backgroundColor: c.background }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: c.foreground }]}>Extra Payment</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Feather name="x" size={22} color={c.mutedForeground} />
            </Pressable>
          </View>

          <Text style={[styles.label, { color: c.mutedForeground }]}>Amount ($)</Text>
          <TextInput
            style={[styles.input, { backgroundColor: c.card, color: c.foreground, borderColor: c.border }]}
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            placeholderTextColor={c.mutedForeground}
            keyboardType="decimal-pad"
          />

          <Text style={[styles.label, { color: c.mutedForeground }]}>Payment Method</Text>
          <View style={styles.methodRow}>
            <Pressable
              onPress={() => setMethod("smallest")}
              style={[
                styles.methodBtn,
                {
                  backgroundColor: method === "smallest" ? c.primary : c.muted,
                  borderRadius: colors.radius,
                },
              ]}
            >
              <Feather
                name="trending-down"
                size={16}
                color={method === "smallest" ? c.primaryForeground : c.mutedForeground}
              />
              <Text
                style={[
                  styles.methodText,
                  { color: method === "smallest" ? c.primaryForeground : c.mutedForeground },
                ]}
              >
                Snowball (Smallest First)
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setMethod("priority")}
              style={[
                styles.methodBtn,
                {
                  backgroundColor: method === "priority" ? c.primary : c.muted,
                  borderRadius: colors.radius,
                },
              ]}
            >
              <Feather
                name="star"
                size={16}
                color={method === "priority" ? c.primaryForeground : c.mutedForeground}
              />
              <Text
                style={[
                  styles.methodText,
                  { color: method === "priority" ? c.primaryForeground : c.mutedForeground },
                ]}
              >
                Priority Order
              </Text>
            </Pressable>
          </View>

          <Pressable
            onPress={handleApply}
            style={({ pressed }) => [
              styles.applyBtn,
              { backgroundColor: c.primary, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[styles.applyText, { color: c.primaryForeground }]}>Apply Extra Payment</Text>
          </Pressable>
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
  methodRow: {
    gap: 8,
    marginTop: 4,
  },
  methodBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 14,
  },
  methodText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  applyBtn: {
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
    marginBottom: 20,
  },
  applyText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
});
