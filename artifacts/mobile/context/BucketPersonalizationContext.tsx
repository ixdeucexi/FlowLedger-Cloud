import Feather from "@expo/vector-icons/Feather";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { BucketAppearanceModal } from "@/components/BucketAppearanceModal";
import { useBudget } from "@/context/BudgetContext";
import { useBucketAppearance } from "@/hooks/useBucketAppearance";
import { useColors } from "@/hooks/useColors";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import {
  observeBucketMilestones,
  type BucketMilestone,
  type MilestoneObservation,
} from "@/lib/bucketAppearance";
import { getBucketAppearanceStore } from "@/lib/bucketAppearanceRuntime";

const Context = createContext({ active: false, open: (_goalId: string) => {} });
export const useBucketPersonalization = () => useContext(Context);
/** A single host keeps personalization separate from financial editors. */
export function BucketPersonalizationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const c = useColors(),
    reduceMotion = useReducedMotion();
  const { goals, loading, startupCoreReady, saveStatus, demoMode } =
    useBudget();
  const appearance = useBucketAppearance("observer");
  const [selected, setSelected] = useState<{
    key: string;
    goalId: string;
  } | null>(null);
  const [moments, setMoments] = useState<{
    key: string;
    values: BucketMilestone[];
  } | null>(null);
  const previous = useRef<MilestoneObservation>(null),
    claimed = useRef(new Set<string>());
  const fade = useRef(new Animated.Value(1)).current;
  const goal =
    selected?.key === appearance.key && appearance.enabled
      ? goals.find((g) => g.id === selected.goalId)
      : undefined;
  const moment =
    moments?.key === appearance.key && appearance.enabled
      ? moments.values[0]
      : undefined;
  const open = useCallback(
    (goalId: string) => {
      if (appearance.enabled && goals.some((g) => g.id === goalId))
        setSelected({ key: appearance.key, goalId });
    },
    [appearance.enabled, appearance.key, goals],
  );
  useEffect(() => {
    setSelected(null);
    setMoments(null);
    previous.current = null;
    claimed.current.clear();
  }, [appearance.key]);
  useEffect(() => {
    if (selected && !loading && startupCoreReady && !goal) setSelected(null);
  }, [selected, goal, loading, startupCoreReady]);
  useEffect(() => {
    const snapshot = goals.map((g) => ({
      id: g.id,
      name: g.name,
      goal_type: g.goal_type ?? "savings",
      target_amount: g.target_amount,
      current_amount: g.current_amount,
      closed_at: g.closed_at,
      archived_at: g.archived_at,
    }));
    const observation = observeBucketMilestones(
      previous.current,
      appearance.key,
      snapshot,
      appearance.data,
      {
        ready:
          !loading &&
          startupCoreReady &&
          appearance.ready &&
          !appearance.loadError,
        saving: saveStatus === "saving",
        failed: saveStatus === "failed",
        confirmed: saveStatus === "saved" || demoMode,
      },
    );
    previous.current = observation.previous;
    const events = observation.events.filter(
      (event) => !claimed.current.has(`${appearance.key}:${event.key}`),
    );
    if (!events.length) return;
    events.forEach((event) =>
      claimed.current.add(`${appearance.key}:${event.key}`),
    );
    const key = appearance.key;
    void getBucketAppearanceStore(appearance.scope)
      .markSeen(
        events.map((e) => e.key),
        appearance.current,
      )
      .then(() => {
        const enabled = events.filter(
          (event) =>
            getBucketAppearanceStore(appearance.scope).getSnapshot().data.looks[
              event.goalId
            ]?.celebrateCompletion,
        );
        if (appearance.current() && enabled.length)
          setMoments((current) => ({
            key,
            values: [
              ...(current?.key === key ? current.values : []),
              ...enabled,
            ],
          }));
      })
      .catch(() => {
        events.forEach((event) =>
          claimed.current.delete(`${key}:${event.key}`),
        );
      });
  }, [
    appearance.key,
    appearance.ready,
    appearance.loadError,
    appearance.data,
    goals,
    loading,
    startupCoreReady,
    saveStatus,
    demoMode,
  ]);
  const dismiss = useCallback(
    () =>
      setMoments((current) =>
        current?.values.length
          ? { ...current, values: current.values.slice(1) }
          : null,
      ),
    [],
  );
  useEffect(() => {
    if (!moment) return;
    fade.setValue(reduceMotion ? 1 : 0);
    if (!reduceMotion)
      Animated.timing(fade, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    const timer = setTimeout(dismiss, 6000);
    return () => clearTimeout(timer);
  }, [moment?.key, reduceMotion, dismiss, fade]);
  return (
    <Context.Provider value={{ active: Boolean(goal), open }}>
      {children}
      {goal ? (
        <BucketAppearanceModal
          goalId={goal.id}
          name={goal.name}
          onClose={() => setSelected(null)}
        />
      ) : null}
      {moment ? (
        <View pointerEvents="box-none" style={styles.toastPosition}>
          <Animated.View
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[
              styles.toast,
              {
                backgroundColor: c.card,
                borderColor: c.primary + "66",
                opacity: fade,
              },
            ]}
          >
            <View style={[styles.star, { backgroundColor: c.primary + "20" }]}>
              <Feather name="award" size={26} color={c.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.toastTitle, { color: c.foreground }]}>
                {moment.label}
              </Text>
              <Text style={[styles.toastCopy, { color: c.mutedForeground }]}>
                {moment.name} · A step worth celebrating.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss milestone celebration"
              onPress={dismiss}
              style={styles.dismiss}
            >
              <Feather name="x" color={c.mutedForeground} size={18} />
            </Pressable>
          </Animated.View>
        </View>
      ) : null}
    </Context.Provider>
  );
}
const styles = StyleSheet.create({
  toastPosition: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 120,
  },
  toast: {
    width: "100%",
    maxWidth: 460,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 10,
  },
  star: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  toastTitle: { fontFamily: "Inter_700Bold", fontSize: 16 },
  toastCopy: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  dismiss: {
    width: 40,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
