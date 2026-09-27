type HistoryHost = {
  history: { state: any; pushState(data: any, title: string, url?: string): void; back(): void };
  location: { href: string };
  addEventListener(type: "popstate", callback: () => void): void;
  removeEventListener(type: "popstate", callback: () => void): void;
};

// Browser traversal is asynchronous. A reopened editor must wait for a closed
// editor's owned nested pop before pushing entries or subscribing to Back.
const pendingOwnedPops = new WeakMap<HistoryHost, { afterPop: (() => void)[] }>();
function finishOwnedPop(host: HistoryHost, requestBack: boolean) {
  const pending = { afterPop: [] as (() => void)[] };
  pendingOwnedPops.set(host, pending);
  const settle = () => {
    host.removeEventListener("popstate", settle);
    pendingOwnedPops.delete(host);
    pending.afterPop.forEach(start => start());
  };
  host.addEventListener("popstate", settle);
  if (requestBack) host.history.back();
}

/** Opt-in nested view within one modal, with a single browser Back listener.
 * The editor entry retains useBackDismiss's existing lifetime; only the extra
 * nested entry is removed when the user leaves that view through UI controls. */
export function createNestedOverlayHistory(host: HistoryHost, onDismiss: () => void) {
  const editorToken = `flowledger-editor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let nestedToken: string | null = null, awaitingOwnedPop = false, wantsNested = false, disposed = false, started = false;
  const push = (token: string) => host.history.pushState({ ...(host.history.state ?? {}), flowledgerLayer: token }, "", host.location.href);
  const openNested = () => { nestedToken = `${editorToken}-history`; push(nestedToken); };
  const onPop = () => {
    if (disposed) return;
    if (awaitingOwnedPop) {
      awaitingOwnedPop = false;
      // UI Back owns exactly one entry, not the user's next navigation.
      if (host.history.state?.flowledgerLayer === editorToken) {
        if (wantsNested) openNested();
        return;
      }
    }
    nestedToken = null;
    onDismiss();
  };
  const start = () => {
    if (disposed) return;
    started = true; push(editorToken); host.addEventListener("popstate", onPop);
    if (wantsNested) openNested();
  };
  const pending = pendingOwnedPops.get(host);
  if (pending) pending.afterPop.push(start); else start();
  return {
    setNested(open: boolean) {
      wantsNested = open;
      if (disposed || !started || awaitingOwnedPop) return;
      if (open && !nestedToken) openNested();
      if (!open && nestedToken) {
        const token = nestedToken; nestedToken = null;
        if (host.history.state?.flowledgerLayer === token) { awaitingOwnedPop = true; host.history.back(); }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true; host.removeEventListener("popstate", onPop);
      const ownsNested = nestedToken && host.history.state?.flowledgerLayer === nestedToken;
      if (awaitingOwnedPop || ownsNested) finishOwnedPop(host, !awaitingOwnedPop);
      nestedToken = null;
    },
  };
}
