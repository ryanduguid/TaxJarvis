// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  buildSite,
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

test("rendering rejects site URLs with bare query and fragment delimiters", () => {
  for (const siteUrl of [
    "https://publisher.example/?",
    "https://publisher.example/#",
  ]) {
    assert.throws(() => renderSite([fixture], { siteUrl, cssText: "" }));
  }
  const files = renderSite([fixture], {
    siteUrl: "https://publisher.example/path%3Fname",
    cssText: "",
  });
  assert.match(files.get("index.html"), /https:\/\/publisher\.example\/path%3Fname\//);
});

test("validation recognises a trailing-dot invalid source hostname", () => {
  const result = validateDevelopment(changed(value => {
    value.fixture = false;
    value.sources[0].canonical_url = "https://example.invalid./source";
  }));

  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.path === "sources[0].canonical_url"));
});

test("rendering abstains from trailing-dot invalid fixture source and licence links", () => {
  const trailingDotSource = changed(value => {
    value.sources[0].canonical_url = "https://example.invalid./source";
    value.sources[0].rights.licence_url = "https://example.invalid./licence";
  });
  const files = renderSite([trailingDotSource], {
    siteUrl: "https://publisher.example/",
    cssText: "",
  });
  const development = files.get("developments/dev-demo-001/index.html");

  assert.doesNotMatch(development, /<a[^>]+example\.invalid\./i);
  assert.match(development, /https:\/\/example\.invalid\.\/source/);
  assert.match(development, /https:\/\/example\.invalid\.\/licence/);
});

test("rendering records each RSS item revision in Atom updated", () => {
  const newer = changed(value => {
    value.development_id = "dev-demo-002";
    value.published_at = "2026-08-28T00:00:00Z";
    value.revision.updated_at = "2026-08-29T00:00:00Z";
  });
  const rss = renderSite([fixture, newer], {
    siteUrl: "https://publisher.example/",
    cssText: "",
  }).get("feed.xml");

  assert.match(rss, /<rss version="2\.0" xmlns:atom="http:\/\/www\.w3\.org\/2005\/Atom">/);
  for (const record of [fixture, newer]) {
    const item = rss.match(new RegExp(
      `<item>[\\s\\S]*?<guid isPermaLink="false">${record.development_id}<\\/guid>[\\s\\S]*?<\\/item>`,
    ))[0];
    assert.match(item, new RegExp(`<atom:updated>${record.revision.updated_at}<\\/atom:updated>`));
  }
});

async function temporaryPublisher(t) {
  const rootDir = await mkdtemp(join(tmpdir(), "tax-publisher-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const recordPath = join(
    rootDir,
    "content",
    "developments",
    fixture.development_id,
    "development.json",
  );
  await mkdir(dirname(recordPath), { recursive: true });
  await writeFile(recordPath, `${JSON.stringify(fixture, null, 2)}\n`);
  await mkdir(join(rootDir, "assets"), { recursive: true });
  await cp(new URL("../assets/site.css", import.meta.url), join(rootDir, "assets", "site.css"));
  return { rootDir, recordPath, outputDir: join(rootDir, "out") };
}

async function readArtifact(outputDir, paths) {
  return Object.fromEntries(await Promise.all(paths.map(async path => [
    path,
    await readFile(join(outputDir, ...path.split("/")), "utf8"),
  ])));
}

test("build writes exactly the six static outputs", async t => {
  const workspace = await temporaryPublisher(t);
  const written = await buildSite({
    rootDir: workspace.rootDir,
    siteUrl: "https://publisher.example/project/",
  });
  assert.deepEqual(written, [
    "assets/site.css",
    "developments/dev-demo-001/index.html",
    "feed.json",
    "feed.xml",
    "index.html",
    "methodology/index.html",
  ]);
  for (const path of written) {
    assert.equal((await lstat(join(workspace.outputDir, ...path.split("/")))).isFile(), true);
  }
});

test("build preserves the previous artifact when validation fails", async t => {
  const workspace = await temporaryPublisher(t);
  await mkdir(workspace.outputDir);
  const sentinel = join(workspace.outputDir, "last-valid.txt");
  await writeFile(sentinel, "keep");
  const invalid = changed(value => { value.sources = []; });
  await writeFile(workspace.recordPath, JSON.stringify(invalid));

  await assert.rejects(() => buildSite({
    rootDir: workspace.rootDir,
    siteUrl: "https://publisher.example/",
  }), { message: "A development record failed validation" });
  assert.equal(await readFile(sentinel, "utf8"), "keep");
});

test("build leaves sibling directories untouched", async t => {
  const workspace = await temporaryPublisher(t);
  const sibling = join(workspace.rootDir, "public");
  await mkdir(sibling);
  const marker = join(sibling, "keep.txt");
  await writeFile(marker, "keep");
  await buildSite({
    rootDir: workspace.rootDir,
    siteUrl: "https://publisher.example/",
  });
  assert.equal(await readFile(marker, "utf8"), "keep");
});

test("build refuses a symbolic-link out directory", async t => {
  const workspace = await temporaryPublisher(t);
  const elsewhere = join(workspace.rootDir, "elsewhere");
  await mkdir(elsewhere);
  await symlink(elsewhere, workspace.outputDir, "junction");
  await assert.rejects(() => buildSite({
    rootDir: workspace.rootDir,
    siteUrl: "https://publisher.example/",
  }), /symbolic link/);
});

test("build is deterministic and does not call fetch", { concurrency: false }, async t => {
  const workspace = await temporaryPublisher(t);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("external network attempted"); };
  try {
    const paths = await buildSite({
      rootDir: workspace.rootDir,
      siteUrl: "https://publisher.example/project/",
    });
    const first = await readArtifact(workspace.outputDir, paths);
    await buildSite({
      rootDir: workspace.rootDir,
      siteUrl: "https://publisher.example/project/",
    });
    const second = await readArtifact(workspace.outputDir, paths);
    assert.deepEqual(second, first);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("build reports missing development content without disclosing its path", async t => {
  const rootDir = await mkdtemp(join(tmpdir(), "tax-publisher-private-content-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  await assert.rejects(() => buildSite({
    rootDir,
    siteUrl: "https://publisher.example/",
  }), error => {
    assert.equal(error.message, "Development content directory is missing");
    assert.equal(error.message.includes(rootDir), false);
    return true;
  });
});

test("build reports a missing record file without disclosing its directory", async t => {
  const workspace = await temporaryPublisher(t);
  const marker = "private-directory-name-must-not-appear";
  await rename(
    dirname(workspace.recordPath),
    join(workspace.rootDir, "content", "developments", marker),
  );
  await rm(join(workspace.rootDir, "content", "developments", marker, "development.json"));

  await assert.rejects(() => buildSite({
    rootDir: workspace.rootDir,
    siteUrl: "https://publisher.example/",
  }), error => {
    assert.equal(error.message, "A development record file is missing");
    assert.equal(error.message.includes(marker), false);
    assert.equal(error.message.includes(workspace.rootDir), false);
    return true;
  });
});

test("build distinguishes malformed development JSON", async t => {
  const workspace = await temporaryPublisher(t);
  await writeFile(workspace.recordPath, "{");

  await assert.rejects(() => buildSite({
    rootDir: workspace.rootDir,
    siteUrl: "https://publisher.example/",
  }), { message: "A development record is not valid JSON" });
});

test("build rejects a development identifier that differs from its directory", async t => {
  const workspace = await temporaryPublisher(t);
  const mismatch = changed(value => { value.development_id = "dev-other"; });
  await writeFile(workspace.recordPath, JSON.stringify(mismatch));

  await assert.rejects(() => buildSite({
    rootDir: workspace.rootDir,
    siteUrl: "https://publisher.example/",
  }), { message: "A development record identifier does not match its directory" });
});

test("build detects duplicated development identifiers before directory mismatch", async t => {
  const workspace = await temporaryPublisher(t);
  const duplicatePath = join(
    workspace.rootDir,
    "content",
    "developments",
    "dev-demo-002",
    "development.json",
  );
  await mkdir(dirname(duplicatePath), { recursive: true });
  await writeFile(duplicatePath, JSON.stringify(fixture));

  await assert.rejects(() => buildSite({
    rootDir: workspace.rootDir,
    siteUrl: "https://publisher.example/",
  }), { message: "A development record identifier is duplicated" });
});

test("build reports validation failures without disclosing an unknown key", async t => {
  const workspace = await temporaryPublisher(t);
  const marker = "private-unknown-key-must-not-appear";
  const invalid = changed(value => { value[marker] = true; });
  await writeFile(workspace.recordPath, JSON.stringify(invalid));

  await assert.rejects(() => buildSite({
    rootDir: workspace.rootDir,
    siteUrl: "https://publisher.example/",
  }), error => {
    assert.equal(error.message, "A development record failed validation");
    assert.equal(error.message.includes(marker), false);
    return true;
  });
});

test("build preserves the previous artifact when staged publication fails", async t => {
  const workspace = await temporaryPublisher(t);
  const paths = await buildSite({
    rootDir: workspace.rootDir,
    siteUrl: "https://publisher.example/",
  });
  const before = await readArtifact(workspace.outputDir, paths);
  const backupPath = join(workspace.rootDir, ".out-previous");
  await writeFile(backupPath, "reserved");

  await assert.rejects(() => buildSite({
    rootDir: workspace.rootDir,
    siteUrl: "https://publisher.example/",
  }), { message: "A private build directory is already present" });
  assert.deepEqual(await readArtifact(workspace.outputDir, paths), before);
  assert.equal(await readFile(backupPath, "utf8"), "reserved");
  await assert.rejects(() => lstat(join(workspace.rootDir, ".out-staging")), {
    code: "ENOENT",
  });
});
