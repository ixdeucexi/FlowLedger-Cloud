"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
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

  const openLink = useCallback(() => {
    if (!linkToken || !ready) return false;
    if (openedTokenRef.current === linkToken) return true;
    openedTokenRef.current = linkToken;
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

  useEffect(() => {
    if (!linkToken) openedTokenRef.current = null;
  }, [linkToken]);

  return null;
});
