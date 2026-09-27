// SPDX-License-Identifier: AGPL-3.0-only
// Compile only. These checks must reject unsafe boundary assumptions.
import { parseStrictJsonBytes } from "../strict-json.mjs";
import { exactKeys, isIdentifier, text, type ValidationError } from "../validation-primitives.mjs";

const raw = parseStrictJsonBytes(new Uint8Array());
// @ts-expect-error Parsing JSON does not establish a record schema.
raw.bundle_id;

const errors: ValidationError[] = [];
// A rejected identifier or text value can still be a string.
const invalidString: string = "";
if (!isIdentifier(invalidString)) invalidString.toUpperCase();
if (!text(errors, invalidString, "title", 80)) invalidString.toUpperCase();

if (exactKeys(errors, raw, "$", new Set(["bundle_id"]))) {
  // @ts-expect-error An object check does not validate individual fields.
  raw.bundle_id.toLowerCase();
}
// @ts-expect-error Diagnostics require a string path.
errors.push({ path: 42, message: "invalid" });

