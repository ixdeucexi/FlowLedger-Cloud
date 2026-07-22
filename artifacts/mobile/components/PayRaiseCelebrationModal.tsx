import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { FloLogo } from "@/components/FloLogo";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";

interface Props {
  debtName?: string;
  difference: number;
  monthlyDifference: number;
  onClose: () => void;
  onViewDebt: () => void;
  visible: boolean;
}

const FIREWORK_PARTICLES = [
  { color: "#a855f7", x: -118, y: -48 }, { color: "#22d3ee", x: -92, y: -104 },
  { color: "#facc15", x: -42, y: -128 }, { color: "#fb7185", x: 18, y: -132 },
  { color: "#34d399", x: 74, y: -108 }, { color: "#60a5fa", x: 112, y: -58 },
  { color: "#f97316", x: 126, y: 4 }, { color: "#e879f9", x: 104, y: 62 },
  { color: "#2dd4bf", x: 58, y: 98 }, { color: "#fde047", x: 4, y: 112 },
  { color: "#818cf8", x: -56, y: 94 }, { color: "#fb7185", x: -104, y: 54 },
] as const;

function money(amount: number) {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PayRaiseCelebrationModal({ debtName, difference, monthlyDifference, onClose, onViewDebt, visible }: Props) {
  const c = useColors();
  const fireworkProgress = useRef(new Animated.Value(0)).current;
  useBackDismiss(visible, onClose);
  useEffect(() => {
    if (!visible) {
      fireworkProgress.stopAnimation();
      fireworkProgress.setValue(0);
      return;
    }
    fireworkProgress.setValue(0);
    Animated.sequence([
      Animated.delay(160),
      Animated.timing(fireworkProgress, {
        duration: 1_450,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fireworkProgress, visible]);
  const advice = debtName
    ? `Put the ${money(difference)} difference toward ${debtName} after each paycheck to speed up your Snowball.`
    : `Keep the ${money(difference)} difference in your plan until you choose its next job.`;

  return (
    <Modal visible={visible} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]} onPress={() => {}}>
          <View pointerEvents="none" style={styles.fireworks}>
            {FIREWORK_PARTICLES.map((particle, index) => (
              <Animated.View
                key={`${particle.x}:${particle.y}`}
                style={[
                  styles.particle,
                  {
                    backgroundColor: particle.color,
                    opacity: fireworkProgress.interpolate({ inputRange: [0, 0.08, 0.72, 1], outputRange: [0, 1, 0.92, 0] }),
                    transform: [
                      { translateX: fireworkProgress.interpolate({ inputRange: [0, 1], outputRange: [0, particle.x] }) },
                      { translateY: fireworkProgress.interpolate({ inputRange: [0, 1], outputRange: [0, particle.y] }) },
                      { rotate: fireworkProgress.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${180 + index * 37}deg`] }) },
                      { scale: fireworkProgress.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0.3, 1.15, 0.7] }) },
                    ],
                  },
                ]}
              />
            ))}
          </View>
          <View style={styles.logo}><FloLogo size={76} /></View>
          <Text style={[styles.eyebrow, { color: c.primary }]}>Flo noticed a raise</Text>
          <Text style={[styles.title, { color: c.foreground }]}>Congratulations!</Text>
          <Text style={[styles.message, { color: c.mutedForeground }]}>Your paycheck increased by {money(difference)}.</Text>
          <View style={[styles.breakdown, { backgroundColor: c.background, borderColor: c.border }]}>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>More each paycheck</Text>
              <Text style={[styles.rowValue, { color: c.success }]}>{money(difference)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>About more each month</Text>
              <Text style={[styles.rowValue, { color: c.success }]}>{money(monthlyDifference)}</Text>
            </View>
          </View>
          <View style={[styles.advice, { backgroundColor: c.primary + "18", borderColor: c.primary + "55" }]}>
            <Feather name="trending-down" size={18} color={c.primary} />
            <Text style={[styles.adviceText, { color: c.foreground }]}>{advice}</Text>
          </View>
          {debtName ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`View Snowball for ${debtName}`} onPress={onViewDebt} style={[styles.primary, { backgroundColor: c.primary }]}>
              <Text style={[styles.primaryText, { color: c.primaryForeground }]}>View Snowball</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Close raise celebration" onPress={onClose} style={[styles.secondary, { borderColor: c.border }]}>
            <Text style={[styles.secondaryText, { color: c.foreground }]}>Keep my current plan</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", padding: 20, backgroundColor: "rgba(0,0,0,0.72)" },
  card: { borderRadius: 30, borderWidth: 1, padding: 20, paddingTop: 24, overflow: "hidden", shadowColor: "#8b5cf6", shadowOpacity: 0.35, shadowRadius: 30, shadowOffset: { width: 0, height: 16 }, elevation: 14 },
  fireworks: { position: "absolute", left: "50%", top: 90, zIndex: 0 },
  particle: { position: "absolute", width: 8, height: 14, borderRadius: 3 },
  logo: { alignItems: "center" },
  eyebrow: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.2, textTransform: "uppercase", textAlign: "center", marginTop: 12 },
  title: { fontSize: 27, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.5, textAlign: "center", marginTop: 7 },
  message: { fontSize: 16, lineHeight: 23, textAlign: "center", marginTop: 7 },
  breakdown: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 10, marginTop: 16 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  rowLabel: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  rowValue: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  advice: { flexDirection: "row", alignItems: "flex-start", gap: 9, borderRadius: 16, borderWidth: 1, padding: 12, marginTop: 14 },
  adviceText: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  primary: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 16 },
  primaryText: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  secondary: { height: 50, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center", marginTop: 10 },
  secondaryText: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
