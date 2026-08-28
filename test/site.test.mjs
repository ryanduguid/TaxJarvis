// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateDevelopment } from "../site.mjs";

const fixtureUrl = new URL(
  "../content/developments/dev-demo-001/development.json",
  import.meta.url,
);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));

test("repository contract: package has no package graph", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.engines.node, ">=24.19.0");
  assert.equal(packageJson.engines.npm, ">=11.17.0");
  assert.equal(Object.hasOwn(packageJson, "dependencies"), false);
  assert.equal(Object.hasOwn(packageJson, "devDependencies"), false);
});

test("canonical fixture: validation accepts the source-only record", () => {
  assert.deepEqual(validateDevelopment(fixture), {
    ok: true,
    value: fixture,
  });
});
