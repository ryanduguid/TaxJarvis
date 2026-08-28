// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseEvidenceBundle,
  transformEvidenceBundle,
  validateEvidenceBundle,
} from "../evidence-bundle.mjs";

const GOLDEN = new URL("./fixtures/evidence-bundle.v1.json", import.meta.url);
const PROVENANCE = new URL(
  "./fixtures/evidence-bundle.v1.provenance.json",
  import.meta.url,
);
const goldenBytes = await readFile(GOLDEN);
const golden = JSON.parse(goldenBytes);

function changed(mutator) {
  const candidate = structuredClone(golden);
  mutator(candidate);
  return candidate;
}

function assertInvalid(mutator, path) {
  const result = validateEvidenceBundle(changed(mutator));
  assert.equal(result.ok, false);
  assert.equal(
    result.errors.some(error => error.path === path),
    true,
    JSON.stringify(result.errors),
  );
  for (const error of result.errors) {
    assert.deepEqual(Object.keys(error), ["path", "message"]);
    assert.equal(typeof error.path, "string");
    assert.equal(typeof error.message, "string");
  }
}

test("golden upstream evidence bundle validates with its exact byte digest", async () => {
  const provenance = JSON.parse(await readFile(PROVENANCE, "utf8"));
  assert.deepEqual(Object.keys(provenance), [
    "repository",
    "commit",
    "path",
    "sha256",
  ]);
  assert.equal(
    provenance.repository,
    "https://github.com/ryanduguid/au-tax-legislation-corpus",
  );
  assert.match(provenance.commit, /^[0-9a-f]{40}$/);
  assert.equal(
    provenance.path,
    "tests/corpus/fixtures/publication/evidence-bundle.v1.json",
  );
  assert.match(provenance.sha256, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(validateEvidenceBundle(golden), { ok: true, value: golden });
  const parsed = parseEvidenceBundle(goldenBytes);
  assert.equal(parsed.bundle.schema_version, "evidence-bundle.v1");
  assert.equal(parsed.bundleSha256, provenance.sha256);
  assert.equal(
    provenance.commit,
    "33c79f20c08d7e0c79c7038c54ea20f0c7bd6443",
  );
});

const mutations = [
  ["unknown top-level key", value => { value.extra = true; }, "extra"],
  ["schema", value => { value.schema_version = "evidence-bundle.v2"; }, "schema_version"],
  ["bundle identifier", value => { value.bundle_id = "../bundle"; }, "bundle_id"],
  ["development identifier", value => { value.development_id = "dev other"; }, "development_id"],
  ["mode", value => { value.mode = "preview"; }, "mode"],
  ["generation timestamp", value => { value.generated_at = "2026-08-08"; }, "generated_at"],
  ["producer shape", value => { value.producer.extra = true; }, "producer.extra"],
  ["producer name", value => { value.producer.name = ""; }, "producer.name"],
  ["producer digest", value => { value.producer.baseline_sha256 = "sha256:ABC"; }, "producer.baseline_sha256"],
  ["development shape", value => { value.development.extra = true; }, "development.extra"],
  ["development title", value => { value.development.title = " "; }, "development.title"],
  ["authority", value => { value.development.authority_status = "law"; }, "development.authority_status"],
  ["evidence status", value => { value.development.evidence_status = "certain"; }, "development.evidence_status"],
  ["publication status", value => { value.development.publication_status = "published"; }, "development.publication_status"],
  ["source event shape", value => { value.source_event.extra = true; }, "source_event.extra"],
  ["source event kind", value => { value.source_event.kind = "amended"; }, "source_event.kind"],
  ["source shape", value => { value.sources[0].extra = true; }, "sources[0].extra"],
  ["source identifier", value => { value.sources[0].source_id = "source other"; }, "sources[0].source_id"],
  ["content digest", value => { value.sources[0].content_sha256 = "sha256:ABC"; }, "sources[0].content_sha256"],
  ["content kind", value => { value.sources[0].content_kind = "summary"; }, "sources[0].content_kind"],
  ["content media type", value => { value.sources[0].content_media_type = "text/plain"; }, "sources[0].content_media_type"],
  ["rights shape", value => { value.sources[0].rights.extra = true; }, "sources[0].rights.extra"],
  ["rights mode", value => { value.sources[0].rights.mode = "quotation"; }, "sources[0].rights.mode"],
  ["metadata-only evidence", value => { value.sources[0].evidence = ["extract"]; }, "sources[0].evidence"],
  ["revision shape", value => { value.revision.extra = true; }, "revision.extra"],
  ["revision number", value => { value.revision.number = 2; }, "revision.number"],
  ["replacement link", value => { value.revision.replaces_bundle_id = "bundle-old"; }, "revision.replaces_bundle_id"],
];

for (const [name, mutator, path] of mutations) {
  test(`bundle validation rejects ${name}`, () => assertInvalid(mutator, path));
}

test("bundle validation rejects live mode with an artificial source host", () => {
  assertInvalid(value => { value.mode = "live"; }, "sources[0].canonical_url");
});

test("bundle validation rejects timestamp ordering conflicts", () => {
  assertInvalid(
    value => { value.sources[0].retrieved_at = "2026-08-04T00:00:00Z"; },
    "sources[0].retrieved_at",
  );
  assertInvalid(
    value => { value.generated_at = "2026-08-07T00:00:00Z"; },
    "generated_at",
  );
  assertInvalid(
    value => { value.revision.updated_at = "2026-08-07T00:00:00Z"; },
    "revision.updated_at",
  );
});

test("bundle validation rejects duplicate source identities", () => {
  assertInvalid(
    value => { value.sources.push(structuredClone(value.sources[0])); },
    "sources[1].source_id",
  );
});

test("bundle validation rejects source-event and source disagreement", () => {
  assertInvalid(
    value => {
      value.source_event.current_compilation.register_document_id = "C2099C00099";
    },
    "source_event.current_compilation.register_document_id",
  );
  assertInvalid(
    value => { value.sources[0].canonical_url = "https://example.invalid/C2099A99999/latest/text"; },
    "sources[0].canonical_url",
  );
  assertInvalid(
    value => { value.sources[0].published_at = "2026-08-06T00:00:00Z"; },
    "sources[0].published_at",
  );
});

test("invalid bundle bytes fail before producing a digest", () => {
  assert.throws(
    () => parseEvidenceBundle(Buffer.from('{"mode":"live","mode":"synthetic"}')),
    /duplicate JSON member/,
  );
  assert.throws(() => parseEvidenceBundle(Buffer.from("{}")), /evidence bundle is invalid/);
});

test("canonical transformation is not available before bundle admission", () => {
  assert.throws(
    () => transformEvidenceBundle({}, { bundleSha256: "sha256:" + "0".repeat(64) }),
    /validated evidence bundle/,
  );
});

test("canonical transformation constructs an independent development.v2 record", () => {
  const parsed = parseEvidenceBundle(goldenBytes);
  const development = transformEvidenceBundle(parsed.bundle, {
    bundleSha256: parsed.bundleSha256,
  });
  assert.deepEqual(Object.keys(development), [
    "schema_version",
    "development_id",
    "mode",
    "title",
    "authority_status",
    "evidence_status",
    "publication_status",
    "published_at",
    "effective_at",
    "topics",
    "affected_practice_areas",
    "source_event",
    "sources",
    "explainer",
    "revision",
    "upstream",
  ]);
  assert.equal(development.schema_version, "development.v2");
  assert.equal(development.explainer, null);
  assert.deepEqual(development.source_event, parsed.bundle.source_event);
  assert.deepEqual(development.sources, parsed.bundle.sources);
  assert.deepEqual(development.upstream, {
    bundle_id: parsed.bundle.bundle_id,
    bundle_sha256: parsed.bundleSha256,
    generated_at: parsed.bundle.generated_at,
    producer: parsed.bundle.producer,
  });

  parsed.bundle.development.title = "Mutated after transformation";
  parsed.bundle.development.topics.push("mutated");
  parsed.bundle.source_event.current_compilation.number = "999";
  parsed.bundle.sources[0].rights.attribution = "Mutated attribution";
  parsed.bundle.producer.name = "mutated-producer";
  assert.equal(development.title, "Sample Consumption Tax Act 2099");
  assert.deepEqual(development.topics, []);
  assert.equal(development.source_event.current_compilation.number, "2");
  assert.equal(
    development.sources[0].rights.attribution,
    "Synthetic Federal Register fixture",
  );
  assert.equal(development.upstream.producer.name, "tax-radar-au");
});
