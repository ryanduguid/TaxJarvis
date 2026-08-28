// SPDX-License-Identifier: AGPL-3.0-only

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{2,79}$/;
const UTC_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isIdentifier(value) {
  return typeof value === "string" && IDENTIFIER.test(value);
}

function addError(errors, path, message) {
  errors.push({ path, message });
}

export function exactKeys(errors, value, path, allowed) {
  if (!isRecord(value)) {
    addError(errors, path, "must be an object");
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      addError(errors, path === "$" ? key : `${path}.${key}`, "is not allowed");
    }
  }
  return true;
}

export function isXmlText(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== 0x09 &&
      codePoint !== 0x0a &&
      codePoint !== 0x0d &&
      (codePoint < 0x20 || codePoint > 0xd7ff) &&
      (codePoint < 0xe000 || codePoint > 0xfffd) &&
      (codePoint < 0x10000 || codePoint > 0x10ffff)
    ) return false;
  }
  return true;
}

export function text(errors, value, path, maximum) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value.length > maximum ||
    !isXmlText(value)
  ) {
    addError(
      errors,
      path,
      `must be trimmed text of 1 to ${maximum} characters`,
    );
    return false;
  }
  return true;
}

export function oneOf(errors, value, path, allowed) {
  if (!allowed.has(value)) {
    addError(errors, path, "has an unsupported value");
    return false;
  }
  return true;
}

export function timestampKey(value) {
  if (typeof value !== "string") return null;
  const match = UTC_TIMESTAMP.exec(value);
  if (match === null) return null;
  return `${value.slice(0, 19)}.${(match[7] ?? "").padEnd(9, "0")}Z`;
}

export function utcTimestamp(errors, value, path, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string") {
    addError(errors, path, "must be an RFC 3339 UTC timestamp");
    return null;
  }
  const match = UTC_TIMESTAMP.exec(value);
  const key = timestampKey(value);
  const milliseconds = Date.parse(value);
  if (!match || key === null || !Number.isFinite(milliseconds)) {
    addError(errors, path, "must be an RFC 3339 UTC timestamp");
    return null;
  }
  const parsed = new Date(milliseconds);
  const parts = match.slice(1, 7).map(Number);
  const actual = [
    parsed.getUTCFullYear(),
    parsed.getUTCMonth() + 1,
    parsed.getUTCDate(),
    parsed.getUTCHours(),
    parsed.getUTCMinutes(),
    parsed.getUTCSeconds(),
  ];
  if (parts.some((part, index) => part !== actual[index])) {
    addError(errors, path, "must identify a real UTC date and time");
    return null;
  }
  return key;
}

export function isArtificialHostname(hostname) {
  const normalised = hostname.toLowerCase().replace(/\.+$/, "");
  return normalised === "invalid" || normalised.endsWith(".invalid");
}

export function httpsUrl(
  errors,
  value,
  path,
  { nullable = false, allowInvalidHost = false } = {},
) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value.length > 2048) {
    addError(errors, path, "must be an HTTPS URL of at most 2048 characters");
    return null;
  }
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      (!allowInvalidHost && isArtificialHostname(parsed.hostname))
    ) throw new TypeError("unsafe URL");
    return parsed;
  } catch {
    addError(errors, path, "must be a permitted HTTPS URL");
    return null;
  }
}

export function labelList(errors, value, path) {
  if (!Array.isArray(value) || value.length > 20) {
    addError(errors, path, "must be an array of at most 20 labels");
    return;
  }
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const label = value[index];
    if (text(errors, label, `${path}[${index}]`, 80)) {
      if (seen.has(label)) addError(errors, path, "must contain unique labels");
      seen.add(label);
    }
  }
}
