# Calendar scrolling fix — November 2, 2026

Fitting balance labels blocked vertical touch scrolling in the mobile web calendar.
The disabled nested React Native Web ScrollView applied `touch-action: none`.
The same swipe from a blank area or an event chip worked. Network throttling
after load did not change the result, and scrolling issued no new API requests.

`CalendarAmountLabel` now keeps its web scroller enabled. Fitting amounts naturally
have no horizontal scroll range, while large values retain horizontal scrolling.
Native overflow-dependent behavior, full amounts, Privacy, focus, layout, day taps,
financial calculations, persistence, and callbacks remain unchanged.

## Verification

- ATLAS identified the installed RNWeb disabled-style behavior; SENTINEL reviewed
  the exact one-component change and local acceptance evidence: PASS.
- Forty focused display/Privacy tests, TSX syntax, diff checks, release/config/guide
  guards, exact 45-file export copy, and production HTTP postflight passed.
- Before the fix, balance-start touch swipes moved 0px; blank/chip starts moved
  the parent. After the fix, balance starts scroll the full 94px and 221px ranges
  on the two tested phone sizes, under normal and constrained network conditions.
- Local and published checks each passed five contexts and 19 touch gestures:
  fitting/overflowing/hidden amounts, horizontal full-value access, actual Privacy
  Show toggle, intentional day taps, Simulator, and desktop focus/arrow scrolling.
- Twelve measured fitting gestures per run produced zero API requests and zero
  long tasks; frame p95 was at most 16.8ms. Tests used real browser timing and
  Chromium touch emulation, not a physical phone or mocked animation timing.
- No real financial writes, provider calls, unknown requests, or unexpected app
  errors occurred. Six published hosting-beacon CSP diagnostics were classified
  separately. Safe browser archives were sanitized and all owned runners closed.

## Release

- Source: `a0b6c21fe4fea587b60f3123d320e2e4fd29aad5`
- Deployment: `dpl_Fwxeu9FAMBcGyLpYyatXLyRuNp14`
- Immutable URL: `flow-ledger-cloud-9xbl840xq-flow-ledger-s-projects.vercel.app`
- All four production aliases were freshly verified on the same READY source.
- Entry SHA-256: `8584bb03f9a0c6390e425d4a8dd9752ba3dff36063ddce9664adb8ee767184dd`
- Exact entry size: 5,154,518 bytes; six entry loads verified per acceptance run.
- Rollback: `rollback/prod-before-calendar-scroll-fix-20261102-1534` preserves
  source `4101ef71637063f6b9295c893d506dae642e8f14` and prior production
  deployment `dpl_34vDJTstQgYKwNxSAkjeuJxh6z5T`.
- Safe evidence: `/workspace/artifacts/qa-calendar-scroll-20261102/`.

This documentation commit does not require rebuilding the verified release.
