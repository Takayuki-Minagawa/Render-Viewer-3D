# Third-party licenses

Render Viewer 3D uses the following third-party packages. Runtime code is
bundled locally; the application does not require an external CDN.

| Package | Declared version range | Use | License | Project |
| --- | --- | --- | --- | --- |
| Three.js | `^0.185.1` | Browser runtime | MIT | <https://threejs.org/> |
| fflate (vendored in Three.js addons) | `0.8.2` | FBX compressed-array preflight and 3MF ZIP decompression in the browser runtime | MIT | <https://github.com/101arrowz/fflate/tree/v0.8.2> |
| occt-wasm | `4.3.1` (exact) | STEP Worker wrapper and compiled Open CASCADE WASM | Wrapper: MIT OR Apache-2.0; compiled WASM: LGPL-2.1-only WITH OCCT-exception-1.0 | <https://github.com/andymai/occt-wasm/tree/v4.3.1> |
| Comlink | `4.4.2` (resolved transitive runtime) | Worker RPC used by occt-wasm | Apache-2.0 | <https://github.com/GoogleChromeLabs/comlink/tree/v4.4.2> |
| @types/three | `^0.185.4` | Development type declarations | MIT | <https://github.com/DefinitelyTyped/DefinitelyTyped> |
| linkedom | `0.18.12` (exact) | Development/test-only DOMParser for DAE / 3MF importer unit, preflight, and fixture tests | ISC | <https://github.com/WebReflection/linkedom/tree/v0.18.12> |
| Vite | `^6.4.3` | Development and build tool | MIT | <https://vite.dev/> |
| TypeScript | `^5.9.3` | Development compiler | Apache-2.0 | <https://www.typescriptlang.org/> |

Exact resolved versions are recorded in `package-lock.json`. The complete
license files for installed development packages are available in their
respective package directories after running `npm ci`.

The GitHub Pages artifact includes `THIRD_PARTY_LICENSES.txt`, containing
notices and license terms for the runtime code distributed with the app,
including the fflate 0.8.2 module vendored by the Three.js addons and used by the FBX / 3MF import paths.
The complete GNU Lesser General Public License 2.1 text is also distributed as
`licenses/LGPL-2.1.txt`, with the Open CASCADE exception distributed as
`licenses/OCCT-exception-1.0.txt`.

linkedom is imported only by the Node.js DAE / 3MF importer unit, preflight, and fixture tests. It is not
referenced from `src/` and is not emitted into the Vite / GitHub Pages runtime
artifact. Its ISC notice is therefore retained in this repository-facing file
but intentionally omitted from `public/THIRD_PARTY_LICENSES.txt`, which covers
code actually distributed in the browser artifact.

## Three.js 0.185.1

The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.


## fflate 0.8.2 vendored by the Three.js addons

The Three.js `3MFLoader` and this application's FBX compressed-array preflight
import the vendored `three/examples/jsm/libs/fflate.module.js` runtime module.

Source for the exact vendored version:
<https://github.com/101arrowz/fflate/tree/v0.8.2>

MIT License

Copyright (c) 2023 Arjun Barrett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## occt-wasm 4.3.1 TypeScript wrapper

Source for the exact distributed version:
<https://github.com/andymai/occt-wasm/tree/v4.3.1>

The package declares `MIT OR Apache-2.0`. This distribution applies the MIT
option to the TypeScript wrapper:

MIT License

Copyright (c) 2026 Andy Mai

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Open CASCADE WebAssembly distributed by occt-wasm 4.3.1

The `occt-wasm.wasm` output contains Open CASCADE Technology 8.0.1.

Copyright (c) 1999-2026 by OPEN CASCADE S.A.S. All rights reserved.

The compiled WASM is distributed under
`LGPL-2.1-only WITH OCCT-exception-1.0`, as declared by occt-wasm.

- Exact occt-wasm wrapper source and build scripts:
  <https://github.com/andymai/occt-wasm/tree/v4.3.1>
- Exact corresponding Open CASCADE source used by this build:
  <https://github.com/andymai/OCCT/tree/055a9a8a2b3fbb33da2ec9a5445d2b97ffbcd765>
- Official Open CASCADE V8_0_1 upstream baseline:
  <https://github.com/Open-Cascade-SAS/OCCT/tree/V8_0_1>
- Complete license texts distributed with this application:
  [GNU LGPL 2.1](./public/licenses/LGPL-2.1.txt) and
  [Open CASCADE Exception 1.0](./public/licenses/OCCT-exception-1.0.txt)

The WASM is emitted and served as an independent `.wasm` file instead of
being embedded in the JavaScript bundle. The app passes that file's URL to the
Worker. A distributor can replace it with an interface-compatible modified
build by changing the separately served asset / URL; the current user
interface does not provide a WASM URL override.

Recipients and downstream distributors must retain the LGPL and Open CASCADE
exception notices, provide the complete license and exception texts and exact
corresponding source access, and preserve the right to replace the
LGPL-covered component. These notes are informational and are not legal
advice.

## Comlink 4.4.2

Copyright 2017 Google Inc.

Licensed under the Apache License, Version 2.0 (the "License"); you may not
use this file except in compliance with the License. You may obtain a copy of
the License at:

<https://www.apache.org/licenses/LICENSE-2.0>

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
License for the specific language governing permissions and limitations under
the License. The complete Apache-2.0 text is included in
`public/THIRD_PARTY_LICENSES.txt`.

## linkedom 0.18.12 (development/test only)

linkedom supplies `DOMParser` to the Node.js DAE / 3MF importer unit,
preflight, and fixture tests. It is not browser runtime code and is not
included in the GitHub Pages artifact.

Source for the exact development dependency:
<https://github.com/WebReflection/linkedom/tree/v0.18.12>

ISC License

Copyright (c) 2021, Andrea Giammarchi, @WebReflection

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE
OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.


## Additional runtime dependencies (editor extensions)

Immer 11.1.18 — Copyright (c) 2017 Michel Weststrate — MIT.
Full notice: licenses/Immer-LICENSE.txt

Draco (bundled by Three.js r185) — Google Draco project — Apache-2.0.
https://github.com/google/draco
Full terms: licenses/Draco-LICENSE.txt

Basis Universal transcoder (bundled by Three.js r185) — Binomial LLC — Apache-2.0.
https://github.com/BinomialLLC/basis_universal
Full terms: licenses/Basis-Universal-LICENSE.txt

Meshoptimizer 1.1 decoder (bundled by Three.js r185) — Copyright (c) 2016-2026 Arseny Kapoulkine — MIT.
https://github.com/zeux/meshoptimizer
Full notice: licenses/Meshoptimizer-LICENSE.txt

@playwright/test is a development-only Apache-2.0 dependency. Its browser binaries and test fixtures are not included in the Pages artifact. Fixture attribution is in tests/fixtures/compressed/README.md.
