import assert from "node:assert/strict";
import test from "node:test";
import { createSimulatorEditorHistory } from "./simulatorEditorHistory";

function browser() {
  const entries = [{ state: { route: "forecast" } as any, href: "/monthly" }, { state: { route: "simulator" }, href: "/plan-simulator" }];
  let index = 1;
  const listeners = new Set<(event?: { state?: any }) => void>();
  const traversals: Array<() => void> = [];
  const host = {
    location: { get href() { return entries[index].href; } },
    history: {
      get state() { return entries[index].state; },
      pushState(state: any, _title: string, href = entries[index].href) { entries.splice(index + 1);entries.push({ state, href });index++; },
      back() { traversals.push(() => { if (!index) return;index--;const event = { state: entries[index].state };[...listeners].forEach(listener => listener(event)); }); },
    },
    addEventListener(_type: "popstate", fn: (event?: { state?: any }) => void) { listeners.add(fn); },
    removeEventListener(_type: "popstate", fn: (event?: { state?: any }) => void) { listeners.delete(fn); },
    flush() { traversals.shift()?.(); },
    get index() { return index; }, get pending() { return traversals.length; }, get listenerCount() { return listeners.size; },
  };
  return host;
}

test("repeated explicit Cancel, X, Add and Update consume one owned entry and next Back reaches the prior route", () => {
  const host = browser();let dismisses = 0;
  for (let i = 0; i < 8; i++) {
    const editor = createSimulatorEditorHistory(host, () => dismisses++);
    assert.equal(host.index, 2);editor.dispose();editor.dispose();assert.equal(host.pending, 1);host.flush();
    assert.equal(host.index, 1);assert.equal(host.location.href, "/plan-simulator");assert.equal(host.listenerCount, 0);
  }
  assert.equal(dismisses, 0);host.history.back();host.flush();assert.equal(host.location.href, "/monthly");
});

test("browser Back closes the editor once and cleanup cannot traverse a second time", () => {
  const host = browser();let dismisses = 0;
  const editor = createSimulatorEditorHistory(host, () => dismisses++);
  host.history.back();host.flush();assert.equal(dismisses, 1);editor.dispose();assert.equal(host.pending, 0);
  host.history.back();host.flush();assert.equal(host.location.href, "/monthly");assert.equal(dismisses, 1);assert.equal(host.listenerCount, 0);
});

test("rapid close then reopen waits for owned traversal instead of letting an old pop dismiss the new editor", () => {
  const host = browser();let firstClosed = 0, secondClosed = 0;
  const first = createSimulatorEditorHistory(host, () => firstClosed++);first.dispose();
  const second = createSimulatorEditorHistory(host, () => secondClosed++);
  assert.equal(host.index, 2);host.flush();assert.equal(host.index, 2);assert.equal(firstClosed, 0);assert.equal(secondClosed, 0);
  host.history.back();host.flush();assert.equal(secondClosed, 1);second.dispose();assert.equal(host.pending, 0);assert.equal(host.listenerCount, 0);
});

test("a queued editor closed before traversal settles never opens or leaves a listener", () => {
  const host = browser();let dismisses = 0;
  const first = createSimulatorEditorHistory(host, () => dismisses++);first.dispose();
  const second = createSimulatorEditorHistory(host, () => dismisses++);second.dispose();host.flush();
  assert.equal(host.index, 1);assert.equal(host.listenerCount, 0);assert.equal(dismisses, 0);
});

test("editor cleanup never consumes another route or another overlay's current history entry", () => {
  const host = browser();let dismisses = 0;
  const editor = createSimulatorEditorHistory(host, () => dismisses++);
  host.history.pushState({ route: "accounts", flowledgerLayer: "some-other-overlay" }, "", "/accounts");editor.dispose();
  assert.equal(host.pending, 0);assert.equal(host.location.href, "/accounts");assert.equal(host.listenerCount, 0);assert.equal(dismisses, 0);
});
