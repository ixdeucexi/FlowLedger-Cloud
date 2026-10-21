# Security maintenance

## Reviewed dependency exceptions

Rechecked against the npm registry and official GitHub advisories on
2026-10-21. `image-size` now has published fixes for `GHSA-w3rx-r6r6-pgpr`
and `GHSA-5p2g-fcmc-qvqq`, but its 2.0.4 major release is incompatible with
the installed Expo/Metro toolchain. Actual web and Android exports failed:
Metro's non-ZIP asset path passes a filename string, while version 2 removed
filesystem-input support. The attempted override was reverted rather than
shipping broken builds. Both existing exceptions remain for 1.2.1 pending
a compatible upstream integration or a separately verified migration.

FlowLedger's inspected parser use is local build tooling reading
repository-controlled assets, not user uploads, bank data, or network-supplied
images. Do not introduce untrusted asset inputs under this exception. Recheck
the compatible fix on dependency updates and at least monthly; published
security fixes exist, so this is a compatibility exception, not "no fix available."

As rechecked on 2026-10-21, the audit feed names `node-forge` 1.4.1 as
patched for `GHSA-86w9-cpqp-85rv`, but npm publishes only through 1.4.0 and
the official advisory has no published patch. The affected RSA verifier is
present through Expo and EAS build tooling; it is not included in FlowLedger's
exported PWA JavaScript and does not process user or financial data at runtime.
This advisory is temporarily ignored until a patched npm release exists. Remove
the exception and update the lockfile as soon as that release is published.

## Build-tooling exceptions

`GHSA-vfj7-8cjw-p6xm` affects `braces` 3.0.3 through deeply nested patterns.
On 2026-10-21 the npm audit response names 3.0.4 as patched, but the npm
registry does not publish that version and the official
[GitHub advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) lists no
patched version. `pnpm why braces --prod` resolves it only through
`micromatch` in Metro and Jest build/test tooling. API and server imports do
not reference those packages; the exported PWA contains no `micromatch` or
`braces` package implementation (the word in react-helmet error copy is not
the dependency). Production serves static Expo output, not a Metro server.
Builds use repository-controlled patterns, not user requests, uploads, or
financial data. Independent review confirmed this reachability assessment.

This, the `node-forge` advisory, and the two `image-size` advisories are the
four remaining high-severity exceptions in the audit policy. These are not
fixes or a claim of zero known vulnerabilities. Remove each exception and
upgrade the lockfile as soon as a compatible patched integration is available. Recheck on
each dependency update and at least monthly; reassess immediately if a
runtime glob/pattern feature is added.

## September 9 maintenance

Updated compatible transitive versions and the lockfile: `fast-uri` 3.1.6,
`browserslist` 4.28.7, `baseline-browser-mapping` 2.11.0, `@xmldom/xmldom`
0.8.15, `js-yaml` 3.15.2/4.3.2 (preserving each major), and `qs` 6.16.0.
The minimum package-release-age policy and existing audit exceptions are
unchanged. No new advisory was ignored.

The September decoder finding has been superseded by the October 21 review.
`decode-uri-component` is already overridden to the published patched 0.5.0
through `query-string` / React Navigation / Expo Router. Its old advisory is
no longer the visible moderate finding. Deep-link parsing remains relevant
runtime code and must not be described as build-only.

## October 21 remaining moderate advisory

`sprintf-js` 1.0.3, through `argparse` 1.0.10 in the build/test graph, is
affected by [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).
The registry publishes only through 1.1.3; the official advisory has no
published fix, despite the audit feed naming 1.1.4. Inspected `argparse`
call sites use fixed internal format strings. No public API formatter or
user-controlled format path was found in the bounded review. Keep this
moderate finding visible and unignored; do not add an exception or perform
an unverified major dependency swap to hide it. Recheck on dependency
updates and at least monthly, together with the four high-severity tooling exceptions.
