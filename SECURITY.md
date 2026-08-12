# Security maintenance

## Reviewed dependency exceptions

As of 2026-08-12, npm does not publish a patched `image-size` release for
`GHSA-w3rx-r6r6-pgpr` or `GHSA-5p2g-fcmc-qvqq`. The package is present only
through Expo's local build tooling. FlowLedger does not pass user uploads,
Plaid data, or network-supplied images to this parser; production builds read
only repository-controlled assets.

These two advisories are explicitly ignored in the root pnpm audit policy until
an upstream release is available. Remove both exceptions and upgrade
`image-size` as soon as a patched npm version ships. Review this exception with
each dependency update and at least monthly.
