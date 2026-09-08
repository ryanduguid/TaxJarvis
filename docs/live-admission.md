# First authenticated source admission

The supported Windows importer admitted the Superannuation Industry (Supervision)
Act 1993 metadata record from the producer's 30 August 2026 capture. No source
text, commencement conclusion or practical-impact explanation was added.

The asset is `bundle-frl-c2004a04633-c2026c00361-r1.json`, from
[this producer release](https://github.com/ryanduguid/au-tax-legislation-corpus/releases/tag/live-evidence-v2-497935ec1acafd3996abd2a3b748f9a29b6578b8be5ea9e28648e7040958fc06).
Its SHA-256 is `575ad9fe2337187abd491dd3e7a9455acb187961dcbf6599154f9250439412ec`.

The unmodified importer verified the release, the asset's exact bytes and its
SLSA attestation, constrained to the producer workflow, main source ref and
hosted runners. All three checks passed before admission. No verification
override or test seam was used.

## Reproduce on Windows

From the repository root, download the asset into an empty directory outside
the repository, then use its absolute path:

```powershell
gh release download live-evidence-v2-497935ec1acafd3996abd2a3b748f9a29b6578b8be5ea9e28648e7040958fc06 --repo ryanduguid/au-tax-legislation-corpus --pattern bundle-frl-c2004a04633-c2026c00361-r1.json --dir <empty-directory>
npm run import-bundle -- --bundle <absolute-path-to-bundle>
npm run build
npm test
npm run lint
npm run smoke
```

The initial import returns `imported`; an identical repeat returns `unchanged`.
The build includes the record in the index, its development page, RSS and JSON
Feed. The synthetic fixture remains separately labelled.

## Evidence limits

The source metadata was retrieved at `2026-08-30T06:51:55Z`. It identifies
compilation 131, document `C2026C00361`, compilation date 10 August 2026 and
registration date 14 August 2026. `effective_at` and `explainer` remain null.
These are snapshot facts, not a fresh assertion about the Register today.

Local admission and projection checks do not establish deployment, continuous
monitoring, the source's legal effect or client use. No site was deployed for
this verification.
