import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";

export type ThemeMode = "auto" | "dark" | "light";

interface ThemeContextValue {
  themeMode: ThemeMode;
  setThemeMode: (m: ThemeMode) => void;
  ready: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  themeMode: "dark",
  setThemeMode: () => {},
  ready: false,
});

const STORAGE_KEY = "@app_theme_v1";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>("dark");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then(val => {
        if (!mounted) return;
        if (val === "auto" || val === "dark" || val === "light") {
          setThemeModeState(val);
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
    AsyncStorage.setItem(STORAGE_KEY, m);
  };

  return (
    <ThemeContext.Provider value={{ themeMode, setThemeMode, ready }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeMode() {
  return useContext(ThemeContext);
}
