"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { usePlaidLink } from "react-plaid-link";

import { logPlaidClientStage } from "@/lib/plaidLaunchGuard";

type PlaidLinkLauncherProps = {
  linkToken: string | null;
  shouldOpen: boolean;
  onReadyChange?: (ready: boolean) => void;
  onOpened?: () => void;
  onSuccess: (publicToken: string, metadata: any) => void | Promise<void>;
  onExit: (error: any, metadata?: any) => void;
  onEvent?: (eventName: string, metadata: any) => void;
};

export type PlaidLinkLauncherHandle = {
  open: () => boolean;
  isReady: () => boolean;
};

export const PlaidLinkLauncher = forwardRef<PlaidLinkLauncherHandle, PlaidLinkLauncherProps>(function PlaidLinkLauncher({
  linkToken,
  shouldOpen,
  onReadyChange,
  onOpened,
  onSuccess,
  onExit,
  onEvent,
}: PlaidLinkLauncherProps, ref) {
  const openedForTokenRef = useRef<string | null>(null);
  const previousReadyRef = useRef<boolean | null>(null);

  const receivedRedirectUri = useMemo(() => {
    if (typeof window === "undefined") return undefined;
    return window.location.href.includes("oauth_state_id=") ? window.location.href : undefined;
  }, []);

  const { open, ready, error } = usePlaidLink({
    token: linkToken,
    receivedRedirectUri,
    onSuccess,
    onExit,
    onEvent,
  });

  useEffect(() => {
    if (!linkToken) {
      openedForTokenRef.current = null;
      previousReadyRef.current = null;
      return;
    }
    logPlaidClientStage("PLAID_LAUNCHER_MOUNTED");
    openedForTokenRef.current = null;
  }, [linkToken]);

  useEffect(() => {
    const nextReady = Boolean(linkToken && ready);
    onReadyChange?.(nextReady);
    if (!linkToken || previousReadyRef.current === nextReady) return;
    previousReadyRef.current = nextReady;
    logPlaidClientStage(nextReady ? "PLAID_READY_TRUE" : "PLAID_READY_FALSE");
  }, [linkToken, onReadyChange, ready]);

  useEffect(() => {
    if (!error) return;
    logPlaidClientStage("PLAID_ON_EXIT");
    onExit(error, null);
  }, [error, onExit]);

  const openLink = useCallback(() => {
    if (!linkToken || !ready) return false;
    if (openedForTokenRef.current === linkToken) return true;
    openedForTokenRef.current = linkToken;
    logPlaidClientStage("PLAID_OPEN_CALLED");
    onOpened?.();
    open();
    return true;
  }, [linkToken, onOpened, open, ready]);

  useImperativeHandle(ref, () => ({
    open: openLink,
    isReady: () => Boolean(linkToken && ready),
  }), [linkToken, openLink, ready]);

  useEffect(() => {
    if (!shouldOpen) return;
    openLink();
  }, [shouldOpen, openLink]);

  return null;
});
