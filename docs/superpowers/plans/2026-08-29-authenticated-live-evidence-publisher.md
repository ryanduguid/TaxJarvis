# Authenticated Live Evidence Publisher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admit one authenticated `evidence-bundle.v2` through three independent GitHub provenance checks, independently prove its Federal Register compilation fact and atomically publish one restrained `development.v2` record.

**Architecture:** `live-evidence.mjs` is the deep live-v2 parser, fact validator, rights checker and canonical transformer. `live-provenance.mjs` owns the exact no-shell GitHub CLI policy. `import-live.mjs` is the sole supported production entry point and fixes the repository content root internally, while `live-import-internals.mjs` contains unsupported test seams for filesystem failure simulation. Existing `evidence-bundle.mjs` and `import.mjs` remain the unchanged synthetic-v1 conformance path.

**Tech Stack:** Node.js 24.19.0+, npm 11.17.0+, standard library only, Node test runner and GitHub CLI 2.98.0+.

**Spec:** Producer repository commit `b5f4d23`, file `docs/superpowers/specs/2026-08-29-authenticated-live-evidence-admission-design.md`.

## Global Constraints

- Work only on local publisher `main`; do not add a remote, push, deploy or import any unverified live record.
- Add no npm dependency and preserve `package-lock.json` absence.
- Copy the producer v2 golden fixture byte-for-byte; never regenerate it independently.
- Keep existing v1 fixture bytes, parser and transformation conformance unchanged.
- The supported production command is exactly `npm run import-bundle -- --bundle <file>`.
- No production command or supported programmatic export accepts a content root, mode, synthetic flag, operations override, verifier, provenance skip, offline trust, overwrite or retry.
- Retain all three GitHub checks; invoke child processes with argument arrays and no shell.
- Preserve raw `start` as compilation date. Derive registration/publication date from the literal calendar component of raw `registeredAt` without timezone conversion or equality between those dates.
- Recompute exact rights from validated `observation.checked_at`; never trust or reword the supplied rights object.
- Every error before promotion leaves `content/developments` byte-for-byte unchanged.
- Use Australian English in prose and exact official source names in code/data.

---

### Task 1: Parse, prove and transform the live v2 evidence contract

**Files:**
- Create: `live-evidence.mjs`
- Create: `test/live-evidence.test.mjs`
- Create: `test/fixtures/evidence-bundle.v2.json`
- Modify: `evidence-bundle.mjs`
- Modify: `test/evidence-bundle.test.mjs`

**Interfaces:**
- Produces: `parseLiveEvidenceBundle(bytes) -> { bundle, bundleSha256, releaseTag, fact }`.
- Produces: `transformLiveEvidenceBundle(parsed) -> development.v2`.
- Produces: `validateLiveDevelopmentV2(record) -> { ok: true, value } | { ok: false, errors }`.
- Keeps Stage 3A nested schemas and raw OData representation private inside `live-evidence.mjs`.

- [ ] **Step 1: Copy and attest the producer golden fixture**

Copy `tests/corpus/fixtures/live-evidence/evidence-bundle.v2.json` from the producer after producer Task 5. Before adding it, compare its byte length and SHA-256 with the producer handoff:

```powershell
$producerFixture = '..\..\worktrees\au-tax-evidence-bundle\tests\corpus\fixtures\live-evidence\evidence-bundle.v2.json'
$publisherFixture = 'test\fixtures\evidence-bundle.v2.json'
Copy-Item -LiteralPath $producerFixture -Destination $publisherFixture
$producerHash = (Get-FileHash -LiteralPath $producerFixture -Algorithm SHA256).Hash
$publisherHash = (Get-FileHash -LiteralPath $publisherFixture -Algorithm SHA256).Hash
if ($producerHash -ne $publisherHash) { throw 'v2 fixtures differ' }
```

- [ ] **Step 2: Write failing live-contract tests**

Test the golden happy path and mutate every exact-member layer. Cover malformed UTF-8/JSON, duplicate/unknown members, SemVer, IDs, URLs, sizes, canonical base64, raw digest/length/path/media relationships, reconstructed capture-result digest and observation relationships. Add this key assertion:

```js
assert.equal(parsed.fact.compilationDate, "2026-08-18");
assert.equal(parsed.fact.registrationDate, "2026-08-27");
assert.equal(parsed.fact.publishedAt, "2026-08-27T00:00:00Z");
assert.equal(parsed.fact.checkedAt, "2026-08-28T00:00:00Z");
```

Test numeric-offset and offset-less `registeredAt` grammar, no `Date` normalisation, a registration date after the UTC `checked_at` calendar date failing closed, null previous compilation number, mandatory current number, 500-character live title/attribution bounds and colon-delimited Stage 3A evidence IDs.

- [ ] **Step 3: Run tests and verify RED**

```powershell
node --test test/live-evidence.test.mjs
```

Expected: module-not-found failure for `live-evidence.mjs`.

- [ ] **Step 4: Implement the deep live parser and fact object**

Use `parseStrictJsonBytes` for the outer and decoded raw JSON. Validate exact object keys before reading nested values. The private fact returned after full validation has this fixed shape:

```js
{
  developmentId,
  bundleId,
  sourceId,
  title,
  collection,
  registerId,
  previousCompilationNumber,
  previousCompilationDate,
  currentCompilationNumber,
  compilationDate,
  registrationDate,
  currentDocumentId,
  checkedAt,
  publishedAt,
  primaryResponseSha256,
  evidenceId,
  observationSha256,
  producer,
  rights,
}
```

Derive `registrationDate` lexically from valid raw `registeredAt`; never compare it with `compilationDate`. Reconstruct the exact rights template from `checkedAt.slice(0, 10)` and require deep equality. Derive the release tag solely from `run.observation_sha256`.

- [ ] **Step 5: Implement direct live canonical transformation and validation**

Construct `development.v2` directly, with `mode: "live"`, empty topics/areas, null explainer, compilation date in `source_event.current_compilation.date`, registration-derived `published_at`, exact validated rights and the fixed official/evidence release links. Do not project through v1. Keep the existing v1 `validateCanonicalDevelopmentV2` for synthetic mode; rename it internally only if needed, without changing v1 results.

- [ ] **Step 6: Run live and v1 contract tests GREEN**

```powershell
node --test test/live-evidence.test.mjs test/evidence-bundle.test.mjs
```

Expected: all selected tests pass and the v1 fixture digest remains unchanged.

- [ ] **Step 7: Commit Task 1**

```powershell
git add live-evidence.mjs test/live-evidence.test.mjs test/fixtures/evidence-bundle.v2.json evidence-bundle.mjs test/evidence-bundle.test.mjs
git diff --cached --check
git commit -m "feat: validate authenticated live evidence"
```

### Task 2: Validate and render restrained live developments

**Files:**
- Modify: `site.mjs`
- Modify: `test/site.test.mjs`
- Modify: `assets/site.css`

**Interfaces:**
- Consumes: `validateLiveDevelopmentV2` for `development.v2` records with `mode: "live"`.
- Preserves: `validateDevelopment`, `renderSite` and `buildSite` public signatures.

- [ ] **Step 1: Add failing canonical and rendering tests**

Use the canonical transformation from Task 1. Assert every public representation contains `New compilation: <official title>`, the exact restrained sentence, registration date `27 August 2026`, compilation date `18 August 2026`, previous/current compilation numbers, official title URL and derived immutable release URL. Assert HTML, RSS and JSON Feed use `2026-08-27T00:00:00Z` for publication/order and never call the compilation date “Registered”. Assert empty topic/area sections and explainer shell are absent, and no format says amended, commenced, impact or advice.

- [ ] **Step 2: Run rendering tests and verify RED**

```powershell
node --test --test-name-pattern="live" test/site.test.mjs
```

Expected: failures for old generic rendering and date labelling.

- [ ] **Step 3: Route canonical validation without joining adapters**

In `validateDevelopment`, route `development.v2` plus `mode: "live"` to `validateLiveDevelopmentV2`; retain the existing synthetic-v2 validator for `mode: "synthetic"`. Reject every other mode. Do not make either evidence-bundle parser call the other.

- [ ] **Step 4: Implement the live presentation branch**

Add private helpers only. Derive the evidence URL as:

```js
const releaseTag = `live-evidence-v2-${record.upstream.producer.observation_facts_sha256.slice("sha256:".length)}`;
const evidenceUrl = `https://github.com/ryanduguid/au-tax-legislation-corpus/releases/tag/${releaseTag}`;
```

Render the registration date from `record.published_at` and compilation date from `record.source_event.current_compilation.date`. Keep the existing synthetic/demo markup byte-stable except for shared escaping fixes required by tests.

- [ ] **Step 5: Run site tests GREEN and commit**

```powershell
node --test test/site.test.mjs
git add site.mjs test/site.test.mjs assets/site.css
git diff --cached --check
git commit -m "feat: render verified compilation developments"
```

### Task 3: Enforce GitHub CLI capability and three-part provenance

**Files:**
- Create: `live-provenance.mjs`
- Create: `test/live-provenance.test.mjs`

**Interfaces:**
- Produces supported operation: `verifyLiveBundleSnapshot({ snapshotPath, releaseTag }) -> Promise<void>`.
- Produces internal test seam: `verifyWithRunner({ snapshotPath, releaseTag, run }) -> Promise<void>`.

- [ ] **Step 1: Add failing command-vector and failure tests**

Capture every `run(file, args, options)` call. Test minimum version `2.98.0`, auth/capability failures, each provenance-command failure, bounded stdout/stderr, no shell and stable errors without child output. Assert the three final argument vectors exactly:

```js
["release", "verify", releaseTag, "--repo", "ryanduguid/au-tax-legislation-corpus"]
["release", "verify-asset", releaseTag, snapshotPath, "--repo", "ryanduguid/au-tax-legislation-corpus"]
[
  "attestation", "verify", snapshotPath,
  "--repo", "ryanduguid/au-tax-legislation-corpus",
  "--signer-workflow", "ryanduguid/au-tax-legislation-corpus/.github/workflows/publish-live-evidence.yml",
  "--source-ref", "refs/heads/main",
  "--predicate-type", "https://slsa.dev/provenance/v1",
  "--deny-self-hosted-runners",
]
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
node --test test/live-provenance.test.mjs
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement bounded no-shell execution**

Use `execFile` through `promisify`, `windowsHide: true`, `shell: false`, UTF-8 text and a maximum child-output buffer of 65,536 bytes. Run bounded `gh --version`, `gh auth status` and help/capability checks before the three provenance calls. Parse only the first official version line and require major/minor/patch at least `2.98.0`. Map failures to fixed `LiveProvenanceError` messages.

- [ ] **Step 4: Run provenance tests GREEN and commit**

```powershell
node --test test/live-provenance.test.mjs
git add live-provenance.mjs test/live-provenance.test.mjs
git diff --cached --check
git commit -m "feat: verify live evidence provenance"
```

### Task 4: Add fixed-root atomic production admission

**Files:**
- Create: `live-import-internals.mjs`
- Create: `import-live.mjs`
- Create: `test/import-live.test.mjs`
- Modify: `package.json`
- Modify: `import.mjs`
- Modify: `test/import.test.mjs`

**Interfaces:**
- Produces supported API: `importLiveEvidenceBundle(bundlePath: string) -> Promise<{ status, developmentPath, bundleSha256 }>`.
- Produces CLI: `runImportCli(argv, streams?) -> Promise<number>` accepting exactly `--bundle <file>`.
- Internal-only `admitLiveEvidence({ bundlePath, repositoryRoot, operations, verifyProvenance })` is imported directly only by focussed tests and the fixed production wrapper; it is not re-exported.

- [ ] **Step 1: Write failing API, filesystem and idempotency tests**

Test that the supported API has arity one and rejects object/options forms. CLI accepts exactly one `--bundle` pair and rejects every unknown/repeated/missing option including `--content-root`, `--synthetic`, `--skip-provenance`, `--offline`, `--overwrite` and `--retry`. Through the internal seam, test unsafe input/root ancestors, links/junctions/reparse points, input inside target, exact private snapshot, snapshot byte change, each provenance failure, semantic failure, write/re-read/race/rename/cleanup failure, exact reimport and changed same-identity conflict. Snapshot must be deleted before final staging enumeration.

- [ ] **Step 2: Run admission tests and verify RED**

```powershell
node --test test/import-live.test.mjs
```

Expected: missing modules/production command behaviour.

- [ ] **Step 3: Implement internal admission in the required order**

Resolve and validate paths; create an importer-owned staging directory under the fixed content root; snapshot the bounded input once; re-read exact bytes; parse only enough v2 envelope to derive release tag; run `verifyLiveBundleSnapshot`; perform full semantic parse/transform; calculate canonical bytes; re-read and validate them; remove the private snapshot; assert staging contains exactly `development.json`; then rename once. Existing exact canonical bytes return `unchanged`; every difference conflicts.

- [ ] **Step 4: Implement the fixed production wrapper and package command**

Resolve repository root from `import.meta.url` and hard-code `content/developments` relative to that root. Change only the package script target:

```json
{
  "scripts": {
    "import-bundle": "node import-live.mjs"
  }
}
```

Keep `import.mjs` available only to existing v1 conformance tests; remove no v1 test seam. Add all new modules/tests to the syntax-check portion of `npm run check`.

- [ ] **Step 5: Run import tests GREEN and commit**

```powershell
node --test test/import-live.test.mjs test/import.test.mjs
git add live-import-internals.mjs import-live.mjs test/import-live.test.mjs package.json import.mjs test/import.test.mjs
git diff --cached --check
git commit -m "feat: admit live evidence atomically"
```

### Task 5: Document, integrate and verify the publisher

**Files:**
- Modify: `README.md`
- Modify: `CONTENT-LICENCE.md`
- Modify only gate-exposed Task 1–4 files.

**Interfaces:**
- Confirms producer/publisher fixture byte equality and all existing public module signatures.

- [ ] **Step 1: Update documentation**

Document the exact fixed-root production command, required authenticated GitHub CLI version, three provenance checks, registration/compilation distinction, immutable per-asset rights, source-only claim, atomic no-overwrite behaviour and the remaining separate hosted activation/deployment approvals. Remove the old production `--content-root` command from README without removing v1 conformance documentation.

- [ ] **Step 2: Run cross-repository fixture proof**

```powershell
$producerFixture = '..\..\worktrees\au-tax-evidence-bundle\tests\corpus\fixtures\live-evidence\evidence-bundle.v2.json'
$publisherFixture = 'test\fixtures\evidence-bundle.v2.json'
if (-not (Compare-Object (Get-Content -LiteralPath $producerFixture -AsByteStream) (Get-Content -LiteralPath $publisherFixture -AsByteStream) -SyncWindow 0)) { 'FIXTURE_BYTES=MATCH' } else { throw 'Fixture bytes differ' }
```

- [ ] **Step 3: Run repository-defined full gates**

```powershell
npm run check
npm run smoke
git diff --check
```

Expected: every command exits zero, existing synthetic outputs remain deterministic and the isolated live fixture produces coherent HTML, RSS and JSON Feed.

- [ ] **Step 4: Commit documentation or gate fixes**

```powershell
git add README.md CONTENT-LICENCE.md
git diff --cached --check
git commit -m "docs: describe authenticated live evidence admission"
```

If a gate required code changes, stage and commit those separately after rerunning the failed focussed and full gates. Do not add a remote or deploy.
