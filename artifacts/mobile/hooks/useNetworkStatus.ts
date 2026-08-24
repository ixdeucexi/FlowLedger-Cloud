import NetInfo from "@react-native-community/netinfo";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
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

type NetworkStatusValue = {
  online: boolean | null;
  reconnected: boolean;
};

const NetworkStatusContext = createContext<NetworkStatusValue | null>(null);

export function NetworkStatusProvider({ children }: { children: React.ReactNode }) {
  const [online, setOnline] = useState<boolean | null>(() => Platform.OS === "web" ? browserOnlineState() : null);
  const [reconnected, setReconnected] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web") {
      let previous: boolean | null = null;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      let active = true;
      const applyState = (state: { isConnected: boolean | null; isInternetReachable: boolean | null }) => {
        if (!active) return;
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
      };
      const unsubscribe = NetInfo.addEventListener(applyState);
      void NetInfo.fetch().then(applyState).catch(() => {
        // Unknown remains fail-closed. The listener can recover when NetInfo resolves.
      });
      return () => {
        active = false;
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

  const value = useMemo(() => ({ online, reconnected }), [online, reconnected]);
  return React.createElement(NetworkStatusContext.Provider, { value }, children);
}

export function useNetworkStatus(): NetworkStatusValue {
  const value = useContext(NetworkStatusContext);
  if (!value) throw new Error("useNetworkStatus must be used inside NetworkStatusProvider.");
  return value;
}
