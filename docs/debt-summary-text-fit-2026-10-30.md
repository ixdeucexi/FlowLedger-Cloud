# Debt summary amount layout

The phone Debt Payoff Planner could split the final cent digit of an Active Debt amount such as $263,682.34 onto another line. Mobile summary cards now use the full available width, preserving the complete formatted amount and readable 21px type. Desktop cards keep their existing row. This is one style-property change; calculation, matching, membership and backend behavior are untouched.

Local verification passed 12 browser cases / 48 check groups across 320-, 390- and 1,200-pixel layouts, light/dark themes, and totals of $263,682.34 and $9,999,999.99. Actual text-node geometry verifies single-line amounts, no clipping/ellipsis, readable font size, contained labels/details, mobile stacking and unchanged desktop rows. No uncaught errors, unknown requests, financial mutations or real provider calls were observed. Source syntax/diff, Expo export, guide hash and artifact-copy checks passed; a broad suite was not repeated for this cosmetic change.

Approved entry: `entry-2db402260143182c1205f6f1e916fbd1.js`, SHA-256 `5ed4c12280fd3c98b6896a0da6f33dd3e22d9c157b51a65e5f067f38fd21a6e4`.

Remotely verified rollback: `rollback/prod-before-debt-total-fit-20261030-1325`, capturing source `36d240051fc88a4d45677adccce407d1220ac42f` and READY deployment `dpl_3EEJjFUEtNjufQ6HZmkRHxnKAyFs`. The backend stays unchanged and compatible with this frontend rollback.

Production source and published-assets verification will be recorded after release. Evidence: [snapshot](release-snapshots/debt-total-fit-20261030/). Browser financial/authentication data is fictional and intercepted; native hardware execution is not claimed.
