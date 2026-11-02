# Calendar header plus removal — November 2, 2026

Removed the mobile Forecast header’s “Add to calendar” plus button. Today,
Plan Simulator, the bottom navigation plus, the selected-day Add button, and
the desktop Add menu remain available. This is a six-line JSX removal in
`artifacts/mobile/app/(tabs)/monthly.tsx`; no financial or data behavior changed.

## Verification

- FAST PATH source review, TSX syntax, and 37 focused tests passed.
- Exact export inventory matched across 45 files; clean-release, mobile config,
  guide/PDF, artifact-copy, and diff checks passed.
- Local and published browser checks passed at 390px dark and 320px light:
  top plus absent, Today/Simulator visible, bottom plus opens the existing
  six-action quick-add sheet, and Cancel closes without saving.
- No real financial writes or provider calls occurred. Fictional fixture data
  remained unchanged. No unexpected app errors or unknown requests occurred;
  two existing hosted Cloudflare beacon CSP diagnostics were recorded separately.
- Production HTTP postflight passed and all four production aliases resolve to
  the same READY release. Browser evidence was sanitized and runners closed.

## Release

- Source: `4101ef71637063f6b9295c893d506dae642e8f14`
- Deployment: `dpl_34vDJTstQgYKwNxSAkjeuJxh6z5T`
- Immutable URL: `flow-ledger-cloud-6kzup9ax1-flow-ledger-s-projects.vercel.app`
- Entry SHA-256: `bf73028fae94171891f9f583853fc436b75c03fc3ce11bbaab35df7d40a1c544`
- Entry size: 5,154,478 bytes; local and published browser loads matched exactly.
- Rollback: `rollback/prod-before-calendar-top-plus-removal-20261102-1301`
  points to prior production source `f032f4a82c739205e3103ef6f77f9ce84b18a09b`
  and deployment `dpl_7kFY5y5KP2urC5AqkrcfQoEaaZmr`.
- Safe evidence: `/workspace/artifacts/qa-calendar-remove-top-plus-20261102/`.

This documentation commit does not require rebuilding the verified release.
