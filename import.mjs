// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseEvidenceBundle,
  transformEvidenceBundle,
} from "./evidence-bundle.mjs";
import { validateDevelopment } from "./site.mjs";
import { parseStrictJsonBytes } from "./strict-json.mjs";

const MAXIMUM_BUNDLE_BYTES = 1_048_576;
const OPERATION_NAMES = new Set([
  "lstat",
  "mkdir",
  "readFile",
  "rename",
  "rm",
  "writeFile",
]);
const DEFAULT_OPERATIONS = Object.freeze({
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
});

class EvidenceImportError extends Error {
  constructor(message) {
    super(message);
    this.name = "EvidenceImportError";
  }
}

function selectedOperations(overrides) {
  if (overrides === undefined) return DEFAULT_OPERATIONS;
  if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new EvidenceImportError("operations must be an object");
  }
  for (const [name, operation] of Object.entries(overrides)) {
    if (!OPERATION_NAMES.has(name) || typeof operation !== "function") {
      throw new EvidenceImportError("operations contains an unsupported override");
    }
  }
  return Object.freeze({ ...DEFAULT_OPERATIONS, ...overrides });
}

function ordinaryFile(details) {
  return details.isFile() && !details.isSymbolicLink();
}

function ordinaryDirectory(details) {
  return details.isDirectory() && !details.isSymbolicLink();
}

async function inspectRequired(operations, path, message) {
  let details;
  try {
    details = await operations.lstat(path);
  } catch {
    throw new EvidenceImportError(message);
  }
  return details;
}

async function inspectOptional(operations, path) {
  try {
    return await operations.lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new EvidenceImportError("import target cannot be inspected");
  }
}

function pathIsWithin(path, parent) {
  const difference = relative(parent, path);
  return (
    difference === "" ||
    (!isAbsolute(difference) && difference !== ".." && !difference.startsWith(`..${sep}`))
  );
}

function canonicalBytes(record) {
  return Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function assertOwnedStaging(stagingPath, contentRoot, prefix) {
  if (
    dirname(stagingPath) !== contentRoot ||
    !basename(stagingPath).startsWith(prefix)
  ) {
    throw new EvidenceImportError("refusing to clean a path outside the importer boundary");
  }
}

async function existingTargetStatus({
  operations,
  targetPath,
  developmentPath,
  expectedBytes,
}) {
  const details = await inspectOptional(operations, targetPath);
  if (details === null) return null;
  if (!ordinaryDirectory(details)) {
    throw new EvidenceImportError(
      "import target must be an ordinary directory or absent",
    );
  }
  const developmentDetails = await inspectOptional(operations, developmentPath);
  if (developmentDetails === null || !ordinaryFile(developmentDetails)) {
    throw new EvidenceImportError(
      "existing development conflicts with the evidence bundle",
    );
  }
  let existingBytes;
  try {
    existingBytes = await operations.readFile(developmentPath);
  } catch {
    throw new EvidenceImportError(
      "existing development conflicts with the evidence bundle",
    );
  }
  if (!Buffer.from(existingBytes).equals(expectedBytes)) {
    throw new EvidenceImportError(
      "existing development conflicts with the evidence bundle",
    );
  }
  return "unchanged";
}

function validateStagedCanonical(bytes, expectedBytes) {
  if (!Buffer.from(bytes).equals(expectedBytes)) {
    throw new EvidenceImportError("staged development changed before validation");
  }
  const parsed = parseStrictJsonBytes(bytes);
  const result = validateDevelopment(parsed);
  if (!result.ok) {
    throw new EvidenceImportError("staged development failed canonical validation");
  }
}

export async function importEvidenceBundle({
  bundlePath,
  contentRoot,
  allowSynthetic = false,
  operations: operationOverrides,
} = {}) {
  if (typeof bundlePath !== "string" || typeof contentRoot !== "string") {
    throw new EvidenceImportError("bundlePath and contentRoot must be explicit paths");
  }
  if (typeof allowSynthetic !== "boolean") {
    throw new EvidenceImportError("allowSynthetic must be a boolean");
  }
  const operations = selectedOperations(operationOverrides);
  const acceptedBundlePath = resolve(bundlePath);
  const acceptedContentRoot = resolve(contentRoot);

  const bundleDetails = await inspectRequired(
    operations,
    acceptedBundlePath,
    "bundle input must be an ordinary file",
  );
  if (!ordinaryFile(bundleDetails)) {
    throw new EvidenceImportError("bundle input must be an ordinary file");
  }
  if (bundleDetails.size > MAXIMUM_BUNDLE_BYTES) {
    throw new EvidenceImportError("bundle input must be no more than 1048576 bytes");
  }
  const rootDetails = await inspectRequired(
    operations,
    acceptedContentRoot,
    "content root must be an ordinary directory",
  );
  if (!ordinaryDirectory(rootDetails)) {
    throw new EvidenceImportError("content root must be an ordinary directory");
  }

  let bundleBytes;
  try {
    bundleBytes = await operations.readFile(acceptedBundlePath);
  } catch {
    throw new EvidenceImportError("bundle input could not be read");
  }
  if (bundleBytes.byteLength > MAXIMUM_BUNDLE_BYTES) {
    throw new EvidenceImportError("bundle input must be no more than 1048576 bytes");
  }
  const parsed = parseEvidenceBundle(bundleBytes);
  if (parsed.bundle.mode === "synthetic" && allowSynthetic !== true) {
    throw new EvidenceImportError("synthetic evidence bundles are not accepted");
  }
  const record = transformEvidenceBundle(parsed.bundle, {
    bundleSha256: parsed.bundleSha256,
  });
  const expectedBytes = canonicalBytes(record);
  const targetPath = join(acceptedContentRoot, record.development_id);
  const developmentPath = join(targetPath, "development.json");
  if (pathIsWithin(acceptedBundlePath, targetPath)) {
    throw new EvidenceImportError("bundle input must be outside its final target");
  }

  const existingStatus = await existingTargetStatus({
    operations,
    targetPath,
    developmentPath,
    expectedBytes,
  });
  if (existingStatus !== null) {
    return {
      status: existingStatus,
      developmentPath,
      bundleSha256: parsed.bundleSha256,
    };
  }

  const prefix = `.${record.development_id}.import-`;
  const stagingPath = join(acceptedContentRoot, `${prefix}${randomUUID()}`);
  const stagedDevelopmentPath = join(stagingPath, "development.json");
  let stagingOwned = false;
  try {
    await operations.mkdir(stagingPath, { mode: 0o700 });
    stagingOwned = true;
    await operations.writeFile(stagedDevelopmentPath, expectedBytes, {
      flag: "wx",
      mode: 0o600,
    });
    const stagedBytes = await operations.readFile(stagedDevelopmentPath);
    validateStagedCanonical(stagedBytes, expectedBytes);

    const racedStatus = await existingTargetStatus({
      operations,
      targetPath,
      developmentPath,
      expectedBytes,
    });
    if (racedStatus !== null) {
      return {
        status: racedStatus,
        developmentPath,
        bundleSha256: parsed.bundleSha256,
      };
    }
    await operations.rename(stagingPath, targetPath);
    stagingOwned = false;
    return {
      status: "imported",
      developmentPath,
      bundleSha256: parsed.bundleSha256,
    };
  } finally {
    if (stagingOwned) {
      assertOwnedStaging(stagingPath, acceptedContentRoot, prefix);
      await operations.rm(stagingPath, { recursive: true, force: true });
    }
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  process.stderr.write(
    "Direct import.mjs execution is disabled; use npm run import-bundle -- --bundle <file>.\n",
  );
  process.exitCode = 1;
}
