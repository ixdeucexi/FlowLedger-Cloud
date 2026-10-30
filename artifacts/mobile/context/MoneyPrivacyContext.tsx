import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { readInterfacePreferences, updateInterfacePreferences, waitForInterfacePreferenceWrites } from "@/lib/interfacePreferences";
import { canCommitMoneyPrivacy, maskMoneyText, moneyPrivacyHouseholdScope, moneyPrivacyScope, readSettledMoneyPrivacy } from "@/lib/moneyPrivacy";

type Value = {
  hidden: boolean;
  ready: boolean;
  loadError: boolean;
  saveError: boolean;
  setHidden: (hidden: boolean) => void;
  toggle: () => void;
  retryLoad: () => void;
  retrySave: () => void;
  mask: (text: string) => string;
};
const fallback: Value = { hidden: false, ready: true, loadError: false, saveError: false, setHidden() {}, toggle() {}, retryLoad() {}, retrySave() {}, mask: text => text };
const Context = createContext<Value>(fallback);
type Snapshot = { scope: string | null; revision: number; hidden: boolean; ready: boolean; loadError: boolean; saveError: boolean };
type Intent = { promise: Promise<void>; state: "pending" | "saved" | "failed" };

export function MoneyPrivacyProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { activeHousehold, loading: budgetLoading, loadError: budgetLoadError } = useBudget();
  const userId = user?.id ?? null;
  const householdId = moneyPrivacyHouseholdScope({ userId, householdId: activeHousehold?.householdId ?? null, loading: budgetLoading, loadError: budgetLoadError });
  const scope = moneyPrivacyScope(userId, householdId);
  const current = useRef({ scope, revision: 0, hidden: true });
  if (current.current.scope !== scope) current.current = { scope, revision: current.current.revision + 1, hidden: true };
  const mounted = useRef(true);
  const hiddenRef = useRef(true);
  const intents = useRef(new Map<string, Intent>());
  const [snapshot, setSnapshot] = useState<Snapshot>({ scope: null, revision: -1, hidden: true, ready: false, loadError: false, saveError: false });
  const [retry, setRetry] = useState(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; hiddenRef.current = true; }; }, []);

  useEffect(() => {
    let active = true;
    if (!scope || !userId || !householdId) return () => { active = false; };
    const request = { scope, revision: current.current.revision };
    setSnapshot({ scope, revision: request.revision, hidden: true, ready: false, loadError: false, saveError: false });
    void readSettledMoneyPrivacy(
      async () => (await readInterfacePreferences(userId, householdId, true)).amountsHidden,
      () => waitForInterfacePreferenceWrites(userId, householdId),
      () => intents.current.get(scope)?.promise,
    ).then(hidden => {
      if (!active || !mounted.current || !canCommitMoneyPrivacy(request, current.current)) return;
      current.current.hidden = hidden;
      setSnapshot({ scope, revision: request.revision, hidden, ready: true, loadError: false, saveError: false });
    }).catch(() => {
      if (!active || !mounted.current || !canCommitMoneyPrivacy(request, current.current)) return;
      current.current.hidden = true;
      const intentState = intents.current.get(scope)?.state;
      const failedSave = intentState !== undefined && intentState !== "saved";
      setSnapshot({ scope, revision: request.revision, hidden: true, ready: true, loadError: !failedSave, saveError: failedSave });
    });
    return () => { active = false; };
  }, [householdId, retry, scope, userId]);

  const save = useCallback((hidden: boolean) => {
    if (!mounted.current || !scope || !userId || !householdId || current.current.scope !== scope) return;
    const request = { scope, revision: ++current.current.revision };
    current.current.hidden = hidden;
    setSnapshot({ scope, revision: request.revision, hidden, ready: true, loadError: false, saveError: false });
    const intent: Intent = { promise: updateInterfacePreferences(userId, householdId, { amountsHidden: hidden }, true), state: "pending" };
    intents.current.set(scope, intent);
    void intent.promise.then(() => {
      intent.state = "saved";
      if (mounted.current && canCommitMoneyPrivacy(request, current.current)) setSnapshot(state => ({ ...state, saveError: false }));
    }).catch(() => {
      intent.state = "failed";
      if (mounted.current && canCommitMoneyPrivacy(request, current.current)) setSnapshot(state => ({ ...state, saveError: true }));
    });
  }, [householdId, scope, userId]);
  const currentSnapshot = snapshot.scope === scope && snapshot.revision === current.current.revision;
  const hidden = !scope || !currentSnapshot || !snapshot.ready || snapshot.hidden;
  const ready = Boolean(scope && currentSnapshot && snapshot.ready);
  const toggle = useCallback(() => save(!current.current.hidden), [save]);
  const retrySave = useCallback(() => save(current.current.hidden), [save]);
  const retryLoad = useCallback(() => { current.current.revision += 1; setRetry(value => value + 1); }, []);
  hiddenRef.current = hidden;
  const mask = useCallback((text: string) => maskMoneyText(text, hiddenRef.current), []);
  const value = useMemo(() => ({ hidden, ready, setHidden: save, toggle, loadError: currentSnapshot && snapshot.loadError, saveError: currentSnapshot && snapshot.saveError, retryLoad, retrySave, mask }), [currentSnapshot, hidden, mask, ready, retryLoad, retrySave, save, snapshot.loadError, snapshot.saveError, toggle]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useMoneyPrivacy() { return useContext(Context); }
