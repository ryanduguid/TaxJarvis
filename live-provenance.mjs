// SPDX-License-Identifier: AGPL-3.0-only
import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPOSITORY = "ryanduguid/au-tax-legislation-corpus";
const WORKFLOW =
  "ryanduguid/au-tax-legislation-corpus/.github/workflows/publish-live-evidence.yml";
const RELEASE_TAG = /^live-evidence-v2-[0-9a-f]{64}$/;
const VERSION_LINE =
  /^gh version ((?:0|[1-9][0-9]{0,8}))\.((?:0|[1-9][0-9]{0,8}))\.((?:0|[1-9][0-9]{0,8})) \([^\r\n]+\)$/;
const EXEC_OPTIONS = Object.freeze({
  encoding: "utf8",
  maxBuffer: 65_536,
  shell: false,
  windowsHide: true,
});

const MESSAGES = Object.freeze({
  runner: "Live provenance runner is invalid.",
  path: "Live evidence snapshot path is invalid.",
  tag: "Live evidence release tag is invalid.",
  versionCommand: "GitHub CLI version check failed.",
  version: "GitHub CLI 2.98.0 or newer is required.",
  auth: "GitHub CLI authentication check failed.",
  releaseCapability: "GitHub CLI release verification capability is unavailable.",
  assetCapability: "GitHub CLI release asset verification capability is unavailable.",
  attestationCapability:
    "GitHub CLI attestation verification capability is unavailable.",
  release: "Live evidence release verification failed.",
  asset: "Live evidence asset verification failed.",
  attestation: "Live evidence attestation verification failed.",
});

class LiveProvenanceError extends Error {
  constructor(message) {
    super(message);
    this.name = "LiveProvenanceError";
  }
}

function fail(message) {
  throw new LiveProvenanceError(message);
}

async function runGh(run, args, failureMessage) {
  try {
    return await run("gh", args, EXEC_OPTIONS);
  } catch {
    fail(failureMessage);
  }
}

function readStdout(result) {
  try {
    return typeof result?.stdout === "string" ? result.stdout : null;
  } catch {
    return null;
  }
}

function readInput(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  try {
    return {
      snapshotPath: input.snapshotPath,
      releaseTag: input.releaseTag,
      run: input.run,
    };
  } catch {
    return null;
  }
}

function supportedVersion(result) {
  const stdout = readStdout(result);
  if (stdout === null) return false;
  const firstLine = stdout.split("\n", 1)[0].replace(/\r$/, "");
  const match = VERSION_LINE.exec(firstLine);
  if (match === null) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  return (
    major > 2 ||
    (major === 2 && (minor > 98 || (minor === 98 && patch >= 0)))
  );
}

function hasOptions(result, required) {
  const stdout = readStdout(result);
  if (stdout === null) return false;
  const options = new Set(stdout.split(/[\s,]+/));
  return required.every(option => options.has(option));
}

export async function verifyWithRunner(input) {
  const fields = readInput(input);
  if (fields === null) fail(MESSAGES.runner);
  const { snapshotPath, releaseTag, run } = fields;
  if (typeof run !== "function") fail(MESSAGES.runner);
  if (
    typeof snapshotPath !== "string" ||
    snapshotPath.length === 0 ||
    snapshotPath.includes("\0") ||
    !isAbsolute(snapshotPath)
  ) {
    fail(MESSAGES.path);
  }
  if (typeof releaseTag !== "string" || !RELEASE_TAG.test(releaseTag)) {
    fail(MESSAGES.tag);
  }

  const version = await runGh(run, ["--version"], MESSAGES.versionCommand);
  if (!supportedVersion(version)) fail(MESSAGES.version);

  await runGh(run, ["auth", "status"], MESSAGES.auth);

  const releaseHelp = await runGh(
    run,
    ["release", "verify", "--help"],
    MESSAGES.releaseCapability,
  );
  if (!hasOptions(releaseHelp, ["--repo"])) fail(MESSAGES.releaseCapability);

  const assetHelp = await runGh(
    run,
    ["release", "verify-asset", "--help"],
    MESSAGES.assetCapability,
  );
  if (!hasOptions(assetHelp, ["--repo"])) fail(MESSAGES.assetCapability);

  const attestationHelp = await runGh(
    run,
    ["attestation", "verify", "--help"],
    MESSAGES.attestationCapability,
  );
  if (
    !hasOptions(attestationHelp, [
      "--repo",
      "--signer-workflow",
      "--source-ref",
      "--predicate-type",
      "--deny-self-hosted-runners",
    ])
  ) {
    fail(MESSAGES.attestationCapability);
  }

  await runGh(
    run,
    ["release", "verify", releaseTag, "--repo", REPOSITORY],
    MESSAGES.release,
  );
  await runGh(
    run,
    [
      "release",
      "verify-asset",
      releaseTag,
      snapshotPath,
      "--repo",
      REPOSITORY,
    ],
    MESSAGES.asset,
  );
  await runGh(
    run,
    [
      "attestation",
      "verify",
      snapshotPath,
      "--repo",
      REPOSITORY,
      "--signer-workflow",
      WORKFLOW,
      "--source-ref",
      "refs/heads/main",
      "--predicate-type",
      "https://slsa.dev/provenance/v1",
      "--deny-self-hosted-runners",
    ],
    MESSAGES.attestation,
  );
}

export async function verifyLiveBundleSnapshot(input) {
  const fields = readInput(input);
  const { snapshotPath, releaseTag } = fields ?? {};
  return verifyWithRunner({ snapshotPath, releaseTag, run: execFileAsync });
}
