# Importer boundaries and measured worker decision

Implemented 2026-09-07. Limits describe rejection boundaries, not a guarantee of peak process memory.

| Format | Input / preflight | Parsed output | Failure / cancellation |
| --- | --- | --- | --- |
| glTF / GLB | Selected files incl. sidecars ≤32 MiB; decoded buffer views and accessors ≤128 MiB each; node hierarchy depth/cycle checks; local-only URIs; KTX2 header decoded pixels checked before transcode | Shared geometry budget; aggregate texture budget 32 Mi pixels, dimension ≤16,384 | Loading-manager resource completion/error tracking; unpublished scenes disposed once as a forest; late completion after abort disposed; resolver URLs and per-import decoder workers released |
| OBJ + MTL | Selected files incl. sidecars ≤32 MiB; each MTL is resolved locally; texture paths relative to that MTL | Shared geometry and decoded texture budgets | Textures finish loading before resolver URLs expire; missing MTL/texture/material rejects; parsed tree and created materials/textures released on failure |
| STL | Source ≤32 MiB; ≥1 MiB parsed in DOM-free Worker when available | Worker rejects >2M positions; main thread applies shared geometry budget before normalization | Typed buffers transferred; Worker terminated on success, failure or abort; failed parsed tree released |
| PLY | Source ≤32 MiB plus existing header checks | Shared geometry budget | Existing parsed-result cleanup retained |
| FBX / DAE | Selected files ≤32 MiB; existing FBX binary and ZIP/document boundaries retained | Shared geometry budget | Existing local resource wait and failed tree cleanup retained |
| 3MF | Archive ≤16 MiB; central directory / expanded size checks; XML ≤8 MiB, ≤100k elements/depth256, references/transforms/object graph inspection | Shared geometry budget | Preflight now isolated in `three-mf-preflight.ts`, public compatibility exports retained; existing failed tree cleanup retained |
| STEP | Source ≤128 MiB; OCCT parsing and tessellation in Worker | ≤2M vertices / triangles | Shape released and Worker terminated; existing behavior retained |

The shared geometry budget is 50,000 scene nodes, depth 256, 10,000 renderables, 2M position vertices, 2M vertex references and 2M primitives. Post-parse checks cannot prevent all parser allocations. Standard image formats are checked after import decoding; KTX2 dimensions are also checked before transcoding. STL/OBJ expansion can exceed source byte size, and OBJ remains synchronous pending a worker protocol for its material/texture dependencies.

## Decoder deployment

Three.js r185 includes local `new URL(..., import.meta.url)` decoder asset references. Vite emits those assets under the GitHub Pages base. No CDN or model network URI exemption is added. Draco and KTX2 use separate loader managers for their bundled decoders; texture input URLs still pass through `LocalResourceResolver`. Meshopt is bundled in the lazily imported decoder module. Decoder libraries and GLTFLoader are not loaded on initial editor startup. `optimizeDeps` excludes decoder loaders so development keeps their asset URLs, and explicitly includes Comlink to avoid a first-STEP dependency-discovery reload.

Native Three.js loader code references both standard and glTF-optimized Draco assets; both appear in build output, although the glTF importer requests the optimized variant. No additional public decoder copies are generated.

## Measurement

Command: `node scripts/benchmark-importers.mjs`, Node v22.18.0 on the local macOS host, fixed synthetic triangle fixtures, 2 warmups and 7 measured parses. Median and p95 (maximum of seven samples):

| Fixture | Source bytes | Median | p95 |
| --- | ---: | ---: | ---: |
| STL ASCII 10,000 triangles | 860,035 | 4.16 ms | 5.85 ms |
| STL ASCII 100,000 triangles | 8,600,035 | 34.89 ms | 37.56 ms |
| OBJ 10,000 triangles | 80,024 | 4.18 ms | 5.90 ms |
| OBJ 100,000 triangles | 800,024 | 36.55 ms | 40.69 ms |

These timings motivated the STL worker boundary (simple transferable geometry), without claiming faster total import or browser p95 gains. Worker startup/transfer has overhead; small files retain synchronous parsing. OBJ materials require separate orchestration, so no unmeasured blanket worker conversion was applied.

At the same implementation stage, moving GLTFLoader and decoder modules off initial startup reduced the main build chunk from 1,172.41 kB / gzip 327.07 kB to 1,035.72 kB / gzip 280.13 kB. These are build artifact measurements, not network/parse timings.

## Validation

- Existing 3MF fixtures and safety tests remain successful after extraction.
- New unit tests cover MTL references, image/geometry allocation checks, decoder URL isolation, shared texture accounting and STL Worker cancellation.
- Actual Draco, Meshopt and KTX2 fixtures, OBJ+MTL PNG, large STL Worker and an original 10×20×30 mm STEP box passed Chromium, Firefox and WebKit tests under `/Render-Viewer-3D/`.
- The PBR UI test attaches normal/roughness/metalness/occlusion images as numeric data, checks Undo and saves/restores those images with the real STEP model. Chromium passed during implementation; the full browser matrix is run as the final acceptance check.
