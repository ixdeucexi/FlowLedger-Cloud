# Dashboard layouts and favorite actions

Status: live at https://flowledger-algo.com on October 30, 2026. Production HTTP and browser postflight passed.

Customize Dashboard now controls the actual major card sections on phone and desktop, with Simple, Debt Focus and Planning Ahead starting layouts, visible selected state, accessible move-up/down buttons, optional card visibility, and up to four favorite actions. Favorite actions use existing routes and edit permissions. Required money overview and Next up cards remain available. Current financial values and handlers are reused, including one shared monthly-plan presentation helper preserving the prior mobile formulas. Desktop cards use an overview-first configurable stack rather than the prior fixed columns.

Legacy three-utility preferences retain their relative order and visibility within the expanded default layout. Preferences stay scoped to user and household, preserve other interface choices, retain pending local saves across sync failure, and expose load/save retry controls. Late hydration and stale controllers cannot overwrite newer edits or a different scope. Remote saves verify the current SDK user, recheck scope after session lookup, and pin the verified authorization token for that request. No database, financial-engine, dependency or schema changes are included.

Verification: 47 focused initial model/controller/monthly-plan tests passed, followed by 14 focused final dispatch/controller tests including four account/session-race regressions. Mobile typecheck passed. Full repository verification before the final narrow session-dispatch correction passed 217 API, 563 Edge, 37 release-fixture, 1,412 mobile and five performance tests, workspace types/export/guide/artifact checks and the existing audit policy. The final correction passed focused tests, mobile typecheck and a fresh export. Audit baseline remains one low, one moderate and three previously ignored high advisories; no exceptions were added.

Independent source review passed. All 26 final browser checks passed across 390/1,200-pixel layouts: actual card order/hiding, all three starting layouts and reload, required cards, bounded favorites and Add Income navigation, sync failure/retry, reset independence. Screenshots were reviewed. All API calls used fictional data and interception; no financial writes or AI calls. The intentional failed-save HTTP503 was classified separately from unexpected errors.

Tested entry: `entry-fac551cbbbe08e3cd36b4a9a9869956c.js`, SHA-256 `4779accdfd3d407cf565f6d432b619504125838e627e3f0a6e27e934a4aeb6e1`.

Rollback: `rollback/prod-before-dashboard-studio-20261030-0506`, remotely verified annotated tag at `9f4959467f8b3605bed03ded933eab16f62f98e0`, exact prior READY deployment `dpl_7ijyTmiBBu8DNPEQh63uC3N2PSud`. Marketing assets and isolated later-phase work are outside the release source.

Evidence: `release-snapshots/dashboard-studio-20261030/`.

Production source `f0790d3b3452b55e73186bc5a8fcd79b7c00c267`, READY deployment `dpl_AuCv4TBT8P5VX1mQUBV62DKBXXtM`, immutable https://flow-ledger-cloud-xtixolsti-flow-ledger-s-projects.vercel.app. Clean source/config/guide guards passed in isolated release checkout. All four app aliases were freshly verified and aligned; only the legacy alias required reassignment. Only the duplicate in-progress non-production build of this exact source was canceled.

The complete repository HTTP postflight passed using real connected-tool alias/deployment observations and transparent GitHub-to-CLI source metadata normalization. Published executable entry exactly matched the tested SHA above. All 26 browser checks passed again using actual published assets and intercepted fictional data. Phone/desktop screenshots were reviewed. Only the existing Cloudflare analytics CSP messages and the intentional mock503 save-failure test were classified separately; no unexpected errors, financial writes or AI calls. No backend/schema/environment/dependency changes were included.
