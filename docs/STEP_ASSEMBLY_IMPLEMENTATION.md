# STEP assembly implementation and validation

Implemented against the existing, pinned **occt-wasm 4.3.1**. No kernel upgrade or additional runtime dependency was needed. All checks run locally; this work does not invoke GitHub Actions.

## Fixed-version prototype result

The installed `dist/xcaf-document.d.ts` exposes `importXCAFFromSTEP`, `getRoots`, `getChildren`, `getLabelInfo` and `exportGLTF`. It does **not** expose the newer `getReferredLabel` or `getLocation` APIs documented on upstream main. Direct label traversal therefore cannot reliably rebuild nested prototype references and local placements in this version.

The native XCAF GLB exporter does resolve those references. Synthetic STEP fixtures verified parent/child names, red/blue part colors, nested 90° rotation, translation, reuse of one prototype at two placements, and millimeter/meter declarations. The imported GLB keeps the source coordinate axes and expresses geometry and translations in meters.

## Runtime path

1. A dedicated Worker imports the STEP bytes into an XCAF document and exports an embedded GLB. The document is closed in a `finally` block.
2. The Worker validates the GLB header, embedded buffer, node graph and totals before transferring its bytes. External buffers/images and required extensions are rejected.
3. The main thread repeats the output check, loads the embedded GLB with external URL resolution disabled, and joins face primitives belonging to the same part. Material groups retain per-face colors. Assembly nodes and placements remain intact, and closed parts can use the section-cap tool.
4. The exporter's mm→m conversion is undone on the content root before the existing STEP normalization runs. User unit/axis overrides, centering and grounding therefore retain their existing meaning.
5. Canceling initialization or conversion terminates the Worker. Parse/normalization failure disposes Three resources; partial face merges also dispose detached geometry. Shared resources are retained by the existing asset store ownership rules.

The output is limited to 128 MiB of embedded GLB, 16 MiB of JSON, 10,000 source nodes/renderable primitives, depth 128, and **2,000,000 vertices / 2,000,000 triangles across all placed instances**. The main-thread resource budget is checked again after loading. These checks bound the accepted output; they do not guarantee OCCT's transient peak memory during STEP parsing or tessellation.

## Project compatibility

New STEP imports use `stepStructure: "assembly"`; saving records the mode explicitly. A project whose stored STEP options lack this field is decoded as `"flat"`. Explicit flat mode uses the original single-mesh parser and retains the old `node-0` path and flatten warning. Unknown mode values are rejected. Existing node overrides are never applied to a newly substituted hierarchy by changing the old project's mode implicitly.

Persisted assembly hierarchy and node-index paths are deterministic for the pinned importer and identical source bytes. They are not durable CAD topology identifiers across changed STEP files or future kernel upgrades. Surface measurements remain tessellated mesh approximations; exact B-Rep geometry and CAD editing are outside this feature.

## Local acceptance checks

- `node --test tests/importers-step.test.mjs tests/importers-step-assembly.test.mjs`: fixed-version WASM import, geometry and color/placement expectations, unit/axis handling, missing names/colors, total budgets, malformed/cyclic output, cancellation, document cleanup, part isolation/material overrides and save/reparse, schema-2 project flat compatibility.
- `npm run test:e2e -- tests/e2e/step-assembly.spec.ts --project=chromium`: actual browser Worker, same-origin resource loading, part editing and project save/restore.
- The existing real STEP box browser test remains applicable to the default assembly path.

Fixtures and their reproducible generator are documented in [tests/fixtures/step/README.md](../tests/fixtures/step/README.md). All fixtures are synthetic and contain no third-party model or user data.
