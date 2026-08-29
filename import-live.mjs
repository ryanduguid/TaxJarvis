// SPDX-License-Identifier: AGPL-3.0-only
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { admitLiveEvidence } from "./live-import-internals.mjs";
import { verifyLiveBundleSnapshot } from "./live-provenance.mjs";

const REPOSITORY_ROOT = dirname(fileURLToPath(import.meta.url));
const USAGE = "Usage: npm run import-bundle -- --bundle <file>";

function bundleArgument(argv) {
  if (
    !Array.isArray(argv) ||
    argv.length !== 2 ||
    argv[0] !== "--bundle" ||
    typeof argv[1] !== "string" ||
    argv[1].length === 0 ||
    argv[1].startsWith("--")
  ) return null;
  return argv[1];
}

export function importLiveEvidenceBundle(bundlePath) {
  if (arguments.length !== 1) {
    return Promise.reject(
      new TypeError("live import requires exactly one bundle path argument"),
    );
  }
  if (
    typeof bundlePath !== "string" ||
    bundlePath.length === 0 ||
    bundlePath.includes("\0")
  ) {
    return Promise.reject(new TypeError("bundle path must be a non-empty string"));
  }
  return admitLiveEvidence({
    bundlePath,
    repositoryRoot: REPOSITORY_ROOT,
    verifyProvenance: verifyLiveBundleSnapshot,
  });
}

export async function runImportCli(argv, {
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const bundlePath = bundleArgument(argv);
  if (bundlePath === null) {
    stderr.write(`${USAGE}\n`);
    return 2;
  }
  try {
    const result = await importLiveEvidenceBundle(bundlePath);
    stdout.write(`${result.status}: ${result.developmentPath}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  runImportCli(process.argv.slice(2)).then(
    status => { process.exitCode = status; },
    () => {
      process.stderr.write("live evidence import failed\n");
      process.exitCode = 1;
    },
  );
}
