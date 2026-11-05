const LOCK_ATTRIBUTE = "data-flowledger-app-lock";
const GATE_ATTRIBUTE = "data-flowledger-app-lock-gate";

function restoreAttribute(element: Element, name: string, value: string | null) {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

/** Isolate web modal portals without unmounting private editors or their drafts. */
export function isolateAppLockWebPortals(gate: HTMLElement): () => void {
  const document = gate.ownerDocument;
  const body = document.body;
  let gatePortal = gate;
  while (gatePortal.parentElement && gatePortal.parentElement !== body) {
    gatePortal = gatePortal.parentElement;
  }
  if (gatePortal.parentElement !== body) return () => {};

  const previousBodyMarker = body.getAttribute(LOCK_ATTRIBUTE);
  const previousGateMarker = gatePortal.getAttribute(GATE_ATTRIBUTE);
  const previousFocus = document.activeElement;
  const dialog = gate.closest('[aria-modal="true"]');
  const previousDialogRole = dialog?.getAttribute("role") ?? null;
  const isolated = new Map<Element, { inert: string | null; hidden: string | null }>();
  const style = document.createElement("style");
  // The selector covers newly appended/reordered portals before the observer
  // runs. Keep #root under its existing startup/privacy ownership.
  style.textContent = `
    body[${LOCK_ATTRIBUTE}] > :not(#root):not([${GATE_ATTRIBUTE}]) {
      visibility: hidden !important;
      pointer-events: none !important;
    }
  `;
  gatePortal.setAttribute(GATE_ATTRIBUTE, "");
  body.setAttribute(LOCK_ATTRIBUTE, "");
  document.head.appendChild(style);

  const isolatePortals = () => {
    // RN Web clears this role when another modal's late animation claims its
    // active stack. The locked host remains the single accessible dialog.
    if (dialog && dialog.getAttribute("role") !== "dialog") dialog.setAttribute("role", "dialog");
    for (const portal of Array.from(body.children)) {
      if (portal === gatePortal || portal.id === "root" || /^(SCRIPT|STYLE|LINK|NOSCRIPT)$/.test(portal.tagName)) continue;
      if (!isolated.has(portal)) {
        isolated.set(portal, {
          inert: portal.getAttribute("inert"),
          hidden: portal.getAttribute("aria-hidden"),
        });
      }
      if (!portal.hasAttribute("inert")) portal.setAttribute("inert", "");
      if (portal.getAttribute("aria-hidden") !== "true") portal.setAttribute("aria-hidden", "true");
    }
  };

  const focusable = () => Array.from(gate.querySelectorAll<HTMLElement>(
    'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
  )).filter(element => !element.hasAttribute("disabled")
    && element.getAttribute("aria-disabled") !== "true"
    && !element.closest("[inert]")
    && element.getClientRects().length > 0);

  let movingFocus = false;
  const focusGate = (last = false) => {
    if (movingFocus) return;
    movingFocus = true;
    try {
      const items = focusable();
      (items[last ? items.length - 1 : 0] ?? gate).focus({ preventScroll: true });
    } finally {
      movingFocus = false;
    }
  };
  const belongsToGate = (target: EventTarget | null) => target instanceof Node && gate.contains(target);
  const block = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onFocus = (event: FocusEvent) => {
    if (!belongsToGate(event.target)) {
      event.stopImmediatePropagation();
      focusGate();
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      block(event);
    } else if (event.key === "Tab") {
      block(event);
      const items = focusable();
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next = current < 0
        ? (event.shiftKey ? items.length - 1 : 0)
        : (current + (event.shiftKey ? -1 : 1) + items.length) % items.length;
      if (items[next]) items[next].focus({ preventScroll: true });
      else focusGate();
    } else if (!belongsToGate(event.target)) {
      block(event);
      focusGate();
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === "Escape" || !belongsToGate(event.target)) block(event);
  };
  const onOutsideInteraction = (event: Event) => {
    if (!belongsToGate(event.target)) {
      block(event);
      focusGate();
    }
  };

  // RN Web can promote an older modal when its opening animation ends. These
  // guards remain independent of that modal stack for the whole lock interval.
  document.addEventListener("focus", onFocus, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keyup", onKeyUp, true);
  document.addEventListener("pointerdown", onOutsideInteraction, true);
  document.addEventListener("click", onOutsideInteraction, true);
  isolatePortals();
  const observer = new MutationObserver(isolatePortals);
  observer.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ["inert", "aria-hidden", "role"] });
  focusGate();

  return () => {
    observer.disconnect();
    document.removeEventListener("focus", onFocus, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("keyup", onKeyUp, true);
    document.removeEventListener("pointerdown", onOutsideInteraction, true);
    document.removeEventListener("click", onOutsideInteraction, true);
    style.remove();
    for (const [portal, previous] of isolated) {
      restoreAttribute(portal, "inert", previous.inert);
      restoreAttribute(portal, "aria-hidden", previous.hidden);
    }
    restoreAttribute(gatePortal, GATE_ATTRIBUTE, previousGateMarker);
    restoreAttribute(body, LOCK_ATTRIBUTE, previousBodyMarker);
    if (dialog) restoreAttribute(dialog, "role", previousDialogRole);
    // Wait for the private wrapper's React props and modal teardown to finish.
    queueMicrotask(() => {
      if (!body.hasAttribute(LOCK_ATTRIBUTE) && previousFocus instanceof HTMLElement
        && previousFocus.isConnected && !previousFocus.closest("[inert]")) {
        previousFocus.focus({ preventScroll: true });
      }
    });
  };
}
