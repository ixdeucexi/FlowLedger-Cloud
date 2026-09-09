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
