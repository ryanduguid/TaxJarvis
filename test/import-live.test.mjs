// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { admitLiveEvidence } from "../live-import-internals.mjs";
import * as publicImport from "../import-live.mjs";
import {
  parseLiveEvidenceBundle,
  transformLiveEvidenceBundle,
} from "../live-evidence.mjs";
import { buildSite } from "../site.mjs";

const FIXTURE = fileURLToPath(
  new URL("./fixtures/evidence-bundle.v2.json", import.meta.url),
);
const DEMO_RECORD = fileURLToPath(
  new URL("../content/developments/dev-demo-001/development.json", import.meta.url),
);
const REAL_DEVELOPMENTS = fileURLToPath(
  new URL("../content/developments", import.meta.url),
);
const DEVELOPMENT_ID = "dev-frl-f2022l00347-f2026c00838";
const RELEASE_TAG =
  "live-evidence-v2-8ea331ff6670fe1f2221146f33f74cfd6c210b3d9c7eca48da2c592fe5d8764f";
const BUNDLE_SHA256 =
  "sha256:b1f0b76202c056f46c9eb6633ccfbea13f8487e0cadf7ddca001dc8acb07b5a1";
const SNAPSHOT_NAME = "evidence-bundle.v2.json";
const USAGE = "Usage: npm run import-bundle -- --bundle <file>\n";

const REAL_OPERATIONS = Object.freeze({
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

async function temporaryRepository(t, { bundleBytes } = {}) {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "tax-live-import-"));
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  const contentPath = join(repositoryRoot, "content");
  const developmentsPath = join(contentPath, "developments");
  const incomingPath = join(repositoryRoot, "incoming");
  await mkdir(developmentsPath, { recursive: true });
  await mkdir(incomingPath);
  const bundlePath = join(incomingPath, SNAPSHOT_NAME);
  if (bundleBytes === undefined) {
    await copyFile(FIXTURE, bundlePath);
  } else {
    await writeFile(bundlePath, bundleBytes);
  }
  return { repositoryRoot, contentPath, developmentsPath, bundlePath };
}

function canonicalRecordBytes() {
  const parsed = parseLiveEvidenceBundle(
    new Uint8Array(requireFixtureBytes()),
  );
  return Buffer.from(
    `${JSON.stringify(transformLiveEvidenceBundle(parsed), null, 2)}\n`,
    "utf8",
  );
}

let fixtureBytes;
let realDevelopmentsBefore;
function requireFixtureBytes() {
  assert.ok(fixtureBytes, "fixture bytes must be loaded by the test");
  return fixtureBytes;
}

function captureStreams() {
  let stdout = "";
  let stderr = "";
  return {
    streams: {
      stdout: { write: value => { stdout += String(value); } },
      stderr: { write: value => { stderr += String(value); } },
    },
    output: () => ({ stdout, stderr }),
  };
}

async function directoryNames(path) {
  return (await readdir(path)).sort();
}

function isPrivateSnapshot(path) {
  return (
    basename(path) === SNAPSHOT_NAME &&
    basename(dirname(path)).startsWith(".live-import-")
  );
}

async function snapshotDirectory(path, prefix = "") {
  const snapshot = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const fullPath = join(path, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      snapshot.push([relativePath, "directory"]);
      snapshot.push(...await snapshotDirectory(fullPath, relativePath));
    } else if (entry.isFile() && !entry.isSymbolicLink()) {
      snapshot.push([relativePath, "file", (await readFile(fullPath)).toString("base64")]);
    } else {
      snapshot.push([relativePath, "other"]);
    }
  }
  return snapshot.sort((left, right) => left[0].localeCompare(right[0]));
}

function fakeVerifier(calls, hook = async () => {}) {
  return async input => {
    calls.push(input);
    await hook(input);
  };
}

test.before(async () => {
  fixtureBytes = await readFile(FIXTURE);
  realDevelopmentsBefore = await snapshotDirectory(REAL_DEVELOPMENTS);
});

test.after(async () => {
  assert.deepEqual(
    await snapshotDirectory(REAL_DEVELOPMENTS),
    realDevelopmentsBefore,
    "focused live-import tests must not mutate the real repository developments tree",
  );
});

test("production module exposes only the fixed one-argument API and CLI", async () => {
  assert.deepEqual(Object.keys(await import("../live-import-internals.mjs")), [
    "admitLiveEvidence",
  ]);
  assert.deepEqual(Object.keys(publicImport).sort(), [
    "importLiveEvidenceBundle",
    "runImportCli",
  ]);
  assert.equal(publicImport.importLiveEvidenceBundle.length, 1);
  await assert.rejects(
    publicImport.importLiveEvidenceBundle({ bundlePath: FIXTURE }),
    /bundle path must be a non-empty string/,
  );
  await assert.rejects(
    publicImport.importLiveEvidenceBundle(
      join(tmpdir(), "tax-live-options-form-must-not-exist.json"),
      { repositoryRoot: resolve(".") },
    ),
    /exactly one bundle path argument/,
  );
});

test("CLI accepts only one separate --bundle value", async t => {
  const rejected = [
    [],
    [FIXTURE],
    ["--bundle"],
    ["--bundle", ""],
    [`--bundle=${FIXTURE}`],
    ["--bundle", FIXTURE, "extra"],
    ["--bundle", FIXTURE, "--bundle", FIXTURE],
    ["--content-root", "content/developments"],
    ["--bundle", FIXTURE, "--content-root", "content/developments"],
    ["--bundle", FIXTURE, "--synthetic"],
    ["--bundle", FIXTURE, "--skip-provenance"],
    ["--bundle", FIXTURE, "--offline"],
    ["--bundle", FIXTURE, "--overwrite"],
    ["--bundle", FIXTURE, "--retry"],
  ];
  for (const argv of rejected) {
    const capture = captureStreams();
    assert.equal(
      await publicImport.runImportCli(argv, capture.streams),
      2,
      JSON.stringify(argv),
    );
    assert.deepEqual(capture.output(), { stdout: "", stderr: USAGE });
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "tax-live-cli-missing-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const capture = captureStreams();
  assert.equal(
    await publicImport.runImportCli(
      ["--bundle", join(temporaryRoot, "does-not-exist.json")],
      capture.streams,
    ),
    1,
  );
  assert.deepEqual(capture.output(), {
    stdout: "",
    stderr: "bundle input must be a canonical ordinary file\n",
  });
});

test("package command has no legacy or configurable-root route", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(packageJson.scripts["import-bundle"], "node import-live.mjs");
  for (const path of [
    "live-evidence.mjs",
    "live-provenance.mjs",
    "live-import-internals.mjs",
    "import-live.mjs",
    "test/live-evidence.test.mjs",
    "test/live-provenance.test.mjs",
    "test/import-live.test.mjs",
  ]) {
    assert.match(packageJson.scripts.check, new RegExp(`node --check ${path.replaceAll("/", "\\/")}`));
  }
  const ignoreLines = (await readFile(new URL("../.gitignore", import.meta.url), "utf8"))
    .split(/\r?\n/)
    .filter(Boolean);
  assert.equal(
    ignoreLines.filter(line => line === "/content/.live-import-*/").length,
    1,
  );
});

test("non-Windows admission refuses before filesystem or provenance work", async () => {
  let filesystemCalls = 0;
  let verifierCalls = 0;
  const filesystem = Object.fromEntries(
    Object.keys(REAL_OPERATIONS).map(name => [name, async () => {
      filesystemCalls += 1;
      throw new Error(`unexpected ${name}`);
    }]),
  );
  await assert.rejects(
    admitLiveEvidence({
      bundlePath: FIXTURE,
      repositoryRoot: resolve("."),
      operations: { ...filesystem, platform: () => "linux" },
      verifyProvenance: async () => { verifierCalls += 1; },
    }),
    /live evidence admission requires Windows/,
  );
  assert.equal(filesystemCalls, 0);
  assert.equal(verifierCalls, 0);
});

test("a real Windows import snapshots once, verifies once and reimports unchanged", async t => {
  if (process.platform !== "win32") return t.skip("Windows-only admission");
  const paths = await temporaryRepository(t);
  const provenanceCalls = [];
  let originalReads = 0;
  const result = await admitLiveEvidence({
    bundlePath: paths.bundlePath,
    repositoryRoot: paths.repositoryRoot,
    operations: {
      readFile: async path => {
        if (resolve(path) === resolve(paths.bundlePath)) originalReads += 1;
        return readFile(path);
      },
    },
    verifyProvenance: fakeVerifier(provenanceCalls, async input => {
      assert.equal(input.releaseTag, RELEASE_TAG);
      assert.equal(basename(input.snapshotPath), SNAPSHOT_NAME);
      assert.match(basename(dirname(input.snapshotPath)), /^\.live-import-.+$/);
      assert.deepEqual(await readFile(input.snapshotPath), fixtureBytes);
    }),
  });
  const developmentPath = join(
    paths.developmentsPath,
    DEVELOPMENT_ID,
    "development.json",
  );
  assert.deepEqual(result, {
    status: "imported",
    developmentPath,
    bundleSha256: BUNDLE_SHA256,
  });
  assert.equal(originalReads, 1);
  assert.equal(provenanceCalls.length, 1);
  assert.deepEqual(await readFile(developmentPath), canonicalRecordBytes());
  assert.deepEqual(await directoryNames(paths.contentPath), ["developments"]);

  const secondCalls = [];
  const second = await admitLiveEvidence({
    bundlePath: paths.bundlePath,
    repositoryRoot: paths.repositoryRoot,
    verifyProvenance: fakeVerifier(secondCalls),
  });
  assert.deepEqual(second, {
    status: "unchanged",
    developmentPath,
    bundleSha256: BUNDLE_SHA256,
  });
  assert.equal(secondCalls.length, 1);
  assert.deepEqual(await readFile(developmentPath), canonicalRecordBytes());
  assert.deepEqual(await directoryNames(paths.contentPath), ["developments"]);
});

test("private work is invisible to the static build while provenance is paused", async t => {
  if (process.platform !== "win32") return t.skip("Windows-only admission");
  const paths = await temporaryRepository(t);
  const demoTarget = join(paths.developmentsPath, "dev-demo-001");
  await mkdir(demoTarget);
  await copyFile(DEMO_RECORD, join(demoTarget, "development.json"));
  await mkdir(join(paths.repositoryRoot, "assets"));
  await copyFile(
    new URL("../assets/site.css", import.meta.url),
    join(paths.repositoryRoot, "assets", "site.css"),
  );
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const admission = admitLiveEvidence({
    bundlePath: paths.bundlePath,
    repositoryRoot: paths.repositoryRoot,
    verifyProvenance: async () => {
      entered.resolve();
      await release.promise;
    },
  });
  await entered.promise;
  assert.deepEqual(await directoryNames(paths.developmentsPath), ["dev-demo-001"]);
  assert.equal(
    (await directoryNames(paths.contentPath)).some(name => name.startsWith(".live-import-")),
    true,
  );
  const outputs = await buildSite({
    rootDir: paths.repositoryRoot,
    siteUrl: "https://publisher.example/",
  });
  assert.equal(outputs.some(path => path.includes(DEVELOPMENT_ID)), false);
  release.resolve();
  assert.equal((await admission).status, "imported");
});

test("concurrent compliant imports publish one complete identical record", {
  timeout: 10_000,
}, async t => {
  if (process.platform !== "win32") return t.skip("Windows-only admission");
  const paths = await temporaryRepository(t);
  const bothAtRename = Promise.withResolvers();
  let renameEntrants = 0;
  const synchronisedRename = async (...arguments_) => {
    renameEntrants += 1;
    if (renameEntrants === 2) bothAtRename.resolve();
    await bothAtRename.promise;
    return rename(...arguments_);
  };
  const [first, second] = await Promise.all([
    admitLiveEvidence({
      bundlePath: paths.bundlePath,
      repositoryRoot: paths.repositoryRoot,
      operations: { rename: synchronisedRename },
      verifyProvenance: async () => {},
    }),
    admitLiveEvidence({
      bundlePath: paths.bundlePath,
      repositoryRoot: paths.repositoryRoot,
      operations: { rename: synchronisedRename },
      verifyProvenance: async () => {},
    }),
  ]);
  assert.equal(renameEntrants, 2);
  assert.deepEqual([first.status, second.status].sort(), ["imported", "unchanged"]);
  const targetPath = join(paths.developmentsPath, DEVELOPMENT_ID);
  assert.deepEqual(await directoryNames(targetPath), ["development.json"]);
  assert.deepEqual(
    await readFile(join(targetPath, "development.json")),
    canonicalRecordBytes(),
  );
  assert.deepEqual(await directoryNames(paths.contentPath), ["developments"]);
});

test("a real Windows rename collision preserves a conflicting directory winner", {
  timeout: 10_000,
}, async t => {
  if (process.platform !== "win32") return t.skip("Windows-only admission");
  const paths = await temporaryRepository(t);
  const targetPath = join(paths.developmentsPath, DEVELOPMENT_ID);
  const atRename = Promise.withResolvers();
  const releaseRename = Promise.withResolvers();
  let collisionCode = null;
  const admission = admitLiveEvidence({
    bundlePath: paths.bundlePath,
    repositoryRoot: paths.repositoryRoot,
    operations: {
      rename: async (...arguments_) => {
        atRename.resolve();
        await releaseRename.promise;
        try {
          return await rename(...arguments_);
        } catch (error) {
          collisionCode = error.code;
          throw error;
        }
      },
    },
    verifyProvenance: async () => {},
  });

  await atRename.promise;
  await mkdir(targetPath);
  const conflictingPath = join(targetPath, "development.json");
  await writeFile(conflictingPath, "keep");
  releaseRename.resolve();

  await assert.rejects(
    admission,
    /existing live development conflicts with the evidence bundle/,
  );
  assert.equal(collisionCode, "EPERM");
  assert.equal(await readFile(conflictingPath, "utf8"), "keep");
  assert.deepEqual(await directoryNames(targetPath), ["development.json"]);
  assert.deepEqual(await directoryNames(paths.contentPath), ["developments"]);
});

test("internal request rejects invalid values without touching the verifier", async () => {
  let verifierCalls = 0;
  const verifyProvenance = async () => { verifierCalls += 1; };
  for (const request of [
    undefined,
    null,
    {},
    { bundlePath: FIXTURE, repositoryRoot: 42, verifyProvenance },
    {
      bundlePath: FIXTURE,
      repositoryRoot: resolve("."),
      operations: { unsupported: async () => {} },
      verifyProvenance,
    },
  ]) {
    await assert.rejects(admitLiveEvidence(request), /live import request is invalid/);
  }
  assert.equal(verifierCalls, 0);
});

test("repository, content and developments must be canonical ordinary directories", async t => {
  if (process.platform !== "win32") return t.skip("Windows-only admission");
  const paths = await temporaryRepository(t);
  const marker = join(paths.developmentsPath, "keep.txt");
  await writeFile(marker, "keep");

  const missingRoot = join(paths.repositoryRoot, "missing-root");
  await assert.rejects(
    admitLiveEvidence({
      bundlePath: paths.bundlePath,
      repositoryRoot: missingRoot,
      verifyProvenance: async () => {},
    }),
    /repository root must be a canonical ordinary directory/,
  );

  const fileRoot = join(paths.repositoryRoot, "file-root");
  await writeFile(fileRoot, "keep");
  await assert.rejects(
    admitLiveEvidence({
      bundlePath: paths.bundlePath,
      repositoryRoot: fileRoot,
      verifyProvenance: async () => {},
    }),
    /repository root must be a canonical ordinary directory/,
  );

  await rm(paths.contentPath, { recursive: true });
  await assert.rejects(
    admitLiveEvidence({
      bundlePath: paths.bundlePath,
      repositoryRoot: paths.repositoryRoot,
      verifyProvenance: async () => {},
    }),
    /content directory must be a canonical ordinary directory/,
  );
  await mkdir(paths.contentPath);
  await writeFile(paths.developmentsPath, "keep");
  await assert.rejects(
    admitLiveEvidence({
      bundlePath: paths.bundlePath,
      repositoryRoot: paths.repositoryRoot,
      verifyProvenance: async () => {},
    }),
    /developments directory must be a canonical ordinary directory/,
  );
});

test("linked roots, namespaces and input aliases are rejected", async t => {
  if (process.platform !== "win32") return t.skip("Windows-only admission");
  const paths = await temporaryRepository(t);
  const outside = await mkdtemp(join(tmpdir(), "tax-live-links-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const linkedRoot = join(outside, "root-link");
  const linkedInput = join(outside, "input-link.json");
  const linkedAncestor = join(outside, "ancestor-link");
  try {
    await symlink(paths.repositoryRoot, linkedRoot, "junction");
    await symlink(paths.bundlePath, linkedInput, "file");
    await symlink(dirname(paths.bundlePath), linkedAncestor, "junction");
  } catch (error) {
    return t.skip(`filesystem links are unavailable: ${error.message}`);
  }
  await assert.rejects(
    admitLiveEvidence({
      bundlePath: paths.bundlePath,
      repositoryRoot: linkedRoot,
      verifyProvenance: async () => {},
    }),
    /repository root must be a canonical ordinary directory/,
  );
  for (const bundlePath of [linkedInput, join(linkedAncestor, SNAPSHOT_NAME)]) {
    await assert.rejects(
      admitLiveEvidence({
        bundlePath,
        repositoryRoot: paths.repositoryRoot,
        verifyProvenance: async () => {},
      }),
      /bundle input must be a canonical ordinary file/,
    );
  }

  const realDevelopments = join(outside, "linked-developments-target");
  await mkdir(realDevelopments);
  await rm(paths.developmentsPath, { recursive: true });
  await symlink(realDevelopments, paths.developmentsPath, "junction");
  await assert.rejects(
    admitLiveEvidence({
      bundlePath: paths.bundlePath,
      repositoryRoot: paths.repositoryRoot,
      verifyProvenance: async () => {},
    }),
    /developments directory must be a canonical ordinary directory/,
  );
  await unlink(paths.developmentsPath);
  await mkdir(paths.developmentsPath);

  const realContent = join(outside, "linked-content-target");
  await mkdir(join(realContent, "developments"), { recursive: true });
  await rm(paths.contentPath, { recursive: true });
  await symlink(realContent, paths.contentPath, "junction");
  await assert.rejects(
    admitLiveEvidence({
      bundlePath: paths.bundlePath,
      repositoryRoot: paths.repositoryRoot,
      verifyProvenance: async () => {},
    }),
    /content directory must be a canonical ordinary directory/,
  );
});

test("input must be an ordinary bounded file before private work is created", async t => {
  if (process.platform !== "win32") return t.skip("Windows-only admission");
  const paths = await temporaryRepository(t);
  const missing = join(paths.repositoryRoot, "missing.json");
  const directoryInput = join(paths.repositoryRoot, "directory-input");
  await mkdir(directoryInput);
  for (const bundlePath of [missing, directoryInput]) {
    await assert.rejects(
      admitLiveEvidence({
        bundlePath,
        repositoryRoot: paths.repositoryRoot,
        verifyProvenance: async () => {},
      }),
      /bundle input must be a canonical ordinary file/,
    );
  }

  const oversized = join(paths.repositoryRoot, "oversized.json");
  await writeFile(oversized, Buffer.alloc(1_048_577));
  let originalReads = 0;
  await assert.rejects(
    admitLiveEvidence({
      bundlePath: oversized,
      repositoryRoot: paths.repositoryRoot,
      operations: {
        readFile: async path => {
          if (resolve(path) === resolve(oversized)) originalReads += 1;
          return readFile(path);
        },
      },
      verifyProvenance: async () => {},
    }),
    /bundle input must be no more than 1048576 bytes/,
  );
  assert.equal(originalReads, 0);
  assert.deepEqual(await directoryNames(paths.contentPath), ["developments"]);
});

test("post-read size enforcement catches growth after the metadata check", async t => {
  if (process.platform !== "win32") return t.skip("Windows-only admission");
  const paths = await temporaryRepository(t);
  await writeFile(paths.bundlePath, Buffer.alloc(1_048_577));
  let reads = 0;
  const actualDetails = await lstat(paths.bundlePath);
  await assert.rejects(
    admitLiveEvidence({
      bundlePath: paths.bundlePath,
      repositoryRoot: paths.repositoryRoot,
      operations: {
        lstat: async path => {
          if (resolve(path) !== resolve(paths.bundlePath)) return lstat(path);
          return {
            size: 1,
            isFile: () => actualDetails.isFile(),
            isDirectory: () => actualDetails.isDirectory(),
            isSymbolicLink: () => actualDetails.isSymbolicLink(),
          };
        },
        readFile: async path => {
          if (resolve(path) === resolve(paths.bundlePath)) reads += 1;
          return readFile(path);
        },
      },
      verifyProvenance: async () => {},
    }),
    /bundle input must be no more than 1048576 bytes/,
  );
  assert.equal(reads, 1);
  assert.deepEqual(await directoryNames(paths.contentPath), ["developments"]);
});

test("an escaped mkdtemp result is never adopted or cleaned", async t => {
  if (process.platform !== "win32") return t.skip("Windows-only admission");
  const paths = await temporaryRepository(t);
  const escaped = join(paths.repositoryRoot, "escaped-work");
  await mkdir(escaped);
  const cleanupCalls = [];
  await assert.rejects(
    admitLiveEvidence({
      bundlePath: paths.bundlePath,
      repositoryRoot: paths.repositoryRoot,
      operations: {
        mkdtemp: async () => escaped,
        rm: async (...arguments_) => {
          cleanupCalls.push(arguments_);
          return rm(...arguments_);
        },
      },
      verifyProvenance: async () => {},
    }),
    /private work directory escaped its fixed boundary/,
  );
  assert.deepEqual(cleanupCalls, []);
  assert.deepEqual(await directoryNames(escaped), []);
  assert.deepEqual(await directoryNames(paths.developmentsPath), []);
});

test("invalid envelope abstains before provenance; deeper invalidity reaches it first", async t => {
  if (process.platform !== "win32") return t.skip("Windows-only admission");
  const invalidEnvelope = JSON.parse(fixtureBytes.toString("utf8"));
  invalidEnvelope.extra = true;
  const envelopePaths = await temporaryRepository(t, {
    bundleBytes: Buffer.from(`${JSON.stringify(invalidEnvelope)}\n`),
  });
  let envelopeVerifierCalls = 0;
  await assert.rejects(
    admitLiveEvidence({
      bundlePath: envelopePaths.bundlePath,
      repositoryRoot: envelopePaths.repositoryRoot,
      verifyProvenance: async () => { envelopeVerifierCalls += 1; },
    }),
    /live evidence envelope is invalid/,
  );
  assert.equal(envelopeVerifierCalls, 0);
  assert.deepEqual(await directoryNames(envelopePaths.developmentsPath), []);

  const semanticallyInvalid = JSON.parse(fixtureBytes.toString("utf8"));
  semanticallyInvalid.rights.attribution = "untrusted";
  const semanticPaths = await temporaryRepository(t, {
    bundleBytes: Buffer.from(`${JSON.stringify(semanticallyInvalid)}\n`),
  });
  let semanticVerifierCalls = 0;
  await assert.rejects(
    admitLiveEvidence({
      bundlePath: semanticPaths.bundlePath,
      repositoryRoot: semanticPaths.repositoryRoot,
      verifyProvenance: async ({ releaseTag }) => {
        semanticVerifierCalls += 1;
        assert.equal(releaseTag, RELEASE_TAG);
      },
    }),
    /live evidence semantics are invalid/,
  );
  assert.equal(semanticVerifierCalls, 1);
  assert.deepEqual(await directoryNames(semanticPaths.developmentsPath), []);
});

test("snapshot write, read and post-provenance drift failures never publish", async t => {
  if (process.platform !== "win32") return t.skip("Windows-only admission");
  for (const [name, overrides, message] of [
    [
      "write",
      {
        writeFile: async (path, ...arguments_) => {
          if (isPrivateSnapshot(path)) throw new Error("WRITE_SECRET");
          return writeFile(path, ...arguments_);
        },
      },
      /snapshot could not be written/,
    ],
    [
      "read",
      {
        readFile: async path => {
          if (isPrivateSnapshot(path)) throw new Error("READ_SECRET");
          return readFile(path);
        },
      },
      /snapshot could not be read/,
    ],
    [
      "drift",
      (() => {
        let snapshotReads = 0;
        return {
          readFile: async path => {
            const bytes = await readFile(path);
            if (isPrivateSnapshot(path) && ++snapshotReads === 2) {
              return Buffer.concat([bytes, Buffer.from(" ")]);
            }
            return bytes;
          },
        };
      })(),
      /snapshot changed during verification/,
    ],
  ]) {
    await t.test(name, async t => {
      const paths = await temporaryRepository(t);
      let verifierCalls = 0;
      await assert.rejects(
        admitLiveEvidence({
          bundlePath: paths.bundlePath,
          repositoryRoot: paths.repositoryRoot,
          operations: overrides,
          verifyProvenance: async () => { verifierCalls += 1; },
        }),
        error => {
          assert.match(error.message, message);
          assert.doesNotMatch(error.message, /SECRET/);
          return true;
        },
      );
      assert.equal(verifierCalls, name === "drift" ? 1 : 0);
      assert.deepEqual(await directoryNames(paths.developmentsPath), []);
    });
  }
});

test("every provenance failure category is bounded and leaves no public record", async t => {
  if (process.platform !== "win32") return t.skip("Windows-only admission");
  for (const category of [
    "GitHub CLI version check failed.",
    "GitHub CLI 2.98.0 or newer is required.",
    "GitHub CLI authentication check failed.",
    "GitHub CLI release verification capability is unavailable.",
    "GitHub CLI release asset verification capability is unavailable.",
    "GitHub CLI attestation verification capability is unavailable.",
    "Live evidence release verification failed.",
    "Live evidence asset verification failed.",
    "Live evidence attestation verification failed.",
    "PROVENANCE_SENTINEL_SECRET",
  ]) {
    await t.test(category, async t => {
      const paths = await temporaryRepository(t);
      await assert.rejects(
        admitLiveEvidence({
          bundlePath: paths.bundlePath,
          repositoryRoot: paths.repositoryRoot,
          verifyProvenance: async () => { throw new Error(category); },
        }),
        error => {
          assert.equal(error.message, "live evidence provenance verification failed");
          assert.doesNotMatch(error.message, /GitHub|SENTINEL|SECRET/);
          return true;
        },
      );
      assert.deepEqual(await directoryNames(paths.developmentsPath), []);
    });
  }
});

test("staging and promotion failures preserve developments and hide injected details", async t => {
  if (process.platform !== "win32") return t.skip("Windows-only admission");
  const failures = [
    {
      name: "child mkdir",
      expected: /staged development directory could not be created/,
      operations: {
        mkdir: async (path, ...arguments_) => {
          if (basename(dirname(path)).startsWith(".live-import-")) {
            throw new Error("MKDIR_SECRET");
          }
          return mkdir(path, ...arguments_);
        },
      },
    },
    {
      name: "child write",
      expected: /staged development could not be written/,
      operations: {
        writeFile: async (path, ...arguments_) => {
          if (basename(path) === "development.json") {
            throw new Error("WRITE_SECRET");
          }
          return writeFile(path, ...arguments_);
        },
      },
    },
    {
      name: "child reread",
      expected: /staged development could not be read/,
      operations: {
        readFile: async path => {
          if (basename(path) === "development.json") {
            throw new Error("READ_SECRET");
          }
          return readFile(path);
        },
      },
    },
    {
      name: "snapshot unlink",
      expected: /snapshot could not be removed/,
      operations: {
        unlink: async path => {
          if (basename(path) === SNAPSHOT_NAME) throw new Error("UNLINK_SECRET");
          return unlink(path);
        },
      },
    },
    {
      name: "child enumeration",
      expected: /staged development shape is invalid/,
      operations: {
        readdir: async (path, ...arguments_) => {
          if (basename(dirname(path)).startsWith(".live-import-")) {
            throw new Error("READDIR_SECRET");
          }
          return readdir(path, ...arguments_);
        },
      },
    },
    {
      name: "rename",
      expected: /live development promotion failed/,
      operations: {
        rename: async () => {
          const error = new Error("RENAME_SECRET");
          error.code = "EIO";
          throw error;
        },
      },
    },
  ];

  for (const failure of failures) {
    await t.test(failure.name, async t => {
      const paths = await temporaryRepository(t);
      const unrelated = join(paths.developmentsPath, "dev-unrelated");
      await mkdir(unrelated);
      await writeFile(join(unrelated, "development.json"), "keep");
      await assert.rejects(
        admitLiveEvidence({
          bundlePath: paths.bundlePath,
          repositoryRoot: paths.repositoryRoot,
          operations: failure.operations,
          verifyProvenance: async () => {},
        }),
        error => {
          assert.match(error.message, failure.expected);
          assert.doesNotMatch(error.message, /SECRET/);
          return true;
        },
      );
      assert.deepEqual(await directoryNames(paths.developmentsPath), ["dev-unrelated"]);
      assert.equal(await readFile(join(unrelated, "development.json"), "utf8"), "keep");
    });
  }
});

test("staged byte drift and invalid canonical bytes abstain", async t => {
  if (process.platform !== "win32") return t.skip("Windows-only admission");
  for (const [name, replacement, message] of [
    ["byte drift", Buffer.from("{}\n"), /staged development changed before validation/],
    [
      "invalid canonical bytes",
      Buffer.from('{"schema_version":"development.v2"}\n'),
      /staged development changed before validation/,
    ],
  ]) {
    await t.test(name, async t => {
      const paths = await temporaryRepository(t);
      await assert.rejects(
        admitLiveEvidence({
          bundlePath: paths.bundlePath,
          repositoryRoot: paths.repositoryRoot,
          operations: {
            readFile: async path => {
              if (basename(path) === "development.json") return replacement;
              return readFile(path);
            },
          },
          verifyProvenance: async () => {},
        }),
        message,
      );
      assert.deepEqual(await directoryNames(paths.developmentsPath), []);
    });
  }
});

test("input inside its derived target is rejected before target inspection", async t => {
  if (process.platform !== "win32") return t.skip("Windows-only admission");
  const paths = await temporaryRepository(t);
  const targetPath = join(paths.developmentsPath, DEVELOPMENT_ID);
  await mkdir(targetPath);
  const nestedInput = join(targetPath, "incoming.json");
  await copyFile(FIXTURE, nestedInput);
  await assert.rejects(
    admitLiveEvidence({
      bundlePath: nestedInput,
      repositoryRoot: paths.repositoryRoot,
      verifyProvenance: async () => {},
    }),
    /bundle input must be outside its final target/,
  );
  assert.deepEqual(await readFile(nestedInput), fixtureBytes);
  assert.deepEqual(await directoryNames(targetPath), ["incoming.json"]);
});

test("every non-exact existing target conflicts without repair", async t => {
  if (process.platform !== "win32") return t.skip("Windows-only admission");
  const expectedBytes = canonicalRecordBytes();
  const shapes = [
    {
      name: "file target",
      create: async ({ targetPath }) => writeFile(targetPath, "keep"),
      inspect: async ({ targetPath }) => assert.equal(await readFile(targetPath, "utf8"), "keep"),
    },
    {
      name: "empty directory",
      create: async ({ targetPath }) => mkdir(targetPath),
      inspect: async ({ targetPath }) => assert.deepEqual(await directoryNames(targetPath), []),
    },
    {
      name: "missing canonical file",
      create: async ({ targetPath }) => {
        await mkdir(targetPath);
        await writeFile(join(targetPath, "keep.txt"), "keep");
      },
      inspect: async ({ targetPath }) => assert.equal(
        await readFile(join(targetPath, "keep.txt"), "utf8"),
        "keep",
      ),
    },
    {
      name: "canonical directory",
      create: async ({ developmentPath, targetPath }) => {
        await mkdir(targetPath);
        await mkdir(developmentPath);
      },
      inspect: async ({ developmentPath }) => assert.equal(
        (await lstat(developmentPath)).isDirectory(),
        true,
      ),
    },
    {
      name: "different canonical bytes",
      create: async ({ developmentPath, targetPath }) => {
        await mkdir(targetPath);
        await writeFile(developmentPath, "keep");
      },
      inspect: async ({ developmentPath }) => assert.equal(
        await readFile(developmentPath, "utf8"),
        "keep",
      ),
    },
    {
      name: "exact bytes plus extra entry",
      create: async ({ developmentPath, targetPath }) => {
        await mkdir(targetPath);
        await writeFile(developmentPath, expectedBytes);
        await writeFile(join(targetPath, "extra.txt"), "keep");
      },
      inspect: async ({ targetPath }) => assert.deepEqual(
        await directoryNames(targetPath),
        ["development.json", "extra.txt"],
      ),
    },
  ];

  for (const shape of shapes) {
    await t.test(shape.name, async t => {
      const paths = await temporaryRepository(t);
      const targetPath = join(paths.developmentsPath, DEVELOPMENT_ID);
      const developmentPath = join(targetPath, "development.json");
      await shape.create({ targetPath, developmentPath, paths });
      let verifierCalls = 0;
      await assert.rejects(
        admitLiveEvidence({
          bundlePath: paths.bundlePath,
          repositoryRoot: paths.repositoryRoot,
          verifyProvenance: async () => { verifierCalls += 1; },
        }),
        /existing live development conflicts with the evidence bundle/,
      );
      assert.equal(verifierCalls, 1);
      await shape.inspect({ targetPath, developmentPath, paths });
    });
  }
});

test("linked target and linked canonical file always conflict", async t => {
  if (process.platform !== "win32") return t.skip("Windows-only admission");
  const outside = await mkdtemp(join(tmpdir(), "tax-live-target-links-"));
  t.after(() => rm(outside, { recursive: true, force: true }));

  await t.test("linked target", async t => {
    const paths = await temporaryRepository(t);
    const externalTarget = join(outside, "external-target");
    await mkdir(externalTarget);
    const marker = join(externalTarget, "keep.txt");
    await writeFile(marker, "keep");
    try {
      await symlink(
        externalTarget,
        join(paths.developmentsPath, DEVELOPMENT_ID),
        "junction",
      );
    } catch (error) {
      return t.skip(`directory links are unavailable: ${error.message}`);
    }
    await assert.rejects(
      admitLiveEvidence({
        bundlePath: paths.bundlePath,
        repositoryRoot: paths.repositoryRoot,
        verifyProvenance: async () => {},
      }),
      /existing live development conflicts with the evidence bundle/,
    );
    assert.equal(await readFile(marker, "utf8"), "keep");
  });

  await t.test("linked canonical file", async t => {
    const paths = await temporaryRepository(t);
    const targetPath = join(paths.developmentsPath, DEVELOPMENT_ID);
    await mkdir(targetPath);
    const externalFile = join(outside, "external-development.json");
    await writeFile(externalFile, canonicalRecordBytes());
    try {
      await symlink(externalFile, join(targetPath, "development.json"), "file");
    } catch (error) {
      return t.skip(`file links are unavailable: ${error.message}`);
    }
    await assert.rejects(
      admitLiveEvidence({
        bundlePath: paths.bundlePath,
        repositoryRoot: paths.repositoryRoot,
        verifyProvenance: async () => {},
      }),
      /existing live development conflicts with the evidence bundle/,
    );
    assert.deepEqual(await readFile(externalFile), canonicalRecordBytes());
  });
});

test("the immediate pre-rename check blocks a newly appeared file target", async t => {
  if (process.platform !== "win32") return t.skip("Windows-only admission");
  const paths = await temporaryRepository(t);
  const targetPath = join(paths.developmentsPath, DEVELOPMENT_ID);
  let targetInspections = 0;
  let renameCalls = 0;
  await assert.rejects(
    admitLiveEvidence({
      bundlePath: paths.bundlePath,
      repositoryRoot: paths.repositoryRoot,
      operations: {
        lstat: async path => {
          if (resolve(path) === resolve(targetPath)) {
            targetInspections += 1;
            if (targetInspections === 2) await writeFile(targetPath, "keep");
          }
          return lstat(path);
        },
        rename: async (...arguments_) => {
          renameCalls += 1;
          return rename(...arguments_);
        },
      },
      verifyProvenance: async () => {},
    }),
    /existing live development conflicts with the evidence bundle/,
  );
  assert.equal(targetInspections, 2);
  assert.equal(renameCalls, 0);
  assert.equal(await readFile(targetPath, "utf8"), "keep");
});

for (const [name, code, winnerBytes, expectedStatus, expectedError] of [
  ["identical compliant winner", "EPERM", canonicalRecordBytes, "unchanged", null],
  ["conflicting winner", "EPERM", () => Buffer.from("keep"), null, /conflicts/],
  ["arbitrary failure with identical target", "EIO", canonicalRecordBytes, null, /promotion failed/],
]) {
  test(`rename race: ${name}`, async t => {
    if (process.platform !== "win32") return t.skip("Windows-only admission");
    const paths = await temporaryRepository(t);
    const targetPath = join(paths.developmentsPath, DEVELOPMENT_ID);
    const resultPromise = admitLiveEvidence({
      bundlePath: paths.bundlePath,
      repositoryRoot: paths.repositoryRoot,
      operations: {
        rename: async () => {
          await mkdir(targetPath);
          await writeFile(join(targetPath, "development.json"), winnerBytes());
          const error = new Error("RACE_SECRET");
          error.code = code;
          throw error;
        },
      },
      verifyProvenance: async () => {},
    });
    if (expectedError === null) {
      const result = await resultPromise;
      assert.equal(result.status, expectedStatus);
      assert.deepEqual(await readFile(result.developmentPath), canonicalRecordBytes());
    } else {
      await assert.rejects(resultPromise, error => {
        assert.match(error.message, expectedError);
        assert.doesNotMatch(error.message, /RACE_SECRET/);
        return true;
      });
      assert.deepEqual(
        await readFile(join(targetPath, "development.json")),
        winnerBytes(),
      );
    }
  });
}

test("best-effort cleanup never masks failure or success and targets only owned work", async t => {
  if (process.platform !== "win32") return t.skip("Windows-only admission");
  await t.test("primary failure", async t => {
    const paths = await temporaryRepository(t);
    const cleanupTargets = [];
    await assert.rejects(
      admitLiveEvidence({
        bundlePath: paths.bundlePath,
        repositoryRoot: paths.repositoryRoot,
        operations: {
          rm: async path => {
            cleanupTargets.push(path);
            throw new Error("CLEANUP_SECRET");
          },
        },
        verifyProvenance: async () => { throw new Error("PRIMARY_SECRET"); },
      }),
      error => {
        assert.equal(error.message, "live evidence provenance verification failed");
        assert.doesNotMatch(error.message, /SECRET/);
        return true;
      },
    );
    assert.equal(cleanupTargets.length, 1);
    assert.equal(dirname(cleanupTargets[0]), paths.contentPath);
    assert.match(basename(cleanupTargets[0]), /^\.live-import-.+$/);
    assert.notEqual(resolve(cleanupTargets[0]), resolve(paths.developmentsPath));
    assert.deepEqual(await directoryNames(paths.developmentsPath), []);
  });

  await t.test("successful promotion", async t => {
    const paths = await temporaryRepository(t);
    const cleanupTargets = [];
    const result = await admitLiveEvidence({
      bundlePath: paths.bundlePath,
      repositoryRoot: paths.repositoryRoot,
      operations: {
        rm: async path => {
          cleanupTargets.push(path);
          throw new Error("CLEANUP_SECRET");
        },
      },
      verifyProvenance: async () => {},
    });
    assert.equal(result.status, "imported");
    assert.equal(cleanupTargets.length, 1);
    assert.equal(dirname(cleanupTargets[0]), paths.contentPath);
    assert.match(basename(cleanupTargets[0]), /^\.live-import-.+$/);
    assert.deepEqual(await readFile(result.developmentPath), canonicalRecordBytes());
    assert.equal(
      (await directoryNames(paths.contentPath)).some(name => name.startsWith(".live-import-")),
      true,
    );
  });
});

test("filesystem failures expose fixed bounded public messages", async t => {
  if (process.platform !== "win32") return t.skip("Windows-only admission");
  const paths = await temporaryRepository(t);
  await assert.rejects(
    admitLiveEvidence({
      bundlePath: paths.bundlePath,
      repositoryRoot: paths.repositoryRoot,
      operations: {
        lstat: async () => { throw new Error("FILESYSTEM_SENTINEL_SECRET"); },
      },
      verifyProvenance: async () => {},
    }),
    error => {
      assert.equal(
        error.message,
        "repository root must be a canonical ordinary directory",
      );
      assert.doesNotMatch(error.message, /SENTINEL|SECRET/);
      assert.ok(error.message.length < 100);
      return true;
    },
  );

  await assert.rejects(
    admitLiveEvidence({
      bundlePath: paths.bundlePath,
      repositoryRoot: paths.repositoryRoot,
      operations: {
        realpath: async () => ({ sentinel: "RETURNED_FILESYSTEM_SECRET" }),
      },
      verifyProvenance: async () => {},
    }),
    error => {
      assert.equal(
        error.message,
        "repository root must be a canonical ordinary directory",
      );
      assert.doesNotMatch(error.message, /RETURNED|SECRET/);
      return true;
    },
  );
});
