// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";

import { exactKeys, isXmlText } from "./validation-primitives.mjs";
import { parseStrictJsonBytes } from "./strict-json.mjs";

const MAXIMUM_RESPONSE_BYTES = 256 * 1024;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const REGISTER_ID = /^[A-Z]\d{4}[A-Z]\d{5}$/;
const EVIDENCE_ID = /^frl:([A-Z]\d{4}[A-Z]\d{5}):[0-9a-f]{32}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const UTC_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$/;
const VERSION_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?(?:(Z)|([+-])(\d{2}):(\d{2}))?$/;
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const CANONICAL_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const COLLECTIONS = new Set([
  "Act",
  "LegislativeInstrument",
  "NotifiableInstrument",
]);
const BUNDLE_KEYS = new Set([
  "schema_version",
  "producer",
  "run",
  "baseline_title",
  "capture_result",
  "observation",
  "rights",
  "primary_response_base64",
]);
const BUNDLE_PRODUCER_KEYS = new Set(["name", "version"]);
const RUN_KEYS = new Set([
  "observed_at",
  "scope_id",
  "complete",
  "run_status",
  "baseline_sha256",
  "observation_sha256",
]);
const BASELINE_KEYS = new Set([
  "register_id",
  "name",
  "collection",
  "compilation_number",
  "compilation_date",
  "version_is_current",
  "current_version_start",
  "retrieved",
  "source_url",
  "register_page",
]);
const CAPTURE_KEYS = new Set([
  "register_id",
  "collection",
  "checked_at",
  "state",
  "error_category",
  "requests",
]);
const REQUEST_KEYS = new Set([
  "role",
  "url",
  "checked_at",
  "http_status",
  "transport_error_category",
  "attempt_count",
  "response_headers",
  "response_length",
  "response_sha256",
  "evidence_path",
]);
const HEADER_KEYS = new Set([
  "date",
  "content-type",
  "odata-version",
  "x-frl-version",
]);
const OBSERVATION_KEYS = new Set([
  "register_id",
  "collection",
  "state",
  "evidence_id",
  "observed_compilation_number",
  "observed_compilation_date",
  "observed_register_document_id",
  "current_version_start",
  "evidence_url",
  "checked_at",
  "error_category",
  "capture_result_sha256",
  "primary_response_sha256",
  "primary_response_media_type",
]);
const RIGHTS_KEYS = new Set(["mode", "attribution", "licence_url"]);
const ODATA_KEYS = new Set(["@odata.context", "value"]);
const ODATA_ROW_KEYS = new Set([
  "titleId",
  "start",
  "compilationNumber",
  "registerId",
  "isCurrent",
  "status",
  "registeredAt",
]);
const DEVELOPMENT_KEYS = new Set([
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
const REVISION_KEYS = new Set([
  "number",
  "updated_at",
  "change_note",
  "replaces_bundle_id",
]);
const UPSTREAM_KEYS = new Set([
  "bundle_id",
  "bundle_sha256",
  "generated_at",
  "producer",
]);
const CANONICAL_PRODUCER_KEYS = new Set([
  "name",
  "version",
  "baseline_sha256",
  "observation_facts_sha256",
]);

const ODATA_CONTEXT =
  "https://api.prod.legislation.gov.au/v1/$metadata#" +
  "Versions(titleId,start,compilationNumber,registerId,isCurrent,status,registeredAt)";
const REVISION_NOTE =
  "Initial source-only record from authenticated Federal Register compilation evidence.";
const LICENCE_URL = "https://creativecommons.org/licenses/by/4.0/";
const acceptedParses = new WeakSet();

function addError(errors, path, message) {
  errors.push({ path, message });
}

function equals(errors, value, expected, path) {
  if (value !== expected) addError(errors, path, `must equal ${String(expected)}`);
}

function object(errors, value, path, keys) {
  return exactKeys(errors, value, path, keys);
}

function boundedText(errors, value, path, maximum) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    !isXmlText(value) ||
    [...value].some(character => {
      const codePoint = character.codePointAt(0);
      return codePoint < 32 || codePoint === 127;
    })
  ) {
    addError(errors, path, `must be trimmed text of 1 to ${maximum} characters`);
    return null;
  }
  return value;
}

function daysInMonth(year, month) {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return new Set([4, 6, 9, 11]).has(month) ? 30 : 31;
}

function realDate(match) {
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return year >= 1 && month >= 1 && month <= 12 &&
    day >= 1 && day <= daysInMonth(year, month);
}

function matchEntire(pattern, value) {
  if (typeof value !== "string") return null;
  const match = pattern.exec(value);
  return match !== null && match[0] === value ? match : null;
}

function isoDate(errors, value, path) {
  const match = matchEntire(DATE, value);
  if (!realDate(match)) {
    addError(errors, path, "must be a real ISO calendar date");
    return null;
  }
  return value;
}

function validClock(match) {
  return Number(match[4]) <= 23 && Number(match[5]) <= 59 && Number(match[6]) <= 59;
}

function utcTimestamp(errors, value, path) {
  const match = matchEntire(UTC_TIMESTAMP, value);
  if (!realDate(match) || !validClock(match)) {
    addError(errors, path, "must be a real Stage 3A UTC timestamp");
    return null;
  }
  return value;
}

function utcKey(value) {
  const match = UTC_TIMESTAMP.exec(value);
  return `${value.slice(0, 19)}.${(match[7] ?? "").padEnd(6, "0")}Z`;
}

function versionTimestamp(errors, value, path) {
  const match = matchEntire(VERSION_TIMESTAMP, value);
  if (
    !realDate(match) ||
    !validClock(match) ||
    (match[9] !== undefined &&
      (Number(match[10]) > 23 || Number(match[11]) > 59))
  ) {
    addError(errors, path, "must be a real Register version timestamp");
    return null;
  }
  return { value, date: value.slice(0, 10) };
}

function sha256(errors, value, path) {
  if (matchEntire(SHA256, value) === null) {
    addError(errors, path, "must be a lowercase SHA-256 identifier");
    return null;
  }
  return value;
}

function registerId(errors, value, path) {
  if (matchEntire(REGISTER_ID, value) === null) {
    addError(errors, path, "must be a Federal Register identifier");
    return null;
  }
  return value;
}

function collection(errors, value, path) {
  if (!COLLECTIONS.has(value)) {
    addError(errors, path, "has an unsupported collection");
    return null;
  }
  return value;
}

function integer(errors, value, path, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    addError(errors, path, `must be an integer from ${minimum} to ${maximum}`);
    return null;
  }
  return value;
}

function semver(errors, value, path) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 100 ||
    !/^[\x00-\x7f]+$/.test(value) ||
    matchEntire(SEMVER, value) === null
  ) {
    addError(errors, path, "must be strict Semantic Version 2.0.0 text");
    return null;
  }
  return value;
}

function currentRequestUrl(register) {
  return "https://api.prod.legislation.gov.au/v1/versions?" +
    "%24top=1&%24filter=titleId%20eq%20%27" + register +
    "%27%20and%20isCurrent%20eq%20true&" +
    "%24select=titleId%2Cstart%2CcompilationNumber%2CregisterId%2C" +
    "isCurrent%2Cstatus%2CregisteredAt";
}

function rightsFor(checkedAt) {
  const captureDate = checkedAt.slice(0, 10);
  return {
    mode: "metadata-only",
    attribution:
      `Based on content from the Federal Register of Legislation at ${captureDate}. ` +
      "For the latest information on Australian Government legislation please go to " +
      "https://www.legislation.gov.au. Changes: selected and reformatted Federal " +
      "Register metadata into a bounded evidence bundle and factual source update; " +
      "no legislation text is reproduced.",
    licence_url: LICENCE_URL,
  };
}

function validateRights(errors, value, path, checkedAt) {
  if (!object(errors, value, path, RIGHTS_KEYS)) return null;
  boundedText(errors, value.attribution, `${path}.attribution`, 500);
  const expected = checkedAt === null ? null : rightsFor(checkedAt);
  if (expected !== null) {
    equals(errors, value.mode, expected.mode, `${path}.mode`);
    equals(errors, value.attribution, expected.attribution, `${path}.attribution`);
    equals(errors, value.licence_url, expected.licence_url, `${path}.licence_url`);
  }
  return expected;
}

function validateProducer(errors, value) {
  if (!object(errors, value, "producer", BUNDLE_PRODUCER_KEYS)) return null;
  equals(errors, value.name, "tax-radar-au", "producer.name");
  const version = semver(errors, value.version, "producer.version");
  return version === null ? null : { name: "tax-radar-au", version };
}

function validateRun(errors, value) {
  if (!object(errors, value, "run", RUN_KEYS)) return null;
  const observedAt = utcTimestamp(errors, value.observed_at, "run.observed_at");
  equals(errors, value.scope_id, "au-primary-tax-legislation.v4", "run.scope_id");
  equals(errors, value.complete, true, "run.complete");
  equals(errors, value.run_status, "VERIFIED", "run.run_status");
  const baselineSha256 = sha256(errors, value.baseline_sha256, "run.baseline_sha256");
  const observationSha256 = sha256(
    errors,
    value.observation_sha256,
    "run.observation_sha256",
  );
  return { observedAt, baselineSha256, observationSha256 };
}

function validateBaseline(errors, value) {
  if (!object(errors, value, "baseline_title", BASELINE_KEYS)) return null;
  const register = registerId(errors, value.register_id, "baseline_title.register_id");
  const title = boundedText(errors, value.name, "baseline_title.name", 500);
  const titleCollection = collection(
    errors,
    value.collection,
    "baseline_title.collection",
  );
  let compilationNumber = value.compilation_number;
  if (compilationNumber !== null) {
    compilationNumber = boundedText(
      errors,
      compilationNumber,
      "baseline_title.compilation_number",
      80,
    );
  }
  const compilationDate = isoDate(
    errors,
    value.compilation_date,
    "baseline_title.compilation_date",
  );
  if (typeof value.version_is_current !== "boolean") {
    addError(errors, "baseline_title.version_is_current", "must be a boolean");
  }
  let currentVersionStart = value.current_version_start;
  if (currentVersionStart !== null) {
    currentVersionStart = isoDate(
      errors,
      currentVersionStart,
      "baseline_title.current_version_start",
    );
  }
  if (value.version_is_current === false && currentVersionStart === null) {
    addError(
      errors,
      "baseline_title.current_version_start",
      "must identify the non-current version start",
    );
  }
  const retrieved = isoDate(errors, value.retrieved, "baseline_title.retrieved");
  if (register !== null && compilationDate !== null) {
    equals(
      errors,
      value.source_url,
      `https://www.legislation.gov.au/${register}/${compilationDate}/${compilationDate}/text/original/epub`,
      "baseline_title.source_url",
    );
    equals(
      errors,
      value.register_page,
      `https://www.legislation.gov.au/${register}/latest/text`,
      "baseline_title.register_page",
    );
  }
  return {
    register,
    title,
    collection: titleCollection,
    compilationNumber,
    compilationDate,
    retrieved,
    registerPage: value.register_page,
  };
}

function validateHeaders(errors, value, path) {
  if (!object(errors, value, path, HEADER_KEYS)) return null;
  for (const [name, headerValue] of Object.entries(value)) {
    boundedText(errors, headerValue, `${path}.${name}`, 2048);
  }
  const contentType = boundedText(
    errors,
    value["content-type"],
    `${path}.content-type`,
    2048,
  );
  if (
    contentType !== null &&
    contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json"
  ) {
    addError(errors, `${path}.content-type`, "must identify JSON metadata");
  }
  return value;
}

function validateRequest(errors, value, register, checkedAt) {
  const path = "capture_result.requests[0]";
  if (!object(errors, value, path, REQUEST_KEYS)) return null;
  equals(errors, value.role, "current", `${path}.role`);
  if (register !== null) {
    equals(errors, value.url, currentRequestUrl(register), `${path}.url`);
  }
  const requestCheckedAt = utcTimestamp(errors, value.checked_at, `${path}.checked_at`);
  if (checkedAt !== null && requestCheckedAt !== checkedAt) {
    addError(errors, `${path}.checked_at`, "must equal capture_result.checked_at");
  }
  equals(errors, value.http_status, 200, `${path}.http_status`);
  equals(
    errors,
    value.transport_error_category,
    null,
    `${path}.transport_error_category`,
  );
  integer(errors, value.attempt_count, `${path}.attempt_count`, 1, 3);
  const headers = validateHeaders(errors, value.response_headers, `${path}.response_headers`);
  const responseLength = integer(
    errors,
    value.response_length,
    `${path}.response_length`,
    1,
    MAXIMUM_RESPONSE_BYTES,
  );
  const responseSha256 = sha256(
    errors,
    value.response_sha256,
    `${path}.response_sha256`,
  );
  if (responseSha256 !== null) {
    equals(
      errors,
      value.evidence_path,
      `evidence/sha256-${responseSha256.slice("sha256:".length)}.json`,
      `${path}.evidence_path`,
    );
  }
  return { value, requestCheckedAt, headers, responseLength, responseSha256 };
}

function validateCapture(errors, value, baseline) {
  if (!object(errors, value, "capture_result", CAPTURE_KEYS)) return null;
  const register = registerId(errors, value.register_id, "capture_result.register_id");
  const resultCollection = collection(
    errors,
    value.collection,
    "capture_result.collection",
  );
  const checkedAt = utcTimestamp(errors, value.checked_at, "capture_result.checked_at");
  equals(errors, value.state, "SUPERSEDED", "capture_result.state");
  equals(errors, value.error_category, null, "capture_result.error_category");
  if (!Array.isArray(value.requests) || value.requests.length !== 1) {
    addError(errors, "capture_result.requests", "must contain exactly one request");
    return { register, collection: resultCollection, checkedAt, request: null };
  }
  if (baseline !== null) {
    if (register !== baseline.register) {
      addError(errors, "capture_result.register_id", "must equal the baseline identity");
    }
    if (resultCollection !== baseline.collection) {
      addError(errors, "capture_result.collection", "must equal the baseline collection");
    }
  }
  return {
    register,
    collection: resultCollection,
    checkedAt,
    request: validateRequest(errors, value.requests[0], register, checkedAt),
  };
}

function canonicalCaptureResult(value) {
  return {
    register_id: value.register_id,
    collection: value.collection,
    checked_at: value.checked_at,
    state: value.state,
    error_category: value.error_category,
    requests: value.requests.map(request => ({
      role: request.role,
      url: request.url,
      checked_at: request.checked_at,
      http_status: request.http_status,
      transport_error_category: request.transport_error_category,
      attempt_count: request.attempt_count,
      response_headers: Object.fromEntries(
        Object.keys(request.response_headers)
          .sort()
          .map(key => [key, request.response_headers[key]]),
      ),
      response_length: request.response_length,
      response_sha256: request.response_sha256,
      evidence_path: request.evidence_path,
    })),
  };
}

function validateObservation(errors, value, baseline, capture) {
  if (!object(errors, value, "observation", OBSERVATION_KEYS)) return null;
  const register = registerId(errors, value.register_id, "observation.register_id");
  const observedCollection = collection(
    errors,
    value.collection,
    "observation.collection",
  );
  equals(errors, value.state, "SUPERSEDED", "observation.state");
  const evidenceMatch = matchEntire(EVIDENCE_ID, value.evidence_id);
  if (evidenceMatch === null) {
    addError(
      errors,
      "observation.evidence_id",
      "must be a Stage 3A evidence identifier",
    );
  }
  const number = boundedText(
    errors,
    value.observed_compilation_number,
    "observation.observed_compilation_number",
    80,
  );
  const date = isoDate(
    errors,
    value.observed_compilation_date,
    "observation.observed_compilation_date",
  );
  const documentId = registerId(
    errors,
    value.observed_register_document_id,
    "observation.observed_register_document_id",
  );
  equals(errors, value.current_version_start, null, "observation.current_version_start");
  const checkedAt = utcTimestamp(errors, value.checked_at, "observation.checked_at");
  equals(errors, value.error_category, null, "observation.error_category");
  const captureSha256 = sha256(
    errors,
    value.capture_result_sha256,
    "observation.capture_result_sha256",
  );
  const primarySha256 = sha256(
    errors,
    value.primary_response_sha256,
    "observation.primary_response_sha256",
  );
  equals(
    errors,
    value.primary_response_media_type,
    "application/json",
    "observation.primary_response_media_type",
  );

  if (baseline !== null) {
    if (register !== baseline.register) {
      addError(errors, "observation.register_id", "must equal the baseline identity");
    }
    if (observedCollection !== baseline.collection) {
      addError(errors, "observation.collection", "must equal the baseline collection");
    }
    equals(
      errors,
      value.evidence_url,
      baseline.registerPage,
      "observation.evidence_url",
    );
  }
  if (capture !== null) {
    if (register !== capture.register) {
      addError(errors, "observation.register_id", "must equal the capture identity");
    }
    if (observedCollection !== capture.collection) {
      addError(errors, "observation.collection", "must equal the capture collection");
    }
    if (checkedAt !== capture.checkedAt) {
      addError(errors, "observation.checked_at", "must equal the capture timestamp");
    }
    if (capture.request?.responseSha256 !== primarySha256) {
      addError(
        errors,
        "observation.primary_response_sha256",
        "must equal the current response digest",
      );
    }
  }
  return {
    register,
    collection: observedCollection,
    evidenceId: value.evidence_id,
    number,
    date,
    documentId,
    checkedAt,
    captureSha256,
    primarySha256,
  };
}

function decodePrimaryResponse(errors, value, request, observation) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !CANONICAL_BASE64.test(value)
  ) {
    addError(errors, "primary_response_base64", "must be canonical RFC 4648 base64");
    return null;
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    addError(errors, "primary_response_base64", "must be canonical RFC 4648 base64");
    return null;
  }
  if (bytes.byteLength > MAXIMUM_RESPONSE_BYTES) {
    addError(errors, "primary_response_base64", "decoded response exceeds 256 KiB");
    return null;
  }
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (request !== null) {
    if (bytes.byteLength !== request.responseLength) {
      addError(
        errors,
        "capture_result.requests[0].response_length",
        "must equal the decoded response length",
      );
    }
    if (digest !== request.responseSha256) {
      addError(
        errors,
        "capture_result.requests[0].response_sha256",
        "must equal the decoded response digest",
      );
    }
  }
  if (observation !== null && digest !== observation.primarySha256) {
    addError(
      errors,
      "observation.primary_response_sha256",
      "must equal the decoded response digest",
    );
  }
  return { bytes, digest };
}

function parseRawResponse(errors, response, register) {
  if (response === null) return null;
  let document;
  try {
    if (
      response.bytes[0] === 0xef &&
      response.bytes[1] === 0xbb &&
      response.bytes[2] === 0xbf
    ) throw new TypeError("byte-order mark");
    document = parseStrictJsonBytes(response.bytes, {
      maximumBytes: MAXIMUM_RESPONSE_BYTES,
    });
  } catch {
    addError(errors, "primary_response_base64", "must decode to strict OData JSON");
    return null;
  }
  if (!object(errors, document, "primary_response", ODATA_KEYS)) return null;
  equals(errors, document["@odata.context"], ODATA_CONTEXT, "primary_response.@odata.context");
  if (!Array.isArray(document.value) || document.value.length !== 1) {
    addError(errors, "primary_response.value", "must contain exactly one row");
    return null;
  }
  const row = document.value[0];
  if (!object(errors, row, "primary_response.value[0]", ODATA_ROW_KEYS)) return null;
  if (register !== null) {
    equals(errors, row.titleId, register, "primary_response.value[0].titleId");
  } else {
    registerId(errors, row.titleId, "primary_response.value[0].titleId");
  }
  const start = versionTimestamp(errors, row.start, "primary_response.value[0].start");
  const number = boundedText(
    errors,
    row.compilationNumber,
    "primary_response.value[0].compilationNumber",
    80,
  );
  const documentId = registerId(
    errors,
    row.registerId,
    "primary_response.value[0].registerId",
  );
  equals(errors, row.isCurrent, true, "primary_response.value[0].isCurrent");
  equals(errors, row.status, "InForce", "primary_response.value[0].status");
  const registeredAt = versionTimestamp(
    errors,
    row.registeredAt,
    "primary_response.value[0].registeredAt",
  );
  return { start, number, documentId, registeredAt };
}

function captureDigest(value) {
  const bytes = Buffer.from(`${JSON.stringify(canonicalCaptureResult(value), null, 2)}\n`);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function validateLiveBundle(input) {
  const errors = [];
  if (!object(errors, input, "$", BUNDLE_KEYS)) return { errors, fact: null };
  equals(errors, input.schema_version, "evidence-bundle.v2", "schema_version");
  const producer = validateProducer(errors, input.producer);
  const run = validateRun(errors, input.run);
  const baseline = validateBaseline(errors, input.baseline_title);
  const capture = validateCapture(errors, input.capture_result, baseline);
  const observation = validateObservation(errors, input.observation, baseline, capture);
  const rights = validateRights(
    errors,
    input.rights,
    "rights",
    observation?.checkedAt ?? null,
  );
  const response = decodePrimaryResponse(
    errors,
    input.primary_response_base64,
    capture?.request ?? null,
    observation,
  );
  const row = parseRawResponse(errors, response, baseline?.register ?? null);

  if (capture?.request !== null && observation !== null) {
    let calculatedCaptureSha256 = null;
    try {
      calculatedCaptureSha256 = captureDigest(input.capture_result);
    } catch {
      addError(errors, "capture_result", "cannot be reconstructed canonically");
    }
    if (calculatedCaptureSha256 !== null) {
      if (observation.captureSha256 !== calculatedCaptureSha256) {
        addError(
          errors,
          "observation.capture_result_sha256",
          "must equal the reconstructed capture-result digest",
        );
      }
      const expectedEvidence = baseline?.register === null || baseline === null
        ? null
        : `frl:${baseline.register}:${calculatedCaptureSha256.slice(7, 39)}`;
      if (expectedEvidence !== null && observation.evidenceId !== expectedEvidence) {
        addError(
          errors,
          "observation.evidence_id",
          "must equal the reconstructed Stage 3A evidence identity",
        );
      }
    }
  }

  if (run?.observedAt != null && observation?.checkedAt != null &&
      utcKey(run.observedAt) > utcKey(observation.checkedAt)) {
    addError(errors, "run.observed_at", "must not postdate the observation check");
  }
  if (baseline?.retrieved != null && observation?.checkedAt != null &&
      baseline.retrieved > observation.checkedAt.slice(0, 10)) {
    addError(errors, "baseline_title.retrieved", "must not postdate the observation check");
  }

  if (row !== null && baseline !== null && observation !== null) {
    if (row.documentId === baseline.register) {
      addError(
        errors,
        "primary_response.value[0].registerId",
        "must differ from the baseline Register identifier",
      );
    }
    if (row.number === baseline.compilationNumber) {
      addError(
        errors,
        "primary_response.value[0].compilationNumber",
        "must differ from the baseline compilation number",
      );
    }
    if (row.start !== null && baseline.compilationDate !== null &&
        row.start.date <= baseline.compilationDate) {
      addError(
        errors,
        "primary_response.value[0].start",
        "must postdate the baseline compilation",
      );
    }
    if (row.number !== observation.number) {
      addError(
        errors,
        "observation.observed_compilation_number",
        "must equal the raw current compilation number",
      );
    }
    if (row.start?.date !== observation.date) {
      addError(
        errors,
        "observation.observed_compilation_date",
        "must equal the raw current compilation date",
      );
    }
    if (row.documentId !== observation.documentId) {
      addError(
        errors,
        "observation.observed_register_document_id",
        "must equal the raw current document identifier",
      );
    }
    if (
      row.registeredAt !== null &&
      observation.checkedAt !== null &&
      row.registeredAt.date > observation.checkedAt.slice(0, 10)
    ) {
      addError(
        errors,
        "primary_response.value[0].registeredAt",
        "registration date must not postdate the observation check",
      );
    }
  }

  if (
    errors.length > 0 ||
    producer === null ||
    run?.baselineSha256 === null ||
    run?.observationSha256 === null ||
    baseline?.register === null ||
    baseline.title === null ||
    baseline.collection === null ||
    baseline.compilationDate === null ||
    observation?.checkedAt === null ||
    observation.number === null ||
    observation.date === null ||
    observation.documentId === null ||
    observation.primarySha256 === null ||
    row?.registeredAt === null ||
    rights === null
  ) return { errors, fact: null };

  const identity = `${baseline.register.toLowerCase()}-${observation.documentId.toLowerCase()}`;
  return {
    errors,
    fact: {
      developmentId: `dev-frl-${identity}`,
      bundleId: `bundle-frl-${identity}-r1`,
      sourceId: `frl-${observation.documentId.toLowerCase()}`,
      title: baseline.title,
      collection: baseline.collection,
      registerId: baseline.register,
      previousCompilationNumber: baseline.compilationNumber,
      previousCompilationDate: baseline.compilationDate,
      currentCompilationNumber: observation.number,
      compilationDate: observation.date,
      registrationDate: row.registeredAt.date,
      currentDocumentId: observation.documentId,
      checkedAt: observation.checkedAt,
      publishedAt: `${row.registeredAt.date}T00:00:00Z`,
      primaryResponseSha256: observation.primarySha256,
      evidenceId: observation.evidenceId,
      observationSha256: run.observationSha256,
      producer: {
        name: producer.name,
        version: producer.version,
        baseline_sha256: run.baselineSha256,
        observation_facts_sha256: run.observationSha256,
      },
      rights,
    },
  };
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function invalidLiveEvidence(cause) {
  const error = new Error("live evidence bundle is invalid", { cause });
  error.name = "LiveEvidenceError";
  return error;
}

function hasByteOrderMark(bytes) {
  return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

export function parseLiveEvidenceBundle(bytes) {
  try {
    if (!(bytes instanceof Uint8Array) || hasByteOrderMark(bytes)) {
      throw new TypeError("invalid live evidence bytes");
    }
    const bundle = parseStrictJsonBytes(bytes);
    const { errors, fact } = validateLiveBundle(bundle);
    if (errors.length > 0 || fact === null) throw new TypeError("invalid contract");
    const bundleSha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const parsed = deepFreeze({
      bundle: deepFreeze(bundle),
      bundleSha256,
      releaseTag:
        `live-evidence-v2-${fact.observationSha256.slice("sha256:".length)}`,
      fact: deepFreeze(fact),
    });
    acceptedParses.add(parsed);
    return parsed;
  } catch (error) {
    if (error?.name === "LiveEvidenceError") throw error;
    throw invalidLiveEvidence(error);
  }
}

function canonicalRecord(parsed) {
  const { fact } = parsed;
  return {
    schema_version: "development.v2",
    development_id: fact.developmentId,
    mode: "live",
    title: fact.title,
    authority_status: "in-force",
    evidence_status: "verified",
    publication_status: "source-only",
    published_at: fact.publishedAt,
    effective_at: null,
    topics: [],
    affected_practice_areas: [],
    source_event: {
      kind: "compilation-superseded",
      register_id: fact.registerId,
      collection: fact.collection,
      previous_compilation: {
        number: fact.previousCompilationNumber,
        date: fact.previousCompilationDate,
      },
      current_compilation: {
        number: fact.currentCompilationNumber,
        date: fact.compilationDate,
        register_document_id: fact.currentDocumentId,
      },
    },
    sources: [
      {
        source_id: fact.sourceId,
        publisher: "Federal Register of Legislation",
        document_class: "legislation",
        title: fact.title,
        canonical_url:
          `https://www.legislation.gov.au/${fact.registerId}/latest/text`,
        published_at: fact.publishedAt,
        retrieved_at: fact.checkedAt,
        evidence_id: fact.evidenceId,
        content_sha256: fact.primaryResponseSha256,
        content_kind: "metadata-response",
        content_media_type: "application/json",
        rights: { ...fact.rights },
        evidence: [],
      },
    ],
    explainer: null,
    revision: {
      number: 1,
      updated_at: fact.checkedAt,
      change_note: REVISION_NOTE,
      replaces_bundle_id: null,
    },
    upstream: {
      bundle_id: fact.bundleId,
      bundle_sha256: parsed.bundleSha256,
      generated_at: fact.checkedAt,
      producer: { ...fact.producer },
    },
  };
}

export function transformLiveEvidenceBundle(parsed) {
  if (!acceptedParses.has(parsed)) throw invalidLiveEvidence();
  const record = canonicalRecord(parsed);
  if (!validateLiveDevelopmentV2(record).ok) throw invalidLiveEvidence();
  return record;
}

function validateLiveSourceEvent(errors, value) {
  if (!object(errors, value, "source_event", SOURCE_EVENT_KEYS)) return null;
  equals(errors, value.kind, "compilation-superseded", "source_event.kind");
  const register = registerId(errors, value.register_id, "source_event.register_id");
  const eventCollection = collection(errors, value.collection, "source_event.collection");

  const previous = value.previous_compilation;
  let previousNumber = null;
  let previousDate = null;
  if (object(
    errors,
    previous,
    "source_event.previous_compilation",
    PREVIOUS_COMPILATION_KEYS,
  )) {
    if (previous.number !== null) {
      previousNumber = boundedText(
        errors,
        previous.number,
        "source_event.previous_compilation.number",
        80,
      );
    }
    previousDate = isoDate(
      errors,
      previous.date,
      "source_event.previous_compilation.date",
    );
  }

  const current = value.current_compilation;
  let currentNumber = null;
  let currentDate = null;
  let documentId = null;
  if (object(
    errors,
    current,
    "source_event.current_compilation",
    CURRENT_COMPILATION_KEYS,
  )) {
    currentNumber = boundedText(
      errors,
      current.number,
      "source_event.current_compilation.number",
      80,
    );
    currentDate = isoDate(
      errors,
      current.date,
      "source_event.current_compilation.date",
    );
    documentId = registerId(
      errors,
      current.register_document_id,
      "source_event.current_compilation.register_document_id",
    );
  }
  if (previousNumber !== null && currentNumber === previousNumber) {
    addError(
      errors,
      "source_event.current_compilation.number",
      "must differ from the previous compilation",
    );
  }
  if (previousDate !== null && currentDate !== null && currentDate <= previousDate) {
    addError(
      errors,
      "source_event.current_compilation.date",
      "must postdate the previous compilation",
    );
  }
  if (register !== null && documentId === register) {
    addError(
      errors,
      "source_event.current_compilation.register_document_id",
      "must differ from the title Register identifier",
    );
  }
  return {
    register,
    collection: eventCollection,
    previousNumber,
    previousDate,
    currentNumber,
    currentDate,
    documentId,
  };
}

function validateCanonicalProducer(errors, value) {
  if (!object(errors, value, "upstream.producer", CANONICAL_PRODUCER_KEYS)) {
    return null;
  }
  equals(errors, value.name, "tax-radar-au", "upstream.producer.name");
  const version = semver(errors, value.version, "upstream.producer.version");
  const baselineSha256 = sha256(
    errors,
    value.baseline_sha256,
    "upstream.producer.baseline_sha256",
  );
  const observationSha256 = sha256(
    errors,
    value.observation_facts_sha256,
    "upstream.producer.observation_facts_sha256",
  );
  return { version, baselineSha256, observationSha256 };
}

export function validateLiveDevelopmentV2(input) {
  const errors = [];
  if (!object(errors, input, "$", DEVELOPMENT_KEYS)) return { ok: false, errors };
  equals(errors, input.schema_version, "development.v2", "schema_version");
  equals(errors, input.mode, "live", "mode");
  const title = boundedText(errors, input.title, "title", 500);
  equals(errors, input.authority_status, "in-force", "authority_status");
  equals(errors, input.evidence_status, "verified", "evidence_status");
  equals(errors, input.publication_status, "source-only", "publication_status");
  const publishedAt = utcTimestamp(errors, input.published_at, "published_at");
  const publishedDate = publishedAt !== null &&
      /^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(input.published_at)
    ? input.published_at.slice(0, 10)
    : null;
  if (publishedAt !== null && publishedDate === null) {
    addError(errors, "published_at", "must be an ISO date at midnight UTC");
  }
  equals(errors, input.effective_at, null, "effective_at");
  if (!Array.isArray(input.topics) || input.topics.length !== 0) {
    addError(errors, "topics", "must be an empty array");
  }
  if (
    !Array.isArray(input.affected_practice_areas) ||
    input.affected_practice_areas.length !== 0
  ) addError(errors, "affected_practice_areas", "must be an empty array");
  equals(errors, input.explainer, null, "explainer");

  const event = validateLiveSourceEvent(errors, input.source_event);
  let source = null;
  let retrievedAt = null;
  if (!Array.isArray(input.sources) || input.sources.length !== 1) {
    addError(errors, "sources", "must contain exactly one source");
  } else if (object(errors, input.sources[0], "sources[0]", SOURCE_KEYS)) {
    source = input.sources[0];
    boundedText(errors, source.source_id, "sources[0].source_id", 80);
    equals(
      errors,
      source.publisher,
      "Federal Register of Legislation",
      "sources[0].publisher",
    );
    equals(errors, source.document_class, "legislation", "sources[0].document_class");
    boundedText(errors, source.title, "sources[0].title", 500);
    const sourcePublishedAt = utcTimestamp(
      errors,
      source.published_at,
      "sources[0].published_at",
    );
    retrievedAt = utcTimestamp(errors, source.retrieved_at, "sources[0].retrieved_at");
    const evidenceMatch = matchEntire(EVIDENCE_ID, source.evidence_id);
    if (evidenceMatch === null) {
      addError(errors, "sources[0].evidence_id", "must be a Stage 3A evidence identifier");
    }
    sha256(errors, source.content_sha256, "sources[0].content_sha256");
    equals(errors, source.content_kind, "metadata-response", "sources[0].content_kind");
    equals(
      errors,
      source.content_media_type,
      "application/json",
      "sources[0].content_media_type",
    );
    validateRights(
      errors,
      source.rights,
      "sources[0].rights",
      retrievedAt === null ? null : source.retrieved_at,
    );
    if (!Array.isArray(source.evidence) || source.evidence.length !== 0) {
      addError(errors, "sources[0].evidence", "must be an empty array");
    }
    if (title !== null && source.title !== title) {
      addError(errors, "sources[0].title", "must equal the development title");
    }
    if (publishedAt !== null && sourcePublishedAt !== publishedAt) {
      addError(errors, "sources[0].published_at", "must equal development publication");
    }
    if (event?.register != null) {
      equals(
        errors,
        source.canonical_url,
        `https://www.legislation.gov.au/${event.register}/latest/text`,
        "sources[0].canonical_url",
      );
      if (evidenceMatch !== null && evidenceMatch[1] !== event.register) {
        addError(errors, "sources[0].evidence_id", "must identify the same Register title");
      }
    }
    if (event?.documentId != null) {
      equals(
        errors,
        source.source_id,
        `frl-${event.documentId.toLowerCase()}`,
        "sources[0].source_id",
      );
    }
  }

  let revisionUpdatedAt = null;
  if (object(errors, input.revision, "revision", REVISION_KEYS)) {
    equals(errors, input.revision.number, 1, "revision.number");
    revisionUpdatedAt = utcTimestamp(
      errors,
      input.revision.updated_at,
      "revision.updated_at",
    );
    equals(errors, input.revision.change_note, REVISION_NOTE, "revision.change_note");
    equals(errors, input.revision.replaces_bundle_id, null, "revision.replaces_bundle_id");
  }

  let generatedAt = null;
  if (object(errors, input.upstream, "upstream", UPSTREAM_KEYS)) {
    sha256(errors, input.upstream.bundle_sha256, "upstream.bundle_sha256");
    generatedAt = utcTimestamp(
      errors,
      input.upstream.generated_at,
      "upstream.generated_at",
    );
    validateCanonicalProducer(errors, input.upstream.producer);
    if (event?.register != null && event?.documentId != null) {
      const identity = `${event.register.toLowerCase()}-${event.documentId.toLowerCase()}`;
      equals(errors, input.development_id, `dev-frl-${identity}`, "development_id");
      equals(
        errors,
        input.upstream.bundle_id,
        `bundle-frl-${identity}-r1`,
        "upstream.bundle_id",
      );
    }
  }

  if (retrievedAt !== null && publishedDate !== null &&
      publishedDate > source.retrieved_at.slice(0, 10)) {
    addError(errors, "published_at", "must not postdate source retrieval");
  }
  if (retrievedAt !== null && revisionUpdatedAt !== retrievedAt) {
    addError(errors, "revision.updated_at", "must equal source retrieval");
  }
  if (retrievedAt !== null && generatedAt !== retrievedAt) {
    addError(errors, "upstream.generated_at", "must equal source retrieval");
  }

  return errors.length === 0 ? { ok: true, value: input } : { ok: false, errors };
}
