// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  renderSite,
  validateDevelopment,
} from "../site.mjs";

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

test("rendering accepts HTTPS and loopback site URLs only", () => {
  const loopback = renderSite([fixture], {
    siteUrl: "http://127.0.0.1:4173",
    cssText: "",
  });
  assert.match(loopback.get("index.html"), /http:\/\/127\.0\.0\.1:4173\//);
  for (const siteUrl of ["http://publisher.example", "javascript:alert(1)"]) {
    assert.throws(() => renderSite([fixture], { siteUrl, cssText: "" }));
  }
});

test("rendering projects one identity and three statuses to every format", () => {
  const files = renderSite([fixture], {
    siteUrl: "https://publisher.example/project/",
    cssText: "body { color: #111; }\n",
  });

  assert.deepEqual([...files.keys()].sort(), [
    "assets/site.css",
    "developments/dev-demo-001/index.html",
    "feed.json",
    "feed.xml",
    "index.html",
    "methodology/index.html",
  ]);

  const home = files.get("index.html");
  const development = files.get("developments/dev-demo-001/index.html");
  const methodology = files.get("methodology/index.html");
  const rss = files.get("feed.xml");
  const feed = JSON.parse(files.get("feed.json"));

  for (const output of [home, development, rss, files.get("feed.json")]) {
    assert.match(output, /dev-demo-001/);
    assert.match(output, /Demonstration source/);
    assert.match(output, /operative-guidance/);
    assert.match(output, /verified/);
    assert.match(output, /source-only/);
  }
  assert.match(home, new RegExp(fixture.revision.updated_at));
  assert.match(development, new RegExp(fixture.revision.updated_at));
  const rssUpdatedAt = rss.match(/<lastBuildDate>([^<]+)<\/lastBuildDate>/)[1];
  assert.equal(
    new Date(rssUpdatedAt).getTime(),
    new Date(fixture.revision.updated_at).getTime(),
  );
  assert.equal(feed.updated_at, fixture.revision.updated_at);
  assert.deepEqual(Object.keys(feed.items[0]), [
    "development_id",
    "url",
    "title",
    "authority_status",
    "evidence_status",
    "publication_status",
    "updated_at",
  ]);
  assert.equal(
    feed.items[0].url,
    "https://publisher.example/project/developments/dev-demo-001/",
  );
  assert.match(home, /Demonstration record/);
  assert.match(development, /No AI explainer has been published/);
  assert.match(development, /source-demo-001/);
  assert.match(development, /metadata-only/);
  assert.match(development, /Initial demonstration record/);
  assert.match(development, /Labels support browsing and are not advice/);
  assert.match(methodology, /does not provide tax advice/i);
  assert.match(methodology, /AI is not used in this vertical slice/i);
  assert.doesNotMatch(development, /<a[^>]+example\.invalid/i);
  assert.doesNotMatch(`${home}${development}${methodology}`, /<script\b/i);
  assert.doesNotMatch(`${home}${development}${methodology}`, /confidence/i);
});

test("rendering escapes a hostile record instead of creating markup", () => {
  const hostile = changed(value => {
    value.title = `Tom & 'Ada' <img src=x onerror="alert(1)">`;
    value.sources[0].publisher = `<script>alert(2)</script>`;
  });
  const files = renderSite([hostile], {
    siteUrl: "https://publisher.example/",
    cssText: "",
  });
  const html = [
    files.get("index.html"),
    files.get("developments/dev-demo-001/index.html"),
  ].join("\n");
  assert.doesNotMatch(html, /<img|<script/i);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script/);
  assert.match(html, /Tom &amp; &#39;Ada&#39;/);
  assert.match(files.get("feed.xml"), /&lt;img/);
  assert.match(files.get("feed.xml"), /Tom &amp; &apos;Ada&apos;/);
  assert.equal(JSON.parse(files.get("feed.json")).items[0].title, hostile.title);
});
