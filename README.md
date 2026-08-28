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
- `npm test` runs the complete Node test suite.
- `npm run check` performs syntax checks, builds and tests.
- `npm run smoke` exercises the exported routes over loopback HTTP.

## Publication model

`content/developments/dev-demo-001/development.json` is the only editorial record. HTML, RSS and JSON are generated projections. Invalid input stops the build before the current artifact is replaced.

Outside contributions are not accepted during this vertical slice. Contribution, correction, security and editorial policies must be approved before that changes.

## Licensing

Original code is licensed under AGPL-3.0-only. Content, factual data, third-party material and marks have separate terms in `CONTENT-LICENCE.md`.
