# Horizontal Dashboard layout

Live at https://flowledger-algo.com. READY production: `dpl_CUfiE8vDX8goGDp2W9wqDNr2HXm5`. All four app aliases resolve to the exact application source below. HTTP postflight passed startup, deep routes, health, cache rules, service worker, guide PDF, provenance and the exact browser-tested entry hash.

Restores the owner's reference layout: checking balance sits beside Flow Score, and Bills left, Safe to spend and Next payday stay in one row. The previous numeric audit's compact column override and 180px minimum summary-column width had pushed these items underneath.

Only `artifacts/mobile/app/(tabs)/index.tsx` changes. Currency labels fit their actual available width using local layout state, retain their complete signs and cents, and keep the existing Privacy text wrapper. Ordinary 390px values render at 37px for checking and 18px for the summary. The score ring is smaller below 360px. Savings height reservations and all 90 existing event handlers are preserved; financial calculations, navigation, persistence and backend behavior are unchanged.

Application source: `48de915d72d9fdefca3f8a447482eebf02b4d98e`. Entry: `entry-ff040d424308d80202acbb5f0b0f7b82.js`; SHA-256 `1b9c2bc45a0ea544891b5e81ce7342959d0f6d9a0ed7cca91e5f4835a98c125b`.

Local verification passed mobile typecheck, TSX parse and handler comparison, Expo export, configuration, guide, clean-source and artifact checks. The focused browser run passed 72 render checks across 38 isolated contexts at 320/390/430/768/1200px in light and dark themes. Cases cover normal values from the owner's screenshot, positive/negative millions, pending/available amounts, all three summary columns, Savings flips and Privacy hide/reveal. Visual review includes normal 390px, normal 320px and pending payments. Test authentication and financial data are fictional and intercepted; no real financial/provider writes or native hardware execution are claimed.

Published verification repeated the same 72 checks / 38 contexts and passed against the exact entry bytes above. All horizontal geometry, full-value containment, pending strips, Privacy and Savings checks passed with zero unresolved numeric/paint issues, uncaught application errors, unknown requests or actual financial/provider writes. All owned QA browsers, runners and servers were closed. Source-only tests were not rerun as a broad financial suite for this isolated display change.

Rollback: `rollback/prod-before-dashboard-horizontal-20261030-2026`, created and remotely verified before production changed. It captures previous source `b71199ba2020a63b069a3d67f96ef22b2fed9f6b` and READY deployment `dpl_GmD96Cq7d1x1Gw6cLj6bUmPW3goK`. This frontend rollback remains compatible with the unchanged backend.

Evidence: [release snapshot](release-snapshots/dashboard-horizontal-20261030/).
