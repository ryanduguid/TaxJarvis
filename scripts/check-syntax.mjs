#!/usr/bin/env node
// Syntax-check every ES module in the repository root and test/ with
// `node --check`. The file list is discovered at run time, so a new module or
// test file is covered without anyone remembering to edit package.json.
// Stops at the first file that fails to parse and exits non-zero.

import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patterns = ["*.mjs", "test/*.mjs"];

const files = [...new Set(patterns.flatMap((pattern) => globSync(pattern, { cwd: root })))].sort();

if (files.length === 0) {
  console.error(`check-syntax: no files matched ${patterns.join(", ")} under ${root}`);
  process.exit(1);
}

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { cwd: root, stdio: "inherit" });
  if (result.error) {
    console.error(`check-syntax: could not run node --check on ${file}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`check-syntax: ${file} failed node --check`);
    process.exit(result.status ?? 1);
  }
}

console.log(`check-syntax: ${files.length} files passed node --check`);
