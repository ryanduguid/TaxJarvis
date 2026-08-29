// SPDX-License-Identifier: AGPL-3.0-only
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { platform } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  parseLiveEvidenceBundle,
  transformLiveEvidenceBundle,
  validateLiveDevelopmentV2,
} from "./live-evidence.mjs";
import { parseStrictJsonBytes } from "./strict-json.mjs";

const MAXIMUM_BUNDLE_BYTES = 1_048_576;
const WORK_PREFIX = ".live-import-";
const SNAPSHOT_NAME = "evidence-bundle.v2.json";
const RECORD_DIRECTORY = "record";
const TOP_LEVEL_KEYS = new Set([
  "schema_version",
  "producer",
  "run",
  "baseline_title",
  "capture_result",
  "observation",
  "rights",
  "primary_response_base64",
]);
const RUN_KEYS = new Set([
  "observed_at",
  "scope_id",
  "complete",
  "run_status",
  "baseline_sha256",
  "observation_sha256",
]);
const OBSERVATION_SHA256 = /^sha256:[0-9a-f]{64}$/;
const EXPECTED_RACE_CODES = new Set(["EACCES", "EEXIST", "ENOTEMPTY", "EPERM"]);
const OPERATION_NAMES = new Set([
  "platform",
  "lstat",
  "mkdir",
  "mkdtemp",
  "readFile",
  "readdir",
  "realpath",
  "rename",
  "rm",
  "unlink",
  "writeFile",
]);

const DEFAULT_OPERATIONS = Object.freeze({
  platform,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
});

class LiveImportError extends Error {
  constructor(message) {
    super(message);
    this.name = "LiveImportError";
  }
}

function fail(message) {
  throw new LiveImportError(message);
}

function exactKeys(value, expected) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every(key => expected.has(key));
}

function ordinaryDirectory(details) {
  try {
    return details.isDirectory() && !details.isSymbolicLink();
  } catch {
    return false;
  }
}

function ordinaryFile(details) {
  try {
    return details.isFile() && !details.isSymbolicLink();
  } catch {
    return false;
  }
}

function selectedOperations(overrides) {
  if (overrides === undefined) return DEFAULT_OPERATIONS;
  if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) {
    fail("live import request is invalid");
  }
  let entries;
  try {
    entries = Object.entries(overrides);
  } catch {
    fail("live import request is invalid");
  }
  for (const [name, operation] of entries) {
    if (!OPERATION_NAMES.has(name) || typeof operation !== "function") {
      fail("live import request is invalid");
    }
  }
  return Object.freeze({ ...DEFAULT_OPERATIONS, ...Object.fromEntries(entries) });
}

function readRequest(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    fail("live import request is invalid");
  }
  try {
    const operations = selectedOperations(input.operations);
    if (
      typeof input.bundlePath !== "string" ||
      input.bundlePath.length === 0 ||
      input.bundlePath.includes("\0") ||
      typeof input.repositoryRoot !== "string" ||
      input.repositoryRoot.length === 0 ||
      input.repositoryRoot.includes("\0") ||
      typeof input.verifyProvenance !== "function"
    ) {
      fail("live import request is invalid");
    }
    return {
      bundlePath: input.bundlePath,
      repositoryRoot: input.repositoryRoot,
      operations,
      verifyProvenance: input.verifyProvenance,
    };
  } catch (error) {
    if (error instanceof LiveImportError) throw error;
    fail("live import request is invalid");
  }
}

async function requireCanonicalDirectory(operations, path, message) {
  try {
    const details = await operations.lstat(path);
    const canonical = await operations.realpath(path);
    if (
      !ordinaryDirectory(details) ||
      typeof canonical !== "string" ||
      resolve(canonical) !== path
    ) fail(message);
  } catch {
    fail(message);
  }
}

async function requireCanonicalInput(operations, path) {
  const message = "bundle input must be a canonical ordinary file";
  let size;
  try {
    const details = await operations.lstat(path);
    const canonical = await operations.realpath(path);
    size = details.size;
    if (
      !ordinaryFile(details) ||
      typeof canonical !== "string" ||
      resolve(canonical) !== path ||
      !Number.isSafeInteger(size) ||
      size < 0
    ) fail(message);
  } catch {
    fail(message);
  }
  if (size > MAXIMUM_BUNDLE_BYTES) {
    fail("bundle input must be no more than 1048576 bytes");
  }
}

function pathIsWithin(path, parent) {
  const difference = relative(parent, path);
  return (
    difference === "" ||
    (!isAbsolute(difference) && difference !== ".." && !difference.startsWith(`..${sep}`))
  );
}

function preflightEnvelope(bytes) {
  try {
    const value = parseStrictJsonBytes(bytes, { canonicalScalars: true });
    if (
      !exactKeys(value, TOP_LEVEL_KEYS) ||
      value.schema_version !== "evidence-bundle.v2" ||
      !exactKeys(value.run, RUN_KEYS) ||
      !OBSERVATION_SHA256.test(value.run.observation_sha256)
    ) fail("live evidence envelope is invalid");
    return `live-evidence-v2-${value.run.observation_sha256.slice("sha256:".length)}`;
  } catch (error) {
    if (error instanceof LiveImportError) throw error;
    fail("live evidence envelope is invalid");
  }
}

function canonicalBytes(record) {
  try {
    const serialised = JSON.stringify(record, null, 2);
    if (typeof serialised !== "string") fail("live development could not be serialised");
    return Buffer.from(`${serialised}\n`, "utf8");
  } catch (error) {
    if (error instanceof LiveImportError) throw error;
    fail("live development could not be serialised");
  }
}

async function optionalDetails(operations, path) {
  try {
    return await operations.lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    fail("existing live development conflicts with the evidence bundle");
  }
}

async function existingTargetStatus({ operations, targetPath, expectedBytes }) {
  const targetDetails = await optionalDetails(operations, targetPath);
  if (targetDetails === null) return null;
  if (!ordinaryDirectory(targetDetails)) {
    fail("existing live development conflicts with the evidence bundle");
  }

  let canonicalTarget;
  let entries;
  try {
    canonicalTarget = await operations.realpath(targetPath);
    entries = await operations.readdir(targetPath, { withFileTypes: true });
  } catch {
    fail("existing live development conflicts with the evidence bundle");
  }
  if (
    typeof canonicalTarget !== "string" ||
    resolve(canonicalTarget) !== targetPath ||
    entries.length !== 1 ||
    entries[0].name !== "development.json" ||
    !entries[0].isFile() ||
    entries[0].isSymbolicLink()
  ) fail("existing live development conflicts with the evidence bundle");

  const developmentPath = join(targetPath, "development.json");
  let developmentDetails;
  let canonicalDevelopment;
  let bytes;
  try {
    developmentDetails = await operations.lstat(developmentPath);
    canonicalDevelopment = await operations.realpath(developmentPath);
    bytes = await operations.readFile(developmentPath);
  } catch {
    fail("existing live development conflicts with the evidence bundle");
  }
  if (
    !ordinaryFile(developmentDetails) ||
    typeof canonicalDevelopment !== "string" ||
    resolve(canonicalDevelopment) !== developmentPath ||
    !Buffer.from(bytes).equals(expectedBytes)
  ) fail("existing live development conflicts with the evidence bundle");
  return "unchanged";
}

async function verifyWorkDirectory(operations, candidate, contentPath) {
  if (!ownedWorkPath(candidate, contentPath)) {
    fail("private work directory escaped its fixed boundary");
  }
  await requireCanonicalDirectory(
    operations,
    candidate,
    "private work directory escaped its fixed boundary",
  );
}

function ownedWorkPath(path, contentPath) {
  return (
    typeof path === "string" &&
    isAbsolute(path) &&
    resolve(path) === path &&
    dirname(path) === contentPath &&
    basename(path).startsWith(WORK_PREFIX) &&
    basename(path).length > WORK_PREFIX.length
  );
}

async function validateStagedRecord(operations, recordPath, expectedBytes) {
  const developmentPath = join(recordPath, "development.json");
  let stagedBytes;
  try {
    stagedBytes = await operations.readFile(developmentPath);
  } catch {
    fail("staged development could not be read");
  }
  if (!Buffer.from(stagedBytes).equals(expectedBytes)) {
    fail("staged development changed before validation");
  }
  try {
    const value = parseStrictJsonBytes(stagedBytes, { canonicalScalars: true });
    if (!validateLiveDevelopmentV2(value).ok) {
      fail("staged development failed canonical validation");
    }
  } catch (error) {
    if (error instanceof LiveImportError) throw error;
    fail("staged development failed canonical validation");
  }
}

async function requireSingleStagedFile(operations, recordPath) {
  let entries;
  try {
    entries = await operations.readdir(recordPath, { withFileTypes: true });
  } catch {
    fail("staged development shape is invalid");
  }
  if (
    entries.length !== 1 ||
    entries[0].name !== "development.json" ||
    !entries[0].isFile() ||
    entries[0].isSymbolicLink()
  ) fail("staged development shape is invalid");

  const developmentPath = join(recordPath, "development.json");
  let details;
  let canonical;
  try {
    details = await operations.lstat(developmentPath);
    canonical = await operations.realpath(developmentPath);
  } catch {
    fail("staged development shape is invalid");
  }
  if (
    !ordinaryFile(details) ||
    typeof canonical !== "string" ||
    resolve(canonical) !== developmentPath
  ) {
    fail("staged development shape is invalid");
  }
}

export async function admitLiveEvidence(input) {
  const request = readRequest(input);
  const { bundlePath, repositoryRoot, operations, verifyProvenance } = request;
  let currentPlatform;
  try {
    currentPlatform = operations.platform();
  } catch {
    fail("live import request is invalid");
  }
  if (currentPlatform !== "win32") fail("live evidence admission requires Windows");

  const acceptedRepositoryRoot = resolve(repositoryRoot);
  const acceptedBundlePath = resolve(bundlePath);
  const contentPath = join(acceptedRepositoryRoot, "content");
  const developmentsPath = join(contentPath, "developments");

  await requireCanonicalDirectory(
    operations,
    acceptedRepositoryRoot,
    "repository root must be a canonical ordinary directory",
  );
  await requireCanonicalDirectory(
    operations,
    contentPath,
    "content directory must be a canonical ordinary directory",
  );
  await requireCanonicalDirectory(
    operations,
    developmentsPath,
    "developments directory must be a canonical ordinary directory",
  );
  await requireCanonicalInput(operations, acceptedBundlePath);

  let workPath = null;
  let workOwned = false;
  try {
    try {
      workPath = await operations.mkdtemp(join(contentPath, WORK_PREFIX));
    } catch {
      fail("private work directory could not be created");
    }
    await verifyWorkDirectory(operations, workPath, contentPath);
    workOwned = true;

    let heldBytes;
    try {
      heldBytes = Buffer.from(await operations.readFile(acceptedBundlePath));
    } catch {
      fail("bundle input could not be read");
    }
    if (heldBytes.byteLength > MAXIMUM_BUNDLE_BYTES) {
      fail("bundle input must be no more than 1048576 bytes");
    }

    const snapshotPath = join(workPath, SNAPSHOT_NAME);
    try {
      await operations.writeFile(snapshotPath, heldBytes, { flag: "wx", mode: 0o600 });
    } catch {
      fail("live evidence snapshot could not be written");
    }
    let snapshotBytes;
    try {
      snapshotBytes = Buffer.from(await operations.readFile(snapshotPath));
    } catch {
      fail("live evidence snapshot could not be read");
    }
    if (!snapshotBytes.equals(heldBytes)) {
      fail("live evidence snapshot changed before verification");
    }

    const releaseTag = preflightEnvelope(heldBytes);
    try {
      await verifyProvenance({ snapshotPath, releaseTag });
    } catch {
      fail("live evidence provenance verification failed");
    }

    try {
      snapshotBytes = Buffer.from(await operations.readFile(snapshotPath));
    } catch {
      fail("live evidence snapshot could not be read");
    }
    if (!snapshotBytes.equals(heldBytes)) {
      fail("live evidence snapshot changed during verification");
    }

    let parsed;
    let record;
    try {
      parsed = parseLiveEvidenceBundle(heldBytes);
      if (parsed.releaseTag !== releaseTag) fail("live evidence release identity changed");
      record = transformLiveEvidenceBundle(parsed);
      if (!validateLiveDevelopmentV2(record).ok) {
        fail("live development failed canonical validation");
      }
    } catch (error) {
      if (error instanceof LiveImportError) throw error;
      fail("live evidence semantics are invalid");
    }
    const expectedBytes = canonicalBytes(record);
    const targetPath = join(developmentsPath, record.development_id);
    if (dirname(targetPath) !== developmentsPath) {
      fail("live development identity is invalid");
    }
    const developmentPath = join(targetPath, "development.json");
    if (pathIsWithin(acceptedBundlePath, targetPath)) {
      fail("bundle input must be outside its final target");
    }

    const existing = await existingTargetStatus({
      operations,
      targetPath,
      expectedBytes,
    });
    if (existing !== null) {
      return { status: existing, developmentPath, bundleSha256: parsed.bundleSha256 };
    }

    const recordPath = join(workPath, RECORD_DIRECTORY);
    try {
      await operations.mkdir(recordPath, { mode: 0o700 });
    } catch {
      fail("staged development directory could not be created");
    }
    await requireCanonicalDirectory(
      operations,
      recordPath,
      "staged development directory is invalid",
    );
    try {
      await operations.writeFile(join(recordPath, "development.json"), expectedBytes, {
        flag: "wx",
        mode: 0o600,
      });
    } catch {
      fail("staged development could not be written");
    }
    await validateStagedRecord(operations, recordPath, expectedBytes);
    try {
      await operations.unlink(snapshotPath);
    } catch {
      fail("live evidence snapshot could not be removed");
    }
    await requireSingleStagedFile(operations, recordPath);

    const raced = await existingTargetStatus({
      operations,
      targetPath,
      expectedBytes,
    });
    if (raced !== null) {
      return { status: raced, developmentPath, bundleSha256: parsed.bundleSha256 };
    }

    try {
      await operations.rename(recordPath, targetPath);
    } catch (error) {
      if (EXPECTED_RACE_CODES.has(error?.code)) {
        const winner = await existingTargetStatus({
          operations,
          targetPath,
          expectedBytes,
        });
        if (winner !== null) {
          return { status: winner, developmentPath, bundleSha256: parsed.bundleSha256 };
        }
      }
      fail("live development promotion failed");
    }
    return {
      status: "imported",
      developmentPath,
      bundleSha256: parsed.bundleSha256,
    };
  } catch (error) {
    if (error instanceof LiveImportError) throw error;
    fail("live evidence admission failed");
  } finally {
    if (workOwned && ownedWorkPath(workPath, contentPath)) {
      try {
        await operations.rm(workPath, { recursive: true, force: true });
      } catch {
        // Best effort only. A verified private orphan is outside the build namespace.
      }
    }
  }
}
