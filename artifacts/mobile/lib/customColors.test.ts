import assert from "node:assert/strict";
import test from "node:test";
import { compositeColor, hexToHsv, hsvToHex, normalizeHexColor } from "./customColors";

test("custom colors normalize opaque shorthand and full hex without accepting CSS", () => {
  for (const [input, expected] of [
    ["#000", "#000000"], ["#fff", "#ffffff"], ["  #AbC  ", "#aabbcc"],
    ["#A17F09", "#a17f09"], ["#012345", "#012345"],
  ]) assert.equal(normalizeHexColor(input), expected);
  for (const invalid of [
    null, undefined, 123456, {}, [], "", "abc", "123456", "#12", "#abcd",
    "#12345", "#1234567", "#12345678", "#gg0000", "red", "transparent",
    "rgb(255,0,0)", "rgba(0,0,0,1)", "var(--accent)", "url(example.com)",
    "#ffffff; color:red", "#fff\n#000", "#" + "f".repeat(2048),
  ]) {
    assert.equal(normalizeHexColor(invalid), undefined, String(invalid));
    assert.equal(hexToHsv(invalid), null, String(invalid));
  }
});

test("HSV selection round-trips exact RGB colors including neutral and hue boundaries", () => {
  for (let r = 0; r <= 255; r += 51)
    for (let g = 0; g <= 255; g += 51)
      for (let b = 0; b <= 255; b += 51) {
        const hex = "#" + [r, g, b].map(value => value.toString(16).padStart(2, "0")).join("");
        const hsv = hexToHsv(hex)!;
        assert.ok(hsv.h >= 0 && hsv.h < 360 && hsv.s >= 0 && hsv.s <= 1 && hsv.v >= 0 && hsv.v <= 1);
        assert.equal(hsvToHex(hsv), hex);
      }
  for (const hex of ["#010203", "#abcdef", "#fefdfc", "#121212", "#00ff01", "#ff0001"])
    assert.equal(hsvToHex(hexToHsv(hex)!), hex);
  assert.deepEqual(hexToHsv("#000"), { h: 0, s: 0, v: 0 });
  assert.deepEqual(hexToHsv("#fff"), { h: 0, s: 0, v: 1 });
  assert.equal(hsvToHex({ h: 0, s: 1, v: 1 }), "#ff0000");
  assert.equal(hsvToHex({ h: 360, s: 1, v: 1 }), "#ff0000");
  assert.equal(hsvToHex({ h: -120, s: 1, v: 1 }), "#0000ff");
  assert.equal(hsvToHex({ h: 120, s: 2, v: 2 }), "#00ff00");
  assert.equal(hsvToHex({ h: 20, s: -1, v: 1 }), "#ffffff");
  assert.equal(hsvToHex({ h: 20, s: 1, v: -1 }), "#000000");
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.equal(hsvToHex({ h: invalid, s: 1, v: 1 }), undefined);
    assert.equal(hsvToHex({ h: 0, s: invalid, v: 1 }), undefined);
    assert.equal(hsvToHex({ h: 0, s: 1, v: invalid }), undefined);
  }
});

test("readability checks composite translucent surfaces over the actual background", () => {
  assert.equal(compositeColor("#F00", "#ffffff"), "#ff0000");
  assert.equal(compositeColor("rgba(0,0,0,0)", "#abcdef"), "#abcdef");
  assert.equal(compositeColor("rgba(255,255,255,1)", "#000000"), "#ffffff");
  assert.equal(compositeColor("rgba(0, 0, 0, .5)", "#ffffff"), "#808080");
  assert.equal(compositeColor("rgba(255, 0, 0, 0.5)", "#000000"), "#800000");
  for (const invalid of ["rgba(256,0,0,1)", "rgba(1,2,3,2)", "rgba(-1,2,3,.5)", "url(example.com)"])
    assert.equal(compositeColor(invalid, "#abcdef"), "#abcdef");
});
