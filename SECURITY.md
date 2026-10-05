# Security maintenance

## Reviewed dependency exceptions

As rechecked with `pnpm audit --prod --audit-level high` and the npm registry on 2026-09-09, npm does not publish a patched `image-size` release for
`GHSA-w3rx-r6r6-pgpr` or `GHSA-5p2g-fcmc-qvqq`. The package is present only
through Expo's local build tooling. FlowLedger does not pass user uploads,
Plaid data, or network-supplied images to this parser; production builds read
only repository-controlled assets.

These two advisories are explicitly ignored in the root pnpm audit policy until
an upstream release is available. Remove both exceptions and upgrade
`image-size` as soon as a patched npm version ships. Review this exception with
each dependency update and at least monthly.

As rechecked on 2026-10-01, `GHSA-86w9-cpqp-85rv` lists `node-forge` 1.4.1 as
patched, but npm publishes only through 1.4.0. The affected RSA verifier is
present through Expo and EAS build tooling; it is not included in FlowLedger's
exported PWA JavaScript and does not process user or financial data at runtime.
This advisory is temporarily ignored until a patched npm release exists. Remove
the exception and update the lockfile as soon as that release is published.

## October 5 build-tooling review

`GHSA-vfj7-8cjw-p6xm` affects `braces` 3.0.3 through deeply nested patterns.
On 2026-10-05 the npm audit response names 3.0.4 as patched, but the npm
registry does not publish that version and the official
[GitHub advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) lists no
patched version. `pnpm why braces --prod` resolves it only through
`micromatch` in Metro and Jest build/test tooling. API and server imports do
not reference those packages; the exported PWA contains no `micromatch` or
`braces` package implementation (the word in react-helmet error copy is not
the dependency). Production serves static Expo output, not a Metro server.
Builds use repository-controlled patterns, not user requests, uploads, or
financial data. Independent review confirmed this reachability assessment.

Only this advisory is temporarily excepted in the audit policy. This is not
a fix or a claim of zero known vulnerabilities. Remove the exception and
upgrade the lockfile as soon as a patched release is published. Recheck on
each dependency update and at least monthly; reassess immediately if a
runtime glob/pattern feature is added.

## September 9 maintenance

Updated compatible transitive versions and the lockfile: `fast-uri` 3.1.6,
`browserslist` 4.28.7, `baseline-browser-mapping` 2.11.0, `@xmldom/xmldom`
0.8.15, `js-yaml` 3.15.2/4.3.2 (preserving each major), and `qs` 6.16.0.
The minimum package-release-age policy and existing audit exceptions are
unchanged. No new advisory was ignored.

The final production audit reports one unignored moderate advisory and the two
previously reviewed, ignored `image-size` high advisories. The high-severity
release gate passes; this is not a claim of zero known advisories.

`decode-uri-component` 0.2.2 is used by `query-string` through React Navigation
and Expo Router. [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr)
reports excessive decoding work on malformed percent-encoded input and names
0.4.3 as patched. `pnpm view decode-uri-component@0.4.3 version` returned no
matching version on September 9. This remains visible in audit output; do not
silence it or make an unreviewed major query-string/router upgrade to hide it.
Recheck the upstream fix before the next dependency release. Shared/deep-link
parsing is relevant, so this must not be described as a build-only dependency.
