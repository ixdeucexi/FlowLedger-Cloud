type HistoryPop = { state?: any };
type HistoryHost = {
  history: { state: any; pushState(data: any, title: string, url?: string): void; back(): void };
  location: { href: string };
  addEventListener(type: "popstate", callback: (event?: HistoryPop) => void): void;
  removeEventListener(type: "popstate", callback: (event?: HistoryPop) => void): void;
};

// Browser traversal is asynchronous. A freshly reopened editor must not claim
// history until the prior editor's UI-driven close has consumed its own entry.
const pendingOwnedPops = new WeakMap<HistoryHost, Array<() => void>>();

/** One simulator-only history owner. Other modals retain their existing policy. */
export function createSimulatorEditorHistory(host: HistoryHost, onBack: () => void) {
  const token = `flowledger-simulator-editor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let disposed = false, started = false;
  const onPop = () => {
    if (disposed || !started) return;
    started = false;
    host.removeEventListener("popstate", onPop);
    onBack();
  };
  const start = () => {
    if (disposed) return;
    started = true;
    host.history.pushState({ ...(host.history.state ?? {}), flowledgerLayer: token }, "", host.location.href);
    host.addEventListener("popstate", onPop);
  };
  const pending = pendingOwnedPops.get(host);
  if (pending) pending.push(start); else start();
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      host.removeEventListener("popstate", onPop);
      if (!started || host.history.state?.flowledgerLayer !== token) return;
      started = false;
      const waiting: Array<() => void> = [];
      pendingOwnedPops.set(host, waiting);
      const settle = () => {
        host.removeEventListener("popstate", settle);
        pendingOwnedPops.delete(host);
        waiting.forEach(resume => resume());
      };
      host.addEventListener("popstate", settle);
      host.history.back();
    },
  };
}
