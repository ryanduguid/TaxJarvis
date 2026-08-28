# Tax Radar Evidence-Bundle Integration

**Status:** Approved Stage 2 design

**Date:** 29 August 2026

**Parent architecture:** Australian Tax Intelligence Public Service

## 1. Outcome

Prove the first trustworthy integration between the maintained Tax Radar code in
`au-tax-legislation-corpus` and the Australian Tax Intelligence publisher:

```text
validated Tax Radar source observation
  -> one immutable evidence-bundle.v1 JSON file
  -> strict publisher import
  -> one canonical development.v2 record
  -> the existing static HTML, RSS and JSON Feed build
```

This is a contract-first integration slice. It establishes the cross-repository
boundary with synthetic but production-shaped evidence. It does not enable live
monitoring, import a current tax development, call an AI model, push either
repository, or deploy a public site.

Credibility remains the controlling requirement. Unsupported, ambiguous or
conflicting input produces no bundle or canonical record.

## 2. Why this approach

Three approaches were considered:

1. A publisher-only importer using a locally invented fixture would be fastest,
   but it could drift from Tax Radar before the first genuine export.
2. A cross-repository contract-first slice gives both sides one exact golden
   example and proves the failure boundary without presenting synthetic material
   as live coverage. This is the selected approach.
3. A complete live monitoring and publication workflow would combine source
   retrieval, rights policy, contract design, repository permissions and public
   deployment in one change. Tax Radar is currently synthetic-only, so that
   approach would bypass evidence still needed to justify those decisions.

The maintained upstream is `au-tax-legislation-corpus`, which contains both the
corpus producer and `tax_radar_au`. The archived standalone Tax Radar repository
and the earlier `au-tax-change-impact-monitor` checkout are not revived or
modified.

## 3. Scope

### Included

- extend the upstream Federal Register observation contract with an evidence-rich
  synthetic version that binds each observation to a SHA-256 content digest;
- add a deterministic upstream evidence-bundle exporter for one supported
  Federal Register change class;
- define the exact, source-family-neutral `evidence-bundle.v1` publisher
  boundary;
- add a golden valid bundle and focused invalid conformance cases to both
  repositories;
- add strict, dependency-free bundle parsing, validation and transformation to
  the Node publisher;
- calculate the SHA-256 hash of the exact received bundle bytes in the publisher;
- materialise a new `development.v2` record through a contained, atomic,
  idempotent import;
- extend the existing validator and renderer to accept both the checked-in
  `development.v1` demonstration record and imported `development.v2` records;
- verify that an imported synthetic bundle can build every existing public view
  in an isolated test directory; and
- document the contract, commands and abstention behaviour.

### Not included

- network retrieval or scheduled monitoring;
- a real Federal Register observation or current professional update;
- ATO, TPB, Treasury, court, tribunal, AASB, AUASB, ASIC or APRA adapters;
- evidence extracts or republication of third-party source text;
- an impact assessment, technical explainer, AI writer or verifier;
- updates or corrections to an already imported development;
- batch import, a queue, database, webhook, API or runtime service;
- GitHub repository creation, remotes, pushes, pull requests, Pages enablement or
  deployment; or
- modification of the archived standalone Tax Radar repository.

## 4. Ownership and flow

### Tax Radar owns evidence production

The upstream repository owns:

- the Federal Register baseline and observation semantics;
- source identity and lifecycle classification;
- the exact evidence bytes used to support an observation and their SHA-256
  digest;
- the Federal Register publisher, document-class and rights policy;
- deterministic development and bundle identities; and
- production of immutable `evidence-bundle.v1` files.

The initial exporter accepts only a complete, evidence-rich synthetic
observation and one `SUPERSEDED` baseline compilation with a newer observed
compilation. That state is rendered as a source event concerning the newly
observed in-force compilation. `UNCHANGED` observations create no bundle. Any
other changed, blocked, incomplete or inconsistent state fails the whole export
rather than disappearing from the output.

The exporter does not infer practical implications, topics, affected practice
areas or legal effect beyond the mechanically supported source lifecycle. Those
arrays remain empty in this slice.

### The publisher owns admission and publication

The publisher treats every bundle byte as untrusted input. It owns:

- input size, file-type and JSON-integrity checks;
- exact bundle schema and semantic validation;
- calculation of the raw received-bundle SHA-256 digest;
- deterministic transformation to `development.v2`;
- idempotency and conflict rejection;
- atomic materialisation under `content/developments/<development_id>/`;
- full-corpus validation before a site build; and
- presentation of source, authority, evidence, publication and synthetic/live
  status.

The publisher never fetches the source URL during import or build. It does not
repair, enrich or reinterpret a malformed bundle.

## 5. Upstream observation and export

### Evidence-rich observation

The upstream contract adds `au-tax-register-observation-facts.v3` and its
projected `au-tax-register-observation.v3` form. Existing v1 and v2 behaviour
remains valid and unchanged.

V3 retains the v2 scope and `evidence_id` fields and adds, for every observation:

- `content_sha256`: `sha256:` followed by exactly 64 lowercase hexadecimal
  characters, calculated over the exact authoritative payload used for the
  observation;
- `content_kind`: initially `metadata-response` or `source-document`; and
- `content_media_type`: a non-empty, controlled media type.

The synthetic fixture hashes a checked-in artificial payload. The contract does
not claim that an observation-file hash is a source-content hash. A later live
observer must capture and hash the real response or document bytes before it can
produce a live v3 observation.

### Export command

The upstream adds a standard-library command shaped as:

```text
python -m fadden export_publication_bundles -- \
  <sources.json> <observation-facts-v3.json> --out <new-empty-directory>
```

The exact command spelling may follow the existing `fadden` dispatcher, but it
must remain non-interactive and take explicit paths. The exporter:

1. captures the exact baseline and facts bytes once;
2. rejects duplicate JSON members, control characters, unsafe paths and unknown
   fields;
3. reuses the existing baseline and observation projection rules;
4. requires complete v3 scope and supported state-specific fields;
5. calculates deterministic source-digest provenance from the captured bytes;
6. creates every output in a new, otherwise empty directory; and
7. leaves no output directory behind if any candidate fails.

The output directory is immutable for that run. The exporter refuses links,
junctions, special files, an existing non-empty destination or an input path that
aliases the output. This avoids an overwrite and recovery protocol in the first
slice.

## 6. `evidence-bundle.v1`

One bundle describes one source development. JSON object keys are exact;
unknown keys fail. Text must be trimmed, bounded and valid for both HTML and XML
rendering. Identifiers use the publisher's safe identifier grammar. Timestamps
use real RFC 3339 UTC values, while official date-only values remain explicitly
date-only inside the source-event block.

The top-level object contains:

- `schema_version`: exactly `evidence-bundle.v1`;
- `bundle_id` and `development_id`;
- `mode`: `synthetic` or `live`;
- `generated_at`;
- `producer`: producer name and version plus SHA-256 digests of the exact
  baseline and observation-facts snapshots;
- `development`: official title, authority status, publication/effect dates,
  topics and affected practice areas;
- `source_event`: the supported lifecycle event and its prior and current
  compilation metadata;
- `sources`: one to twenty authoritative source entries; and
- `revision`: initial revision metadata and an optional replacement reference.

Each source contains:

- stable identity, publisher, document class and official title;
- canonical HTTPS URL, publication time and retrieval time;
- the evidence identifier, content kind, media type and content SHA-256;
- a rights object with mode, attribution and optional HTTPS licence URL; and
- a bounded evidence array.

This slice permits only `metadata-only` rights and therefore requires an empty
evidence array. The schema reserves no loosely typed extension object. A future
extract-bearing contract must specify locator, quotation, hashing and rights
rules explicitly.

The synthetic golden bundle uses reserved artificial hosts and `mode:
synthetic`. A live bundle may not use an artificial host. The upstream exporter
in this slice emits only synthetic bundles, even though the publisher validates
the future `live` mode distinction.

The bundle carries source and producer hashes but not its own raw-bundle hash. A
hash declared inside the same unsigned file would not establish authenticity.
The publisher calculates that digest from the exact bytes it receives.

## 7. Canonical `development.v2`

`development.v2` preserves the existing public fields and adds:

- `mode`: `synthetic` or `live`;
- `source_event`: the mechanically supported upstream change;
- source evidence identity, content kind, media type and SHA-256;
- `upstream`: bundle identity, producer metadata, producer source digests and
  the publisher-calculated raw bundle SHA-256; and
- revision linkage suitable for a later, separately designed update path.

The existing `development.v1` artificial fixture remains supported and
unchanged so this slice does not disguise a contract test as new editorial
content. The renderer normalises both versions to one internal view model. A v2
record with `mode: synthetic` receives the same prominent demonstration warning
and is never presented as current coverage.

Every public format continues to derive from the canonical record. The
homepage, development page, RSS and JSON Feed must agree on identity, title,
statuses and revision time. Source-event and provenance detail may appear only
where the format can carry it without inventing another editorial record.

## 8. Import behaviour

The publisher adds a dependency-free command for one explicit bundle file and
one explicit content root. Its reusable functions validate bytes, transform a
validated bundle and import a canonical record; command-line parsing remains a
thin wrapper.

Import rules are:

1. The input must be one ordinary file, no more than 1 MiB, outside the target
   development directory.
2. UTF-8, duplicate JSON members, exact keys, sizes, identifiers, timestamps,
   URL safety, source uniqueness, dates, hashes, rights and cross-field
   consistency are validated before transformation.
3. Synthetic bundles are rejected by the normal command. Tests may enable an
   explicit `allowSynthetic` function option while writing only to an isolated
   temporary content root.
4. The raw SHA-256 is calculated over the exact accepted bytes and recorded in
   `upstream.bundle_sha256`.
5. Transformation is deterministic and contains no current-time, network or
   environment-derived field.
6. A new record is completely written and re-read in a private sibling
   directory before that directory is renamed to its final development ID.
7. If the final directory already contains the same development and bundle
   hash, import is an idempotent no-op.
8. Any existing identity with a different hash, revision or content is a
   conflict. This slice refuses it; correction and supersession import receive
   their own design.
9. Failed validation or promotion removes only importer-owned staging material
   and leaves existing content unchanged.

The importer never deletes or overwrites an accepted record in this slice.

## 9. Failure and security rules

- No invalid input creates a bundle, canonical record or partially changed
  public artifact.
- Unknown schema versions and keys fail closed on both sides.
- Duplicate JSON members fail rather than relying on parser last-key wins.
- Sparse arrays, non-finite values, malformed Unicode, XML-forbidden text,
  unsafe URLs and timestamp normalisation edge cases are tested.
- Source titles, identifiers, paths and URLs never become executable markup or
  filesystem traversal.
- Hash comparisons use canonical lowercase syntax and exact equality.
- A producer digest is provenance, not authentication. Repository protections
  and a later transport design remain responsible for origin assurance.
- No source HTML, PDF, EPUB or model output is rendered in this slice.
- Build and import perform no network access and read no credentials.
- Existing workflow permissions remain unchanged because this slice does not
  automate cross-repository delivery.

## 10. Tests and conformance

### Upstream

- v3 nominal projection and all new exact-field, hash, content-kind and media
  type failures;
- byte-stable golden bundle generation;
- deterministic identifiers and date mapping;
- complete-scope and supported-state abstention;
- duplicate-member, input-alias, destination and cleanup failures; and
- no regression to existing v1/v2 monitor and corpus tests.

### Publisher

- exact valid golden bundle admission and raw-byte hash;
- unknown/missing/duplicate keys, oversized files and malformed UTF-8;
- invalid identifiers, URLs, timestamps, dates, digests, rights and inconsistent
  source-event metadata;
- deterministic `development.v2` transformation;
- synthetic-mode command rejection;
- successful isolated import, re-read validation and idempotent re-import;
- conflict and injected write/promotion failure with existing content intact;
- v1 and v2 rendering projections, escaping and status labelling; and
- complete existing `npm run check` and `npm run smoke` regression suites.

The same golden JSON bytes must exist in both repositories. A local conformance
check compares their SHA-256 values and exact bytes. Neither repository fetches
the other's fixture during its normal test run.

## 11. Delivery sequence

1. Implement and verify the upstream v3 observation and golden bundle exporter.
2. Copy the reviewed golden bundle bytes into the publisher test fixtures and
   record their upstream commit and SHA-256.
3. Implement strict publisher parsing, validation and transformation.
4. Implement contained one-record import and idempotency.
5. Extend canonical validation and rendering for `development.v2`.
6. Run both complete repository suites and the cross-repository byte comparison.
7. Perform a final diff review. Do not push or deploy.

## 12. Acceptance criteria

1. Tax Radar, not the publisher, produces the evidence bundle.
2. Both repositories agree byte-for-byte on one valid `evidence-bundle.v1`
   fixture.
3. The publisher records a SHA-256 calculated from the exact received bytes.
4. The same valid bundle imports deterministically and idempotently into an
   isolated canonical record.
5. A conflicting, unsupported or malformed bundle leaves existing content
   unchanged.
6. An imported v2 record can generate all public formats without a parallel
   editorial representation.
7. Synthetic status remains unmistakable and the normal import command refuses
   synthetic material.
8. Existing source-only behaviour and tests continue to pass.
9. Neither build nor import uses network access, AI, a package dependency,
   secrets or a production database.
10. No remote, push, deployment or live publication is performed.

Passing this slice authorises a separate design for the first live Federal
Register observer and repository-to-repository delivery. It does not authorise
public AI explainers or unattended publication.
