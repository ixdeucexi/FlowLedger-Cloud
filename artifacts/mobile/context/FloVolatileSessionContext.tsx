import React, { createContext, useContext, useLayoutEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { useMembership } from "@/context/MembershipContext";
import { createFloVolatileSession } from "@/lib/floVolatileSession";

type Session = { store: ReturnType<typeof createFloVolatileSession>; scope: string | null; epoch: number };
const FloVolatileContext = createContext<Session | null>(null);

/** Lives above tab routes, so leaving Flo cannot hide a logout/scope change. */
export function FloVolatileSessionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { activeHousehold, demoMode } = useBudget();
  const { isAdmin } = useMembership();
  const ref = useRef<ReturnType<typeof createFloVolatileSession> | null>(null);
  if (!ref.current) ref.current = createFloVolatileSession();
  const scope = !demoMode && isAdmin && user?.id && activeHousehold?.householdId
    ? `${user.id}:${activeHousehold.householdId}:${activeHousehold.budgetId ?? "personal"}:${activeHousehold.role}`
    : null;
  // Synchronous invalidation prevents an old screen's passive cleanup from
  // writing financial content into a new identity epoch before effects run.
  const epoch = ref.current.observeScope(scope);
  useLayoutEffect(() => {
    ref.current!.observeScope(scope);
    return () => ref.current?.clear();
  }, []);
  return <FloVolatileContext.Provider value={{ store: ref.current, scope, epoch }}>{children}</FloVolatileContext.Provider>;
}

export function useFloVolatileSession(): Session {
  const value = useContext(FloVolatileContext);
  if (!value) throw new Error("Flo temporary session provider is required");
  return value;
}
