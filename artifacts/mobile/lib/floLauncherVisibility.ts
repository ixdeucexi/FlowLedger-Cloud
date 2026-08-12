type FloLauncherVisibilityListener = () => void;

let dismissedForSession = false;
const listeners = new Set<FloLauncherVisibilityListener>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export function isFloLauncherDismissed() {
  return dismissedForSession;
}

export function dismissFloLauncher() {
  if (dismissedForSession) return;
  dismissedForSession = true;
  emitChange();
}

export function restoreFloLauncher() {
  if (!dismissedForSession) return;
  dismissedForSession = false;
  emitChange();
}

export function subscribeFloLauncherVisibility(
  listener: FloLauncherVisibilityListener,
) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
