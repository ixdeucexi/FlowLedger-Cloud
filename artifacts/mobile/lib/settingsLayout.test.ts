import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getForecastSafetyLayout,
  isCompactSettingsLayout,
  SETTINGS_STACK_BREAKPOINT,
  shouldExpandReportDetails,
  shouldStackAccountControls,
  shouldStackSettingsMetrics,
} from "./settingsLayout";

describe("Forecast Safety responsive layout", () => {
  it("stacks full-width fields on common phone widths without collapsing them", () => {
    for (const width of [360, 390, 412]) {
      const layout = getForecastSafetyLayout(width);

      assert.equal(layout.stacked, true);
      assert.equal(layout.fields.flexDirection, "column");
      assert.equal(layout.fields.alignItems, "stretch");
      assert.equal(layout.field.width, "100%");
      assert.equal(layout.field.flexBasis, undefined);
      assert.equal(layout.input.width, "100%");
      assert.equal(layout.input.minHeight, 48);
    }
  });

  it("uses two intrinsic columns at and above the desktop breakpoint", () => {
    const layout = getForecastSafetyLayout(SETTINGS_STACK_BREAKPOINT);

    assert.equal(layout.stacked, false);
    assert.equal(layout.fields.flexDirection, "row");
    assert.equal(layout.field.flexGrow, 1);
    assert.equal(layout.field.flexShrink, 1);
    assert.equal(layout.field.flexBasis, 0);
  });
});

it("stacks Settings row status below long labels under zoom pressure", () => {
  assert.equal(isCompactSettingsLayout(240), true);
  assert.equal(isCompactSettingsLayout(275), true);
  assert.equal(isCompactSettingsLayout(320), false);
  assert.equal(isCompactSettingsLayout(360), false);
});

it("stacks Settings metrics instead of collapsing values under enlarged text", () => {
  for (const width of [240, 260, 275]) {
    assert.equal(shouldStackSettingsMetrics(width), true);
  }
  for (const width of [320, 360, 390, 412]) {
    assert.equal(shouldStackSettingsMetrics(width), false);
  }
});

it("stacks account controls and expands report details under enlarged text", () => {
  for (const width of [240, 260, 275]) {
    assert.equal(shouldExpandReportDetails(width), true);
    assert.equal(shouldStackAccountControls(width), true);
  }
  for (const width of [320, 360, 390, 412]) {
    assert.equal(shouldExpandReportDetails(width), false);
    assert.equal(shouldStackAccountControls(width), false);
  }
});
