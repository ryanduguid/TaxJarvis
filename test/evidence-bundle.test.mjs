// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateEvidenceBundle } from "../evidence-bundle.mjs";

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
  assert.equal(golden.schema_version, "evidence-bundle.v1");
  assert.equal(
    `sha256:${createHash("sha256").update(goldenBytes).digest("hex")}`,
    provenance.sha256,
  );
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

test("bundle validation requires the verified in-force state for this source event", () => {
  for (const evidenceStatus of ["insufficient", "conflicting", "stale"]) {
    assertInvalid(
      value => { value.development.evidence_status = evidenceStatus; },
      "development.evidence_status",
    );
  }
  for (const authorityStatus of ["consultation", "withdrawn", "superseded"]) {
    assertInvalid(
      value => { value.development.authority_status = authorityStatus; },
      "development.authority_status",
    );
  }
});

test("live Federal Register bundles require the exact official source and attribution", () => {
  for (const canonicalUrl of [
    "https://other.example/C2099A00001/latest/text",
    "https://www.legislation.gov.au/C2099A00001/latest/text?unreviewed=1",
  ]) {
    assertInvalid(
      value => {
        value.mode = "live";
        value.sources[0].canonical_url = canonicalUrl;
        value.sources[0].rights.attribution = "Federal Register of Legislation";
      },
      "sources[0].canonical_url",
    );
  }
  assertInvalid(
    value => {
      value.mode = "live";
      value.sources[0].canonical_url =
        "https://www.legislation.gov.au/C2099A00001/latest/text";
    },
    "sources[0].rights.attribution",
  );
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

test("bundle validation rejects compilation dates that are not real calendar dates", () => {
  for (const date of [20260701, null, "2026-7-1", "2026-07-01T00:00:00Z", "2026-02-30", "2026-13-01"]) {
    assertInvalid(
      value => { value.source_event.previous_compilation.date = date; },
      "source_event.previous_compilation.date",
    );
  }
});

test("bundle validation rejects a current compilation that does not supersede the previous one", () => {
  assertInvalid(
    value => { value.source_event.previous_compilation.number = "2"; },
    "source_event.current_compilation.number",
  );
  for (const date of ["2026-08-05", "2026-08-06"]) {
    assertInvalid(
      value => { value.source_event.previous_compilation.date = date; },
      "source_event.current_compilation.date",
    );
  }
});

test("bundle validation rejects publication that does not map the compilation date to midnight UTC", () => {
  for (const publishedAt of ["2026-08-05T12:00:00Z", "2026-08-04T00:00:00Z"]) {
    assertInvalid(
      value => {
        value.development.published_at = publishedAt;
        value.sources[0].published_at = publishedAt;
      },
      "development.published_at",
    );
  }
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
