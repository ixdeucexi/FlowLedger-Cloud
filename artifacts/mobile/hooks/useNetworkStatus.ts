import { useEffect, useState } from "react";
import { Platform } from "react-native";

function browserOnlineState() {
  if (
    Platform.OS !== "web" ||
    typeof navigator === "undefined" ||
    typeof navigator.onLine !== "boolean"
  ) {
    return true;
  }
  return navigator.onLine;
}

export function useNetworkStatus() {
  const [online, setOnline] = useState(browserOnlineState);
  const [reconnected, setReconnected] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const handleOffline = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      setReconnected(false);
      setOnline(false);
    };
    const handleOnline = () => {
      setOnline(true);
      setReconnected(true);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => setReconnected(false), 2600);
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    setOnline(browserOnlineState());
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  return { online, reconnected };
}
