import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  APPEARANCE_PRESETS,
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  LEGACY_THEME_STORAGE_KEY,
  appearancePreset,
  createAppearanceWriter,
  normalizeAppearance,
  parseAppearance,
  type AppearancePreferences,
  type ThemeMode,
} from "@/lib/appearance";
export type { ThemeMode } from "@/lib/appearance";
export type AppFontStyle = "default";
type AppearancePatch = Partial<Omit<AppearancePreferences, "version">>;
type AppearanceUpdate =
  | AppearancePatch
  | ((current: Readonly<AppearancePreferences>) => AppearancePatch);
interface ThemeContextValue {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  appearance: AppearancePreferences;
  updateAppearance: (patch: AppearanceUpdate) => void;
  applyPreset: (id: string) => void;
  resetAppearance: () => void;
  presetName: string;
  saveError: boolean;
  retrySave: () => void;
  loadError: boolean;
  retryLoad: () => void;
  saving: boolean;
  fontStyle: AppFontStyle;
  setFontStyle: (style: AppFontStyle) => void;
  ready: boolean;
}
const ThemeContext = createContext<ThemeContextValue>({
  themeMode: "dark",
  setThemeMode() {},
  appearance: DEFAULT_APPEARANCE,
  updateAppearance() {},
  applyPreset() {},
  resetAppearance() {},
  presetName: "FlowLedger",
  saveError: false,
  retrySave() {},
  loadError: false,
  retryLoad() {},
  saving: false,
  fontStyle: "default",
  setFontStyle() {},
  ready: false,
});
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [appearance, setAppearance] =
      useState<AppearancePreferences>(DEFAULT_APPEARANCE),
    [ready, setReady] = useState(false),
    [saveError, setSaveError] = useState(false),
    [saving, setSaving] = useState(false),
    [loadError, setLoadError] = useState(false);
  const current = useRef(appearance),
    revision = useRef(0),
    mounted = useRef(true);
  const writer = useRef(
    createAppearanceWriter(async (value) => {
      await AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(value));
    }),
  );
  const hydration = useRef(0);
  const loadAppearance = useCallback(() => {
    const attempt = ++hydration.current,
      started = revision.current;
    const isCurrent = () =>
      mounted.current &&
      hydration.current === attempt &&
      revision.current === started;
    void Promise.all([
      AsyncStorage.getItem(APPEARANCE_STORAGE_KEY),
      AsyncStorage.getItem(LEGACY_THEME_STORAGE_KEY),
    ])
      .then(([raw, legacy]) => {
        if (!isCurrent()) return;
        const value = parseAppearance(raw, legacy);
        current.current = value;
        setAppearance(value);
        setLoadError(false);
      })
      .catch(() => {
        if (isCurrent()) setLoadError(true);
      })
      .finally(() => {
        if (mounted.current && hydration.current === attempt) setReady(true);
      });
  }, []);
  useEffect(() => {
    mounted.current = true;
    loadAppearance();
    return () => {
      mounted.current = false;
      hydration.current += 1;
    };
  }, [loadAppearance]);
  const persist = useCallback(
    (value: AppearancePreferences, generation: number) => {
      setSaving(true);
      setSaveError(false);
      void writer
        .current(value)
        .then(() => {
          if (mounted.current && revision.current === generation)
            setSaveError(false);
        })
        .catch(() => {
          if (mounted.current && revision.current === generation)
            setSaveError(true);
        })
        .finally(() => {
          if (mounted.current && revision.current === generation)
            setSaving(false);
        });
    },
    [],
  );
  const updateAppearance = useCallback(
    (patch: AppearanceUpdate) => {
      const value = normalizeAppearance({
        ...current.current,
        ...(typeof patch === "function" ? patch(current.current) : patch),
        version: 1,
      });
      revision.current += 1;
      current.current = value;
      setLoadError(false);
      setAppearance(value);
      persist(value, revision.current);
    },
    [persist],
  );
  const applyPreset = useCallback(
    (id: string) => {
      const preset = APPEARANCE_PRESETS.find((p) => p.id === id);
      if (preset) updateAppearance(preset.preferences);
    },
    [updateAppearance],
  );
  const resetAppearance = useCallback(
    () =>
      updateAppearance({ ...DEFAULT_APPEARANCE, calendarColors: undefined }),
    [updateAppearance],
  );
  const setThemeMode = useCallback(
    (themeMode: ThemeMode) => updateAppearance({ themeMode }),
    [updateAppearance],
  );
  const retrySave = useCallback(() => {
    revision.current += 1;
    persist(current.current, revision.current);
  }, [persist]);
  return (
    <ThemeContext.Provider
      value={{
        themeMode: appearance.themeMode,
        setThemeMode,
        appearance,
        updateAppearance,
        applyPreset,
        resetAppearance,
        presetName: appearancePreset(appearance)?.name ?? "Custom",
        saveError,
        saving,
        retrySave,
        loadError,
        retryLoad: loadAppearance,
        fontStyle: "default",
        setFontStyle() {},
        ready,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
export function useThemeMode() {
  return useContext(ThemeContext);
}
