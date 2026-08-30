// SPDX-License-Identifier: AGPL-3.0-only
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateCanonicalDevelopmentV2 } from "./evidence-bundle.mjs";
import { validateLiveDevelopmentV2 } from "./live-evidence.mjs";
import { parseStrictJsonBytes } from "./strict-json.mjs";
import {
  exactKeys,
  httpsUrl,
  isArtificialHostname,
  isIdentifier,
  isRecord,
  labelList,
  oneOf,
  previewPort,
  text,
  timestampKey,
  utcTimestamp,
} from "./validation-primitives.mjs";

const AUTHORITY_STATUSES = new Set(["consultation", "introduced", "made-not-effective", "in-force", "operative-guidance", "decision", "withdrawn", "superseded"]);
const EVIDENCE_STATUSES = new Set(["verified", "insufficient", "conflicting", "stale"]);
const DEVELOPMENT_KEYS = new Set(["schema_version", "development_id", "title", "authority_status", "evidence_status", "publication_status", "published_at", "effective_at", "topics", "affected_practice_areas", "sources", "explainer", "revision", "fixture"]);
const SOURCE_KEYS = new Set(["source_id", "publisher", "document_class", "title", "canonical_url", "published_at", "retrieved_at", "rights", "evidence"]);
const RIGHTS_KEYS = new Set(["mode", "attribution", "licence_url"]);
const REVISION_KEYS = new Set(["number", "updated_at", "change_note"]);

function addError(errors, path, message) { errors.push({ path, message }); }

function validateDevelopmentV1(input) {
  const errors = [];
  if (!exactKeys(errors, input, "$", DEVELOPMENT_KEYS)) return { ok: false, errors };
  if (input.schema_version !== "development.v1") addError(errors, "schema_version", "must equal development.v1");
  if (!isIdentifier(input.development_id)) addError(errors, "development_id", "must be a safe identifier");
  text(errors, input.title, "title", 200);
  oneOf(errors, input.authority_status, "authority_status", AUTHORITY_STATUSES);
  oneOf(errors, input.evidence_status, "evidence_status", EVIDENCE_STATUSES);
  if (input.publication_status !== "source-only") addError(errors, "publication_status", "must equal source-only");
  const publishedAt = utcTimestamp(errors, input.published_at, "published_at");
  utcTimestamp(errors, input.effective_at, "effective_at", { nullable: true });
  labelList(errors, input.topics, "topics");
  labelList(errors, input.affected_practice_areas, "affected_practice_areas");
  if (!Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > 20) addError(errors, "sources", "must contain 1 to 20 sources");
  else {
    const sourceIds = new Set();
    for (let index = 0; index < input.sources.length; index += 1) {
      const source = input.sources[index];
      const base = `sources[${index}]`; if (!exactKeys(errors, source, base, SOURCE_KEYS)) continue;
      if (!isIdentifier(source.source_id)) addError(errors, `${base}.source_id`, "must be a safe identifier");
      else if (sourceIds.has(source.source_id)) addError(errors, `${base}.source_id`, "must be unique");
      sourceIds.add(source.source_id);
      text(errors, source.publisher, `${base}.publisher`, 200); text(errors, source.title, `${base}.title`, 200);
      if (source.document_class !== "guidance") addError(errors, `${base}.document_class`, "must equal guidance");
      httpsUrl(errors, source.canonical_url, `${base}.canonical_url`, { allowInvalidHost: input.fixture === true });
      const sourcePublished = utcTimestamp(errors, source.published_at, `${base}.published_at`);
      const retrieved = utcTimestamp(errors, source.retrieved_at, `${base}.retrieved_at`);
      if (sourcePublished !== null && retrieved !== null && retrieved < sourcePublished) addError(errors, `${base}.retrieved_at`, "must not predate publication");
      if (exactKeys(errors, source.rights, `${base}.rights`, RIGHTS_KEYS)) {
        if (source.rights.mode !== "metadata-only") addError(errors, `${base}.rights.mode`, "must equal metadata-only");
        text(errors, source.rights.attribution, `${base}.rights.attribution`, 200);
        httpsUrl(errors, source.rights.licence_url, `${base}.rights.licence_url`, { nullable: true, allowInvalidHost: true });
      }
      if (!Array.isArray(source.evidence) || source.evidence.length !== 0) addError(errors, `${base}.evidence`, "must be an empty array");
    }
  }
  if (input.explainer !== null) addError(errors, "explainer", "must be null");
  if (exactKeys(errors, input.revision, "revision", REVISION_KEYS)) {
    if (input.revision.number !== 1) addError(errors, "revision.number", "must equal 1");
    const updatedAt = utcTimestamp(errors, input.revision.updated_at, "revision.updated_at");
    if (publishedAt !== null && updatedAt !== null && updatedAt < publishedAt) addError(errors, "revision.updated_at", "must not predate publication");
    text(errors, input.revision.change_note, "revision.change_note", 500);
  }
  if (input.fixture !== true) addError(errors, "fixture", "must be true");
  return errors.length === 0 ? { ok: true, value: input } : { ok: false, errors };
}

export function validateDevelopment(input) {
  if (!isRecord(input)) {
    return { ok: false, errors: [{ path: "$", message: "must be an object" }] };
  }
  if (input.schema_version === "development.v1") {
    return validateDevelopmentV1(input);
  }
  if (input.schema_version === "development.v2") {
    if (input.mode === "synthetic") return validateCanonicalDevelopmentV2(input);
    if (input.mode === "live") return validateLiveDevelopmentV2(input);
    return {
      ok: false,
      errors: [{ path: "mode", message: "has an unsupported value" }],
    };
  }
  return {
    ok: false,
    errors: [{ path: "schema_version", message: "has an unsupported value" }],
  };
}

async function loadDevelopments({ contentDir }) {
  let contentEntries;
  try {
    contentEntries = await readdir(contentDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Development content directory is missing");
    }
    throw new Error("Development content directory cannot be read");
  }
  const entries = contentEntries
    .filter(entry => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length === 0) {
    throw new Error("No development records were found");
  }

  const records = [];
  const identifiers = new Set();
  for (const entry of entries) {
    const recordPath = join(contentDir, entry.name, "development.json");
    let source;
    try {
      source = await readFile(recordPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error("A development record file is missing");
      }
      throw new Error("A development record file cannot be read");
    }
    let input;
    try {
      input = parseStrictJsonBytes(source);
    } catch {
      throw new Error("A development record is not valid JSON");
    }
    const result = validateDevelopment(input);
    if (!result.ok) {
      throw new Error("A development record failed validation");
    }
    if (identifiers.has(result.value.development_id)) {
      throw new Error("A development record identifier is duplicated");
    }
    if (result.value.development_id !== entry.name) {
      throw new Error("A development record identifier does not match its directory");
    }
    identifiers.add(result.value.development_id);
    records.push(result.value);
  }
  return records;
}

async function outputDirectory(rootDir) {
  const expected = join(resolve(rootDir), "out");
  await outputExists(expected);
  return expected;
}

async function outputExists(outputDir) {
  let information;
  try {
    information = await lstat(outputDir);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw new Error("The out directory cannot be inspected");
  }
  if (information.isSymbolicLink()) {
    throw new Error("The out directory must not be a symbolic link");
  }
  return true;
}

async function createPrivateDirectory(rootDir, name) {
  const directory = join(rootDir, name);
  try {
    await mkdir(directory);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error("A private build directory is already present");
    }
    throw new Error("Unable to prepare private build output");
  }
  return directory;
}

async function removePrivateDirectory(directory) {
  try {
    await rm(directory, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function writeStagedOutput(stagingDir, rendered) {
  try {
    for (const [relativePath, contents] of rendered) {
      const destination = join(stagingDir, ...relativePath.split("/"));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, contents, "utf8");
    }
  } catch {
    throw new Error("Unable to write staged output");
  }
}

async function publishStagedOutput({ rootDir, outputDir, stagingDir }) {
  const backupDir = await createPrivateDirectory(rootDir, ".out-previous");
  const backupOutput = join(backupDir, "out");
  let previousOutputMoved = false;
  try {
    if (await outputExists(outputDir)) {
      try {
        await rename(outputDir, backupOutput);
        previousOutputMoved = true;
      } catch {
        throw new Error("Unable to publish staged output");
      }
    }
    try {
      await rename(stagingDir, outputDir);
    } catch {
      if (previousOutputMoved) {
        try {
          await rename(backupOutput, outputDir);
          previousOutputMoved = false;
        } catch {
          throw new Error("Staged output could not be published and the previous artifact could not be restored");
        }
      }
      throw new Error("Unable to publish staged output");
    }
    await removePrivateDirectory(backupDir);
  } catch (error) {
    if (!previousOutputMoved && !await removePrivateDirectory(backupDir)) {
      throw new Error("Unable to clean private build output");
    }
    throw error;
  }
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character],
  );
}

function escapeXml(value) {
  return String(value).replace(
    /[&<>"']/g,
    character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;",
    })[character],
  );
}

function normaliseSiteUrl(value) {
  const rawValue = String(value);
  const url = new URL(rawValue);
  const loopback =
    url.protocol === "http:" &&
    new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname);
  if (url.protocol !== "https:" && !loopback) {
    throw new TypeError("SITE_URL must use HTTPS or a loopback HTTP origin");
  }
  if (url.username || url.password || rawValue.includes("?") || rawValue.includes("#")) {
    throw new TypeError("SITE_URL must not contain credentials, query or fragment");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

function absoluteUrl(siteUrl, path) {
  return new URL(path.replace(/^\/+/, ""), siteUrl).href;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

const LIVE_CLAIM = "The Federal Register reports a newer registered current compilation for this title.";

function livePresentation(record) {
  const previousNumber = record.source_event.previous_compilation.number ??
    "No compilation number recorded";
  const currentNumber = record.source_event.current_compilation.number;
  const compilationDate = formatDate(
    `${record.source_event.current_compilation.date}T00:00:00Z`,
  );
  const registrationDate = formatDate(record.published_at);
  const officialUrl = record.sources[0].canonical_url;
  const releaseTag = `live-evidence-v2-${record.upstream.producer.observation_facts_sha256.slice("sha256:".length)}`;
  const evidenceUrl = `https://github.com/ryanduguid/au-tax-legislation-corpus/releases/tag/${releaseTag}`;
  const headline = `New compilation: ${record.title}`;
  const summary = [
    LIVE_CLAIM,
    `Registered: ${registrationDate}`,
    `Compilation date: ${compilationDate}`,
    `Previous compilation number: ${previousNumber}`,
    `Current compilation number: ${currentNumber}`,
    `Official source: ${officialUrl}`,
    `Evidence release: ${evidenceUrl}`,
    statusSummary(record),
  ].join("; ");
  return {
    headline,
    claim: LIVE_CLAIM,
    registrationDate,
    compilationDate,
    previousNumber,
    currentNumber,
    officialUrl,
    evidenceUrl,
    summary,
  };
}

const SITE_NAME = "TaxJarvis";

function modeLabel(mode) {
  return mode === "live" ? "Live" : "Synthetic";
}

function recordLabel(mode) {
  return mode === "live"
    ? "Live · Source-only"
    : "Demonstration record · Synthetic · Source-only";
}

function statusList(record) {
  return `
    <dl class="statuses" aria-label="Development status">
      <div><dt>Authority</dt><dd>${escapeHtml(record.authority_status)}</dd></div>
      <div><dt>Evidence</dt><dd>${escapeHtml(record.evidence_status)}</dd></div>
      <div><dt>Publication</dt><dd>${escapeHtml(record.publication_status)}</dd></div>
      <div><dt>Mode</dt><dd>${escapeHtml(modeLabel(record.mode))}</dd></div>
    </dl>`;
}

function layout({ title, body, siteUrl }) {
  const homeUrl = absoluteUrl(siteUrl, "/");
  const methodologyUrl = absoluteUrl(siteUrl, "/methodology/");
  const cssUrl = absoluteUrl(siteUrl, "/assets/site.css");
  return `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)} | ${SITE_NAME}</title>
  <link rel="stylesheet" href="${escapeHtml(cssUrl)}">
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <a class="site-name" href="${escapeHtml(homeUrl)}">${SITE_NAME}</a>
    <nav aria-label="Primary"><a href="${escapeHtml(methodologyUrl)}">Methodology</a></nav>
  </header>
  <main id="main">${body}</main>
  <footer><p>Evidence-first information for professional source checking. Not tax advice.</p></footer>
</body>
</html>
`;
}

function developmentUrl(siteUrl, record) {
  return absoluteUrl(siteUrl, `/developments/${record.development_id}/`);
}

function renderHome(records, siteUrl) {
  const items = records.map(record => {
    if (record.mode === "live") {
      const live = livePresentation(record);
      return `
    <article class="development-card">
      <p class="eyebrow">${escapeHtml(recordLabel(record.mode))}</p>
      <h2><a href="${escapeHtml(developmentUrl(siteUrl, record))}">${escapeHtml(live.headline)}</a></h2>
      <p>${escapeHtml(live.claim)}</p>
      <p>Registered: <time datetime="${escapeHtml(record.published_at)}">${escapeHtml(live.registrationDate)}</time> · Compilation date: <time datetime="${escapeHtml(record.source_event.current_compilation.date)}">${escapeHtml(live.compilationDate)}</time></p>
      <p>Previous compilation number: ${escapeHtml(live.previousNumber)} · Current compilation number: ${escapeHtml(live.currentNumber)}</p>
      ${statusList(record)}
      <p><strong>Official source:</strong> <a href="${escapeHtml(live.officialUrl)}" rel="external noopener">${escapeHtml(live.officialUrl)}</a></p>
      <p><strong>Evidence release:</strong> <a href="${escapeHtml(live.evidenceUrl)}" rel="external noopener">${escapeHtml(live.evidenceUrl)}</a></p>
    </article>`;
    }
    return `
    <article class="development-card">
      <p class="eyebrow">${escapeHtml(recordLabel(record.mode))}</p>
      <h2><a href="${escapeHtml(developmentUrl(siteUrl, record))}">${escapeHtml(record.title)}</a></h2>
      <p>Published <time datetime="${escapeHtml(record.published_at)}">${escapeHtml(formatDate(record.published_at))}</time> · updated <time datetime="${escapeHtml(record.revision.updated_at)}">${escapeHtml(formatDate(record.revision.updated_at))}</time></p>
      ${statusList(record)}
      <p><strong>Affected practice:</strong> ${record.affected_practice_areas.map(escapeHtml).join(", ")}</p>
    </article>`;
  }).join("");

  const containsLive = records.some(record => record.mode === "live");
  return layout({
    title: "Recent developments",
    siteUrl,
    body: `
      <section class="hero">
        <p class="eyebrow">${containsLive ? "Source-only tax intelligence" : "Source-only demonstration"}</p>
        <h1>Australian tax and accounting developments</h1>
        <p>${containsLive ? "Validated source developments, with no AI explanation published in this stage." : "This vertical slice contains only non-production fixtures and no AI explanation."}</p>
      </section>
      <section aria-labelledby="recent"><h2 id="recent">Recent developments</h2>${items}</section>`,
  });
}

function renderSource(source, mode) {
  const parsed = new URL(source.canonical_url);
  const sourceLocation =
    mode === "synthetic" && isArtificialHostname(parsed.hostname)
      ? `<code>${escapeHtml(source.canonical_url)}</code>`
      : `<a href="${escapeHtml(parsed.href)}" rel="external noopener">Open official source</a>`;
  const licenceUrl = source.rights.licence_url === null
    ? null
    : new URL(source.rights.licence_url);
  const licenceLocation = licenceUrl === null
    ? "No separate licence URL supplied."
    : mode === "synthetic" && isArtificialHostname(licenceUrl.hostname)
      ? `<code>${escapeHtml(licenceUrl.href)}</code>`
      : `<a href="${escapeHtml(licenceUrl.href)}" rel="external noopener">Source licence</a>`;
  return `
    <li>
      <p><strong>${escapeHtml(source.title)}</strong></p>
      <p><code>${escapeHtml(source.source_id)}</code>, ${escapeHtml(source.publisher)}, ${escapeHtml(source.document_class)}</p>
      <p>${sourceLocation}</p>
      <p>Published <time datetime="${escapeHtml(source.published_at)}">${escapeHtml(formatDate(source.published_at))}</time> · retrieved <time datetime="${escapeHtml(source.retrieved_at)}">${escapeHtml(formatDate(source.retrieved_at))}</time></p>
      <p>Rights: ${escapeHtml(source.rights.mode)} · attribution: ${escapeHtml(source.rights.attribution)}</p>
      <p>${licenceLocation}</p>
    </li>`;
}

function renderDevelopment(record, siteUrl) {
  if (record.mode === "live") {
    const live = livePresentation(record);
    const source = record.sources[0];
    return layout({
      title: live.headline,
      siteUrl,
      body: `
      <article>
        <p class="eyebrow">${escapeHtml(recordLabel(record.mode))}</p>
        <h1>${escapeHtml(live.headline)}</h1>
        <p>${escapeHtml(live.claim)}</p>
        <p>Development ID: <code>${escapeHtml(record.development_id)}</code></p>
        <p>Registered: <time datetime="${escapeHtml(record.published_at)}">${escapeHtml(live.registrationDate)}</time> · Compilation date: <time datetime="${escapeHtml(record.source_event.current_compilation.date)}">${escapeHtml(live.compilationDate)}</time></p>
        <p>Previous compilation number: ${escapeHtml(live.previousNumber)} · Current compilation number: ${escapeHtml(live.currentNumber)}</p>
        ${statusList(record)}
        <section aria-labelledby="sources"><h2 id="sources">Primary source</h2>
          <p><strong>Official source:</strong> <a href="${escapeHtml(live.officialUrl)}" rel="external noopener">${escapeHtml(live.officialUrl)}</a></p>
          <p><strong>Evidence release:</strong> <a href="${escapeHtml(live.evidenceUrl)}" rel="external noopener">${escapeHtml(live.evidenceUrl)}</a></p>
          <p>Attribution: ${escapeHtml(source.rights.attribution)}</p>
          <p><a href="${escapeHtml(source.rights.licence_url)}" rel="external noopener">Source licence</a></p>
        </section>
        <section aria-labelledby="revision"><h2 id="revision">Revision</h2>
          <p>Revision ${escapeHtml(record.revision.number)}: ${escapeHtml(record.revision.change_note)}</p>
        </section>
      </article>`,
    });
  }
  const syntheticWarning = record.mode === "synthetic"
    ? `
        <aside class="notice synthetic-warning" aria-labelledby="synthetic-status">
          <h2 id="synthetic-status">Synthetic development</h2>
          <p>This is demonstration data, not current professional coverage. Do not rely on it for client work.</p>
        </aside>`
    : "";
  return layout({
    title: record.title,
    siteUrl,
    body: `
      <article>
        <p class="eyebrow">${escapeHtml(recordLabel(record.mode))}</p>
        <h1>${escapeHtml(record.title)}</h1>
        <p>Development ID: <code>${escapeHtml(record.development_id)}</code></p>
        <p>Published <time datetime="${escapeHtml(record.published_at)}">${escapeHtml(formatDate(record.published_at))}</time> · updated <time datetime="${escapeHtml(record.revision.updated_at)}">${escapeHtml(formatDate(record.revision.updated_at))}</time></p>
        <p>Effective date: ${record.effective_at === null ? "not separately supplied" : `<time datetime="${escapeHtml(record.effective_at)}">${escapeHtml(formatDate(record.effective_at))}</time>`}.</p>
        ${statusList(record)}
        ${syntheticWarning}
        <aside class="notice" aria-labelledby="explainer-status">
          <h2 id="explainer-status">Explainer status</h2>
          <p>No AI explainer has been published for this source-only record.</p>
        </aside>
        <section aria-labelledby="practice"><h2 id="practice">Affected practice areas</h2>
          <ul>${record.affected_practice_areas.map(area => `<li>${escapeHtml(area)}</li>`).join("")}</ul>
        </section>
        <section aria-labelledby="topics"><h2 id="topics">Topics</h2>
          <ul>${record.topics.map(topic => `<li>${escapeHtml(topic)}</li>`).join("")}</ul>
          <p>Labels support browsing and are not advice.</p>
        </section>
        <section aria-labelledby="sources"><h2 id="sources">Primary sources</h2>
          <ul class="source-list">${record.sources.map(source => renderSource(source, record.mode)).join("")}</ul>
        </section>
        <section aria-labelledby="revision"><h2 id="revision">Revision</h2>
          <p>Revision ${escapeHtml(record.revision.number)}: ${escapeHtml(record.revision.change_note)}</p>
        </section>
        <section aria-labelledby="status-definitions"><h2 id="status-definitions">Status definitions</h2>
          <dl>
            <dt>Authority status</dt><dd>What kind of official development this is.</dd>
            <dt>Evidence status</dt><dd>Whether the source record passed the evidence checks.</dd>
            <dt>Publication status</dt><dd>Whether this page contains source material only or a separately gated explanation.</dd>
          </dl>
        </section>
      </article>`,
  });
}

function renderMethodology(siteUrl, containsLive) {
  const coverageStatement = containsLive
    ? "This stage publishes validated metadata from explicitly identified live source records. Synthetic conformance records remain labelled and are not presented as current coverage."
    : "This demonstration publishes only validated metadata from one clearly labelled, non-production source fixture.";
  return layout({
    title: "Methodology",
    siteUrl,
    body: `
      <article class="prose">
        <p class="eyebrow">Methodology</p>
        <h1>Evidence before publication</h1>
        <p>${coverageStatement}</p>
        <h2>Sources and abstention</h2>
        <p>The intended service relies on authoritative primary sources. If identity, status, freshness, integrity or reuse rights cannot be established, an item is held rather than filled with plausible prose.</p>
        <h2>Artificial intelligence</h2>
        <p>AI is not used in this vertical slice. An explainer requires a separately designed writer, independent verifier and deterministic publication gate.</p>
        <h2>Limitations</h2>
        <p>This service does not provide tax advice, replace professional judgement or remove the need to check the official source.</p>
        <h2>Licensing</h2>
        <p>Original code is AGPL-3.0-only. Separate terms apply to original content, factual data, reserved marks and third-party source material.</p>
      </article>`,
  });
}

function latestUpdatedAt(records) {
  let latest = records[0].revision.updated_at;
  for (let index = 1; index < records.length; index += 1) {
    const candidate = records[index].revision.updated_at;
    if (timestampKey(candidate) >= timestampKey(latest)) latest = candidate;
  }
  return latest;
}

function statusSummary(record) {
  return [
    `Authority: ${record.authority_status}`,
    `Evidence: ${record.evidence_status}`,
    `Publication: ${record.publication_status}`,
    `Mode: ${record.mode}`,
  ].join("; ");
}

function renderFeedJson(records, siteUrl) {
  const updatedAt = latestUpdatedAt(records);
  return `${JSON.stringify({
    schema_version: "feed.v2",
    updated_at: updatedAt,
    items: records.map(record => {
      const live = record.mode === "live" ? livePresentation(record) : null;
      return {
        development_id: record.development_id,
        url: developmentUrl(siteUrl, record),
        title: live === null ? record.title : live.headline,
        summary: live === null ? statusSummary(record) : live.summary,
        mode: record.mode,
        authority_status: record.authority_status,
        evidence_status: record.evidence_status,
        publication_status: record.publication_status,
        published_at: record.published_at,
        updated_at: record.revision.updated_at,
      };
    }),
  }, null, 2)}\n`;
}

function renderFeedXml(records, siteUrl) {
  const updatedAt = latestUpdatedAt(records);
  const items = records.map(record => {
    const url = developmentUrl(siteUrl, record);
    const live = record.mode === "live" ? livePresentation(record) : null;
    const title = live === null ? record.title : live.headline;
    const description = live === null ? statusSummary(record) : live.summary;
    return `
    <item>
      <guid isPermaLink="false">${escapeXml(record.development_id)}</guid>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(url)}</link>
      <pubDate>${escapeXml(new Date(record.published_at).toUTCString())}</pubDate>
      <atom:updated>${escapeXml(record.revision.updated_at)}</atom:updated>
      <description>${escapeXml(description)}</description>
    </item>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${SITE_NAME}</title>
    <link>${escapeXml(siteUrl)}</link>
    <description>Validated Australian tax and accounting source developments.</description>
    <lastBuildDate>${escapeXml(new Date(updatedAt).toUTCString())}</lastBuildDate>${items}
  </channel>
</rss>
`;
}

export function renderSite(records, { siteUrl, cssText }) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new TypeError("At least one validated record is required");
  }
  const baseUrl = normaliseSiteUrl(siteUrl);
  const views = records.map(record => record.schema_version === "development.v1"
    ? { ...record, mode: "synthetic" }
    : record);
  const ordered = [...views].sort((left, right) => {
    const leftKey = timestampKey(left.published_at);
    const rightKey = timestampKey(right.published_at);
    if (leftKey === rightKey) return 0;
    return leftKey < rightKey ? 1 : -1;
  });
  const containsLive = ordered.some(record => record.mode === "live");
  const files = new Map([
    ["index.html", renderHome(ordered, baseUrl)],
    ["methodology/index.html", renderMethodology(baseUrl, containsLive)],
    ["feed.xml", renderFeedXml(ordered, baseUrl)],
    ["feed.json", renderFeedJson(ordered, baseUrl)],
    ["assets/site.css", cssText],
  ]);
  for (const record of ordered) {
    files.set(
      `developments/${record.development_id}/index.html`,
      renderDevelopment(record, baseUrl),
    );
  }
  return files;
}

export async function buildSite({ rootDir, siteUrl }) {
  const resolvedRoot = resolve(rootDir);
  const outputDir = await outputDirectory(resolvedRoot);
  const records = await loadDevelopments({
    contentDir: join(resolvedRoot, "content", "developments"),
  });
  let cssText;
  try {
    cssText = await readFile(join(resolvedRoot, "assets", "site.css"), "utf8");
  } catch {
    throw new Error("Stylesheet cannot be read");
  }
  const rendered = renderSite(records, { siteUrl, cssText });
  const stagingDir = await createPrivateDirectory(resolvedRoot, ".out-staging");
  try {
    await writeStagedOutput(stagingDir, rendered);
    await publishStagedOutput({
      rootDir: resolvedRoot,
      outputDir,
      stagingDir,
    });
  } catch (error) {
    if (!await removePrivateDirectory(stagingDir)) {
      throw new Error("Unable to clean private build output");
    }
    throw error;
  }
  return [...rendered.keys()].sort();
}

const REPOSITORY_ROOT = fileURLToPath(new URL(".", import.meta.url));
const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";

if (invokedPath === import.meta.url) {
  void (async () => {
    try {
      const paths = await buildSite({
        rootDir: REPOSITORY_ROOT,
        siteUrl: process.env.SITE_URL ?? `http://127.0.0.1:${previewPort(process.env.PORT)}/`,
      });
      console.log(`Built ${paths.length} files in out/`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  })();
}
