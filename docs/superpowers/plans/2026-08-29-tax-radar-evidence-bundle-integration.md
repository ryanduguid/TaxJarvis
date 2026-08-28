# Tax Radar Evidence-Bundle Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove a fail-closed, byte-stable path from a synthetic Tax Radar source observation to an idempotently imported `development.v2` record and every existing static public format.

**Architecture:** The maintained `au-tax-legislation-corpus` repository extends its Federal Register observation contract and exports one immutable, source-family-neutral `evidence-bundle.v1`. The dependency-free Node publisher strictly parses and validates those bytes, calculates their SHA-256 digest, transforms them to `development.v2`, and atomically admits a new record without overwriting existing content.

**Tech Stack:** Python 3.10+ standard library with the repository's locked pytest toolchain; Node.js 24.19.0+ ECMAScript modules and standard library; `unittest`, pytest and `node:test`; JSON, HTML, RSS and CSS; Git worktrees.

**Spec:** `docs/superpowers/specs/2026-08-29-tax-radar-evidence-bundle-integration-design.md`

## Global Constraints

- Work in isolated worktrees created through `superpowers:using-git-worktrees`; do not develop on either repository's existing checkout branch.
- Base publisher work on local `main` containing design commit `dca1171` or its verified descendant.
- Fetch the maintained upstream and base its worktree on the exact `origin/main` commit verified at execution time; the design-time reference was `0daebccade87183fa8264ba3bf7e967ce02603f5`.
- Do not modify or recreate the archived standalone `tax-radar-au` repository or the earlier `au-tax-change-impact-monitor` checkout.
- Do not add a Python or Node package dependency, lockfile, client JavaScript, network call, AI call, database, queue or runtime service.
- Upstream tests and generated fixtures must be deterministic on Python 3.10 through 3.13; publisher code requires Node.js 24.19.0 and npm 11.17.0 or later.
- Treat bundle bytes, JSON values, URLs and filesystem paths as untrusted input; unknown keys, duplicate JSON members and unsupported states fail closed.
- The normal publisher command must reject `mode: synthetic`; tests may pass `allowSynthetic: true` only with an isolated temporary content root.
- The publisher calculates the raw bundle digest from exact received bytes. It never trusts or adds a self-declared raw-bundle hash.
- Imports create new development directories only. This slice never overwrites, revises or deletes an accepted record.
- The publisher fixture must match the reviewed upstream golden fixture byte-for-byte and record its exact upstream commit and SHA-256.
- Use Australian English in prose. Preserve official identifiers, URLs, source names and code spelling exactly.
- Run only repository-defined checks. Do not push, publish, deploy, create a remote or change GitHub settings.

The planned worktree roots are
`C:\Users\-\Documents\Codex\2026-08-28\wou\worktrees\australian-tax-intelligence-stage2`
and
`C:\Users\-\Documents\Codex\2026-08-28\wou\worktrees\au-tax-evidence-bundle`.

## Execution preflight

Before Task 1, read this plan and its specification completely, then:

1. Run `git status --short --branch` in both base repositories and preserve unrelated work.
2. Use the git-worktrees skill to create one publisher feature worktree and one upstream feature worktree.
3. Record `git rev-parse HEAD`, the available Python/uv versions and `node --version && npm --version` in the execution notes.
4. Run the publisher baseline `npm run check` and `npm run smoke`.
5. Run the upstream baseline commands that are available locally: at minimum `python -m unittest discover -s tests/corpus -t . -v`; use the locked `uv` commands in Task 7 when `uv==0.12.0` is available.
6. Stop if either baseline fails for a reason not already documented; use `superpowers:systematic-debugging` before changing implementation code.

---

### Task 1: Evidence-rich Federal Register observation v3

**Files:**

- Modify upstream: `fadden/export_monitor_contract.py`
- Modify upstream: `tests/corpus/test_monitor_contract.py`
- Modify upstream: `tax_radar_au/monitor.py`
- Modify upstream: `tests/radar/test_monitor.py`

**Interfaces:**

- Consumes: existing `project_baseline(sources: dict[str, Any]) -> dict[str, Any]` and `project_observation(baseline: dict[str, Any], facts: dict[str, Any]) -> dict[str, Any]`.
- Produces: v3 support in `project_observation` and the existing monitor loader;
  constants `CONTENT_KINDS`, `CONTENT_MEDIA_TYPES`, `SHA256_ID`; no behavioural
  change to v1, v2 or the `au-tax-impact-queue.v2` output schema.

- [ ] **Step 1: Add the failing nominal v3 projection test**

Add a local fixture constructor to `tests/corpus/test_monitor_contract.py` using the same two sample titles as the existing v2 helper. Give every item these additional fields:

```python
"content_sha256": "sha256:" + "a" * 64,
"content_kind": "metadata-response",
"content_media_type": "application/json",
```

Use `schema_version: "au-tax-register-observation-facts.v3"` and assert:

```python
def test_project_observation_v3_preserves_content_evidence(self):
    projected = contract.project_observation(sources_document(), observation_facts_v3())
    self.assertEqual(projected["schema_version"], "au-tax-register-observation.v3")
    self.assertEqual(projected["mode"], "synthetic")
    self.assertEqual(projected["scope_id"], "au-primary-tax-legislation.v3")
    self.assertEqual(projected["observations"][0]["content_sha256"], "sha256:" + "a" * 64)
    self.assertEqual(projected["observations"][0]["content_kind"], "metadata-response")
    self.assertEqual(projected["observations"][0]["content_media_type"], "application/json")
```

- [ ] **Step 2: Run the nominal test and confirm RED**

Run:

```text
python -m unittest tests.corpus.test_monitor_contract.MonitorContractTests.test_project_observation_v3_preserves_content_evidence -v
```

Expected: failure reporting the unsupported v3 schema.

- [ ] **Step 3: Add strict v3 validation**

In `fadden/export_monitor_contract.py`, add exact constants:

```python
SHA256_ID = re.compile(r"sha256:[0-9a-f]{64}")
CONTENT_KINDS = {"metadata-response", "source-document"}
CONTENT_MEDIA_TYPES = {"application/json", "application/pdf", "application/xhtml+xml", "text/html"}
OBSERVATION_V3_FIELDS = OBSERVATION_V2_FIELDS | {
    "content_sha256", "content_kind", "content_media_type",
}
```

Extend the schema dispatch without changing the v1/v2 branches. For v3, require the v2 top-level keys and `OBSERVATION_V3_FIELDS`, emit `au-tax-register-observation.v3`, and copy only values that pass:

```python
content_sha256 = _non_empty(item["content_sha256"], f"observation fact {index} content_sha256")
if SHA256_ID.fullmatch(content_sha256) is None:
    raise ContractError(f"observation fact {index} content_sha256 is invalid.")
content_kind = _non_empty(item["content_kind"], f"observation fact {index} content_kind")
if content_kind not in CONTENT_KINDS:
    raise ContractError(f"observation fact {index} content_kind is unsupported.")
content_media_type = _non_empty(
    item["content_media_type"], f"observation fact {index} content_media_type"
)
if content_media_type not in CONTENT_MEDIA_TYPES:
    raise ContractError(f"observation fact {index} content_media_type is unsupported.")
```

- [ ] **Step 4: Add the v3 rejection matrix**

Add subtests for an uppercase digest, wrong digest length, unsupported kind, media type with parameters, missing field, extra field and duplicate `evidence_id`. Each case must assert a safe field-specific `ContractError` and no partially projected value.

```python
cases = (
    ("digest case", lambda value: value["observations"][0].__setitem__("content_sha256", "sha256:" + "A" * 64), "content_sha256"),
    ("digest length", lambda value: value["observations"][0].__setitem__("content_sha256", "sha256:" + "a" * 63), "content_sha256"),
    ("content kind", lambda value: value["observations"][0].__setitem__("content_kind", "web-page"), "content_kind"),
    ("media type", lambda value: value["observations"][0].__setitem__("content_media_type", "application/json; charset=utf-8"), "content_media_type"),
)
```

- [ ] **Step 5: Add Tax Radar consumer compatibility tests**

In `tests/radar/test_monitor.py`, build a valid v3 observation from the existing
v2 helper by changing `schema_version`, adding the three content-evidence fields
to every observation and retaining the exact baseline scope. Assert `compare`
accepts it and still emits `schema_version: "au-tax-impact-queue.v2"`. Add
consumer rejection cases for every invalid digest, kind and media-type case used
by the producer tests.

Extend `_load_observation` in `tax_radar_au/monitor.py` with a v3 exact-key
branch and the same controlled values. Validate and retain the fields in the
loaded snapshot but do not add them to queue item prose or treat them as a
technical decision. The existing raw observation snapshot digest already binds
them into `source_digests.observation`.

- [ ] **Step 6: Run focused and complete upstream contract tests**

Run:

```text
python -m unittest tests.corpus.test_monitor_contract -v
python -m unittest discover -s tests/corpus -t . -v
uv run --locked --extra dev pytest tests/radar/test_monitor.py
```

Expected: all tests pass with existing v1/v2 coverage unchanged.

- [ ] **Step 7: Commit Task 1 in the upstream worktree**

```text
git add fadden/export_monitor_contract.py tests/corpus/test_monitor_contract.py tax_radar_au/monitor.py tests/radar/test_monitor.py
git commit -m "feat: bind monitor observations to content evidence"
```

---

### Task 2: Deterministic upstream evidence-bundle exporter

**Files:**

- Create upstream: `fadden/export_publication_bundles.py`
- Create upstream: `tests/corpus/test_publication_bundle_export.py`
- Create upstream: `tests/corpus/fixtures/publication/sample-sources.json`
- Create upstream: `tests/corpus/fixtures/publication/sample-observation-facts-v3.json`
- Create upstream: `tests/corpus/fixtures/publication/sample-evidence-payload.json`
- Create upstream: `tests/corpus/fixtures/publication/evidence-bundle.v1.json`
- Modify upstream: `fadden/__init__.py`
- Modify upstream: `fadden/__main__.py`
- Modify upstream: `tests/corpus/test_corpus_cli.py`

**Interfaces:**

- Consumes: `project_baseline`, `project_observation`, exact baseline bytes, exact observation-facts bytes and root `VERSION`.
- Produces:
  - `build_publication_bundles(baseline: dict[str, Any], observation: dict[str, Any], *, baseline_sha256: str, observation_facts_sha256: str, producer_version: str) -> list[dict[str, Any]]`
  - `bundle_bytes(bundle: dict[str, Any]) -> bytes`
  - `export_publication_bundles(sources_path: Path, facts_path: Path, output_dir: Path) -> list[Path]`
  - `main(argv: Sequence[str] | None = None) -> int`

- [ ] **Step 1: Add coherent synthetic input fixtures**

Use one artificial Act with baseline compilation `1` dated `2026-07-01`, observed compilation `2` dated `2026-08-05`, observation/retrieval time `2026-08-08T00:00:00Z`, and reserved `https://example.invalid/` URLs. The artificial payload must contain exactly these UTF-8 LF bytes, including the final newline:

```json
{
  "register_id": "C2099A00001",
  "current_register_document_id": "C2099C00002",
  "compilation_number": "2",
  "compilation_date": "2026-08-05"
}
```

Its expected digest is:

```text
sha256:cace4b38f998a09ea28ebe1448e0756da72ee05d750e27f8278c15a66d0b5dc3
```

The v3 facts fixture must use that digest, `metadata-response` and `application/json`. Add a test that hashes the payload bytes and compares the exact value before exercising the exporter.

- [ ] **Step 2: Write failing semantic exporter tests**

Create `PublicationBundleExportTests(unittest.TestCase)` and assert that one supported observation yields exactly one bundle with:

```python
self.assertEqual(bundle["schema_version"], "evidence-bundle.v1")
self.assertEqual(bundle["bundle_id"], "bundle-frl-c2099a00001-c2099c00002-r1")
self.assertEqual(bundle["development_id"], "dev-frl-c2099a00001-c2099c00002")
self.assertEqual(bundle["mode"], "synthetic")
self.assertEqual(bundle["development"]["authority_status"], "in-force")
self.assertEqual(bundle["development"]["published_at"], "2026-08-05T00:00:00Z")
self.assertEqual(bundle["development"]["topics"], [])
self.assertEqual(bundle["development"]["affected_practice_areas"], [])
self.assertEqual(bundle["source_event"]["kind"], "compilation-superseded")
self.assertEqual(bundle["sources"][0]["content_sha256"], "sha256:cace4b38f998a09ea28ebe1448e0756da72ee05d750e27f8278c15a66d0b5dc3")
self.assertEqual(bundle["sources"][0]["rights"]["mode"], "metadata-only")
self.assertEqual(bundle["sources"][0]["evidence"], [])
```

- [ ] **Step 3: Run the semantic test and confirm RED**

Run:

```text
python -m unittest tests.corpus.test_publication_bundle_export -v
```

Expected: import failure because `fadden.export_publication_bundles` does not exist.

- [ ] **Step 4: Implement the pure bundle transformation**

Create `fadden/export_publication_bundles.py`. Define exact key order by constructing dictionaries in contract order and serialise with:

```python
def bundle_bytes(bundle: dict[str, Any]) -> bytes:
    return (json.dumps(bundle, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
```

For every observation, ignore `UNCHANGED`; require `SUPERSEDED` for every changed item; require `complete is True`, v3, `mode == "synthetic"`, a current observed compilation and a matching baseline collection. Use these deterministic identities:

```python
development_id = f"dev-frl-{register_id.lower()}-{observed_document_id.lower()}"
bundle_id = f"bundle-frl-{register_id.lower()}-{observed_document_id.lower()}-r1"
source_id = f"frl-{observed_document_id.lower()}"
```

Map the official date to midnight UTC only for the publisher timestamp while preserving the date in `source_event`:

```python
published_at = f"{observed['observed_compilation_date']}T00:00:00Z"
```

Construct the exact top-level sections from the design. Set producer name `tax-radar-au`, read the trimmed version from root `VERSION`, use `sha256:`-prefixed exact-input digests, set `generated_at` and revision `updated_at` to `observed_at`, and set `replaces_bundle_id` to `None`.

- [ ] **Step 5: Add abstention and deterministic-byte tests**

Cover incomplete scope, `LOOKUP_FAILED`, `CURRENT_NO_PUBLISHED_COMPILATION`, `NO_LONGER_IN_FORCE`, mismatched collections, missing content evidence, multiple unsupported changed items and duplicate output identities. Each case must raise `PublicationBundleError` before writing any output. Assert that reversing input observation order produces identical sorted bundle bytes.

- [ ] **Step 6: Implement contained output publication and CLI dispatch**

`export_publication_bundles` must capture each input once with
`tax_radar_au.util.SourceSnapshot`, reject non-regular inputs, resolve aliases,
parse each captured snapshot with duplicate-member-safe `load_json`, calculate
exact-byte SHA-256, build all bundles in memory, require the destination path not
to exist, stage files under a private sibling directory, and rename the complete
directory only after every write succeeds. Wrap `MonitorError` as the safe
`PublicationBundleError` boundary. On failure, remove only the private staging
directory.

Add tests for a non-regular input, an input/output alias, an existing empty
destination, an existing non-empty destination, a destination link or junction
where supported, a staged-write failure and a promotion failure. Every case must
leave inputs and unrelated sibling paths byte-identical and remove only the
exporter-owned staging path.

Add `export_publication_bundles` to `STAGES` and forward its arguments through the same dispatcher branch as `export_monitor_contract`:

```python
elif args.stage in {"export_monitor_contract", "export_publication_bundles"}:
    result = func(forwarded)
```

Update the CLI roster and forwarding tests with the exact stage name.

- [ ] **Step 7: Generate and lock the golden bundle**

Run the new command into a temporary empty directory, inspect the output, add its exact bytes as `tests/corpus/fixtures/publication/evidence-bundle.v1.json`, and add:

```python
def test_generated_bundle_matches_the_reviewed_golden_bytes(self):
    generated = exporter.bundle_bytes(self._build_one_bundle())
    expected = (FIXTURES / "evidence-bundle.v1.json").read_bytes()
    self.assertEqual(generated, expected)
```

Run the command a second time into another empty directory and compare SHA-256 and bytes.

- [ ] **Step 8: Run upstream focused checks**

Run:

```text
python -m unittest tests.corpus.test_publication_bundle_export -v
python -m unittest tests.corpus.test_corpus_cli -v
python -m unittest discover -s tests/corpus -t . -v
python -m compileall -q fadden tax_radar_au tests/corpus
```

Expected: all pass.

- [ ] **Step 9: Commit Task 2 in the upstream worktree**

```text
git add fadden/__init__.py fadden/__main__.py fadden/export_publication_bundles.py tests/corpus/test_corpus_cli.py tests/corpus/test_publication_bundle_export.py tests/corpus/fixtures/publication
git commit -m "feat: export immutable publication evidence bundles"
```

Record the resulting upstream commit and golden fixture SHA-256 for Task 7.

---

### Task 3: Strict publisher JSON-byte parser

**Files:**

- Create publisher: `strict-json.mjs`
- Create publisher: `test/strict-json.test.mjs`
- Modify publisher: `package.json`

**Interfaces:**

- Consumes: `Uint8Array` or `Buffer` containing untrusted JSON bytes.
- Produces: `parseStrictJsonBytes(bytes, { maximumBytes = 1_048_576 } = {}) -> unknown`, throwing `StrictJsonError` with a safe message.

- [ ] **Step 1: Write the failing raw-input tests**

Cover valid nested JSON, empty input, more than 1 MiB, malformed UTF-8, trailing input, duplicate decoded keys at both levels, escaped duplicate keys, invalid number grammar and a finite-range overflow:

```javascript
test("strict JSON rejects duplicate decoded members", () => {
  const bytes = new TextEncoder().encode('{"a":1,"\\u0061":2}');
  assert.throws(() => parseStrictJsonBytes(bytes), /duplicate JSON member/);
});

test("strict JSON rejects numbers that become non-finite", () => {
  const bytes = new TextEncoder().encode('{"value":1e999}');
  assert.throws(() => parseStrictJsonBytes(bytes), /finite JSON number/);
});
```

- [ ] **Step 2: Run the focused file and confirm RED**

Run:

```text
node --test test/strict-json.test.mjs
```

Expected: module-not-found failure for `strict-json.mjs`.

- [ ] **Step 3: Implement strict UTF-8 and recursive JSON parsing**

Use `new TextDecoder("utf-8", { fatal: true })`. Implement a cursor-based parser with `parseValue`, `parseObject`, `parseArray`, `parseString`, `parseNumber` and `skipWhitespace`. In `parseObject`, compare decoded keys before constructing the object:

```javascript
function parseObject(state) {
  state.index += 1;
  skipWhitespace(state);
  const entries = [];
  const keys = new Set();
  if (state.source[state.index] === "}") { state.index += 1; return {}; }
  while (true) {
    const key = parseString(state);
    if (keys.has(key)) throw new StrictJsonError("JSON contains a duplicate JSON member");
    keys.add(key);
    skipWhitespace(state);
    expect(state, ":");
    skipWhitespace(state);
    entries.push([key, parseValue(state)]);
    skipWhitespace(state);
    if (state.source[state.index] === "}") { state.index += 1; return Object.fromEntries(entries); }
    expect(state, ",");
    skipWhitespace(state);
  }
}
```

Parse string and number token slices with `JSON.parse` only after the cursor has established one complete token. Reject a parsed number unless `Number.isFinite(value)`. Require the cursor to reach the end after trailing whitespace.

- [ ] **Step 4: Run parser tests and the publisher regression suite**

Add `node --check strict-json.mjs` and `node --check test/strict-json.test.mjs` to `npm run check`, then run:

```text
node --test test/strict-json.test.mjs
npm run check
npm run smoke
```

Expected: all pass.

- [ ] **Step 5: Commit Task 3 in the publisher worktree**

```text
git add strict-json.mjs test/strict-json.test.mjs package.json
git commit -m "feat: parse untrusted JSON bytes strictly"
```

---

### Task 4: Bundle validation and deterministic canonical transformation

**Files:**

- Create publisher: `evidence-bundle.mjs`
- Create publisher: `test/evidence-bundle.test.mjs`
- Create publisher: `test/fixtures/evidence-bundle.v1.json`
- Create publisher: `test/fixtures/evidence-bundle.v1.provenance.json`
- Modify publisher: `package.json`

**Interfaces:**

- Consumes: exact upstream golden fixture bytes and `parseStrictJsonBytes`.
- Produces:
  - `validateEvidenceBundle(input)` returns either `{ ok: true, value: object }` or `{ ok: false, errors }`, where every error has exact string `path` and `message` fields.
  - `parseEvidenceBundle(bytes) -> { bundle: object, bundleSha256: string }`
  - `transformEvidenceBundle(bundle, { bundleSha256: string }) -> object`

- [ ] **Step 1: Copy and attest the reviewed upstream fixture**

Add the exact golden JSON bytes from Task 2 with `apply_patch`; do not
reserialise them. Run `git rev-parse HEAD` in the upstream worktree and
`Get-FileHash -Algorithm SHA256` on its golden fixture. Add a provenance JSON
object whose literal values are that command output and whose exact keys are
`repository`, `commit`, `path` and `sha256`. `repository` must equal
`https://github.com/ryanduguid/au-tax-legislation-corpus`, `path` must equal
`tests/corpus/fixtures/publication/evidence-bundle.v1.json`, `commit` must be the
40 lowercase hexadecimal Task 2 commit, and `sha256` must be `sha256:` followed
by the lowercase 64-character file digest.

- [ ] **Step 2: Write failing exact-schema and digest tests**

Assert the golden fixture validates, its calculated digest matches provenance, and mutations fail at the expected path. The mutation table must cover every top-level section plus unsafe live/artificial-host combinations, timestamp ordering, duplicate IDs, content digests, metadata-only evidence, source-event/current-source disagreement and unsupported modes.

```javascript
test("golden upstream evidence bundle validates with its exact byte digest", async () => {
  const bytes = await readFile(GOLDEN);
  const provenance = JSON.parse(await readFile(PROVENANCE, "utf8"));
  const parsed = parseEvidenceBundle(bytes);
  assert.equal(parsed.bundle.schema_version, "evidence-bundle.v1");
  assert.equal(parsed.bundleSha256, provenance.sha256);
});
```

- [ ] **Step 3: Run the focused tests and confirm RED**

Run:

```text
node --test test/evidence-bundle.test.mjs
```

Expected: module-not-found failure for `evidence-bundle.mjs`.

- [ ] **Step 4: Implement exact bundle validation**

Use frozen sets for exact keys and controlled values. Reuse the publisher's identifier, real UTC timestamp, XML text, HTTPS URL and label-list semantics by moving only genuinely shared primitives to `evidence-bundle.mjs` or exporting narrow helpers from `site.mjs`; do not create two divergent URL or timestamp policies.

The validator must require these exact top-level keys:

```javascript
const BUNDLE_KEYS = new Set([
  "schema_version", "bundle_id", "development_id", "mode", "generated_at",
  "producer", "development", "source_event", "sources", "revision",
]);
```

Require `metadata-only` rights and an empty evidence array. Require one source for this adapter, while retaining the contract maximum of twenty. Cross-check the source and source-event register document, dates, canonical URL and evidence fields. `parseEvidenceBundle` must hash exact bytes with `createHash("sha256")` and return `sha256:` followed by exactly 64 lowercase hexadecimal characters only after parsing and validation succeed.

- [ ] **Step 5: Write the failing canonical transformation test**

Assert an exact `development.v2` object with these top-level keys:

```javascript
[
  "schema_version", "development_id", "mode", "title", "authority_status",
  "evidence_status", "publication_status", "published_at", "effective_at",
  "topics", "affected_practice_areas", "source_event", "sources",
  "explainer", "revision", "upstream",
]
```

Assert `schema_version === "development.v2"`, `explainer === null`, source fields are copied without enrichment, and:

```javascript
assert.deepEqual(development.upstream, {
  bundle_id: bundle.bundle_id,
  bundle_sha256: parsed.bundleSha256,
  generated_at: bundle.generated_at,
  producer: bundle.producer,
});
```

- [ ] **Step 6: Implement deterministic transformation**

Construct a new object explicitly in canonical key order. Do not mutate or spread the input object, call the clock, read environment variables or derive professional labels. Deep-copy the bounded arrays and nested source-event/source objects. Return a deeply independent value that survives mutation of the parsed bundle in a regression test.

- [ ] **Step 7: Run focused and regression tests**

Add syntax checks for the new module and test file to `npm run check`, then run:

```text
node --test test/evidence-bundle.test.mjs
npm run check
npm run smoke
```

Expected: all pass.

- [ ] **Step 8: Commit Task 4 in the publisher worktree**

```text
git add evidence-bundle.mjs test/evidence-bundle.test.mjs test/fixtures/evidence-bundle.v1.json test/fixtures/evidence-bundle.v1.provenance.json package.json
git commit -m "feat: validate and transform evidence bundles"
```

---

### Task 5: Canonical `development.v2` and mode-preserving rendering

**Files:**

- Modify publisher: `site.mjs`
- Modify publisher: `test/site.test.mjs`
- Modify publisher: `assets/site.css`

**Interfaces:**

- Consumes: `development.v1` demonstration records and `development.v2` output from `transformEvidenceBundle`.
- Produces: `validateDevelopment` support for both versions and one internal render view with explicit `mode`; `feed.v2` JSON output.

- [ ] **Step 1: Add failing v2 canonical validation tests**

Import and transform the golden bundle, then pass the result to `validateDevelopment`. Assert success without weakening v1 validation. Add a mutation table for every new v2 field: mode, source event, source evidence fields, upstream bundle identity/hash/digests and revision linkage.

```javascript
test("development.v2 accepts the exact imported canonical record", async () => {
  const parsed = parseEvidenceBundle(await readFile(GOLDEN));
  const record = transformEvidenceBundle(parsed.bundle, { bundleSha256: parsed.bundleSha256 });
  assert.deepEqual(validateDevelopment(record), { ok: true, value: record });
});
```

- [ ] **Step 2: Run the focused validator test and confirm RED**

Run:

```text
node --test --test-name-pattern="development.v2" test/site.test.mjs
```

Expected: failure reporting that `schema_version` must equal `development.v1`.

- [ ] **Step 3: Split version dispatch without relaxing v1**

Keep `validateDevelopment(input)` as the public interface. Dispatch by exact schema:

```javascript
export function validateDevelopment(input) {
  if (!isRecord(input)) return { ok: false, errors: [{ path: "$", message: "must be an object" }] };
  if (input.schema_version === "development.v1") return validateDevelopmentV1(input);
  if (input.schema_version === "development.v2") return validateDevelopmentV2(input);
  return { ok: false, errors: [{ path: "schema_version", message: "has an unsupported value" }] };
}
```

Retain every v1 exact-key and fixture rule. Add separate exact v2 key sets and enforce the same cross-field invariants as bundle transformation, including exact upstream SHA-256 and `mode`/URL rules.

- [ ] **Step 4: Add failing render and feed-mode tests**

Render one v1 fixture and one transformed v2 record in memory. Assert:

```javascript
assert.match(files.get("index.html"), /Demonstration/);
assert.match(files.get(`developments/${record.development_id}/index.html`), /Synthetic/);
assert.match(files.get("feed.xml"), /Mode: synthetic/);
const feed = JSON.parse(files.get("feed.json"));
assert.equal(feed.schema_version, "feed.v2");
assert.equal(feed.items.find(item => item.development_id === record.development_id).mode, "synthetic");
```

Also assert that a mutated valid in-memory v2 live record renders `Live` and does not receive a demonstration warning; do not check such a record into content.

- [ ] **Step 5: Normalise both versions and update renderers**

Add a private normaliser:

```javascript
function renderView(record) {
  return record.schema_version === "development.v1"
    ? { ...record, mode: "synthetic" }
    : record;
}
```

Normalise once before ordering/rendering. Show mode beside the three independent statuses, add a prominent synthetic warning on v2 pages, add `mode` to every JSON feed item, bump `feed.json` to `feed.v2`, and append either `Mode: synthetic` or `Mode: live` to RSS descriptions. Add only the CSS needed for the new semantic label and retain the restrained existing visual system.

- [ ] **Step 6: Run render, accessibility-adjacent and full site tests**

Run:

```text
node --test --test-name-pattern="development.v2|mode|feed" test/site.test.mjs
npm run check
npm run smoke
```

Expected: all pass; existing six route outputs remain present for the checked-in v1 fixture.

- [ ] **Step 7: Commit Task 5 in the publisher worktree**

```text
git add site.mjs test/site.test.mjs assets/site.css
git commit -m "feat: render canonical evidence-backed developments"
```

---

### Task 6: Atomic, idempotent one-bundle importer

**Files:**

- Create publisher: `import.mjs`
- Create publisher: `test/import.test.mjs`
- Modify publisher: `package.json`

**Interfaces:**

- Consumes: one ordinary bundle file and an explicit content root.
- Produces: `importEvidenceBundle({ bundlePath, contentRoot, allowSynthetic = false, operations } = {}) -> Promise<{ status: "imported" | "unchanged", developmentPath: string, bundleSha256: string }>` and a CLI that exposes no synthetic override.

- [ ] **Step 1: Write failing admission and normal-command tests**

Test a valid synthetic fixture with the default function option and through the CLI. Both must reject before creating a target. Then call the function with `allowSynthetic: true` and a temporary content root and assert one canonical `development.json` appears under the exact development ID.

```javascript
await assert.rejects(
  importEvidenceBundle({ bundlePath: GOLDEN, contentRoot }),
  /synthetic evidence bundles are not accepted/,
);
const result = await importEvidenceBundle({
  bundlePath: GOLDEN,
  contentRoot,
  allowSynthetic: true,
});
assert.equal(result.status, "imported");
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```text
node --test test/import.test.mjs
```

Expected: module-not-found failure for `import.mjs`.

- [ ] **Step 3: Implement input containment and new-record promotion**

Use `lstat` to require an ordinary input file and ordinary content root, reject symlinks/special files and more than 1 MiB before reading, and reject an input resolved inside its own final target directory. Parse, validate, hash and transform before any write.

Use a private sibling directory named from `development_id` plus `randomUUID()`. Write canonical JSON as two-space UTF-8 plus a final newline, re-read it through `validateDevelopment`, then rename the complete staging directory to the absent final directory. Always remove a remaining importer-owned staging path in `finally`.

Define `operations` with exact defaults so tests can inject a failing `rename` without patching global modules:

```javascript
const DEFAULT_OPERATIONS = Object.freeze({ lstat, mkdir, readFile, rename, rm, writeFile });
```

- [ ] **Step 4: Add idempotency and conflict tests**

Import the same exact bytes twice and assert the second result is `unchanged` with byte-identical canonical content. Then mutate the existing canonical record's `upstream.bundle_sha256`, change its bundle identity, replace the target with a file and use a target symlink/junction where supported. Every case must fail without altering the pre-existing bytes.

- [ ] **Step 5: Add write and promotion failure tests**

Inject `writeFile` and `rename` failures separately. Assert the final development does not exist, the content root has no `.import-` paths and an unrelated sibling record remains byte-identical. Also assert a malformed bundle never calls the injected `mkdir` or `writeFile`.

- [ ] **Step 6: Add the explicit CLI and package command**

The CLI accepts only:

```text
node import.mjs --bundle incoming/evidence-bundle.v1.json --content-root content/developments
```

Reject missing, repeated or unknown options with exit code 2 and one safe usage message. A processing refusal exits 1. Add:

```json
"import-bundle": "node import.mjs"
```

Add syntax checks for `import.mjs` and its test file to `npm run check`.

- [ ] **Step 7: Prove imported v2 content builds in isolation**

Create an isolated temporary publisher root containing the real stylesheet and an empty content directory, import the golden fixture with the function-only synthetic override, call `buildSite`, and assert HTML, RSS and JSON feed all contain the development ID and synthetic mode. Do not write the synthetic record into repository `content/`.

- [ ] **Step 8: Run importer and full publisher checks**

Run:

```text
node --test test/import.test.mjs
npm run check
npm run smoke
```

Expected: all pass and repository `content/` still contains only `dev-demo-001`.

- [ ] **Step 9: Commit Task 6 in the publisher worktree**

```text
git add import.mjs test/import.test.mjs package.json
git commit -m "feat: import one evidence bundle atomically"
```

---

### Task 7: Contract documentation, cross-repository conformance and release gates

**Files:**

- Modify upstream: `README.md`
- Modify upstream: `BUILD.md`
- Modify publisher: `README.md`
- Modify publisher: `CONTENT-LICENCE.md`
- Modify publisher: `test/evidence-bundle.test.mjs`
- Modify publisher: `docs/superpowers/specs/2026-08-29-tax-radar-evidence-bundle-integration-design.md` only if implementation proved an approved-design statement factually wrong

**Interfaces:**

- Consumes: completed upstream exporter, golden fixture, publisher importer and both repositories' defined checks.
- Produces: operator-facing contract commands, explicit non-live boundary, exact cross-repository provenance and final verification evidence.

- [ ] **Step 1: Document the upstream contract without overstating readiness**

Add the exact `python -m fadden export_publication_bundles -- tests/corpus/fixtures/publication/sample-sources.json tests/corpus/fixtures/publication/sample-observation-facts-v3.json --out build/publication-bundles` command, supported synthetic `SUPERSEDED` case, v3 content-hash meaning, absent-output-path rule, failure behaviour and explicit statement that no live observer exists. Keep `RADAR.md`'s human technical-review description intact because this exporter does not certify practical impact.

- [ ] **Step 2: Document publisher import and rights behaviour**

Add the exact `npm run import-bundle -- --bundle incoming/evidence-bundle.v1.json --content-root content/developments` command, the normal synthetic refusal, raw-byte hashing, idempotent-new-record limit and no-overwrite rule. Update `CONTENT-LICENCE.md` to state that content hashes and source metadata do not grant republication rights and this slice stores no extracts.

- [ ] **Step 3: Add fixture-provenance policy enforcement**

Extend the publisher test to require exact repository URL, 40-character lowercase commit, approved upstream path and `sha256:` digest. Hash the local golden bytes and compare. This prevents a later fixture edit from retaining stale provenance.

- [ ] **Step 4: Compare the two repositories' exact fixture bytes**

Run from PowerShell with explicit absolute paths resolved and inspected first:

```powershell
$upstreamFixture = 'C:\Users\-\Documents\Codex\2026-08-28\wou\worktrees\au-tax-evidence-bundle\tests\corpus\fixtures\publication\evidence-bundle.v1.json'
$publisherFixture = 'C:\Users\-\Documents\Codex\2026-08-28\wou\worktrees\australian-tax-intelligence-stage2\test\fixtures\evidence-bundle.v1.json'
Get-FileHash -Algorithm SHA256 -LiteralPath $upstreamFixture
Get-FileHash -Algorithm SHA256 -LiteralPath $publisherFixture
[System.IO.File]::ReadAllBytes($upstreamFixture).SequenceEqual([System.IO.File]::ReadAllBytes($publisherFixture))
```

Expected: equal hashes and `True`. If the git-worktrees skill selects different
owned paths because either planned path already exists, substitute only the two
exact paths it reports after validating them.

- [ ] **Step 5: Run all upstream repository-defined checks**

Run the exact commands defined by the current upstream workflows:

```text
python -m compileall -q .
python -m unittest discover -s tests/corpus -t . -v
uv run --locked --extra dev pytest tests
uv run --locked --extra dev ruff check tax_radar_au tests
uv run --locked --extra dev mypy tax_radar_au
uv run --locked --extra dev --python 3.12 python -m build
```

If `uv==0.12.0` or a required Python version is unavailable, do not invent a substitute check; record the unavailable workflow check explicitly.

- [ ] **Step 6: Run all publisher repository-defined checks**

Run:

```text
npm run check
npm run smoke
```

Also run `git diff --check`, enumerate tracked files and generated `out/` artefacts, and confirm there is no lockfile, `node_modules`, remote, live record or synthetic imported content.

- [ ] **Step 7: Commit documentation in each worktree**

Upstream:

```text
git add README.md BUILD.md
git commit -m "docs: explain publication evidence bundles"
```

Publisher:

```text
git add README.md CONTENT-LICENCE.md test/evidence-bundle.test.mjs
git commit -m "docs: explain evidence bundle admission"
```

- [ ] **Step 8: Perform the final review gate**

Invoke `superpowers:requesting-code-review` for both complete branch diffs. Correct every validated Important or Critical finding test-first, rerun affected focused checks and both complete suites, then invoke `superpowers:verification-before-completion` before making any completion claim.

- [ ] **Step 9: Stop at the local handoff boundary**

Report both branch tips, exact test counts, cross-repository fixture digest, every unavailable check and any residual risk. Do not merge either branch, alter the user's existing upstream checkout, push, create a pull request or deploy unless the user separately requests that action.
