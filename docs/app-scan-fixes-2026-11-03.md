# App scan fixes — November 3, 2026

The scan found and fixed two calculation defects and three calendar/settings
navigation defects. Main Dashboard, Bills, Activity, Forecast, and Settings flows
were checked in mobile and desktop browser fixtures.

- Payoff-only and extra-payment scenarios now use the existing shared dated
  debt engine. Future required payments stop after payoff and final payments cap
  at the amount owed. Paying off $300 from $1,000 now leaves $700; the old path
  retained another $300 of scheduled payments and incorrectly left $400.
- Cashflow and Dashboard outstanding bills now recognize manual finalized and
  partial payments. Actual cash is included once, reviewed transactions retain
  precedence, and unpaid/weekly sibling obligations remain. Finalizing a $100
  bill at $80 yields outstanding $0, paid $80, and net cash −$80.
- Browser Back closes either custom-color draft while retaining Appearance and
  its saved colors. The parent Settings listener respects the picker overlay.
- Browsing years in Jump to month is a local draft. X, backdrop, or Back keeps
  the original month/day; choosing a month commits its selected year.
- Late calendar preference reads cannot overwrite newer navigation or day
  choices. Reactive readiness persists the latest choice, with request identity,
  scope, and explicit-date precedence protected.

No database, schema, authentication, provider, or saved financial-data migrations
were required. Existing amount layouts, colors, and vertical scroll behavior
remain covered by the browser replay.

## Verification

- Independent CORE source/model review passed for the final 17-file manifest.
- 2,431 automated checks passed: 218 API, 572 edge, 37 release fixtures, 1,599
  mobile, and five performance checks. Workspace TypeScript passed.
- Focused financial checks passed 161 tests; UI/calendar checks passed 57.
  Three legacy UI assertions were aligned with guarded date-selection callbacks;
  their existing ordering/default checks remain, and 41 affected tests passed.
- The intentional golden cashflow correction explicitly asserts $435 paid,
  $75 outstanding, and $2,335 remaining; its Forecast endings stay unchanged.
  Isolated extra-payment fixtures use zero minimum where they contain no
  scheduled debt rows; new public-default-path regressions cover canonical
  required payments, payment caps, and payoff lifecycle.
- Local and published browser checks each passed seven contexts and 57 checks,
  including the actual $300 Simulator payoff flow, both color pickers, calendar
  cancellation/selection/touch, main navigation, modal cancellation, and Flo
  open/Back without sending a question. Slow native preference reads are tested
  with the actual-source deferred-storage harness, not a physical phone.
- Every browser entry load matched the exact reviewed artifact. No real financial
  writes, provider calls, unknown requests, unexpected errors, or financial
  fixture mutations occurred. Final evidence was sanitized and runners closed.
- Original 682 CRLF sequences were preserved; Git whitespace checks explicitly
  recognize CRLF. Clean release, config, artifact copy, guide, exact 45-file
  export inventory, and production HTTP checks passed.

## Release

- Source: `8a320576342dea8d9b8e4c167ab2df618ecdb56f`
- Deployment: `dpl_EomuWmkUJu6UBjhpkP5v99j22PR1`
- Immutable URL: `flow-ledger-cloud-ra8g9oevs-flow-ledger-s-projects.vercel.app`
- All four production aliases were freshly verified on that READY source.
- Entry SHA-256: `9638306ef0d7ec1728bee2cfb1fc9f955a69f857bf28413710d064af28fd7b87`
- Entry size: 5,171,151 bytes; unchanged guide source hash: `3ed8f245902c`.
- Rollback: `rollback/prod-before-app-scan-fixes-20261103-0314` preserves source
  `20fab574c76d212f6b92723e763d409cd20b850c` and prior deployment
  `dpl_EWyimMP1j2HCRD2xFg37cKoXNrY8`.
- Safe evidence: `/workspace/artifacts/qa-app-scan-fixes-20261103/`.

This documentation commit does not require rebuilding the verified release.
