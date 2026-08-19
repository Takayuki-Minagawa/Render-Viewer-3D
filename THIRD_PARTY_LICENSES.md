# Third-party licenses

Render Viewer 3D uses the following open-source packages. Runtime code is bundled locally;
the application does not require an external CDN.

| Package | Version range | License | Project |
| --- | --- | --- | --- |
| Three.js | `^0.185.1` | MIT | <https://threejs.org/> |
| @types/three | `^0.185.4` | MIT | <https://github.com/DefinitelyTyped/DefinitelyTyped> |
| Vite | `^6.4.3` | MIT | <https://vite.dev/> |
| TypeScript | `^5.9.3` | Apache-2.0 | <https://www.typescriptlang.org/> |

The exact resolved versions are recorded in `package-lock.json`. License texts for installed
packages are included in their respective package directories after running `npm ci`.
