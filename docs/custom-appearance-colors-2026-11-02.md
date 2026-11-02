# Custom appearance colors — November 2, 2026

Appearance now offers a custom app accent and independent custom colors for all
six Forecast categories. A shared picker provides a saturation/brightness area,
hue track, preview, hex field, keyboard controls, and explicit Apply/Cancel.
Draft changes do not save. Valid #RGB/#RRGGBB values normalize to opaque lowercase
six-digit hex; invalid input cannot apply.

The existing version-1 device preference stores preset IDs or normalized hex.
Presets and predefined accents replace the app accent while retaining calendar
overrides. Follow theme clears one category; calendar reset clears category
overrides; full appearance reset restores defaults. ThemeContext, hydration,
retry behavior, database/auth, and financial calculations remain unchanged.

The chosen hex is preserved. Custom accent shades adapt for readable text and
controls against the actual canvas and composite card surface. Named/default
palettes and semantic success/warning/destructive colors retain their behavior.
The shared color hook memoizes the derived palette so picker drags do not repeat
the custom contrast search. The in-app guide and downloadable PDF were updated.

## Verification

- Independent ATLAS/SENTINEL review and React checklist: PASS.
- Twenty-five focused tests cover parsing, HSV, persistence/hydration, independent
  preset/reset behavior, and actual fractional RGBA contrast regressions.
- Full mobile TypeScript, three touched TSX syntax checks, diff checks, clean
  release/config/artifact/guide guards, and exact 45-file export copy passed.
- Independent color checks covered 4,980 custom palettes and 3,528 unchanged
  named/default comparisons; custom contrast remained above 4.5:1.
- Local and published browser journeys each passed three contexts and 18 stages:
  Apply/Cancel/invalid input, all categories, preset/reset scopes, reload, touch
  picking, narrow layouts, desktop keyboard, and Forecast/Simulator color reuse.
- Eight hosted entry loads matched the tested artifact. Settled modal screenshots
  verified opaque backgrounds and complete fade transitions. Short-viewport tests
  emulate reduced browser height, not a physical Android keyboard.
- No real financial writes, provider calls, unknown requests, or unexpected app
  errors occurred. Eight known hosted beacon CSP diagnostics were classified
  separately. Evidence was sanitized and all owned runners closed.
- Production HTTP postflight and all four production aliases passed.

## Release

- Source: `20fab574c76d212f6b92723e763d409cd20b850c`
- Deployment: `dpl_EWyimMP1j2HCRD2xFg37cKoXNrY8`
- Immutable URL: `flow-ledger-cloud-aizn7zxmg-flow-ledger-s-projects.vercel.app`
- Entry SHA-256: `b6a38e1fa0e10c07bba73b62de2bae8321d5de086c9e5638cc5fd8ed32262c3f`
- Entry size: 5,169,651 bytes; guide source hash: `3ed8f245902c`.
- Rollback: `rollback/prod-before-custom-appearance-colors-20261102-1553`
  preserves source `a0b6c21fe4fea587b60f3123d320e2e4fd29aad5` and prior deployment
  `dpl_Fwxeu9FAMBcGyLpYyatXLyRuNp14`.
- Safe evidence: `/workspace/artifacts/qa-appearance-custom-colors-20261102/`.

This documentation commit does not require rebuilding the verified release.
