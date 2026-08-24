# Security maintenance

## Reviewed dependency exceptions

As rechecked with `pnpm audit --prod --audit-level high` on 2026-08-24, npm does not publish a patched `image-size` release for
`GHSA-w3rx-r6r6-pgpr` or `GHSA-5p2g-fcmc-qvqq`. The package is present only
through Expo's local build tooling. FlowLedger does not pass user uploads,
Plaid data, or network-supplied images to this parser; production builds read
only repository-controlled assets.

These two advisories are explicitly ignored in the root pnpm audit policy until
an upstream release is available. Remove both exceptions and upgrade
`image-size` as soon as a patched npm version ships. Review this exception with
each dependency update and at least monthly.

The August 24 audit also identified five patchable `fast-uri` advisories in
Expo build tooling. The workspace now overrides every version below 3.1.5 to
3.1.5; those advisories no longer appear in the production audit.
