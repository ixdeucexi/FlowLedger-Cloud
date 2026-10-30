# Visible appearance preset selection

Status: verified candidate; production release pending.

Appearance previously treated independent calendar color choices as a fully custom appearance and removed the selected marker from every preset. Preset cards now identify the matching app preset using the four app-wide appearance fields while leaving calendar colors independent. The matching card has a visible Selected badge, checkmark and border. The current-status label includes the preset name and Custom colors when appropriate. A truly unmatched custom configuration explicitly says Custom and does not incorrectly select a preset. The current-status label sits below the heading so it remains readable on narrow screens.

No preference storage, reset/apply behavior, auth, backend, financial calculations or dependencies changed. The whole-appearance Custom contract remains intact; only preset selection display uses the base-preset match.

Verification: 17 focused appearance tests, including all five presets with immutable calendar overrides and all four unmatched global fields, passed. Test compilation, mobile typecheck, web export, artifact-copy scan and diff check passed. No broad financial suite was rerun for this scoped selection-display change.

Rollback: `rollback/prod-before-preset-selection-20261030-0441`, remotely verified annotated tag at source `dcaf8d5e09e28fd415bb1eff445d87dbd45d42a8`, exact prior READY production deployment `dpl_DsHzL1RJFmQU1khmyEUSE53yzN4k`. Marketing assets remain outside release source.

Evidence: `release-snapshots/preset-selection-20261030/`.

Browser verification passed 34 checks across 390/1,200-pixel layouts: all five presets, visible and accessible selection, independent calendar overrides and reload, fully custom honesty/persistence, reset and Flo/haptics independence. Screenshots were reviewed. All application/API requests used fictional fixtures and interception, with no app errors, unexpected console events, unknown requests, AI calls or financial writes. Intercepted diagnostics telemetry was counted separately.

Tested entry: `entry-25e37fd2efcb9dc5e37e228a12e2eab7.js`, SHA-256 `b67e9fb3a642435ddfc4d3d953f8ff013f2c3134f97fb928b5f122c956424668`.
