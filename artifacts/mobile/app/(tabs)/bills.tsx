import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useState } from "react";
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AddBillModal } from "@/components/AddBillModal";
import { BillRow } from "@/components/BillRow";
import { EmptyState } from "@/components/EmptyState";
import colors from "@/constants/colors";
import { useBudget, type Bill } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

export default function BillsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { bills, addBill, updateBill, deleteBill } = useBudget();
  const [modalVisible, setModalVisible] = useState(false);
  const [editBill, setEditBill] = useState<Bill | null>(null);

  const handleDelete = useCallback(
    (id: string) => {
      const bill = bills.find(b => b.id === id);
      Alert.alert("Delete Bill", `Remove "${bill?.name}"?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            deleteBill(id);
          },
        },
      ]);
    },
    [bills, deleteBill]
  );

  const handleSave = useCallback(
    (data: Omit<Bill, "id"> | Bill) => {
      if ("id" in data) {
        updateBill(data as Bill);
      } else {
        addBill(data);
      }
    },
    [addBill, updateBill]
  );

  const totalAmount = bills.reduce((sum, b) => sum + b.amount, 0);
  const webTopPad = Platform.OS === "web" ? 67 : 0;

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <View style={[styles.headerArea, { paddingTop: insets.top + 12 + webTopPad }]}>
        <View>
          <Text style={[styles.title, { color: c.foreground }]}>Payment Schedule</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
            {bills.length} bills | Total: ${totalAmount.toFixed(2)}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            setEditBill(null);
            setModalVisible(true);
          }}
          style={({ pressed }) => [
            styles.addBtn,
            { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Feather name="plus" size={20} color={c.primaryForeground} />
        </Pressable>
      </View>

      <FlatList
        data={bills}
        keyExtractor={item => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        scrollEnabled={bills.length > 0}
        ListEmptyComponent={
          <EmptyState
            icon="file-text"
            title="No Bills Yet"
            message="Add your first bill to get started tracking your budget."
            actionLabel="Add Bill"
            onAction={() => {
              setEditBill(null);
              setModalVisible(true);
            }}
          />
        }
        renderItem={({ item }) => (
          <BillRow
            name={item.name}
            amount={item.amount}
            category={item.category}
            onPress={() => {
              setEditBill(item);
              setModalVisible(true);
            }}
            onDelete={() => handleDelete(item.id)}
          />
        )}
      />

      <AddBillModal
        visible={modalVisible}
        onClose={() => {
          setModalVisible(false);
          setEditBill(null);
        }}
        onSave={handleSave}
        editBill={editBill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  headerArea: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    paddingHorizontal: 16,
  },
});
