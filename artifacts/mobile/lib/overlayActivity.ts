const active = new Set<symbol>();
const listeners = new Set<() => void>();
const interactions = new Set<() => void>();
export const overlayActivity = {
  interact: () => interactions.forEach((fn) => fn()),
  subscribeInteractions: (fn: () => void) => {
    interactions.add(fn);
    return () => {
      interactions.delete(fn);
    };
  },
  getSnapshot: () => active.size > 0,
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  register: () => {
    const token = Symbol();
    active.add(token);
    listeners.forEach((fn) => fn());
    return () => {
      active.delete(token);
      listeners.forEach((fn) => fn());
    };
  },
};
