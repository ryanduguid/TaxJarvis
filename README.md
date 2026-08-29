# Australian Tax Intelligence

This repository is a non-production, source-only demonstration for a future public service covering Australian tax and accounting developments for practising accountants and tax agents.

It contains one artificial public demonstration record. No live record has been admitted. It has no hosted source monitor, automatic or unattended publication, AI explainer or deployment, and it does not provide tax advice or replace source checking and professional judgement.

## Requirements

- Node.js 24.19.0 or later
- npm 11.17.0 or later
- no package installation

Authenticated live evidence admission is supported only on Windows and additionally requires GitHub CLI 2.98.0 or later, authenticated for GitHub.

## Commands

- `npm run dev` builds once and serves `out/` at `http://127.0.0.1:4173/`.
- `npm run build` creates the static artifact.
- `npm run import-bundle -- --bundle <file>` authenticates and admits one live-v2 evidence bundle under the rules below.
- `npm test` runs the complete Node test suite.
- `npm run check` performs syntax checks, builds and tests.
- `npm run smoke` exercises the exported routes over loopback HTTP.

## Publication model

`content/developments/dev-demo-001/development.json` is the only checked-in
editorial record. HTML, RSS and JSON are generated projections. Invalid input
stops the build before the current artifact is replaced. Canonical record files
also use strict UTF-8 and duplicate-member rejection during every build.

### Authenticated live admission

The supported wrapper fixes both the repository root and the `content/developments` destination. It accepts only the exact `--bundle <file>` argument and has no supported content-root, mode, provenance-skip, offline, overwrite or retry option. Direct execution of `import.mjs` refuses before parsing input or mutating content. Its exported v1 import function remains only for isolated conformance tests and is not a supported production entry point.

Before semantic admission, the wrapper places a private snapshot of the received bytes under `content/.live-import-*` and runs three GitHub checks against `ryanduguid/au-tax-legislation-corpus`:

1. verification of the derived tagged release;
2. exact release-asset digest verification for that private snapshot; and
3. SLSA v1 artifact-attestation verification constrained to the producer repository, `publish-live-evidence.yml` workflow, `refs/heads/main` source ref and a denial of self-hosted runners.

These checks authenticate the admitted bytes and their GitHub production path. They do not independently establish the truth, completeness or legal effect of the unsigned Federal Register of Legislation API response.

The registration/publication date is the literal calendar part of the source `registeredAt` field, without timezone conversion. The compilation date is the source `start` field. They describe different events and need not be equal.

After provenance and semantic validation, the importer serialises and exactly revalidates one canonical `development.json` in private staging outside `content/developments`, then promotes its complete directory with one rename. An existing target containing exactly that one byte-identical file returns `unchanged`; every other existing target conflicts. Within the cooperative operating boundary described below, the importer never repairs, deletes or overwrites an existing target.

This transaction assumes a trusted, exclusive local operator, checkout and destination namespace, apart from concurrent compliant imports. It does not provide a hostile same-principal, shared-account, multi-tenant or power-loss guarantee. A crash or failed best-effort cleanup may leave only an ignored `content/.live-import-*` orphan outside the build namespace.

An admitted record is a restrained factual source update. It reports the registered current compilation and its source fields, but does not infer amendment, commencement, practical impact, advice or an explainer. Hosted activation, automatic monitoring, live importing and deployment remain separately authorised future work.

Outside contributions are not accepted during this vertical slice. Contribution, correction, security and editorial policies must be approved before that changes.

## Licensing

Original code is licensed under AGPL-3.0-only. Content, factual data, third-party material and marks have separate terms in `CONTENT-LICENCE.md`.
