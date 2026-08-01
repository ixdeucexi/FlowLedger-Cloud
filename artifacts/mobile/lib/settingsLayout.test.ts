import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getForecastSafetyLayout,
  isCompactSettingsLayout,
  SETTINGS_COMPACT_BREAKPOINT,
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
  for (const width of [240, 275, 288, 312, 330]) {
    assert.equal(isCompactSettingsLayout(width), true);
  }
  assert.equal(isCompactSettingsLayout(SETTINGS_COMPACT_BREAKPOINT), false);
  assert.equal(isCompactSettingsLayout(360), false);
});

it("stacks Settings metrics instead of collapsing values under enlarged text", () => {
  for (const width of [240, 260, 275, 288, 312, 330]) {
    assert.equal(shouldStackSettingsMetrics(width), true);
  }
  for (const width of [SETTINGS_COMPACT_BREAKPOINT, 360, 390, 412]) {
    assert.equal(shouldStackSettingsMetrics(width), false);
  }
});

it("stacks account controls and expands report details under enlarged text", () => {
  for (const width of [240, 260, 275, 288, 312, 330]) {
    assert.equal(shouldExpandReportDetails(width), true);
    assert.equal(shouldStackAccountControls(width), true);
  }
  for (const width of [SETTINGS_COMPACT_BREAKPOINT, 360, 390, 412]) {
    assert.equal(shouldExpandReportDetails(width), false);
    assert.equal(shouldStackAccountControls(width), false);
  }
});
