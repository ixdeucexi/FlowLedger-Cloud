import Feather from "@expo/vector-icons/Feather";
import * as Haptics from "@/lib/haptics";
import { usePathname, useRouter } from "expo-router";
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FloLogo } from "@/components/FloLogo";
import { useMembership } from "@/context/MembershipContext";
import { useColors } from "@/hooks/useColors";
import {
  dismissFloLauncher,
  isFloLauncherDismissed,
  restoreFloLauncher,
  subscribeFloLauncherVisibility,
} from "@/lib/floLauncherVisibility";
import {
  clampFloPosition,
  createFloDragSession,
  floLauncherBounds,
  readFloPosition,
  rememberFloPosition,
  shouldStartFloDrag,
  type FloPoint,
} from "@/lib/floLauncherPosition";

const UNDO_DURATION_MS = 5000;

const CONTEXT_BY_PATH: Record<
  string,
  { label: string; prompt: string; entityType: string }
> = {
  "/": {
    label: "Ask about my plan",
    prompt: "What should I know about my plan today?",
    entityType: "dashboard",
  },
  "/(tabs)": {
    label: "Ask about my plan",
    prompt: "What should I know about my plan today?",
    entityType: "dashboard",
  },
  "/(tabs)/bills": {
    label: "Ask about debts & bills",
    prompt: "What should I know about my bills and debts?",
    entityType: "bills",
  },
  "/bills": {
    label: "Ask about debts & bills",
    prompt: "What should I know about my bills and debts?",
    entityType: "bills",
  },
  "/(tabs)/transactions": {
    label: "Ask about activity",
    prompt: "What should I know about my recent activity?",
    entityType: "transactions",
  },
  "/transactions": {
    label: "Ask about activity",
    prompt: "What should I know about my recent activity?",
    entityType: "transactions",
  },
  "/(tabs)/monthly": {
    label: "Ask about my forecast",
    prompt: "What should I know about my forecast?",
    entityType: "forecast",
  },
  "/monthly": {
    label: "Ask about my forecast",
    prompt: "What should I know about my forecast?",
    entityType: "forecast",
  },
  "/(tabs)/category-budget": {
    label: "Ask about categories",
    prompt: "What should I know about my category plan?",
    entityType: "categories",
  },
  "/category-budget": {
    label: "Ask about categories",
    prompt: "What should I know about my category plan?",
    entityType: "categories",
  },
  "/snowball-plan": {
    label: "Ask about payoff",
    prompt: "What should I know about my debt payoff plan?",
    entityType: "debt_plan",
  },
  "/planned-debt-payment": {
    label: "Ask about this payment",
    prompt: "Help me understand this planned debt payment.",
    entityType: "debt_payment",
  },
  "/plan-simulator": {
    label: "Ask about this scenario",
    prompt: "Help me understand my current simulation.",
    entityType: "simulation",
  },
};

export function FloLauncher({ desktop }: { desktop: boolean }) {
  const c = useColors();
  const router = useRouter();
  const pathname = usePathname();
  const { isFeatureLocked } = useMembership();
  const dismissed = useSyncExternalStore(
    subscribeFloLauncherVisibility,
    isFloLauncherDismissed,
    () => false,
  );
  const [showUndo, setShowUndo] = useState(false);
  const insets = useSafeAreaInsets();
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [position, setPosition] = useState<FloPoint>({ x: 0, y: 0 });
  const positionRef = useRef(position);
  const dragSession = useRef(createFloDragSession()).current;
  const footprint = {
    width: dismissed && showUndo ? 208 : desktop ? 240 : 106,
    height: 54,
  };
  const bounds = floLauncherBounds(frame, footprint, insets, desktop);
  const place = (point: FloPoint, remember = true) => {
    const next = clampFloPosition(point, bounds);
    positionRef.current = next;
    setPosition(next);
    if (remember) rememberFloPosition(next, bounds);
  };
  const gestureContext = useRef({ bounds, place });
  gestureContext.current = { bounds, place };
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          shouldStartFloDrag(gesture.dx, gesture.dy),
        onPanResponderGrant: (_event, gesture) => {
          dragSession.suppressActivation();
          const point = dragSession.move(
            gesture.dx,
            gesture.dy,
            gestureContext.current.bounds,
          );
          if (point) gestureContext.current.place(point);
        },
        onPanResponderMove: (_event, gesture) => {
          const point = dragSession.move(
            gesture.dx,
            gesture.dy,
            gestureContext.current.bounds,
          );
          if (point) gestureContext.current.place(point);
        },
        onPanResponderRelease: () =>
          gestureContext.current.place(
            dragSession.finish(gestureContext.current.bounds),
          ),
        onPanResponderTerminate: () =>
          gestureContext.current.place(
            dragSession.cancel(gestureContext.current.bounds),
          ),
        onPanResponderTerminationRequest: () => true,
      }),
    [dragSession],
  );

  useEffect(() => {
    const next = readFloPosition(bounds);
    positionRef.current = next;
    setPosition(next);
  }, [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY]);

  useEffect(() => {
    if (!showUndo) return;
    const timer = setTimeout(() => setShowUndo(false), UNDO_DURATION_MS);
    return () => clearTimeout(timer);
  }, [showUndo]);

  if (isFeatureLocked("flo_account_chat") || pathname.endsWith("/flo"))
    return null;
  const context = CONTEXT_BY_PATH[pathname] ?? {
    label: "Ask Flo",
    prompt: "What should I know about my account?",
    entityType: "account",
  };

  const hideLauncher = () => {
    dragSession.suppressActivation();
    setShowUndo(true);
    dismissFloLauncher();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
      () => undefined,
    );
  };

  const undoDismissal = () => {
    setShowUndo(false);
    restoreFloLauncher();
    void Haptics.selectionAsync().catch(() => undefined);
  };

  if (dismissed && !showUndo) return null;
  const fits =
    frame.width >= footprint.width && frame.height >= footprint.height;

  return (
    <View
      pointerEvents="box-none"
      style={styles.overlay}
      onLayout={({ nativeEvent: { layout } }) =>
        setFrame((previous) =>
          previous.width === layout.width && previous.height === layout.height
            ? previous
            : { width: layout.width, height: layout.height },
        )
      }
    >
      {fits ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.slot,
            {
              left: clampFloPosition(position, bounds).x,
              top: clampFloPosition(position, bounds).y,
              width: footprint.width,
              height: footprint.height,
            },
          ]}
        >
          {dismissed ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Undo hiding the Flo shortcut"
              onPress={undoDismissal}
              style={({ pressed }) => [
                styles.undoButton,
                {
                  backgroundColor: c.card,
                  borderColor: c.primary + "70",
                  opacity: pressed ? 0.78 : 1,
                },
              ]}
            >
              <Feather name="eye-off" size={16} color={c.mutedForeground} />
              <Text style={[styles.undoCopy, { color: c.mutedForeground }]}>
                Flo hidden
              </Text>
              <Text style={[styles.undoAction, { color: c.primary }]}>
                Undo
              </Text>
            </Pressable>
          ) : (
            <>
              <View
                {...panResponder.panHandlers}
                style={Platform.OS === "web" ? styles.dragHandleWeb : undefined}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={context.label}
                  accessibilityHint="Tap to open Flo. Drag this shortcut to move it. Use the adjacent X button to hide it."
                  delayLongPress={650}
                  onPressIn={() => {
                    dragSession.begin(positionRef.current);
                  }}
                  onLongPress={() => dragSession.suppressActivation()}
                  onPress={() => {
                    if (!dragSession.canActivate()) return;
                    router.push({
                      pathname: "/(tabs)/flo",
                      params: {
                        prompt: context.prompt,
                        promptId: `context-${Date.now()}`,
                        sourceRoute: pathname,
                        entityType: context.entityType,
                      },
                    } as never);
                  }}
                  style={({ pressed }) => [
                    styles.button,
                    desktop && styles.buttonDesktop,
                    {
                      backgroundColor: c.card,
                      borderColor: c.primary + "70",
                      opacity: pressed ? 0.78 : 1,
                    },
                  ]}
                >
                  <FloLogo size={desktop ? 30 : 34} />
                  {desktop ? (
                    <Text style={[styles.label, { color: c.foreground }]}>
                      {context.label}
                    </Text>
                  ) : null}
                  {desktop ? (
                    <Feather
                      name="arrow-up-right"
                      size={15}
                      color={c.primary}
                    />
                  ) : null}
                </Pressable>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Hide Flo shortcut"
                accessibilityHint="Hides this shortcut until the app reopens. Flo remains available in Quick Actions."
                onPress={hideLauncher}
                style={[
                  styles.closeButton,
                  { backgroundColor: c.card, borderColor: c.primary },
                ]}
              >
                <Feather name="x" size={20} color={c.foreground} />
              </Pressable>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 35 },
  dragHandleWeb: { touchAction: "none", userSelect: "none" } as ViewStyle,
  slot: {
    position: "absolute",
    zIndex: 35,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  button: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#7c3aed",
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  buttonDesktop: {
    width: 188,
    borderRadius: 16,
    paddingHorizontal: 10,
    flexDirection: "row",
    gap: 8,
  },
  label: { flex: 1, fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  undoButton: {
    width: 208,
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  undoCopy: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  undoAction: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
});
