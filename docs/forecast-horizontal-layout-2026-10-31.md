# Horizontal Forecast payment tiles

Live at https://flowledger-algo.com. READY production: `dpl_44vSMCT21RkZ62arL89CFEs6TR4F`. All four app aliases resolve to the exact application source below.

Restores Amount, Paid and Left across one row in Forecast's planned-debt-payment cards. The numeric audit's 160px minimum tile width had forced the three tiles underneath one another. The payment row now uses equal flexible columns and fits each complete currency label to the available width, with tighter padding on small screens. Other payment editing and shared bill/Activity rows keep their existing behavior.

Only `artifacts/mobile/app/(tabs)/monthly.tsx` and `artifacts/mobile/components/desktop/DesktopCalendarPage.tsx` change. The desktop check also found that the closing-balance formatter dropped the minus sign by default and squeezed a large balance beside its chart. Negative balances now retain the sign; the chart can reflow below a readable full amount. Forecast calculations, saved amounts, editing, navigation, privacy and backend behavior are unchanged.

Application source: `8d6e782b2db95b2cab5ea96d3d603ce55ac3f66c`. Entry: `entry-b4766e9939b2750abe2135daaf613ed2.js`, SHA-256 `baa65fbfcba5640768d43c17b132df221827da84235865b9ba4076dd6087b484`.

Typecheck, TSX parse, Expo export, guide, configuration, clean-source and artifact checks passed. Independent review verified all 150 existing handlers unchanged, 54 exact amount-label equivalence cases, 28 money-sign cases and 64 focused existing tests. New width state stays local, bails out at the same width, and preserves Privacy text wrappers and native-supported styles.

Final local verification passed 23 cases: 16 phone/tablet cases at 320/390/430/768px in both themes with normal and large amounts, four desktop cases at 1200px, one applied-payment case and two actual Privacy hide/reveal cases. Normal $695.60 remains complete at 13px on a 390px phone and 12px at 320px; the extreme $9999999.99 case fits at 8px on 320px. Desktop negative close stays complete at 18px. Editing/cancel, date and footer controls remain reachable, and unchanged bill/income/Activity values were checked. No unresolved numeric/paint issues, uncaught application errors, unknown requests or actual financial/provider writes remain. Initial small-screen padding and desktop-sign failures were diagnosed and corrected before release; final evidence uses only the approved entry above.

Published verification repeated and passed the same 23 cases on the exact approved entry bytes. The phone row and desktop sign/close, applied amounts and actual Privacy hide/reveal passed with zero unresolved issues, application errors, unknown requests or real writes. All owned QA browsers, runners and servers were closed. HTTP postflight passed startup, registered deep routes, health, missing resources, cache rules, service worker, guide PDF, source/alias provenance and the browser-tested entry hash.

Rollback: `rollback/prod-before-forecast-horizontal-20261031-0004`, created and remotely verified before production changes. It captures previous source `48de915d72d9fdefca3f8a447482eebf02b4d98e` and READY deployment `dpl_CUfiE8vDX8goGDp2W9wqDNr2HXm5`. The unchanged backend remains compatible with this frontend rollback.

Evidence: [release snapshot](release-snapshots/forecast-horizontal-20261031/). Financial/authentication fixtures are fictional and intercepted. No real customer/provider writes or native hardware execution are claimed.
