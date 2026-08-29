// SPDX-License-Identifier: AGPL-3.0-only

const DEFAULT_MAXIMUM_BYTES = 1_048_576;
const MAXIMUM_NESTING_DEPTH = 128;
const JSON_WHITESPACE = new Set([" ", "\t", "\r", "\n"]);
const SIMPLE_ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t"]);
const HEX_DIGIT = /^[0-9a-fA-F]$/;
const DECIMAL_DIGIT = /^[0-9]$/;
const NON_ZERO_DIGIT = /^[1-9]$/;

export class StrictJsonError extends Error {
  constructor(message) {
    super(message);
    this.name = "StrictJsonError";
  }
}

function skipWhitespace(state) {
  while (JSON_WHITESPACE.has(state.source[state.index])) state.index += 1;
}

function expect(state, character) {
  if (state.source[state.index] !== character) {
    throw new StrictJsonError("JSON contains invalid container punctuation");
  }
  state.index += 1;
}

function enterContainer(state) {
  state.depth += 1;
  if (state.depth > MAXIMUM_NESTING_DEPTH) {
    throw new StrictJsonError("JSON exceeds the permitted nesting depth");
  }
}

function parseString(state) {
  if (state.source[state.index] !== '"') {
    throw new StrictJsonError("JSON object members and strings must be quoted");
  }
  const start = state.index;
  state.index += 1;
  while (state.index < state.source.length) {
    const character = state.source[state.index];
    if (character === '"') {
      state.index += 1;
      const token = state.source.slice(start, state.index);
      let value;
      try {
        value = JSON.parse(token);
      } catch {
        throw new StrictJsonError("JSON contains an invalid string");
      }
      if (state.canonicalScalars && token !== JSON.stringify(value)) {
        throw new StrictJsonError("JSON string must use its canonical scalar spelling");
      }
      return value;
    }
    if (character.charCodeAt(0) < 0x20) {
      throw new StrictJsonError("JSON strings must not contain control characters");
    }
    if (character !== "\\") {
      state.index += 1;
      continue;
    }

    state.index += 1;
    const escape = state.source[state.index];
    if (escape === "u") {
      for (let offset = 1; offset <= 4; offset += 1) {
        if (!HEX_DIGIT.test(state.source[state.index + offset] ?? "")) {
          throw new StrictJsonError("JSON contains an invalid Unicode escape");
        }
      }
      state.index += 5;
      continue;
    }
    if (!SIMPLE_ESCAPES.has(escape)) {
      throw new StrictJsonError("JSON contains an invalid string escape");
    }
    state.index += 1;
  }
  throw new StrictJsonError("JSON contains an unterminated string");
}

function parseNumber(state) {
  const start = state.index;
  if (state.source[state.index] === "-") state.index += 1;

  if (state.source[state.index] === "0") {
    state.index += 1;
  } else if (NON_ZERO_DIGIT.test(state.source[state.index] ?? "")) {
    state.index += 1;
    while (DECIMAL_DIGIT.test(state.source[state.index] ?? "")) state.index += 1;
  } else {
    throw new StrictJsonError("JSON contains an invalid number");
  }

  if (state.source[state.index] === ".") {
    state.index += 1;
    if (!DECIMAL_DIGIT.test(state.source[state.index] ?? "")) {
      throw new StrictJsonError("JSON contains an invalid number");
    }
    while (DECIMAL_DIGIT.test(state.source[state.index] ?? "")) state.index += 1;
  }

  if (state.source[state.index] === "e" || state.source[state.index] === "E") {
    state.index += 1;
    if (state.source[state.index] === "+" || state.source[state.index] === "-") {
      state.index += 1;
    }
    if (!DECIMAL_DIGIT.test(state.source[state.index] ?? "")) {
      throw new StrictJsonError("JSON contains an invalid number");
    }
    while (DECIMAL_DIGIT.test(state.source[state.index] ?? "")) state.index += 1;
  }

  let value;
  try {
    value = JSON.parse(state.source.slice(start, state.index));
  } catch {
    throw new StrictJsonError("JSON contains an invalid number");
  }
  if (!Number.isFinite(value)) {
    throw new StrictJsonError("JSON numbers must resolve to a finite JSON number");
  }
  if (
    state.canonicalScalars &&
    state.source.slice(start, state.index) !== JSON.stringify(value)
  ) {
    throw new StrictJsonError("JSON number must use its canonical scalar spelling");
  }
  return value;
}

function parseLiteral(state, token, value) {
  if (!state.source.startsWith(token, state.index)) {
    throw new StrictJsonError("JSON contains an invalid literal");
  }
  state.index += token.length;
  return value;
}

function parseArray(state) {
  enterContainer(state);
  state.index += 1;
  try {
    skipWhitespace(state);
    const values = [];
    if (state.source[state.index] === "]") {
      state.index += 1;
      return values;
    }
    while (true) {
      values.push(parseValue(state));
      skipWhitespace(state);
      if (state.source[state.index] === "]") {
        state.index += 1;
        return values;
      }
      expect(state, ",");
      skipWhitespace(state);
    }
  } finally {
    state.depth -= 1;
  }
}

function parseObject(state) {
  enterContainer(state);
  state.index += 1;
  try {
    skipWhitespace(state);
    const entries = [];
    const keys = new Set();
    if (state.source[state.index] === "}") {
      state.index += 1;
      return {};
    }
    while (true) {
      const key = parseString(state);
      if (keys.has(key)) {
        throw new StrictJsonError("JSON contains a duplicate JSON member");
      }
      keys.add(key);
      skipWhitespace(state);
      expect(state, ":");
      skipWhitespace(state);
      entries.push([key, parseValue(state)]);
      skipWhitespace(state);
      if (state.source[state.index] === "}") {
        state.index += 1;
        return Object.fromEntries(entries);
      }
      expect(state, ",");
      skipWhitespace(state);
    }
  } finally {
    state.depth -= 1;
  }
}

function parseValue(state) {
  const character = state.source[state.index];
  if (character === "{") return parseObject(state);
  if (character === "[") return parseArray(state);
  if (character === '"') return parseString(state);
  if (character === "t") return parseLiteral(state, "true", true);
  if (character === "f") return parseLiteral(state, "false", false);
  if (character === "n") return parseLiteral(state, "null", null);
  if (character === "-" || DECIMAL_DIGIT.test(character ?? "")) {
    return parseNumber(state);
  }
  throw new StrictJsonError("input must contain one JSON value");
}

export function parseStrictJsonBytes(
  input,
  { maximumBytes = DEFAULT_MAXIMUM_BYTES, canonicalScalars = false } = {},
) {
  if (!(input instanceof Uint8Array)) {
    throw new StrictJsonError("strict JSON input must be a Uint8Array");
  }
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new StrictJsonError("maximumBytes must be a positive safe integer");
  }
  if (input.byteLength > maximumBytes) {
    throw new StrictJsonError("strict JSON input exceeds the maximum byte size");
  }

  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    throw new StrictJsonError("strict JSON input must be valid UTF-8");
  }
  const state = { source, index: 0, depth: 0, canonicalScalars };
  skipWhitespace(state);
  const value = parseValue(state);
  skipWhitespace(state);
  if (state.index !== source.length) {
    throw new StrictJsonError("JSON contains trailing input");
  }
  return value;
}
