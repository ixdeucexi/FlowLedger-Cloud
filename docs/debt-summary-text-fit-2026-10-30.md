# Debt summary amount layout

Live at https://flowledger-algo.com. App source: `c461e9082904c530fbedf8a2574638a7cce2a02d`; READY production: `dpl_979XCUmB2FYU1gQXzmmgvJiNmYpQ`. All four app aliases resolve to this exact release.

The phone Debt Payoff Planner could split the final cent digit of an Active Debt amount such as $263,682.34 onto another line. Mobile summary cards now use the full available width, preserving the complete formatted amount and readable 21px type. Desktop cards keep their existing row. The target heading/body also keeps a readable minimum width on narrow phones, allowing the strategy badge to wrap below. These are small mobile layout changes; calculation, matching, membership and backend behavior are untouched.

Local verification passed 12 browser cases / 60 check groups across 320-, 390- and 1,200-pixel layouts, light/dark themes, and totals of $263,682.34 and $9,999,999.99. Actual text-node geometry verifies single-line amounts, no clipping/ellipsis, readable font size, contained labels/details, mobile stacking and unchanged desktop rows. The header checks verify whole words, readable copy width and non-overlapping logo/copy/strategy elements. No uncaught errors, unknown requests, financial mutations or real provider calls were observed. Source syntax/diff, Expo export, guide hash and artifact-copy checks passed; a broad suite was not repeated for this cosmetic change.

Approved entry: `entry-2ef3e4bc362cccf6d32ae034f767ff45.js`, SHA-256 `9152cb501fab4bea5aba67b212a7c10a97f9b4ed15f66f3edd92ba812a949313`.

Remotely verified rollback: `rollback/prod-before-debt-total-fit-20261030-1325`, capturing source `36d240051fc88a4d45677adccce407d1220ac42f` and READY deployment `dpl_3EEJjFUEtNjufQ6HZmkRHxnKAyFs`. The backend stays unchanged and compatible with this frontend rollback.

Published verification passed the same 12 cases / 60 checks at all three widths and both themes. Every downloaded entry matches the approved SHA; exact full currency, whole target/body words, badge placement and containment passed with zero app errors, unknown requests or financial/provider writes. HTTP postflight also passed startup/deep routes, health, cache, worker, guide and source/alias checks. Evidence: [snapshot](release-snapshots/debt-total-fit-20261030/). Browser financial/authentication data is fictional and intercepted; native hardware execution is not claimed.
