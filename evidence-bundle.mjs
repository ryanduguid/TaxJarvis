// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import {
  exactKeys,
  httpsUrl,
  isIdentifier,
  isRecord,
  labelList,
  oneOf,
  text,
  timestampKey,
  utcTimestamp,
} from "./site.mjs";
import { parseStrictJsonBytes } from "./strict-json.mjs";

const BUNDLE_KEYS = new Set([
  "schema_version",
  "bundle_id",
  "development_id",
  "mode",
  "generated_at",
  "producer",
  "development",
  "source_event",
  "sources",
  "revision",
]);
const PRODUCER_KEYS = new Set([
  "name",
  "version",
  "baseline_sha256",
  "observation_facts_sha256",
]);
const DEVELOPMENT_KEYS = new Set([
  "title",
  "authority_status",
  "evidence_status",
  "publication_status",
  "published_at",
  "effective_at",
  "topics",
  "affected_practice_areas",
]);
const SOURCE_EVENT_KEYS = new Set([
  "kind",
  "register_id",
  "collection",
  "previous_compilation",
  "current_compilation",
]);
const PREVIOUS_COMPILATION_KEYS = new Set(["number", "date"]);
const CURRENT_COMPILATION_KEYS = new Set([
  "number",
  "date",
  "register_document_id",
]);
const SOURCE_KEYS = new Set([
  "source_id",
  "publisher",
  "document_class",
  "title",
  "canonical_url",
  "published_at",
  "retrieved_at",
  "evidence_id",
  "content_sha256",
  "content_kind",
  "content_media_type",
  "rights",
  "evidence",
]);
const RIGHTS_KEYS = new Set(["mode", "attribution", "licence_url"]);
const REVISION_KEYS = new Set([
  "number",
  "updated_at",
  "change_note",
  "replaces_bundle_id",
]);
const MODES = new Set(["synthetic", "live"]);
const AUTHORITY_STATUSES = new Set([
  "consultation",
  "introduced",
  "made-not-effective",
  "in-force",
  "operative-guidance",
  "decision",
  "withdrawn",
  "superseded",
]);
const EVIDENCE_STATUSES = new Set([
  "verified",
  "insufficient",
  "conflicting",
  "stale",
]);
const COLLECTIONS = new Set([
  "Act",
  "LegislativeInstrument",
  "NotifiableInstrument",
]);
const CONTENT_KINDS = new Set(["metadata-response", "source-document"]);
const CONTENT_MEDIA_TYPES = new Set([
  "application/json",
  "application/pdf",
  "application/xhtml+xml",
  "text/html",
]);
const SHA256_ID = /^sha256:[0-9a-f]{64}$/;
const UPSTREAM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export class EvidenceBundleError extends Error {
  constructor(message) {
    super(message);
    this.name = "EvidenceBundleError";
  }
}

function addError(errors, path, message) {
  errors.push({ path, message });
}

function identifier(errors, value, path) {
  if (!isIdentifier(value)) {
    addError(errors, path, "must be a safe identifier");
    return false;
  }
  return true;
}

function upstreamIdentifier(errors, value, path) {
  if (typeof value !== "string" || !UPSTREAM_ID.test(value)) {
    addError(errors, path, "must be a safe upstream identifier");
    return false;
  }
  return true;
}

function sha256(errors, value, path) {
  if (typeof value !== "string" || !SHA256_ID.test(value)) {
    addError(errors, path, "must be a lowercase SHA-256 identifier");
    return false;
  }
  return true;
}

function isoDate(errors, value, path) {
  if (typeof value !== "string") {
    addError(errors, path, "must be an ISO calendar date");
    return null;
  }
  const match = ISO_DATE.exec(value);
  if (match === null) {
    addError(errors, path, "must be an ISO calendar date");
    return null;
  }
  const milliseconds = Date.parse(`${value}T00:00:00Z`);
  const parsed = new Date(milliseconds);
  if (
    !Number.isFinite(milliseconds) ||
    parsed.getUTCFullYear() !== Number(match[1]) ||
    parsed.getUTCMonth() + 1 !== Number(match[2]) ||
    parsed.getUTCDate() !== Number(match[3])
  ) {
    addError(errors, path, "must be a real ISO calendar date");
    return null;
  }
  return value;
}

function validateProducer(errors, producer) {
  if (!exactKeys(errors, producer, "producer", PRODUCER_KEYS)) return;
  text(errors, producer.name, "producer.name", 100);
  text(errors, producer.version, "producer.version", 100);
  sha256(errors, producer.baseline_sha256, "producer.baseline_sha256");
  sha256(
    errors,
    producer.observation_facts_sha256,
    "producer.observation_facts_sha256",
  );
}

function validateDevelopmentSection(errors, development) {
  if (!exactKeys(errors, development, "development", DEVELOPMENT_KEYS)) {
    return { publishedAt: null };
  }
  text(errors, development.title, "development.title", 200);
  oneOf(
    errors,
    development.authority_status,
    "development.authority_status",
    AUTHORITY_STATUSES,
  );
  oneOf(
    errors,
    development.evidence_status,
    "development.evidence_status",
    EVIDENCE_STATUSES,
  );
  if (development.publication_status !== "source-only") {
    addError(errors, "development.publication_status", "must equal source-only");
  }
  const publishedAt = utcTimestamp(
    errors,
    development.published_at,
    "development.published_at",
  );
  utcTimestamp(errors, development.effective_at, "development.effective_at", {
    nullable: true,
  });
  if (development.effective_at !== null) {
    addError(
      errors,
      "development.effective_at",
      "must be null for a source-only compilation event",
    );
  }
  labelList(errors, development.topics, "development.topics");
  labelList(
    errors,
    development.affected_practice_areas,
    "development.affected_practice_areas",
  );
  return { publishedAt };
}

function validateCompilation(errors, value, path, keys, { current = false } = {}) {
  if (!exactKeys(errors, value, path, keys)) {
    return { number: null, date: null, registerDocumentId: null };
  }
  const numberIsText = text(errors, value.number, `${path}.number`, 80);
  const date = isoDate(errors, value.date, `${path}.date`);
  let registerDocumentId = null;
  if (current) {
    if (upstreamIdentifier(
      errors,
      value.register_document_id,
      `${path}.register_document_id`,
    )) registerDocumentId = value.register_document_id;
  }
  return {
    number: numberIsText ? value.number : null,
    date,
    registerDocumentId,
  };
}

function validateSourceEvent(errors, sourceEvent) {
  if (!exactKeys(errors, sourceEvent, "source_event", SOURCE_EVENT_KEYS)) {
    return {};
  }
  if (sourceEvent.kind !== "compilation-superseded") {
    addError(
      errors,
      "source_event.kind",
      "must equal compilation-superseded",
    );
  }
  const registerId = upstreamIdentifier(
    errors,
    sourceEvent.register_id,
    "source_event.register_id",
  ) ? sourceEvent.register_id : null;
  oneOf(
    errors,
    sourceEvent.collection,
    "source_event.collection",
    COLLECTIONS,
  );
  const previous = validateCompilation(
    errors,
    sourceEvent.previous_compilation,
    "source_event.previous_compilation",
    PREVIOUS_COMPILATION_KEYS,
  );
  const current = validateCompilation(
    errors,
    sourceEvent.current_compilation,
    "source_event.current_compilation",
    CURRENT_COMPILATION_KEYS,
    { current: true },
  );
  if (previous.number !== null && current.number === previous.number) {
    addError(
      errors,
      "source_event.current_compilation.number",
      "must differ from the previous compilation",
    );
  }
  if (previous.date !== null && current.date !== null && current.date <= previous.date) {
    addError(
      errors,
      "source_event.current_compilation.date",
      "must postdate the previous compilation",
    );
  }
  return {
    registerId,
    collection: sourceEvent.collection,
    previous,
    current,
  };
}

function validateRights(errors, rights, path, { allowInvalidHost }) {
  if (!exactKeys(errors, rights, path, RIGHTS_KEYS)) return;
  if (rights.mode !== "metadata-only") {
    addError(errors, `${path}.mode`, "must equal metadata-only");
  }
  text(errors, rights.attribution, `${path}.attribution`, 200);
  httpsUrl(errors, rights.licence_url, `${path}.licence_url`, {
    nullable: true,
    allowInvalidHost,
  });
}

function validateSources(errors, sources, { allowInvalidHost }) {
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 20) {
    addError(errors, "sources", "must contain 1 to 20 sources");
    return [];
  }
  if (sources.length !== 1) {
    addError(errors, "sources", "this source event must contain exactly one source");
  }
  const sourceIds = new Set();
  const validated = [];
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const path = `sources[${index}]`;
    if (!exactKeys(errors, source, path, SOURCE_KEYS)) continue;
    const sourceIdIsValid = identifier(errors, source.source_id, `${path}.source_id`);
    if (sourceIdIsValid && sourceIds.has(source.source_id)) {
      addError(errors, `${path}.source_id`, "must be unique");
    }
    if (sourceIdIsValid) sourceIds.add(source.source_id);
    text(errors, source.publisher, `${path}.publisher`, 200);
    text(errors, source.document_class, `${path}.document_class`, 80);
    text(errors, source.title, `${path}.title`, 200);
    const canonicalUrl = httpsUrl(
      errors,
      source.canonical_url,
      `${path}.canonical_url`,
      { allowInvalidHost },
    );
    const publishedAt = utcTimestamp(
      errors,
      source.published_at,
      `${path}.published_at`,
    );
    const retrievedAt = utcTimestamp(
      errors,
      source.retrieved_at,
      `${path}.retrieved_at`,
    );
    if (publishedAt !== null && retrievedAt !== null && retrievedAt < publishedAt) {
      addError(errors, `${path}.retrieved_at`, "must not predate publication");
    }
    upstreamIdentifier(errors, source.evidence_id, `${path}.evidence_id`);
    sha256(errors, source.content_sha256, `${path}.content_sha256`);
    oneOf(errors, source.content_kind, `${path}.content_kind`, CONTENT_KINDS);
    oneOf(
      errors,
      source.content_media_type,
      `${path}.content_media_type`,
      CONTENT_MEDIA_TYPES,
    );
    validateRights(errors, source.rights, `${path}.rights`, { allowInvalidHost });
    if (!Array.isArray(source.evidence) || source.evidence.length !== 0) {
      addError(errors, `${path}.evidence`, "must be an empty array for metadata-only rights");
    }
    validated.push({ source, path, canonicalUrl, publishedAt, retrievedAt });
  }
  return validated;
}

function validateRevision(errors, revision, publishedAt) {
  if (!exactKeys(errors, revision, "revision", REVISION_KEYS)) {
    return { updatedAt: null };
  }
  if (revision.number !== 1) {
    addError(errors, "revision.number", "must equal 1");
  }
  const updatedAt = utcTimestamp(
    errors,
    revision.updated_at,
    "revision.updated_at",
  );
  if (publishedAt !== null && updatedAt !== null && updatedAt < publishedAt) {
    addError(errors, "revision.updated_at", "must not predate publication");
  }
  text(errors, revision.change_note, "revision.change_note", 500);
  if (revision.replaces_bundle_id !== null) {
    addError(
      errors,
      "revision.replaces_bundle_id",
      "must be null for an initial immutable bundle",
    );
  }
  return { updatedAt };
}

function crossValidate(
  errors,
  bundle,
  { generatedAt, publishedAt, sourceEvent, sources, updatedAt },
) {
  const registerId = sourceEvent.registerId;
  const documentId = sourceEvent.current?.registerDocumentId;
  if (typeof registerId === "string" && typeof documentId === "string") {
    const identity = `${registerId.toLowerCase()}-${documentId.toLowerCase()}`;
    const expectedDevelopmentId = `dev-frl-${identity}`;
    const expectedBundleId = `bundle-frl-${identity}-r1`;
    if (bundle.development_id !== expectedDevelopmentId) {
      addError(
        errors,
        "development_id",
        "does not match the source-event identity",
      );
    }
    if (bundle.bundle_id !== expectedBundleId) {
      addError(errors, "bundle_id", "does not match the source-event identity");
    }
  }

  if (generatedAt !== null && publishedAt !== null && generatedAt < publishedAt) {
    addError(errors, "generated_at", "must not predate publication");
  }
  if (updatedAt !== null && generatedAt !== null && updatedAt !== generatedAt) {
    addError(errors, "revision.updated_at", "must equal generated_at");
  }

  for (const { source, path, canonicalUrl, publishedAt: sourcePublished, retrievedAt } of sources) {
    if (retrievedAt !== null && generatedAt !== null && retrievedAt > generatedAt) {
      addError(errors, "generated_at", "must not predate source retrieval");
    }
    if (publishedAt !== null && sourcePublished !== null && sourcePublished !== publishedAt) {
      addError(errors, `${path}.published_at`, "must equal development publication");
    }
    if (bundle.development?.title !== source.title) {
      addError(errors, `${path}.title`, "must equal the development title");
    }
    if (source.publisher !== "Federal Register of Legislation") {
      addError(errors, `${path}.publisher`, "must identify the Federal Register of Legislation");
    }
    if (source.document_class !== "legislation") {
      addError(errors, `${path}.document_class`, "must equal legislation");
    }
    if (
      typeof documentId === "string" &&
      source.source_id !== `frl-${documentId.toLowerCase()}`
    ) {
      addError(errors, `${path}.source_id`, "does not match the current register document");
      addError(
        errors,
        "source_event.current_compilation.register_document_id",
        "does not match the source identity",
      );
    }
    if (typeof registerId === "string" && canonicalUrl !== null) {
      const expectedPath = `/${registerId}/latest/text`;
      if (canonicalUrl.pathname !== expectedPath) {
        addError(errors, `${path}.canonical_url`, "does not match the register title");
      }
    }
  }

  const currentDate = sourceEvent.current?.date;
  if (typeof currentDate === "string" && publishedAt !== null) {
    const expectedPublishedAt = `${currentDate}T00:00:00Z`;
    if (bundle.development?.published_at !== expectedPublishedAt) {
      addError(
        errors,
        "development.published_at",
        "must map the current compilation date to midnight UTC",
      );
    }
  }
}

export function validateEvidenceBundle(input) {
  const errors = [];
  if (!exactKeys(errors, input, "$", BUNDLE_KEYS)) return { ok: false, errors };
  if (input.schema_version !== "evidence-bundle.v1") {
    addError(errors, "schema_version", "must equal evidence-bundle.v1");
  }
  identifier(errors, input.bundle_id, "bundle_id");
  identifier(errors, input.development_id, "development_id");
  oneOf(errors, input.mode, "mode", MODES);
  const generatedAt = utcTimestamp(errors, input.generated_at, "generated_at");
  validateProducer(errors, input.producer);
  const { publishedAt } = validateDevelopmentSection(errors, input.development);
  const sourceEvent = validateSourceEvent(errors, input.source_event);
  const sources = validateSources(errors, input.sources, {
    allowInvalidHost: input.mode === "synthetic",
  });
  const { updatedAt } = validateRevision(errors, input.revision, publishedAt);
  crossValidate(errors, input, {
    generatedAt,
    publishedAt,
    sourceEvent,
    sources,
    updatedAt,
  });
  return errors.length === 0 ? { ok: true, value: input } : { ok: false, errors };
}

export function parseEvidenceBundle(bytes) {
  const bundle = parseStrictJsonBytes(bytes);
  const result = validateEvidenceBundle(bundle);
  if (!result.ok) {
    throw new EvidenceBundleError("evidence bundle is invalid");
  }
  const bundleSha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  return { bundle: result.value, bundleSha256 };
}

function copyProducer(producer) {
  return {
    name: producer.name,
    version: producer.version,
    baseline_sha256: producer.baseline_sha256,
    observation_facts_sha256: producer.observation_facts_sha256,
  };
}

function copySourceEvent(sourceEvent) {
  return {
    kind: sourceEvent.kind,
    register_id: sourceEvent.register_id,
    collection: sourceEvent.collection,
    previous_compilation: {
      number: sourceEvent.previous_compilation.number,
      date: sourceEvent.previous_compilation.date,
    },
    current_compilation: {
      number: sourceEvent.current_compilation.number,
      date: sourceEvent.current_compilation.date,
      register_document_id:
        sourceEvent.current_compilation.register_document_id,
    },
  };
}

function copySource(source) {
  return {
    source_id: source.source_id,
    publisher: source.publisher,
    document_class: source.document_class,
    title: source.title,
    canonical_url: source.canonical_url,
    published_at: source.published_at,
    retrieved_at: source.retrieved_at,
    evidence_id: source.evidence_id,
    content_sha256: source.content_sha256,
    content_kind: source.content_kind,
    content_media_type: source.content_media_type,
    rights: {
      mode: source.rights.mode,
      attribution: source.rights.attribution,
      licence_url: source.rights.licence_url,
    },
    evidence: [],
  };
}

export function transformEvidenceBundle(bundle, { bundleSha256 } = {}) {
  const result = validateEvidenceBundle(bundle);
  if (!result.ok || typeof bundleSha256 !== "string" || !SHA256_ID.test(bundleSha256)) {
    throw new EvidenceBundleError("a validated evidence bundle and digest are required");
  }
  const accepted = result.value;
  return {
    schema_version: "development.v2",
    development_id: accepted.development_id,
    mode: accepted.mode,
    title: accepted.development.title,
    authority_status: accepted.development.authority_status,
    evidence_status: accepted.development.evidence_status,
    publication_status: accepted.development.publication_status,
    published_at: accepted.development.published_at,
    effective_at: accepted.development.effective_at,
    topics: accepted.development.topics.map(topic => topic),
    affected_practice_areas:
      accepted.development.affected_practice_areas.map(area => area),
    source_event: copySourceEvent(accepted.source_event),
    sources: accepted.sources.map(source => copySource(source)),
    explainer: null,
    revision: {
      number: accepted.revision.number,
      updated_at: accepted.revision.updated_at,
      change_note: accepted.revision.change_note,
      replaces_bundle_id: accepted.revision.replaces_bundle_id,
    },
    upstream: {
      bundle_id: accepted.bundle_id,
      bundle_sha256: bundleSha256,
      generated_at: accepted.generated_at,
      producer: copyProducer(accepted.producer),
    },
  };
}
