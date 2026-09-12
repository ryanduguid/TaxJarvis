# TaxJarvis: Australian tax source-verification demo

This non-production source-only demonstration contains one synthetic fixture and one authenticated Federal Register metadata record. Review aid, not professional advice; a practitioner must check the source and decide its relevance.

**Inputs:** the synthetic [dev-demo-001](content/developments/dev-demo-001/development.json) fixture, whose publisher and source URL are fictional, and the authenticated [Federal Register snapshot](content/developments/dev-frl-c2004a04633-c2026c00361/development.json).

```bash
npm run build
```

**Output:** the static site under `out/`, with an HTML page for each record and both records in the index, RSS and JSON feed.

The JSON endpoint uses the custom `feed.v2` schema and is advertised as
`application/json`. Use RSS for feed-reader subscriptions.

| Property | Synthetic fixture | Federal Register snapshot |
| --- | --- | --- |
| Publication status | `source-only` | `source-only` |
| Effective date | `null`, no commencement date established | `null`, no commencement date established |
| Evidence type | Fabricated demonstration | Authenticated metadata captured on 30 August 2026 |

Review question: what primary source and effective date would I need before changing a workpaper or advising on a development?

The [Superannuation Industry (Supervision) Act 1993 record](content/developments/dev-frl-c2004a04633-c2026c00361/development.json)
was admitted through the supported live importer. Its evidence was captured on
30 August 2026; it does not establish the current compilation today. The
[admission record](docs/live-admission.md) gives the authenticated asset and
reproduction commands. This local demonstration does not establish a hosted
monitoring service or client use.

<details>
<summary>Requirements, publication model, admission boundaries and licensing</summary>

## Requirements

- Node.js 24.19.0 or later
- npm 11.17.0 or later
- no package installation to build, test or publish; `npm ci` installs ESLint for `npm run lint` only

Authenticated live evidence admission is supported only on Windows and additionally requires GitHub CLI 2.98.0 or later, authenticated for GitHub.

## Commands

- `npm run dev` builds once and serves `out/` at `http://127.0.0.1:4173/`.
- `npm run build` creates the static site.
- `npm run import-bundle -- --bundle <file>` authenticates and admits one live-v2 evidence bundle under the rules below.
- `npm test` runs the complete Node test suite and prints a coverage summary.
- `npm run lint` runs ESLint with the recommended rules (after `npm ci`).
- `npm run smoke` exercises the exported routes over loopback HTTP.

CI runs the full suite on Ubuntu and Windows. Manual deployment requires both
jobs to pass. The Windows job exercises admission and filesystem behaviour that
Ubuntu skips.

## Publication model

`content/developments/` contains the synthetic `dev-demo-001` record and the
authenticated `dev-frl-c2004a04633-c2026c00361` record. HTML, RSS and JSON are generated projections. Invalid input
stops the build before the current build is replaced. Canonical record files
also use strict UTF-8 and duplicate-member rejection during every build.

Validation errors identify the record and up to five affected top-level fields
using `INVALID_FIELD`, or `INVALID_RECORD` for unknown fields and invalid shapes.
Invalid or mismatched identifiers appear as `[unidentified]`. Rejected values,
unknown key names and filesystem paths are omitted from these diagnostics.

Live pages and feed summaries show the evidence capture date in UTC and qualify
the displayed status as a historical observation. Building the site does not
recheck the source.

### Authenticated live admission

The supported wrapper fixes both the repository root and the `content/developments` destination. It accepts only the exact `--bundle <file>` argument and has no supported content-root, mode, provenance-skip, offline, overwrite or retry option.

Before semantic admission, the wrapper places a private snapshot of the received bytes under `content/.live-import-*` and runs three GitHub checks against `ryanduguid/au-tax-legislation-corpus`:

1. verification of the derived tagged release;
2. exact release-asset digest verification for that private snapshot; and
3. SLSA v1 artefact attestation verification constrained to the producer repository, `publish-live-evidence.yml` workflow, `refs/heads/main` source ref and a denial of self-hosted runners.

These checks authenticate the admitted bytes and their GitHub production path. They do not independently establish the truth, completeness or legal effect of the unsigned Federal Register of Legislation API response.

Each GitHub CLI command has a two-minute timeout. A timeout fails the import
without retrying or admitting the record.

The registration/publication date is the literal calendar part of the source `registeredAt` field, without timezone conversion. The compilation date is the source `start` field. They describe different events and need not be equal.

After provenance and semantic validation, the importer serialises and exactly revalidates one canonical `development.json` in private staging outside `content/developments`, then promotes its complete directory with one rename. An existing target containing exactly that one byte-identical file returns `unchanged`; every other existing target conflicts. Within the cooperative operating boundary described below, the importer never repairs, deletes or overwrites an existing target.

This transaction assumes a trusted, exclusive local operator, checkout and destination namespace, apart from concurrent compliant imports. It does not provide a hostile same-principal, shared-account, multi-tenant or power-loss guarantee. A crash or failed best-effort cleanup may leave only an ignored `content/.live-import-*` orphan outside the build namespace.

An admitted record is a restrained factual source update. It reports the registered current compilation at capture time and its source fields, but does not infer amendment, commencement, practical impact, advice or an explainer. Hosted activation, automatic monitoring, further live imports and deployment remain separately authorised future work.

Outside contributions are not accepted during this demonstration. Contribution, correction, security and editorial policies must be approved before that changes.

## Licensing

Original code is licensed under AGPL-3.0-only. Content, factual data, third-party material and marks have separate terms in `CONTENT-LICENCE.md`.

</details>
