"use client";

import { useEffect, useRef } from "react";
import { usePlaidLink } from "react-plaid-link";

type PlaidLinkLauncherProps = {
  linkToken: string | null;
  shouldOpen: boolean;
  onReadyChange?: (ready: boolean) => void;
  onOpened?: () => void;
  onSuccess: (publicToken: string, metadata: any) => void | Promise<void>;
  onExit: (error: any, metadata?: any) => void;
  onEvent?: (eventName: string, metadata: any) => void;
};

export function PlaidLinkLauncher({
  linkToken,
  shouldOpen,
  onReadyChange,
  onOpened,
  onSuccess,
  onExit,
  onEvent,
}: PlaidLinkLauncherProps) {
  const openedTokenRef = useRef<string | null>(null);
  const { open, ready, error } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit,
    onEvent,
  });

  useEffect(() => {
    onReadyChange?.(Boolean(linkToken && ready));
  }, [linkToken, onReadyChange, ready]);

  useEffect(() => {
    if (!error) return;
    onExit(error, null);
  }, [error, onExit]);

  useEffect(() => {
    if (!linkToken || !shouldOpen || !ready) return;
    if (openedTokenRef.current === linkToken) return;
    openedTokenRef.current = linkToken;
    onOpened?.();
    open();
  }, [linkToken, onOpened, open, ready, shouldOpen]);

  useEffect(() => {
    if (!linkToken) openedTokenRef.current = null;
  }, [linkToken]);

  return null;
}
