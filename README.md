# Australian Tax Intelligence

This repository is a non-production source-only demonstration for a future public service covering Australian tax and accounting developments for practising accountants and tax agents.

It contains one artificial fixture. It does not monitor sources, publish live professional developments, generate an AI explainer, provide tax advice or replace source checking and professional judgement.

## Requirements

- Node.js 24.19.0 or later
- npm 11.17.0 or later
- no package installation

## Commands

- `npm run dev` builds once and serves `out/` at `http://127.0.0.1:4173/`.
- `npm run build` creates the static artifact.
- `npm run import-bundle -- --bundle incoming/evidence-bundle.v1.json --content-root content/developments` admits one live bundle under the rules below.
- `npm test` runs the complete Node test suite.
- `npm run check` performs syntax checks, builds and tests.
- `npm run smoke` exercises the exported routes over loopback HTTP.

## Publication model

`content/developments/dev-demo-001/development.json` is the only checked-in
editorial record. HTML, RSS and JSON are generated projections. Invalid input
stops the build before the current artifact is replaced. Canonical record files
also use strict UTF-8 and duplicate-member rejection during every build.

The importer accepts one ordinary `evidence-bundle.v1` file of at most 1 MiB
and an explicit ordinary content root. It parses UTF-8 and JSON strictly,
rejects unknown fields and duplicate members, validates source identity,
chronology, rights and evidence, and calculates `upstream.bundle_sha256` from
the exact bytes received. This Federal Register event is admitted only as
verified and in force; live mode requires the exact official Register URL and
attribution. The importer performs no network request and does not enrich the
source record.

The normal command rejects `mode: synthetic`; there is no command-line bypass.
The synthetic override exists only on the reusable function so the conformance
fixture can be exercised inside temporary test directories. A new record is
written and revalidated in a private sibling directory, then promoted with one
rename. Re-importing the same canonical bytes is an idempotent no-op. Any
different hash, identity, revision or content is a conflict: this stage never
deletes or overwrites an accepted development.

This integration does not add a live source monitor, AI explainer, unattended
publication or deployment. It establishes only the evidence-to-canonical
contract needed before those later stages can be designed safely.

Outside contributions are not accepted during this vertical slice. Contribution, correction, security and editorial policies must be approved before that changes.

## Licensing

Original code is licensed under AGPL-3.0-only. Content, factual data, third-party material and marks have separate terms in `CONTENT-LICENCE.md`.
