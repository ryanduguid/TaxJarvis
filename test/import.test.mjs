// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseEvidenceBundle } from "../evidence-bundle.mjs";
import * as legacyImport from "../import.mjs";
import { buildSite, validateDevelopment } from "../site.mjs";

const { importEvidenceBundle } = legacyImport;

const GOLDEN = fileURLToPath(
  new URL("./fixtures/evidence-bundle.v1.json", import.meta.url),
);
const IMPORT_COMMAND = fileURLToPath(new URL("../import.mjs", import.meta.url));
const DEVELOPMENT_ID = "dev-frl-c2099a00001-c2099c00002";

test("legacy module exports only function-level v1 conformance", () => {
  assert.deepEqual(Object.keys(legacyImport), ["importEvidenceBundle"]);
});

async function temporaryContentRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "tax-import-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const contentRoot = join(root, "developments");
  await mkdir(contentRoot);
  return { root, contentRoot };
}

function runLegacyImport(arguments_) {
  return spawnSync(process.execPath, [IMPORT_COMMAND, ...arguments_], {
    encoding: "utf8",
  });
}

test("default function rejects synthetic bundles", async t => {
  const { contentRoot } = await temporaryContentRoot(t);
  await assert.rejects(
    importEvidenceBundle({ bundlePath: GOLDEN, contentRoot }),
    /synthetic evidence bundles are not accepted/,
  );
  assert.deepEqual(await readdir(contentRoot), []);
});

test("function-only synthetic override imports one canonical record", async t => {
  const { contentRoot } = await temporaryContentRoot(t);
  const result = await importEvidenceBundle({
    bundlePath: GOLDEN,
    contentRoot,
    allowSynthetic: true,
  });
  const developmentPath = join(contentRoot, DEVELOPMENT_ID, "development.json");
  assert.deepEqual(result, {
    status: "imported",
    developmentPath,
    bundleSha256:
      "sha256:04c032d9f5cbe9414739beff7452cffd0b5b6482c7554769663e7698df98c15c",
  });
  const canonical = JSON.parse(await readFile(developmentPath, "utf8"));
  assert.deepEqual(validateDevelopment(canonical), {
    ok: true,
    value: canonical,
  });
  assert.equal(canonical.schema_version, "development.v2");
  assert.equal(canonical.mode, "synthetic");
});

test("reimporting exact bytes is an idempotent byte-preserving no-op", async t => {
  const { contentRoot } = await temporaryContentRoot(t);
  const first = await importEvidenceBundle({
    bundlePath: GOLDEN,
    contentRoot,
    allowSynthetic: true,
  });
  const before = await readFile(first.developmentPath);
  const second = await importEvidenceBundle({
    bundlePath: GOLDEN,
    contentRoot,
    allowSynthetic: true,
  });
  assert.equal(second.status, "unchanged");
  assert.deepEqual(await readFile(first.developmentPath), before);
  assert.deepEqual(await readdir(contentRoot), [DEVELOPMENT_ID]);
});

for (const [name, mutate] of [
  ["bundle digest", value => { value.upstream.bundle_sha256 = `sha256:${"0".repeat(64)}`; }],
  ["bundle identity", value => { value.upstream.bundle_id = "bundle-conflict-r1"; }],
  ["canonical content", value => { value.title = "Conflicting title"; value.sources[0].title = "Conflicting title"; }],
]) {
  test(`existing ${name} conflict preserves its exact bytes`, async t => {
    const { contentRoot } = await temporaryContentRoot(t);
    const imported = await importEvidenceBundle({
      bundlePath: GOLDEN,
      contentRoot,
      allowSynthetic: true,
    });
    const value = JSON.parse(await readFile(imported.developmentPath, "utf8"));
    mutate(value);
    const conflictingBytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    await writeFile(imported.developmentPath, conflictingBytes);

    await assert.rejects(
      importEvidenceBundle({
        bundlePath: GOLDEN,
        contentRoot,
        allowSynthetic: true,
      }),
      /conflicts with the evidence bundle/,
    );
    assert.deepEqual(await readFile(imported.developmentPath), conflictingBytes);
  });
}

test("existing file target is rejected without mutation", async t => {
  const { contentRoot } = await temporaryContentRoot(t);
  const target = join(contentRoot, DEVELOPMENT_ID);
  await writeFile(target, "keep");
  await assert.rejects(
    importEvidenceBundle({ bundlePath: GOLDEN, contentRoot, allowSynthetic: true }),
    /target must be an ordinary directory or absent/,
  );
  assert.equal(await readFile(target, "utf8"), "keep");
});

test("existing linked target is rejected without touching its target", async t => {
  const { root, contentRoot } = await temporaryContentRoot(t);
  const linkedTarget = join(root, "linked-target");
  await mkdir(linkedTarget);
  const marker = join(linkedTarget, "keep.txt");
  await writeFile(marker, "keep");
  try {
    await symlink(linkedTarget, join(contentRoot, DEVELOPMENT_ID), "junction");
  } catch (error) {
    t.skip(`directory links are unavailable: ${error.message}`);
    return;
  }
  await assert.rejects(
    importEvidenceBundle({ bundlePath: GOLDEN, contentRoot, allowSynthetic: true }),
    /target must be an ordinary directory or absent/,
  );
  assert.equal(await readFile(marker, "utf8"), "keep");
});

test("idempotency rejects a linked canonical record", async t => {
  const { root, contentRoot } = await temporaryContentRoot(t);
  const imported = await importEvidenceBundle({
    bundlePath: GOLDEN,
    contentRoot,
    allowSynthetic: true,
  });
  const canonicalBytes = await readFile(imported.developmentPath);
  const externalRecord = join(root, "external-development.json");
  await writeFile(externalRecord, canonicalBytes);
  await rm(imported.developmentPath);
  try {
    await symlink(externalRecord, imported.developmentPath, "file");
  } catch (error) {
    t.skip(`file links are unavailable: ${error.message}`);
    return;
  }

  await assert.rejects(
    importEvidenceBundle({
      bundlePath: GOLDEN,
      contentRoot,
      allowSynthetic: true,
    }),
    /existing development conflicts with the evidence bundle/,
  );
  assert.deepEqual(await readFile(externalRecord), canonicalBytes);
});

for (const operation of ["writeFile", "rename"]) {
  test(`${operation} failure leaves no target or staging directory`, async t => {
    const { contentRoot } = await temporaryContentRoot(t);
    const unrelated = join(contentRoot, "dev-unrelated");
    await mkdir(unrelated);
    const marker = join(unrelated, "development.json");
    await writeFile(marker, "keep");
    const operations = {
      [operation]: async () => { throw new Error(`injected ${operation} failure`); },
    };

    await assert.rejects(
      importEvidenceBundle({
        bundlePath: GOLDEN,
        contentRoot,
        allowSynthetic: true,
        operations,
      }),
      new RegExp(`injected ${operation} failure`),
    );
    assert.equal(await readFile(marker, "utf8"), "keep");
    assert.deepEqual(await readdir(contentRoot), ["dev-unrelated"]);
  });
}

test("malformed input performs no write operation", async t => {
  const { root, contentRoot } = await temporaryContentRoot(t);
  const malformed = join(root, "malformed.json");
  await writeFile(malformed, '{"mode":"live","mode":"synthetic"}');
  let mkdirCalls = 0;
  let writeCalls = 0;
  await assert.rejects(
    importEvidenceBundle({
      bundlePath: malformed,
      contentRoot,
      allowSynthetic: true,
      operations: {
        mkdir: async () => { mkdirCalls += 1; },
        writeFile: async () => { writeCalls += 1; },
      },
    }),
    /duplicate JSON member/,
  );
  assert.equal(mkdirCalls, 0);
  assert.equal(writeCalls, 0);
  assert.deepEqual(await readdir(contentRoot), []);
});

test("input and content-root preflight rejects unsafe filesystem shapes", async t => {
  const { root, contentRoot } = await temporaryContentRoot(t);
  const directoryInput = join(root, "directory-input");
  await mkdir(directoryInput);
  await assert.rejects(
    importEvidenceBundle({
      bundlePath: directoryInput,
      contentRoot,
      allowSynthetic: true,
    }),
    /bundle input must be an ordinary file/,
  );

  const oversized = join(root, "oversized.json");
  await writeFile(oversized, Buffer.alloc(1_048_577));
  await assert.rejects(
    importEvidenceBundle({ bundlePath: oversized, contentRoot, allowSynthetic: true }),
    /no more than 1048576 bytes/,
  );

  const fileRoot = join(root, "file-root");
  await writeFile(fileRoot, "keep");
  await assert.rejects(
    importEvidenceBundle({ bundlePath: GOLDEN, contentRoot: fileRoot, allowSynthetic: true }),
    /content root must be an ordinary directory/,
  );
});

test("input and content-root preflight rejects filesystem links", async t => {
  const { root, contentRoot } = await temporaryContentRoot(t);
  const inputLink = join(root, "bundle-link.json");
  const linkedRoot = join(root, "linked-root");
  try {
    await symlink(GOLDEN, inputLink, "file");
    await symlink(contentRoot, linkedRoot, "junction");
  } catch (error) {
    t.skip(`filesystem links are unavailable: ${error.message}`);
    return;
  }
  await assert.rejects(
    importEvidenceBundle({
      bundlePath: inputLink,
      contentRoot,
      allowSynthetic: true,
    }),
    /bundle input must be an ordinary file/,
  );
  await assert.rejects(
    importEvidenceBundle({
      bundlePath: GOLDEN,
      contentRoot: linkedRoot,
      allowSynthetic: true,
    }),
    /content root must be an ordinary directory/,
  );
});

test("bundle input inside its final target is rejected before writing", async t => {
  const { contentRoot } = await temporaryContentRoot(t);
  const target = join(contentRoot, DEVELOPMENT_ID);
  await mkdir(target);
  const nestedBundle = join(target, "incoming.json");
  await cp(GOLDEN, nestedBundle);
  const before = await readFile(nestedBundle);
  await assert.rejects(
    importEvidenceBundle({
      bundlePath: nestedBundle,
      contentRoot,
      allowSynthetic: true,
    }),
    /bundle input must be outside its final target/,
  );
  assert.deepEqual(await readFile(nestedBundle), before);
});

test("direct legacy execution refuses before parsing or content mutation", async t => {
  const { root, contentRoot } = await temporaryContentRoot(t);
  const sentinelDirectory = join(contentRoot, "dev-sentinel");
  const sentinelPath = join(sentinelDirectory, "development.json");
  await mkdir(sentinelDirectory);
  await writeFile(sentinelPath, "keep");

  const liveBundle = join(root, "live-v1.json");
  const liveValue = JSON.parse(await readFile(GOLDEN, "utf8"));
  liveValue.mode = "live";
  liveValue.sources[0].canonical_url =
    "https://www.legislation.gov.au/C2099A00001/latest/text";
  liveValue.sources[0].rights.attribution = "Federal Register of Legislation";
  const liveBytes = Buffer.from(`${JSON.stringify(liveValue, null, 2)}\n`);
  assert.equal(parseEvidenceBundle(liveBytes).bundle.mode, "live");
  await writeFile(liveBundle, liveBytes);
  const malformed = join(root, "malformed.json");
  await writeFile(malformed, '{"mode":"live","mode":"synthetic"}');
  const nonexistent = join(root, "does-not-exist.json");

  for (const input of [liveBundle, malformed, nonexistent]) {
    const result = runLegacyImport([
      "--bundle",
      input,
      "--content-root",
      contentRoot,
    ]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      "Direct import.mjs execution is disabled; use npm run import-bundle -- --bundle <file>.\n",
    );
    assert.deepEqual(await readdir(contentRoot), ["dev-sentinel"]);
    assert.equal(await readFile(sentinelPath, "utf8"), "keep");
  }
});

test("an isolated imported v2 record builds every public format", async t => {
  const rootDir = await mkdtemp(join(tmpdir(), "tax-import-build-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const contentRoot = join(rootDir, "content", "developments");
  await mkdir(contentRoot, { recursive: true });
  await mkdir(join(rootDir, "assets"));
  await cp(
    new URL("../assets/site.css", import.meta.url),
    join(rootDir, "assets", "site.css"),
  );
  await importEvidenceBundle({
    bundlePath: GOLDEN,
    contentRoot,
    allowSynthetic: true,
  });

  const paths = await buildSite({
    rootDir,
    siteUrl: "https://publisher.example/",
  });
  assert.equal(paths.includes(`developments/${DEVELOPMENT_ID}/index.html`), true);
  for (const relativePath of [
    "index.html",
    `developments/${DEVELOPMENT_ID}/index.html`,
    "feed.xml",
    "feed.json",
  ]) {
    const output = await readFile(join(rootDir, "out", relativePath), "utf8");
    assert.match(output, new RegExp(DEVELOPMENT_ID));
    assert.match(output, /synthetic/i);
  }
});
