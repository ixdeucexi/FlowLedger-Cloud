import NetInfo from "@react-native-community/netinfo";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

import { publishNetworkStatus, reachableNetworkState } from "@/lib/networkStatus";

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
  const [online, setOnline] = useState<boolean | null>(() => Platform.OS === "web" ? browserOnlineState() : null);
  const [reconnected, setReconnected] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web") {
      let previous: boolean | null = null;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      const unsubscribe = NetInfo.addEventListener(state => {
        const next = reachableNetworkState(state);
        setOnline(next);
        publishNetworkStatus(next);
        if (previous === false && next) {
          setReconnected(true);
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => setReconnected(false), 2600);
        } else if (!next) {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          setReconnected(false);
        }
        previous = next;
      });
      return () => {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        unsubscribe();
      };
    }
    if (typeof window === "undefined") return;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const handleOffline = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      setReconnected(false);
      setOnline(false);
      publishNetworkStatus(false);
    };
    const handleOnline = () => {
      setOnline(true);
      publishNetworkStatus(true);
      setReconnected(true);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => setReconnected(false), 2600);
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    const initial = browserOnlineState();
    setOnline(initial);
    publishNetworkStatus(initial);
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  return { online, reconnected };
}
