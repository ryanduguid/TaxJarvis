// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import {
  parseStrictJsonBytes,
  StrictJsonError,
} from "../strict-json.mjs";

const encoder = new TextEncoder();
const bytes = value => encoder.encode(value);

test("strict JSON parses valid nested values from bytes", () => {
  const input = bytes(
    '{"object":{"text":"Australian tax","truth":true},"array":[null,-12.5e2,[]]}',
  );
  assert.deepEqual(parseStrictJsonBytes(input), {
    object: { text: "Australian tax", truth: true },
    array: [null, -1250, []],
  });
});

test("strict JSON accepts Buffer and a caller-supplied byte limit", () => {
  assert.deepEqual(
    parseStrictJsonBytes(Buffer.from("{}"), { maximumBytes: 2 }),
    {},
  );
  assert.throws(
    () => parseStrictJsonBytes(bytes("{}"), { maximumBytes: 1 }),
    /maximum byte size/,
  );
});

test("strict JSON canonical scalar checks are opt-in", () => {
  const alternate = bytes(String.raw`{"\u0061":200.0,"path":"a\/b","zero":-0}`);
  assert.deepEqual(parseStrictJsonBytes(alternate), {
    a: 200,
    path: "a/b",
    zero: -0,
  });

  for (const source of [
    String.raw`{"\u0061":200}`,
    '{"a":200.0}',
    '{"a":2e2}',
    String.raw`{"a":"a\/b"}`,
    '{"a":-0}',
  ]) {
    assert.throws(
      () => parseStrictJsonBytes(bytes(source), { canonicalScalars: true }),
      /canonical scalar/,
    );
  }

  assert.deepEqual(
    parseStrictJsonBytes(bytes(' { "b" : 2, "a" : 1 }\n'), {
      canonicalScalars: true,
    }),
    { b: 2, a: 1 },
  );
});

test("strict JSON rejects empty and whitespace-only input", () => {
  for (const source of ["", " \t\r\n"]) {
    assert.throws(
      () => parseStrictJsonBytes(bytes(source)),
      error => error instanceof StrictJsonError && /JSON value/.test(error.message),
    );
  }
});

test("strict JSON rejects input larger than one MiB by default", () => {
  const oversized = new Uint8Array(1_048_577);
  assert.throws(
    () => parseStrictJsonBytes(oversized),
    /maximum byte size/,
  );
});

test("strict JSON rejects malformed UTF-8", () => {
  assert.throws(
    () => parseStrictJsonBytes(Uint8Array.from([0x7b, 0x22, 0xc3, 0x28])),
    /valid UTF-8/,
  );
});

test("strict JSON rejects trailing input", () => {
  for (const source of ["{}{}", "true false", "[]x"]) {
    assert.throws(() => parseStrictJsonBytes(bytes(source)), /trailing input/);
  }
});

test("strict JSON rejects duplicate decoded members at every depth", () => {
  for (const source of [
    '{"a":1,"a":2}',
    '{"outer":{"a":1,"a":2}}',
    '{"a":1,"\\u0061":2}',
  ]) {
    assert.throws(
      () => parseStrictJsonBytes(bytes(source)),
      /duplicate JSON member/,
    );
  }
});

test("strict JSON rejects invalid number grammar", () => {
  for (const source of ["01", "1.", "1e", "1e+", "-", "+1", ".1", "--1"]) {
    assert.throws(
      () => parseStrictJsonBytes(bytes(source)),
      error => error instanceof StrictJsonError,
    );
  }
});

test("strict JSON rejects numbers that become non-finite", () => {
  assert.throws(
    () => parseStrictJsonBytes(bytes('{"value":1e999}')),
    /finite JSON number/,
  );
});

test("strict JSON rejects malformed strings and container punctuation", () => {
  for (const source of [
    '"unterminated',
    '"bad\\xescape"',
    '"line\nbreak"',
    "[1,]",
    '{"a" 1}',
    '{"a":1,}',
  ]) {
    assert.throws(
      () => parseStrictJsonBytes(bytes(source)),
      error => error instanceof StrictJsonError,
    );
  }
});

test("strict JSON bounds recursive container depth", () => {
  const source = `${"[".repeat(129)}null${"]".repeat(129)}`;
  assert.throws(
    () => parseStrictJsonBytes(bytes(source)),
    /nesting depth/,
  );
});

test("strict JSON rejects unsupported input and limit types", () => {
  assert.throws(() => parseStrictJsonBytes("{}"), /Uint8Array/);
  for (const maximumBytes of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () => parseStrictJsonBytes(bytes("{}"), { maximumBytes }),
      /maximumBytes/,
    );
  }
});
