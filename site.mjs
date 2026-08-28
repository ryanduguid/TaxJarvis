// SPDX-License-Identifier: AGPL-3.0-only
export function validateDevelopment(input) {
  const errors = [];

  if (input?.schema_version !== "development.v1") {
    errors.push({
      path: "schema_version",
      message: "must equal development.v1",
    });
  }
  if (input?.development_id !== "dev-demo-001") {
    errors.push({
      path: "development_id",
      message: "must identify the canonical demonstration record",
    });
  }
  if (input?.fixture !== true) {
    errors.push({ path: "fixture", message: "must be true" });
  }
  if (input?.publication_status !== "source-only") {
    errors.push({
      path: "publication_status",
      message: "must equal source-only",
    });
  }
  if (input?.explainer !== null) {
    errors.push({ path: "explainer", message: "must be null" });
  }

  return errors.length === 0
    ? { ok: true, value: input }
    : { ok: false, errors };
}
