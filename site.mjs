// SPDX-License-Identifier: AGPL-3.0-only
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{2,79}$/;
const UTC_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
const AUTHORITY_STATUSES = new Set(["consultation", "introduced", "made-not-effective", "in-force", "operative-guidance", "decision", "withdrawn", "superseded"]);
const EVIDENCE_STATUSES = new Set(["verified", "insufficient", "conflicting", "stale"]);
const DEVELOPMENT_KEYS = new Set(["schema_version", "development_id", "title", "authority_status", "evidence_status", "publication_status", "published_at", "effective_at", "topics", "affected_practice_areas", "sources", "explainer", "revision", "fixture"]);
const SOURCE_KEYS = new Set(["source_id", "publisher", "document_class", "title", "canonical_url", "published_at", "retrieved_at", "rights", "evidence"]);
const RIGHTS_KEYS = new Set(["mode", "attribution", "licence_url"]);
const REVISION_KEYS = new Set(["number", "updated_at", "change_note"]);

function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function addError(errors, path, message) { errors.push({ path, message }); }
function exactKeys(errors, value, path, allowed) {
  if (!isRecord(value)) { addError(errors, path, "must be an object"); return false; }
  for (const key of Object.keys(value)) if (!allowed.has(key)) addError(errors, path === "$" ? key : `${path}.${key}`, "is not allowed");
  return true;
}
function text(errors, value, path, maximum) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || value.length > maximum) {
    addError(errors, path, `must be trimmed text of 1 to ${maximum} characters`); return false;
  }
  return true;
}
function oneOf(errors, value, path, allowed) { if (!allowed.has(value)) { addError(errors, path, "has an unsupported value"); return false; } return true; }
function utcTimestamp(errors, value, path, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string") { addError(errors, path, "must be an RFC 3339 UTC timestamp"); return null; }
  const match = UTC_TIMESTAMP.exec(value); const milliseconds = Date.parse(value);
  if (!match || !Number.isFinite(milliseconds)) { addError(errors, path, "must be an RFC 3339 UTC timestamp"); return null; }
  const parsed = new Date(milliseconds); const parts = match.slice(1, 7).map(Number);
  const actual = [parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate(), parsed.getUTCHours(), parsed.getUTCMinutes(), parsed.getUTCSeconds()];
  if (parts.some((part, index) => part !== actual[index])) { addError(errors, path, "must identify a real UTC date and time"); return null; }
  return milliseconds;
}
function httpsUrl(errors, value, path, { nullable = false, allowInvalidHost = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value.length > 2048) { addError(errors, path, "must be an HTTPS URL of at most 2048 characters"); return null; }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || (!allowInvalidHost && parsed.hostname.endsWith(".invalid"))) throw new TypeError("unsafe URL");
    return parsed;
  } catch { addError(errors, path, "must be a permitted HTTPS URL"); return null; }
}
function labelList(errors, value, path) {
  if (!Array.isArray(value) || value.length > 20) { addError(errors, path, "must be an array of at most 20 labels"); return; }
  const seen = new Set();
  value.forEach((label, index) => { if (text(errors, label, `${path}[${index}]`, 80)) { if (seen.has(label)) addError(errors, path, "must contain unique labels"); seen.add(label); } });
}

export function validateDevelopment(input) {
  const errors = [];
  if (!exactKeys(errors, input, "$", DEVELOPMENT_KEYS)) return { ok: false, errors };
  if (input.schema_version !== "development.v1") addError(errors, "schema_version", "must equal development.v1");
  if (!IDENTIFIER.test(input.development_id ?? "")) addError(errors, "development_id", "must be a safe identifier");
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
    input.sources.forEach((source, index) => {
      const base = `sources[${index}]`; if (!exactKeys(errors, source, base, SOURCE_KEYS)) return;
      if (!IDENTIFIER.test(source.source_id ?? "")) addError(errors, `${base}.source_id`, "must be a safe identifier");
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
    });
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
