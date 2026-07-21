import { Feather } from "@expo/vector-icons";
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import {
  ZERO_BUDGET_LAB_BILLS,
  zeroBudgetLabBillPaid,
  type ZeroBudgetLabState,
} from "@/lib/zeroBudgetLab";

interface ZeroBudgetLabBillsProps {
  state: ZeroBudgetLabState;
  bottomInset: number;
}

export function ZeroBudgetLabBills({
  state,
  bottomInset,
}: ZeroBudgetLabBillsProps) {
  const c = useColors();
  const [year, month] = state.selectedMonth.split("-").map(Number);
  const bills = ZERO_BUDGET_LAB_BILLS.map((bill) => {
    const paid = zeroBudgetLabBillPaid(state, bill);
    return { ...bill, paid, left: Math.max(0, bill.amount - paid) };
  }).sort((left, right) => left.dueDay - right.dueDay);
  const paidCount = bills.filter((bill) => bill.left <= 0.005).length;

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingBottom: bottomInset + 112 },
      ]}
    >
      <View
        style={[
          styles.snapshot,
          { backgroundColor: c.card, borderColor: c.border },
        ]}
      >
        <View style={styles.snapshotHeader}>
          <View>
            <Text style={[styles.eyebrow, { color: c.primary }]}>
              BILL SNAPSHOT
            </Text>
            <Text style={[styles.snapshotTitle, { color: c.foreground }]}>
              Sample plan
            </Text>
          </View>
          <View
            style={[styles.paidPill, { backgroundColor: c.success + "18" }]}
          >
            <Text style={[styles.paidPillText, { color: c.success }]}>
              {paidCount} PAID
            </Text>
          </View>
        </View>
        <View style={styles.stats}>
          <Stat
            label="Scheduled"
            value={String(bills.length)}
            color={c.primary}
          />
          <Stat label="Paid" value={String(paidCount)} color={c.success} />
          <Stat
            label="Still open"
            value={`$${bills.reduce((sum, bill) => sum + bill.left, 0).toFixed(0)}`}
            color={c.warning}
          />
        </View>
      </View>
      <Text style={[styles.sectionTitle, { color: c.foreground }]}>
        Next occurrences
      </Text>
      {bills.map((bill) => {
        const paid = bill.left <= 0.005;
        const partial = bill.paid > 0.005 && !paid;
        const tone = paid ? c.success : partial ? c.warning : c.destructive;
        const occurrence = new Date(
          year,
          month - 1,
          bill.dueDay,
        ).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        });
        return (
          <View
            key={bill.id}
            style={[
              styles.billCard,
              { backgroundColor: c.card, borderColor: c.border },
            ]}
          >
            <View style={styles.billTop}>
              <View style={[styles.icon, { backgroundColor: tone + "18" }]}>
                <Feather name="file-text" size={17} color={tone} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.billName, { color: c.foreground }]}>
                  {bill.name}
                </Text>
                <Text style={[styles.billMeta, { color: c.mutedForeground }]}>
                  Next occurrence · {occurrence}
                </Text>
              </View>
              <View style={[styles.status, { backgroundColor: tone + "18" }]}>
                <Text style={[styles.statusText, { color: tone }]}>
                  {paid ? "PAID" : partial ? "PARTIAL" : "UNPAID"}
                </Text>
              </View>
            </View>
            <View style={styles.amountRow}>
              <Amount
                label="AMOUNT"
                value={`$${bill.amount.toFixed(2)}`}
                color={c.foreground}
              />
              <Amount
                label="PAID"
                value={`$${bill.paid.toFixed(2)}`}
                color={c.success}
              />
              <Amount
                label="LEFT"
                value={`$${bill.left.toFixed(2)}`}
                color={tone}
              />
            </View>
            {!paid && (
              <Text style={[styles.helper, { color: c.mutedForeground }]}>
                Assign money in Budget, then apply the matching fake transaction
                when it posts.
              </Text>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}
function Amount({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View style={styles.amount}>
      <Text style={styles.amountLabel}>{label}</Text>
      <Text style={[styles.amountValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 13 },
  snapshot: { borderWidth: 1, borderRadius: 24, padding: 17 },
  snapshotHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  eyebrow: { fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
  snapshotTitle: {
    fontSize: 23,
    fontFamily: "Inter_800ExtraBold",
    marginTop: 3,
  },
  paidPill: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  paidPillText: { fontSize: 9, fontFamily: "Inter_800ExtraBold" },
  stats: { flexDirection: "row", gap: 8, marginTop: 16 },
  stat: { flex: 1, minWidth: 0 },
  statValue: { fontSize: 19, fontFamily: "Inter_800ExtraBold" },
  statLabel: {
    color: "#94a3b8",
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: "Inter_800ExtraBold",
    marginTop: 4,
  },
  billCard: { borderWidth: 1, borderRadius: 22, padding: 15 },
  billTop: { flexDirection: "row", alignItems: "center", gap: 11 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  billName: { fontSize: 16, fontFamily: "Inter_800ExtraBold" },
  billMeta: { fontSize: 10, fontFamily: "Inter_500Medium", marginTop: 3 },
  status: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  statusText: { fontSize: 8, fontFamily: "Inter_800ExtraBold" },
  amountRow: { flexDirection: "row", gap: 8, marginTop: 15 },
  amount: {
    flex: 1,
    minWidth: 0,
    borderRadius: 13,
    backgroundColor: "rgba(2,6,23,0.18)",
    padding: 10,
  },
  amountLabel: {
    color: "#94a3b8",
    fontSize: 8,
    fontFamily: "Inter_800ExtraBold",
  },
  amountValue: { fontSize: 13, fontFamily: "Inter_800ExtraBold", marginTop: 4 },
  helper: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    lineHeight: 15,
    marginTop: 12,
  },
});
