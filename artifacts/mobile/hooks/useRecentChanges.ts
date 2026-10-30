import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { loadRecentChanges } from "@/lib/recentChangesApi";
import { appendRecentChanges, createRecentChangesRequestGate, recentChangesScopeKey, type RecentChange, type RecentChangesScope } from "@/lib/recentChanges";

interface HistoryState {
  scope: string | null;
  items: RecentChange[];
  cursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  failedMore: boolean;
}
const empty = (scope: string | null): HistoryState => ({ scope, items: [], cursor: null, loading: false, loadingMore: false, error: null, failedMore: false });

export function useRecentChanges() {
  const { user, demoMode } = useAuth();
  const { activeHousehold } = useBudget();
  const userId = user?.id ?? null, householdId = activeHousehold?.householdId ?? null, budgetId = activeHousehold?.budgetId ?? null;
  const scope: RecentChangesScope | null = userId && householdId && budgetId ? { userId, householdId, budgetId } : null;
  const scopeKey = recentChangesScopeKey(scope);
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const gate = useRef(createRecentChangesRequestGate()).current;
  gate.setScope(scopeKey);
  const mounted = useRef(true);
  const inFlight = useRef<{ scope: string | null; generation: number } | null>(null);
  const [state, setState] = useState<HistoryState>(() => ({ ...empty(scopeKey), loading: Boolean(scopeKey && !demoMode) }));
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; gate.invalidate(); }; }, [gate]);
  const load = useCallback(async (more: boolean) => {
    const requestScope = userId && householdId && budgetId ? { userId, householdId, budgetId } : null;
    const key = recentChangesScopeKey(requestScope);
    if (!requestScope || !key || key !== scopeRef.current || demoMode) return;
    const current = stateRef.current.scope === key ? stateRef.current : empty(key);
    if (more && (!current.cursor || inFlight.current?.scope === key)) return;
    const token = gate.begin();
    inFlight.current = token;
    setState({ ...current, scope: key, loading: !more, loadingMore: more, error: null });
    try {
      const page = await loadRecentChanges(requestScope, more ? current.cursor : null);
      if (!mounted.current || !gate.isCurrent(token)) return;
      setState({ scope: key, items: more ? appendRecentChanges(current.items, page.items) : page.items, cursor: page.nextCursor, loading: false, loadingMore: false, error: null, failedMore: false });
    } catch (error) {
      if (!mounted.current || !gate.isCurrent(token)) return;
      setState({ ...current, scope: key, loading: false, loadingMore: false, error: error instanceof Error ? error.message : "Recent changes could not be loaded. Try again.", failedMore: more });
    } finally {
      if (inFlight.current === token) inFlight.current = null;
    }
  }, [budgetId, demoMode, gate, householdId, userId]);
  const refresh = useCallback(() => load(false), [load]);
  const loadMore = useCallback(() => load(true), [load]);
  const retry = useCallback(() => load(stateRef.current.failedMore), [load]);
  useEffect(() => {
    setState(empty(scopeKey));
    if (scopeKey && !demoMode) void refresh();
    return () => gate.invalidate();
  }, [demoMode, gate, refresh, scopeKey]);
  const visible = state.scope === scopeKey ? state : { ...empty(scopeKey), loading: Boolean(scopeKey && !demoMode) };
  return { ...visible, scopeKey, ready: Boolean(scopeKey), demoMode, refresh, loadMore, retry };
}
