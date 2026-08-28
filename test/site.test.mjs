// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateDevelopment } from "../site.mjs";

const fixtureUrl = new URL(
  "../content/developments/dev-demo-001/development.json",
  import.meta.url,
);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));

test("repository contract: package has no package graph", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.engines.node, ">=24.19.0");
  assert.equal(packageJson.engines.npm, ">=11.17.0");
  assert.equal(Object.hasOwn(packageJson, "dependencies"), false);
  assert.equal(Object.hasOwn(packageJson, "devDependencies"), false);
});

test("canonical fixture: validation accepts the source-only record", () => {
  assert.deepEqual(validateDevelopment(fixture), {
    ok: true,
    value: fixture,
  });
});

function changed(mutator) {
  const candidate = structuredClone(fixture);
  mutator(candidate);
  return candidate;
}

const invalidCases = [
  ["unknown top-level key", value => { value.extra = true; }, "extra"],
  ["unknown nested key", value => { value.sources[0].extra = true; }, "sources[0].extra"],
  ["schema version", value => { value.schema_version = "development.v2"; }, "schema_version"],
  ["identifier", value => { value.development_id = "../escape"; }, "development_id"],
  ["blank title", value => { value.title = " "; }, "title"],
  ["oversized title", value => { value.title = "x".repeat(201); }, "title"],
  ["authority status", value => { value.authority_status = "law"; }, "authority_status"],
  ["evidence status", value => { value.evidence_status = "certain"; }, "evidence_status"],
  ["publication status", value => { value.publication_status = "published"; }, "publication_status"],
  ["publication timestamp", value => { value.published_at = "2026-02-30T00:00:00Z"; }, "published_at"],
  ["effective timestamp", value => { value.effective_at = "28 August 2026"; }, "effective_at"],
  ["duplicate topic", value => { value.topics = ["tax", "tax"]; }, "topics"],
  ["oversized topic", value => { value.topics = ["x".repeat(81)]; }, "topics[0]"],
  ["oversized practice list", value => { value.affected_practice_areas = Array.from({ length: 21 }, (_, index) => `area-${index}`); }, "affected_practice_areas"],
  ["missing source", value => { value.sources = []; }, "sources"],
  ["oversized source list", value => { value.sources = Array.from({ length: 21 }, (_, index) => ({ ...structuredClone(value.sources[0]), source_id: `source-demo-${String(index).padStart(3, "0")}` })); }, "sources"],
  ["duplicate source identifier", value => { value.sources.push(structuredClone(value.sources[0])); }, "sources[1].source_id"],
  ["source identifier", value => { value.sources[0].source_id = ".."; }, "sources[0].source_id"],
  ["source publisher", value => { value.sources[0].publisher = ""; }, "sources[0].publisher"],
  ["document class", value => { value.sources[0].document_class = "article"; }, "sources[0].document_class"],
  ["insecure source URL", value => { value.sources[0].canonical_url = "http://example.com/source"; }, "sources[0].canonical_url"],
  ["oversized source URL", value => { value.sources[0].canonical_url = `https://example.com/${"x".repeat(2040)}`; }, "sources[0].canonical_url"],
  ["source chronology", value => { value.sources[0].retrieved_at = "2026-08-26T00:00:00Z"; }, "sources[0].retrieved_at"],
  ["rights mode", value => { value.sources[0].rights.mode = "full-text"; }, "sources[0].rights.mode"],
  ["rights attribution", value => { value.sources[0].rights.attribution = " "; }, "sources[0].rights.attribution"],
  ["insecure licence URL", value => { value.sources[0].rights.licence_url = "http://example.com/licence"; }, "sources[0].rights.licence_url"],
  ["metadata-only extract", value => { value.sources[0].evidence = [{ text: "not permitted" }]; }, "sources[0].evidence"],
  ["explainer", value => { value.explainer = {}; }, "explainer"],
  ["revision number", value => { value.revision.number = 2; }, "revision.number"],
  ["revision chronology", value => { value.revision.updated_at = "2026-08-26T00:00:00Z"; }, "revision.updated_at"],
  ["revision note", value => { value.revision.change_note = "x".repeat(501); }, "revision.change_note"],
  ["fixture flag", value => { value.fixture = false; }, "fixture"],
];

for (const [name, mutate, expectedPath] of invalidCases) {
  test(`validation rejects ${name}`, () => {
    const result = validateDevelopment(changed(mutate));
    assert.equal(result.ok, false);
    assert.equal(Object.hasOwn(result, "value"), false);
    assert.ok(result.errors.some(error => error.path === expectedPath));
  });
}

test("validation reports multiple inexpensive errors without echoing values", () => {
  const marker = "private-value-must-not-appear";
  const result = validateDevelopment(changed(value => {
    value.title = marker.repeat(20);
    value.authority_status = marker;
    value.sources = [];
  }));

  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 3);
  assert.doesNotMatch(JSON.stringify(result.errors), new RegExp(marker));
});

test("validation rejects sparse topics", () => {
  const result = validateDevelopment(changed(value => {
    value.topics = new Array(1);
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.path === "topics[0]"));
});

test("validation rejects sparse affected practice areas", () => {
  const result = validateDevelopment(changed(value => {
    value.affected_practice_areas = new Array(1);
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.path === "affected_practice_areas[0]"));
});

test("validation rejects sparse sources", () => {
  const result = validateDevelopment(changed(value => {
    value.sources = new Array(1);
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.path === "sources[0]"));
});
