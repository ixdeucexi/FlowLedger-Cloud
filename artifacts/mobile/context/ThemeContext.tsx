import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";

export type ThemeMode = "auto" | "dark" | "light";
export type AppFontStyle = "default" | "elegant" | "bold" | "playful" | "soft";

interface ThemeContextValue {
  themeMode: ThemeMode;
  setThemeMode: (m: ThemeMode) => void;
  fontStyle: AppFontStyle;
  setFontStyle: (m: AppFontStyle) => void;
  lightningFlashesEnabled: boolean;
  setLightningFlashesEnabled: (enabled: boolean) => void;
  ready: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  themeMode: "dark",
  setThemeMode: () => {},
  fontStyle: "default",
  setFontStyle: () => {},
  lightningFlashesEnabled: true,
  setLightningFlashesEnabled: () => {},
  ready: false,
});

const THEME_STORAGE_KEY = "@app_theme_v1";
const FONT_STORAGE_KEY = "@app_font_style_v1";
const LIGHTNING_STORAGE_KEY = "@flowledger_lightning_flashes_v1";

function isFontStyle(value: string | null): value is AppFontStyle {
  return value === "default" || value === "elegant" || value === "bold" || value === "playful" || value === "soft";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>("dark");
  const [fontStyle, setFontStyleState] = useState<AppFontStyle>("default");
  const [lightningFlashesEnabled, setLightningFlashesEnabledState] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      AsyncStorage.getItem(THEME_STORAGE_KEY),
      AsyncStorage.getItem(FONT_STORAGE_KEY),
      AsyncStorage.getItem(LIGHTNING_STORAGE_KEY),
    ])
      .then(([theme, font, lightning]) => {
        if (!mounted) return;
        if (theme === "auto" || theme === "dark" || theme === "light") {
          setThemeModeState(theme);
        }
        if (isFontStyle(font)) {
          setFontStyleState(font);
        }
        if (lightning === "false" || lightning === "true") {
          setLightningFlashesEnabledState(lightning === "true");
        }
      })
      .finally(() => {
        if (mounted) setReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const setThemeMode = (m: ThemeMode) => {
    setThemeModeState(m);
    AsyncStorage.setItem(THEME_STORAGE_KEY, m);
  };

  const setFontStyle = (m: AppFontStyle) => {
    setFontStyleState(m);
    AsyncStorage.setItem(FONT_STORAGE_KEY, m);
  };

  const setLightningFlashesEnabled = (enabled: boolean) => {
    setLightningFlashesEnabledState(enabled);
    AsyncStorage.setItem(LIGHTNING_STORAGE_KEY, enabled ? "true" : "false");
  };

  return (
    <ThemeContext.Provider
      value={{
        themeMode,
        setThemeMode,
        fontStyle,
        setFontStyle,
        lightningFlashesEnabled,
        setLightningFlashesEnabled,
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
