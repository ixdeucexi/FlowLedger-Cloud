import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { FloLogo } from "@/components/FloLogo";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";

export type DebtPaymentAppliedDetail = {
  debtName: string;
  amount: number;
  paymentDate: string;
  scheduled?: boolean;
  balanceBefore?: number;
  balanceAfter?: number;
  rolledToDebtName?: string;
  extraMessage?: string;
};

interface Props {
  visible: boolean;
  detail: DebtPaymentAppliedDetail | null;
  onClose: () => void;
}

const CELEBRATION_PARTICLES = [
  { color: "#a855f7", x: -124, y: -44 }, { color: "#22d3ee", x: -96, y: -98 },
  { color: "#facc15", x: -46, y: -126 }, { color: "#fb7185", x: 12, y: -132 },
  { color: "#34d399", x: 68, y: -112 }, { color: "#60a5fa", x: 108, y: -68 },
  { color: "#f97316", x: 128, y: -8 }, { color: "#e879f9", x: 110, y: 52 },
  { color: "#2dd4bf", x: 68, y: 94 }, { color: "#fde047", x: 12, y: 110 },
  { color: "#818cf8", x: -50, y: 98 }, { color: "#fb7185", x: -108, y: 48 },
] as const;

function money(amount?: number) {
  if (amount === undefined || !Number.isFinite(amount)) return "—";
  return `$${Math.max(0, amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function DebtPaymentAppliedModal({ visible, detail, onClose }: Props) {
  const c = useColors();
  const celebration = useRef(new Animated.Value(0)).current;
  useBackDismiss(visible, onClose);
  const paidOff = detail?.balanceAfter !== undefined && detail.balanceAfter <= 0.005;

  useEffect(() => {
    if (!visible || !paidOff) {
      celebration.stopAnimation();
      celebration.setValue(0);
      return;
    }

    celebration.setValue(0);
    Animated.sequence([
      Animated.delay(120),
      Animated.timing(celebration, {
        toValue: 1,
        duration: 1_650,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [celebration, paidOff, visible]);

  if (!detail) return null;

  const title = paidOff
    ? `You paid off ${detail.debtName}!`
    : detail.scheduled
      ? "I scheduled your debt payment"
      : "I updated your debt balance";
  const message = paidOff
    ? `${detail.debtName} is at $0.00. Take a moment—you earned this win.`
    : detail.scheduled
    ? `I scheduled ${money(detail.amount)} for ${detail.debtName} on ${formatDate(detail.paymentDate)}. I’ll subtract it from the Debt page when that date arrives.`
    : `I subtracted ${money(detail.amount)} from ${detail.debtName} on the Debt page.`;
  const rollover = paidOff
    ? detail.rolledToDebtName
      ? `${detail.debtName} is paid off, so I’ll roll its payment into ${detail.rolledToDebtName} next.`
      : `${detail.debtName} is paid off. If that was your last active debt, your snowball is complete.`
    : undefined;

  return (
    <Modal visible={visible} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]} onPress={() => {}}>
          {paidOff && (
            <View pointerEvents="none" style={styles.fireworks}>
              {CELEBRATION_PARTICLES.map((particle, index) => (
                <Animated.View
                  key={`${particle.x}:${particle.y}`}
                  style={[
                    styles.particle,
                    {
                      backgroundColor: particle.color,
                      opacity: celebration.interpolate({ inputRange: [0, 0.08, 0.72, 1], outputRange: [0, 1, 0.92, 0] }),
                      transform: [
                        { translateX: celebration.interpolate({ inputRange: [0, 1], outputRange: [0, particle.x] }) },
                        { translateY: celebration.interpolate({ inputRange: [0, 1], outputRange: [0, particle.y] }) },
                        { rotate: celebration.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${180 + index * 37}deg`] }) },
                        { scale: celebration.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0.3, 1.15, 0.7] }) },
                      ],
                    },
                  ]}
                />
              ))}
            </View>
          )}
          <View style={styles.floWrap}>
            <FloLogo size={76} />
            {paidOff && (
              <View style={styles.celebrationBadge}>
                <Feather name="star" size={12} color="#422006" />
              </View>
            )}
          </View>
          <Text style={[styles.eyebrow, { color: paidOff ? c.success : c.primary }]}>
            {paidOff ? "Flo is celebrating with you" : "Flo updated the plan"}
          </Text>
          <Text style={[styles.title, { color: c.foreground }]}>{title}</Text>
          <Text style={[styles.message, { color: c.mutedForeground }]}>{message}</Text>

          <View style={[styles.breakdown, { backgroundColor: c.background, borderColor: c.border }]}>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>Payment</Text>
              <Text style={[styles.rowValue, { color: c.success }]}>{money(detail.amount)}</Text>
            </View>
            {detail.balanceBefore !== undefined && (
              <View style={styles.row}>
                <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>Before</Text>
                <Text style={[styles.rowValue, { color: c.foreground }]}>{money(detail.balanceBefore)}</Text>
              </View>
            )}
            {detail.balanceAfter !== undefined && (
              <View style={styles.row}>
                <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>After</Text>
                <Text style={[styles.rowValue, { color: paidOff ? c.success : c.foreground }]}>{money(detail.balanceAfter)}</Text>
              </View>
            )}
          </View>

          {rollover && (
            <View style={[styles.rollover, { backgroundColor: c.primary + "18", borderColor: c.primary + "55" }]}>
              <Feather name="repeat" size={17} color={c.primary} />
              <Text style={[styles.rolloverText, { color: c.foreground }]}>{rollover}</Text>
            </View>
          )}
          {detail.extraMessage && !rollover && (
            <View style={[styles.rollover, { backgroundColor: c.primary + "18", borderColor: c.primary + "55" }]}>
              <Feather name="zap" size={17} color={c.primary} />
              <Text style={[styles.rolloverText, { color: c.foreground }]}>{detail.extraMessage}</Text>
            </View>
          )}

          <Pressable accessibilityRole="button" accessibilityLabel={paidOff ? "Close debt payoff celebration" : "Close debt payment update"} onPress={onClose} style={[styles.primary, { backgroundColor: c.primary }]}>
            <Text style={[styles.primaryText, { color: c.primaryForeground }]}>{paidOff ? "Keep going" : "Got it"}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", padding: 20, backgroundColor: "rgba(0,0,0,0.7)" },
  card: { width: "100%", maxWidth: 480, alignSelf: "center", borderRadius: 30, borderWidth: 1, padding: 20, paddingTop: 24, overflow: "hidden", shadowColor: "#8b5cf6", shadowOpacity: 0.35, shadowRadius: 30, shadowOffset: { width: 0, height: 16 }, elevation: 14 },
  fireworks: { position: "absolute", left: "50%", top: 90, zIndex: 0 },
  particle: { position: "absolute", width: 8, height: 14, borderRadius: 3 },
  floWrap: { alignItems: "center", alignSelf: "center" },
  celebrationBadge: { position: "absolute", right: -2, top: -3, width: 25, height: 25, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#fde047", borderWidth: 2, borderColor: "#0f172a" },
  eyebrow: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.2, textTransform: "uppercase", textAlign: "center", marginTop: 12 },
  title: { fontSize: 24, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.5, textAlign: "center", marginTop: 8 },
  message: { fontSize: 15, lineHeight: 22, textAlign: "center", marginTop: 8 },
  breakdown: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 10, marginTop: 16 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  rowLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  rowValue: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  rollover: { flexDirection: "row", alignItems: "flex-start", gap: 9, borderRadius: 16, borderWidth: 1, padding: 12, marginTop: 14 },
  rolloverText: { flex: 1, fontSize: 13, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
  primary: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 16 },
  primaryText: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
});
