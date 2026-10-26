# Deep scan and confirmed fixes

Baseline: `c8cf5db` on `dev`. Scope: financial projections and scheduling, native notification navigation, Settings mutation feedback, and compatible security maintenance. The review used source inspection, deterministic fixtures, and local browser scenarios; it does not establish that every possible app interaction is bug-free.

## Confirmed defects and changes

| Defect | Result |
| --- | --- |
| Open spending buckets disappeared from projected commitments after the observed checking balance passed their target date | Keep each open bucket’s remaining reserve on the observation date, including buckets targeted in an earlier month; carry that reserve into later months once |
| The Last day income shortcut skipped short months, and February skipped to March | Save a real first payday separately from the existing valid day-31 recurrence anchor; preserve that choice when editing and clear it when a custom date or different frequency is chosen |
| A stored monthly schedule anchor could be presented as the next actual payday | Resolve desktop’s next expected monthly income date through the canonical occurrence scheduler |
| Native feedback pushes discarded Admin/My Feedback destinations, and their dashboard fallback was ignored on tap | Align server and native strict route allowlists with the actual destinations, retain valid feedback identifiers and household checks, and make the intentional dashboard fallback tappable |
| Settings income/category deletion callbacks returned before persistence, so confirmation dialogs could close early and miss failures | Return the actual deletion promises so confirmation stays pending and can show an error/retry |
| Category add/rename cleared drafts before saving and could submit twice | Await persistence, guard pending submissions, retain failed drafts, and prevent a delayed save from clearing newer input |

Bucket display/history dates, persisted target dates, and observed bank balances are unchanged. Closed, archived, and fully spent buckets do not create reserves; savings goals remain separate. This repair concerns balance reservations, while monthly cash-flow allocations retain their original target-month meaning. Bucket carryover checks cover connected and manual checking observations, partial spending, earlier target months, future targets, future-first reads, and cached reads.

Income uses the existing `start_date` and `next_payment_date` fields without a schema migration. Both saved dates are real calendar dates. The monthly scheduler uses the anchor’s day and the real start date, so November 30 remains included and December still uses December 31. Editor, custom-date/frequency changes, leap/non-leap February, short months, December/January, and actual next-payday output have regression coverage. Existing records saved with the old shortcut are not silently rewritten because their intended first payday cannot be inferred reliably.

Native notification destinations remain narrowly restricted. External URLs, destructive paths, malformed feedback identifiers, and unexpected parameters are rejected. The legacy `section=feedback` alias maps to Help. Existing Settings admin authorization and notification household-membership checks remain in place. Contract tests pass actual feedback/test payloads through the real server payload builder and native tap parser using mocked transport; no real push was sent.

## Security maintenance

- Update scoped compatible overrides to `fast-uri` 3.1.9, `moment` 2.31.0, and `fast-copy` 4.1.2, all beyond the package-release-age threshold.
- Remove unused direct Zod/Zod-validation-error development dependencies from mobile and unused Zod from the sandbox; source search found no consumers. Existing production Zod 4.6.6 and the unused Zod 3 catalog declaration remain unchanged; no validation semantics are migrated.
- Preserve the 1,440-minute minimum release age and all four existing advisory exceptions. No new exception was added, and Expo/EAS major versions remain unchanged.
- Full audit after the changes: **zero critical, three high (all existing ignored findings), one moderate, two low**. Visible findings are `ts-deepmerge`, `diff`, and `esbuild`. Production-only audit: **three high, all existing ignored findings, with no visible unignored findings**. This is not a claim of zero vulnerabilities; see [SECURITY.md](../SECURITY.md).

## Verification evidence

- Focused mobile regressions: **103 passed**, including the actual Settings handlers, actual Income editor/save behavior, canonical bucket projections, scheduling, native route parsing, and existing related regressions.
- Focused backend contract/privacy tests: **17 passed**, including real notification payload-to-parser routing with mocked transport.
- Mobile TypeScript and `git diff --check`: **passed**.
- Dependency peer check: **passed**, with no peer issues. Actual consumer smoke checks passed for Pino Pretty’s `fast-copy`, EAS logger/Bunyan’s `moment`, and Expo build-properties’ Ajv/`fast-uri`, including real relative schema reference resolution. EAS `--version` and `build --help` passed.

## Final development verification

- Root `pnpm run verify`: **passed**, including **1,882 tests** (217 API, 403 Edge, 37 release fixtures, 1,220 mobile and five isolated performance checks), all workspace typechecks, normal web export, release-artifact checks and the production dependency-audit gate.
- Android Hermes export: **passed**, with output at `/tmp/flowledger-deep-android-export`. Expo Doctor: **18/18 passed** after running with the configured network proxy through `NODE_USE_ENV_PROXY=1`. Two initial network checks failed with direct-fetch `ECONNREFUSED`; using the configured proxy resolved them without an app change.
- Parent browser verification: **eight cases passed**. Four income cases covered November 30 at 320 pixels, February 28 at 390 pixels, and leap-February 29 and December 31 at 1,200 pixels, including edit round trips. Settings cases at 390 and 1,200 pixels covered pending/error/retry behavior for all four mutation handlers and preservation of newer drafts. Bucket cases at both widths kept an older $250 reserve against a $1,000 observed balance, producing $750 without a new calendar occurrence. There were no page errors or non-local writes.
- Independent SENTINEL source review: **passed**, with 101 distinct adversarial cases, seven focused regressions, two backend contract cases, dependency compatibility smokes and peer validation.

These results verify the unchanged reviewed source on development; this document does not claim a production deployment. No production financial records, schema definitions, database migrations, store signing identities or Play Store submissions were changed by these fixes. The existing [Play Store readiness requirements](play-store-readiness-audit.md) remain separate. An Android JavaScript/Hermes export is not a signed Android App Bundle or physical-device validation.
