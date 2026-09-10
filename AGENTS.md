# Repository instructions

Read [README.md](README.md) before changing records, admission or publication.
This is a source-only demonstration. Keep synthetic fixtures distinct from
authenticated historical metadata; a build does not recheck a source or establish
its current legal effect.

- Edit canonical records under `content/developments/`; HTML, RSS and JSON in
  `out/` are generated projections.
- For live admission work, read the README's Authenticated live admission section
  and [docs/live-admission.md](docs/live-admission.md). Preserve Windows-only
  admission, exact-byte provenance checks and immutable destination behaviour.
- Keep rejected values and private paths out of validation diagnostics.
- Hosted activation, further live imports and deployment require separate
  authorisation. The README also defines the current contribution restriction.

Before handoff, run the applicable scripts in `package.json` and checks in
[publish.yml](.github/workflows/publish.yml). Report Windows-only admission tests
separately from tests that pass or skip on another platform. Building or testing
the site does not authorise its deployment.
