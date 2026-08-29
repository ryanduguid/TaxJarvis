// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseLiveEvidenceBundle,
  transformLiveEvidenceBundle,
  validateLiveDevelopmentV2,
} from "../live-evidence.mjs";

const FIXTURE = new URL("./fixtures/evidence-bundle.v2.json", import.meta.url);
const goldenBytes = await readFile(FIXTURE);
const golden = JSON.parse(goldenBytes);
const RIGHTS = {
  mode: "metadata-only",
  attribution:
    "Based on content from the Federal Register of Legislation at 2026-08-28. " +
    "For the latest information on Australian Government legislation please go to " +
    "https://www.legislation.gov.au. Changes: selected and reformatted Federal " +
    "Register metadata into a bounded evidence bundle and factual source update; " +
    "no legislation text is reproduced.",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
};

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function encode(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
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

function refreshCaptureProof(value) {
  const digest = sha256(encode(canonicalCaptureResult(value.capture_result)));
  value.observation.capture_result_sha256 = digest;
  value.observation.evidence_id =
    `frl:${value.observation.register_id}:${digest.slice("sha256:".length, 39)}`;
}

function withResponseBytes(bytes) {
  const value = structuredClone(golden);
  const digest = sha256(bytes);
  const request = value.capture_result.requests[0];
  value.primary_response_base64 = bytes.toString("base64");
  request.response_length = bytes.byteLength;
  request.response_sha256 = digest;
  request.evidence_path = `evidence/sha256-${digest.slice("sha256:".length)}.json`;
  value.observation.primary_response_sha256 = digest;
  refreshCaptureProof(value);
  return value;
}

function withRaw(mutator) {
  const raw = JSON.parse(
    Buffer.from(golden.primary_response_base64, "base64").toString("utf8"),
  );
  mutator(raw);
  return withResponseBytes(Buffer.from(JSON.stringify(raw)));
}

function rejectMutation(mutator) {
  const value = structuredClone(golden);
  mutator(value);
  assert.throws(() => parseLiveEvidenceBundle(encode(value)));
}

test("golden live evidence proves the bounded compilation fact", () => {
  const parsed = parseLiveEvidenceBundle(goldenBytes);

  assert.deepEqual(Object.keys(parsed), [
    "bundle",
    "bundleSha256",
    "releaseTag",
    "fact",
  ]);
  assert.equal(
    parsed.bundleSha256,
    "sha256:b1f0b76202c056f46c9eb6633ccfbea13f8487e0cadf7ddca001dc8acb07b5a1",
  );
  assert.equal(
    parsed.releaseTag,
    "live-evidence-v2-8ea331ff6670fe1f2221146f33f74cfd6c210b3d9c7eca48da2c592fe5d8764f",
  );
  assert.deepEqual(parsed.fact, {
    developmentId: "dev-frl-f2022l00347-f2026c00838",
    bundleId: "bundle-frl-f2022l00347-f2026c00838-r1",
    sourceId: "frl-f2026c00838",
    title: "Taxation Administration Regulations 2017",
    collection: "LegislativeInstrument",
    registerId: "F2022L00347",
    previousCompilationNumber: "19",
    previousCompilationDate: "2026-08-05",
    currentCompilationNumber: "20",
    compilationDate: "2026-08-18",
    registrationDate: "2026-08-27",
    currentDocumentId: "F2026C00838",
    checkedAt: "2026-08-28T00:00:00Z",
    publishedAt: "2026-08-27T00:00:00Z",
    primaryResponseSha256:
      "sha256:88cc753d44dc01fa2518c6ed8c881c9079952a51f9f3818f710320e03293ee42",
    evidenceId: "frl:F2022L00347:ca7ec3fe087142c637fb34529fd64eaf",
    observationSha256:
      "sha256:8ea331ff6670fe1f2221146f33f74cfd6c210b3d9c7eca48da2c592fe5d8764f",
    producer: {
      name: "tax-radar-au",
      version: "0.1.3",
      baseline_sha256:
        "sha256:a9d403d633f3dc9ecf8447fadb794c687bdb481a4776c493798a58a160eaa997",
      observation_facts_sha256:
        "sha256:8ea331ff6670fe1f2221146f33f74cfd6c210b3d9c7eca48da2c592fe5d8764f",
    },
    rights: RIGHTS,
  });
});

test("live evidence transforms directly to the canonical development", () => {
  const parsed = parseLiveEvidenceBundle(goldenBytes);
  const record = transformLiveEvidenceBundle(parsed);

  assert.deepEqual(record, {
    schema_version: "development.v2",
    development_id: "dev-frl-f2022l00347-f2026c00838",
    mode: "live",
    title: "Taxation Administration Regulations 2017",
    authority_status: "in-force",
    evidence_status: "verified",
    publication_status: "source-only",
    published_at: "2026-08-27T00:00:00Z",
    effective_at: null,
    topics: [],
    affected_practice_areas: [],
    source_event: {
      kind: "compilation-superseded",
      register_id: "F2022L00347",
      collection: "LegislativeInstrument",
      previous_compilation: { number: "19", date: "2026-08-05" },
      current_compilation: {
        number: "20",
        date: "2026-08-18",
        register_document_id: "F2026C00838",
      },
    },
    sources: [
      {
        source_id: "frl-f2026c00838",
        publisher: "Federal Register of Legislation",
        document_class: "legislation",
        title: "Taxation Administration Regulations 2017",
        canonical_url:
          "https://www.legislation.gov.au/F2022L00347/latest/text",
        published_at: "2026-08-27T00:00:00Z",
        retrieved_at: "2026-08-28T00:00:00Z",
        evidence_id: "frl:F2022L00347:ca7ec3fe087142c637fb34529fd64eaf",
        content_sha256:
          "sha256:88cc753d44dc01fa2518c6ed8c881c9079952a51f9f3818f710320e03293ee42",
        content_kind: "metadata-response",
        content_media_type: "application/json",
        rights: RIGHTS,
        evidence: [],
      },
    ],
    explainer: null,
    revision: {
      number: 1,
      updated_at: "2026-08-28T00:00:00Z",
      change_note:
        "Initial source-only record from authenticated Federal Register compilation evidence.",
      replaces_bundle_id: null,
    },
    upstream: {
      bundle_id: "bundle-frl-f2022l00347-f2026c00838-r1",
      bundle_sha256:
        "sha256:b1f0b76202c056f46c9eb6633ccfbea13f8487e0cadf7ddca001dc8acb07b5a1",
      generated_at: "2026-08-28T00:00:00Z",
      producer: {
        name: "tax-radar-au",
        version: "0.1.3",
        baseline_sha256:
          "sha256:a9d403d633f3dc9ecf8447fadb794c687bdb481a4776c493798a58a160eaa997",
        observation_facts_sha256:
          "sha256:8ea331ff6670fe1f2221146f33f74cfd6c210b3d9c7eca48da2c592fe5d8764f",
      },
    },
  });
  assert.deepEqual(validateLiveDevelopmentV2(record), { ok: true, value: record });
  assert.throws(() => transformLiveEvidenceBundle({}));
  assert.throws(() => transformLiveEvidenceBundle(structuredClone(parsed)));
  assert.throws(() => { parsed.fact.title = "post-parse mutation"; });

  record.sources[0].rights.attribution = "mutated output";
  record.upstream.producer.name = "mutated output";
  const fresh = transformLiveEvidenceBundle(parsed);
  assert.deepEqual(fresh.sources[0].rights, RIGHTS);
  assert.equal(fresh.upstream.producer.name, "tax-radar-au");
});

test("every live bundle object layer rejects unknown members", () => {
  const paths = [
    value => { value.extra = true; },
    value => { value.producer.extra = true; },
    value => { value.run.extra = true; },
    value => { value.baseline_title.extra = true; },
    value => { value.capture_result.extra = true; },
    value => { value.capture_result.requests[0].extra = true; },
    value => { value.capture_result.requests[0].response_headers.extra = "x"; },
    value => { value.observation.extra = true; },
    value => { value.rights.extra = true; },
  ];
  for (const mutate of paths) rejectMutation(mutate);

  const rawTop = withRaw(raw => { raw.extra = true; });
  assert.throws(() => parseLiveEvidenceBundle(encode(rawTop)));
  const rawRow = withRaw(raw => { raw.value[0].extra = true; });
  assert.throws(() => parseLiveEvidenceBundle(encode(rawRow)));
});

test("strict JSON rejects malformed bytes, byte-order marks and duplicate members", () => {
  assert.throws(() => parseLiveEvidenceBundle(Buffer.from([0xff])));
  assert.throws(() => parseLiveEvidenceBundle(Buffer.from("{")));
  assert.throws(() => parseLiveEvidenceBundle(Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    goldenBytes,
  ])));
  assert.throws(() => parseLiveEvidenceBundle(Buffer.from(
    goldenBytes.toString("utf8").replace(
      '  "schema_version": "evidence-bundle.v2",',
      '  "schema_version": "evidence-bundle.v2",\n  "schema_version": "evidence-bundle.v2",',
    ),
  )));

  const duplicateRaw = Buffer.from(
    Buffer.from(golden.primary_response_base64, "base64")
      .toString("utf8")
      .replace('"titleId":"F2022L00347",', '"titleId":"F2022L00347","titleId":"F2022L00347",'),
  );
  const value = structuredClone(golden);
  const digest = sha256(duplicateRaw);
  const request = value.capture_result.requests[0];
  value.primary_response_base64 = duplicateRaw.toString("base64");
  request.response_length = duplicateRaw.byteLength;
  request.response_sha256 = digest;
  request.evidence_path = `evidence/sha256-${digest.slice(7)}.json`;
  value.observation.primary_response_sha256 = digest;
  refreshCaptureProof(value);
  assert.throws(() => parseLiveEvidenceBundle(encode(value)));
});

test("producer receipt requires exact identity, SemVer and verified run values", () => {
  for (const version of [
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "1.2",
    "1.2.3-01",
    "1.2.3+",
    "1.2.3_foo",
    "1.2.3\n",
    "v1.2.3",
    "é.2.3",
  ]) rejectMutation(value => { value.producer.version = version; });

  const valid = structuredClone(golden);
  valid.producer.version = "1.2.3-alpha.1+build.5";
  assert.equal(parseLiveEvidenceBundle(encode(valid)).fact.producer.version, valid.producer.version);

  const cases = [
    value => { value.producer.name = "other"; },
    value => { value.run.scope_id = "other"; },
    value => { value.run.complete = false; },
    value => { value.run.run_status = "BLOCKED"; },
    value => { value.run.baseline_sha256 = `sha256:${"A".repeat(64)}`; },
    value => { value.run.baseline_sha256 += "\n"; },
    value => { value.run.observation_sha256 = "0".repeat(64); },
  ];
  for (const mutate of cases) rejectMutation(mutate);
});

test("baseline, capture and observation identities and official URLs must agree", () => {
  const cases = [
    value => { value.baseline_title.register_id = "../unsafe"; },
    value => { value.baseline_title.register_id += "\n"; },
    value => { value.baseline_title.collection = "Regulation"; },
    value => { value.baseline_title.source_url += "?changed=1"; },
    value => { value.baseline_title.register_page += "/"; },
    value => { value.capture_result.register_id = "F2022L00348"; },
    value => { value.capture_result.collection = "Act"; },
    value => { value.capture_result.checked_at = "2026-08-28T00:00:01Z"; },
    value => { value.capture_result.state = "UNCHANGED"; },
    value => { value.capture_result.error_category = "INVALID_JSON"; },
    value => { value.observation.register_id = "F2022L00348"; },
    value => { value.observation.collection = "Act"; },
    value => { value.observation.state = "UNCHANGED"; },
    value => { value.observation.evidence_url += "?changed=1"; },
    value => { value.observation.checked_at = "2026-08-28T00:00:01Z"; },
    value => { value.observation.error_category = "INVALID_JSON"; },
    value => { value.observation.current_version_start = "2026-08-18"; },
  ];
  for (const mutate of cases) rejectMutation(mutate);
});

test("current request metadata and capture-result proof are recomputed", () => {
  const cases = [
    value => { value.capture_result.requests = []; },
    value => { value.capture_result.requests[0].role = "history"; },
    value => { value.capture_result.requests[0].url += "&changed=true"; },
    value => { value.capture_result.requests[0].checked_at = "2026-08-28T00:00:01Z"; },
    value => { value.capture_result.requests[0].http_status = 201; },
    value => { value.capture_result.requests[0].transport_error_category = "TRANSPORT_ERROR"; },
    value => { value.capture_result.requests[0].attempt_count = 0; },
    value => { value.capture_result.requests[0].attempt_count = 4; },
    value => { value.capture_result.requests[0].response_headers["content-type"] = "text/html"; },
    value => { value.capture_result.requests[0].response_length += 1; },
    value => { value.capture_result.requests[0].response_sha256 = `sha256:${"0".repeat(64)}`; },
    value => { value.capture_result.requests[0].evidence_path = "evidence/other.json"; },
    value => { value.observation.capture_result_sha256 = `sha256:${"0".repeat(64)}`; },
    value => { value.observation.evidence_id = "frl:F2022L00347:00000000000000000000000000000000"; },
    value => { value.observation.primary_response_sha256 = `sha256:${"0".repeat(64)}`; },
    value => { value.observation.primary_response_media_type = "text/html"; },
  ];
  for (const mutate of cases) rejectMutation(mutate);
});

test("primary response base64, bytes, digest, length and path must be canonical", () => {
  rejectMutation(value => { value.primary_response_base64 += "\n"; });
  rejectMutation(value => { value.primary_response_base64 = value.primary_response_base64.slice(0, -1); });
  rejectMutation(value => { value.primary_response_base64 = "-w=="; });

  const originalRaw = Buffer.from(golden.primary_response_base64, "base64");
  const padded = withResponseBytes(Buffer.concat([originalRaw, Buffer.from(" ")]));
  assert.match(padded.primary_response_base64, /==$/);
  assert.equal(parseLiveEvidenceBundle(encode(padded)).fact.registerId, "F2022L00347");
  assert.throws(() => parseLiveEvidenceBundle(encode(withResponseBytes(
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), originalRaw]),
  ))));
  assert.throws(() => parseLiveEvidenceBundle(encode(withResponseBytes(Buffer.from([0xff])))));

  const raw = Buffer.alloc(256 * 1024 + 1, 0x20);
  assert.throws(() => parseLiveEvidenceBundle(encode(withResponseBytes(raw))));
});

test("outer and decoded response byte limits are exact", () => {
  const outerAtLimit = Buffer.concat([
    goldenBytes,
    Buffer.alloc(1024 * 1024 - goldenBytes.byteLength, 0x20),
  ]);
  assert.equal(outerAtLimit.byteLength, 1024 * 1024);
  assert.equal(parseLiveEvidenceBundle(outerAtLimit).bundleSha256, sha256(outerAtLimit));
  assert.throws(() => parseLiveEvidenceBundle(Buffer.concat([
    outerAtLimit,
    Buffer.from(" "),
  ])));

  const originalRaw = Buffer.from(golden.primary_response_base64, "base64");
  const responseAtLimit = Buffer.concat([
    originalRaw,
    Buffer.alloc(256 * 1024 - originalRaw.byteLength, 0x20),
  ]);
  assert.equal(responseAtLimit.byteLength, 256 * 1024);
  assert.equal(
    parseLiveEvidenceBundle(encode(withResponseBytes(responseAtLimit))).fact.registerId,
    "F2022L00347",
  );
});

test("capture-result recomputation ignores input member order", () => {
  const value = structuredClone(golden);
  const request = value.capture_result.requests[0];
  request.response_headers = {
    "odata-version": request.response_headers["odata-version"],
    "content-type": request.response_headers["content-type"],
  };
  value.capture_result.requests[0] = {
    evidence_path: request.evidence_path,
    response_sha256: request.response_sha256,
    response_length: request.response_length,
    response_headers: request.response_headers,
    attempt_count: request.attempt_count,
    transport_error_category: request.transport_error_category,
    http_status: request.http_status,
    checked_at: request.checked_at,
    url: request.url,
    role: request.role,
  };
  value.capture_result = {
    requests: value.capture_result.requests,
    error_category: value.capture_result.error_category,
    state: value.capture_result.state,
    checked_at: value.capture_result.checked_at,
    collection: value.capture_result.collection,
    register_id: value.capture_result.register_id,
  };
  assert.equal(parseLiveEvidenceBundle(encode(value)).fact.evidenceId, golden.observation.evidence_id);
});

test("raw OData must prove one current in-force newer compilation", () => {
  const cases = [
    raw => { raw["@odata.context"] += "#changed"; },
    raw => { raw.value = []; },
    raw => { raw.value.push(structuredClone(raw.value[0])); },
    raw => { raw.value[0].titleId = "F2022L00348"; },
    raw => { raw.value[0].isCurrent = false; },
    raw => { raw.value[0].status = "Ceased"; },
    raw => { raw.value[0].registerId = null; },
    raw => { raw.value[0].registerId = "F2022L00347"; },
    raw => { raw.value[0].compilationNumber = "19"; },
    raw => { raw.value[0].compilationNumber = null; },
    raw => { raw.value[0].start = "2026-08-05T00:00:00"; },
    raw => { raw.value[0].start = "2026-02-30T00:00:00"; },
  ];
  for (const mutate of cases) {
    assert.throws(() => parseLiveEvidenceBundle(encode(withRaw(mutate))));
  }
});

test("raw facts must equal every observation declaration", () => {
  const cases = [
    value => { value.observation.observed_compilation_number = "21"; },
    value => { value.observation.observed_compilation_date = "2026-08-19"; },
    value => { value.observation.observed_register_document_id = "F2026C00839"; },
  ];
  for (const mutate of cases) rejectMutation(mutate);
});

test("registration remains lexically distinct from compilation and check dates", () => {
  const numericOffset = withRaw(raw => {
    raw.value[0].registeredAt = "2026-08-27T23:31:41.1234567-08:00";
  });
  const parsedOffset = parseLiveEvidenceBundle(encode(numericOffset));
  assert.equal(parsedOffset.fact.compilationDate, "2026-08-18");
  assert.equal(parsedOffset.fact.registrationDate, "2026-08-27");
  assert.equal(parsedOffset.fact.publishedAt, "2026-08-27T00:00:00Z");
  assert.equal(parsedOffset.fact.checkedAt, "2026-08-28T00:00:00Z");

  const offsetless = withRaw(raw => {
    raw.value[0].registeredAt = "2026-08-27T17:31:41.1234567";
  });
  assert.equal(
    parseLiveEvidenceBundle(encode(offsetless)).fact.registrationDate,
    "2026-08-27",
  );

  for (const registeredAt of [
    null,
    "2026-02-30T17:31:41Z",
    "2026-08-27T24:00:00Z",
    "2026-08-27T17:31:41.12345678Z",
    "2026-08-27T17:31:41+24:00",
    "2026-08-27T17:31:41Z\n",
    "2026-08-29T00:00:00+10:00",
  ]) {
    const value = withRaw(raw => { raw.value[0].registeredAt = registeredAt; });
    assert.throws(() => parseLiveEvidenceBundle(encode(value)));
  }
});

test("nullable previous compilation and 500-character live titles are supported", () => {
  const value = structuredClone(golden);
  value.baseline_title.compilation_number = null;
  value.baseline_title.name = "A".repeat(500);
  const parsed = parseLiveEvidenceBundle(encode(value));
  assert.equal(parsed.fact.previousCompilationNumber, null);
  assert.equal(parsed.fact.title.length, 500);
  const record = transformLiveEvidenceBundle(parsed);
  assert.equal(record.source_event.previous_compilation.number, null);
  assert.equal(validateLiveDevelopmentV2(record).ok, true);

  rejectMutation(candidate => { candidate.baseline_title.name = "A".repeat(501); });
  rejectMutation(candidate => { candidate.baseline_title.name = "Invalid\ufffftitle"; });
  rejectMutation(candidate => { candidate.baseline_title.compilation_number = " "; });
});

test("rights are reconstructed from the observation date and carried through exactly", () => {
  const cases = [
    value => { value.rights.mode = "quotation"; },
    value => { value.rights.attribution = "Federal Register of Legislation"; },
    value => { value.rights.attribution = value.rights.attribution.replace("2026-08-28", "2026-08-27"); },
    value => { value.rights.licence_url = "https://example.com/licence"; },
  ];
  for (const mutate of cases) rejectMutation(mutate);

  const record = transformLiveEvidenceBundle(parseLiveEvidenceBundle(goldenBytes));
  assert.deepEqual(record.sources[0].rights, RIGHTS);
  assert.match(record.sources[0].evidence_id, /^frl:F2022L00347:[0-9a-f]{32}$/);
});

test("live canonical validation rejects unknown members at every object layer", () => {
  const original = transformLiveEvidenceBundle(parseLiveEvidenceBundle(goldenBytes));
  const cases = [
    value => { value.extra = true; },
    value => { value.source_event.extra = true; },
    value => { value.source_event.previous_compilation.extra = true; },
    value => { value.source_event.current_compilation.extra = true; },
    value => { value.sources[0].extra = true; },
    value => { value.sources[0].rights.extra = true; },
    value => { value.revision.extra = true; },
    value => { value.upstream.extra = true; },
    value => { value.upstream.producer.extra = true; },
  ];
  for (const mutate of cases) {
    const value = structuredClone(original);
    mutate(value);
    assert.equal(validateLiveDevelopmentV2(value).ok, false);
  }
});

test("live canonical validation enforces cross-field identity and chronology", () => {
  const original = transformLiveEvidenceBundle(parseLiveEvidenceBundle(goldenBytes));
  const cases = [
    value => { value.schema_version = "development.v3"; },
    value => { value.mode = "synthetic"; },
    value => { value.development_id = "dev-other"; },
    value => { value.title = "Other"; },
    value => { value.published_at = "2026-08-29T00:00:00Z"; },
    value => { value.topics = ["GST"]; },
    value => { value.source_event.previous_compilation.number = "20"; },
    value => { value.source_event.current_compilation.date = "2026-08-05"; },
    value => { value.sources[0].source_id = "frl-other"; },
    value => { value.sources[0].canonical_url += "?changed=1"; },
    value => { value.sources[0].published_at = "2026-08-26T00:00:00Z"; },
    value => { value.sources[0].retrieved_at = "2026-08-27T00:00:00Z"; },
    value => { value.sources[0].evidence_id = "frl-f2022l00347-deadbeef"; },
    value => { value.sources[0].rights.attribution = "A".repeat(500); },
    value => { value.sources[0].evidence = ["extract"]; },
    value => { value.explainer = {}; },
    value => { value.revision.updated_at = "2026-08-27T00:00:00Z"; },
    value => { value.revision.change_note = "Changed"; },
    value => { value.upstream.bundle_id = "bundle-other"; },
    value => { value.upstream.generated_at = "2026-08-27T00:00:00Z"; },
    value => { value.upstream.producer.observation_facts_sha256 = "invalid"; },
  ];
  for (const mutate of cases) {
    const value = structuredClone(original);
    mutate(value);
    assert.equal(validateLiveDevelopmentV2(value).ok, false);
  }
});
