# Compressed importer fixtures

- `Box.gltf`, `Box.bin`: unmodified Box Draco variant from [Khronos glTF Sample Models](https://github.com/KhronosGroup/glTF-Sample-Models/tree/main/2.0/Box/glTF-Draco). Donated by Cesium; [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Downloaded 2026-09-07.
- `2d_etc1s.ktx2`: unmodified texture from [Three.js examples](https://github.com/mrdoob/three.js/blob/dev/examples/textures/ktx2/2d_etc1s.ktx2), Three.js MIT license. Downloaded 2026-09-07. Used only by local tests; not published with the site.
- `triangle-meshopt.gltf`: synthetic triangle (0,0,0), (1,0,0), (0,1,0), generated for this project using meshoptimizer `encodeGltfBuffer` in ATTRIBUTES mode, stride 12. Encoder is not a runtime dependency; application uses the Three.js bundled decoder.
