import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import colors from "@/constants/colors";
import { useColors } from "@/hooks/useColors";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

interface MonthPickerProps {
  selectedMonth: number;
  onSelect: (month: number) => void;
  year: number;
  onYearChange: (year: number) => void;
}

export function MonthPicker({ selectedMonth, onSelect, year, onYearChange }: MonthPickerProps) {
  const c = useColors();

  return (
    <View style={styles.container}>
      <View style={styles.yearRow}>
        <Pressable onPress={() => onYearChange(year - 1)} hitSlop={8}>
          <Feather name="chevron-left" size={20} color={c.foreground} />
        </Pressable>
        <Text style={[styles.yearText, { color: c.foreground }]}>{year}</Text>
        <Pressable onPress={() => onYearChange(year + 1)} hitSlop={8}>
          <Feather name="chevron-right" size={20} color={c.foreground} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.monthRow}>
        {MONTHS.map((m, i) => {
          const isSelected = selectedMonth === i;
          return (
            <Pressable
              key={m}
              onPress={() => onSelect(i)}
              style={[
                styles.monthChip,
                {
                  backgroundColor: isSelected ? c.primary : c.card,
                  borderRadius: colors.radius,
                },
              ]}
            >
              <Text
                style={[
                  styles.monthText,
                  { color: isSelected ? c.primaryForeground : c.mutedForeground },
                ]}
              >
                {m}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  yearRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    marginBottom: 12,
  },
  yearText: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  monthRow: {
    gap: 8,
    paddingHorizontal: 4,
  },
  monthChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  monthText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
});
