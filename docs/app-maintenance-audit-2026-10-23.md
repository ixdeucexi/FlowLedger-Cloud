# FlowLedger maintenance audit — October 23, 2026

Baseline: `fe227e3` on `dev`. Scope: confirmed app bugs, compatible dependency security updates, and a review of existing Play Store blockers. This work does not deploy the website or submit a native build.

**Status: fixes and dependency updates verified on `dev`; not a production deployment or Play Store submission.**

## Confirmed fixes

| Defect | Result |
| --- | --- |
| Import Bills could read the income header in a full backup and then convert income, activity, overrides and goals into bills | Import selects only the BILLS section, or a standalone bill CSV with named columns |
| CSV splitting corrupted quoted names and grouped amounts; numeric prefix parsing accepted malformed fields | Parse complete CSV records, including escaped quotes, multiline fields, BOM and CRLF; validate every row before persistence |
| Import announced success before saving completed and allowed concurrent imports | Await persistence, keep one import in flight, and display visible success or failure on web and native |
| A household/account change during file selection could misroute import intent | Capture user/household/budget identity and verify current identity and edit permission immediately before saving |
| Export omitted recurring schedule anchors and import downgraded quarterly/biweekly frequencies | Append schedule columns and preserve all four supported frequencies; derive weekdays/due dates from valid anchors and reject schedules whose required facts are missing |
| Income estimates and debt-payment confirmation parsed only the numeric prefix of `1,200.50` | Use the same strict money parser as saving; reject malformed or unsafe payment drafts and require a coherent payment preview |
| Clearing an extra-payment draft removed the editor when its preview became unavailable | Keep the input visible through empty/invalid drafts; confirmation stays disabled until a valid preview returns |
| Review Center repeatedly scanned all transactions for each manual match candidate | Build one transaction-ID index; preserve candidate payloads and debt flags with one lookup per candidate |
| Calendar plan matches were labeled as spending buckets | Label decision matches as Calendar plan |

Existing backups cannot recover schedule fields they never contained. Quarterly/biweekly imports require a valid payment/start date; weekly imports require an explicit weekday or date anchor. The importer rejects missing required facts instead of inventing a schedule. Import Bills remains a bills-only import, not a restoration of the other backup sections.

## Dependency maintenance

- Pin Orval `8.22.0`, retaining the existing React Query/Zod generation configuration and checked-in generated source.
- Update compatible tooling patches for Vite, Sharp, node-forge, minimatch, Joi, Ajv, markdown-it, linkify-it, http-cache-semantics and lodash.
- Preserve the minimum package-release age, existing audit exceptions, Expo SDK/React Native compatibility, and existing EAS major version.
- Full dependency audit after updating: **0 critical, 4 high (all existing ignored exceptions), 3 moderate, 2 low**. Remaining development-tooling findings stay visible; see [SECURITY.md](../SECURITY.md). These figures do not mean that all advisories are fixed.

## Verification

- Focused app regressions: **26 PASS**, including actual import handlers, async failure/concurrency/scope changes, canonical recurring dates, actual preview declarations, persistent rendered payment input, and linear manual-target lookups.
- EAS `--version` and `build --help`: **PASS**. Actual EAS dependency resolution and synthetic RSA sign/verify, minimatch matching, Joi validation and Ajv validation: **PASS**.
- Isolated Orval generation using the repository's OpenAPI, transformer, mutator and output settings: **PASS** for React Query and Zod. Generated output went to `/tmp`; its semantic typecheck against the existing workspace dependencies also passed.
- Browser: **6 scenarios PASS**, across phone 390 px and desktop 1200 px, covering CSV imports/exports and section isolation, grouped amounts, invalid-row atomicity, missing schedule anchors, income estimates and visible errors. Activity's extra-payment editor retained its input through empty, invalid, unsafe grouped and valid drafts. There were no page errors or non-local writes; the browser used fictional local data.
- Sharp `0.35.5` native image pipeline: **PASS** for SVG metadata, resize, composite and PNG output, plus resizing a fictional 390×1000 app screenshot to 195×500 PNG.
- Full regression/performance suites: **1,861 tests PASS** (215 API, 403 Edge, 37 release fixtures, 1,201 mobile, 5 performance). Independent SENTINEL review, its 26 focused tests and additional adversarial checks: **PASS**.
- Root `pnpm run verify`: **PASS**, including all workspace typechecks, normal web export and artifact checks. Its production-only dependency gate reports **3 high findings, all existing ignored exceptions**; the broader full-graph audit above includes development tooling and reports four ignored high findings.
- Final Android Hermes export to `/tmp`, Vite `7.3.7` sandbox production build, and Expo Doctor **18/18: PASS**. Checked-in generated API/Zod source is unchanged, and `git diff --check` passed. An Android JavaScript/Hermes export is not a signed Android App Bundle, device validation or store-submission proof.

No production financial records were modified. The existing [Play Store audit](play-store-readiness-audit.md) still governs owner-approved privacy policy, developer-account verification, Play signing identity, a signed Android candidate, device/16 KB testing, declarations and reviewer access. This maintenance pass does not clear those submission requirements.
