import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";

export type ThemeMode = "auto" | "dark" | "light";
// Keep a single app-wide font family. Weight and tone provide hierarchy while
// avoiding the visual inconsistency of switching families between screens.
// This type remains in the context for backwards compatibility.
export type AppFontStyle = "default";

interface ThemeContextValue {
  themeMode: ThemeMode;
  setThemeMode: (m: ThemeMode) => void;
  fontStyle: AppFontStyle;
  setFontStyle: (m: AppFontStyle) => void;
  ready: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  themeMode: "dark",
  setThemeMode: () => {},
  fontStyle: "default",
  setFontStyle: () => {},
  ready: false,
});

const THEME_STORAGE_KEY = "@app_theme_v1";
const FONT_STORAGE_KEY = "@app_font_style_v1";

function isFontStyle(value: string | null): value is AppFontStyle {
  return value === "default";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>("dark");
  const [fontStyle, setFontStyleState] = useState<AppFontStyle>("default");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      AsyncStorage.getItem(THEME_STORAGE_KEY),
      AsyncStorage.getItem(FONT_STORAGE_KEY),
    ])
      .then(([theme, font]) => {
        if (!mounted) return;
        if (theme === "auto" || theme === "dark" || theme === "light") {
          setThemeModeState(theme);
        }
        if (isFontStyle(font)) setFontStyleState(font);
        else if (font != null) void AsyncStorage.setItem(FONT_STORAGE_KEY, "default");
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

  return (
    <ThemeContext.Provider
      value={{
        themeMode,
        setThemeMode,
        fontStyle,
        setFontStyle,
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
