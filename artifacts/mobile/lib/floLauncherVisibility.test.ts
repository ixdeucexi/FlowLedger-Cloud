import assert from "node:assert/strict";
import test from "node:test";

import {
  dismissFloLauncher,
  isFloLauncherDismissed,
  restoreFloLauncher,
  subscribeFloLauncherVisibility,
} from "./floLauncherVisibility";

test("Flo launcher dismissal lasts for the current app session and can be undone", () => {
  restoreFloLauncher();
  assert.equal(isFloLauncherDismissed(), false);

  let changes = 0;
  const unsubscribe = subscribeFloLauncherVisibility(() => {
    changes += 1;
  });

  dismissFloLauncher();
  assert.equal(isFloLauncherDismissed(), true);
  assert.equal(changes, 1);

  dismissFloLauncher();
  assert.equal(changes, 1);

  restoreFloLauncher();
  assert.equal(isFloLauncherDismissed(), false);
  assert.equal(changes, 2);

  unsubscribe();
});
