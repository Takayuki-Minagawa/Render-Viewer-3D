# Third-party licenses

Render Viewer 3D uses the following third-party packages. Runtime code is
bundled locally; the application does not require an external CDN.

| Package | Declared version range | Use | License | Project |
| --- | --- | --- | --- | --- |
| Three.js | `^0.185.1` | Browser runtime | MIT | <https://threejs.org/> |
| occt-wasm | `4.3.1` (exact) | STEP Worker wrapper and compiled Open CASCADE WASM | Wrapper: MIT OR Apache-2.0; compiled WASM: LGPL-2.1-only WITH OCCT-exception-1.0 | <https://github.com/andymai/occt-wasm/tree/v4.3.1> |
| Comlink | `4.4.2` (resolved transitive runtime) | Worker RPC used by occt-wasm | Apache-2.0 | <https://github.com/GoogleChromeLabs/comlink/tree/v4.4.2> |
| @types/three | `^0.185.4` | Development type declarations | MIT | <https://github.com/DefinitelyTyped/DefinitelyTyped> |
| Vite | `^6.4.3` | Development and build tool | MIT | <https://vite.dev/> |
| TypeScript | `^5.9.3` | Development compiler | Apache-2.0 | <https://www.typescriptlang.org/> |

Exact resolved versions are recorded in `package-lock.json`. The complete
license files for installed development packages are available in their
respective package directories after running `npm ci`.

The GitHub Pages artifact includes `THIRD_PARTY_LICENSES.txt`, containing
notices and license terms for the runtime code distributed with the app.
The complete GNU Lesser General Public License 2.1 text is also distributed as
`licenses/LGPL-2.1.txt`, with the Open CASCADE exception distributed as
`licenses/OCCT-exception-1.0.txt`.

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
