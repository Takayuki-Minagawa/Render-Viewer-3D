# POV-Ray material concept coverage (not renderer compatibility)

Render Viewer 3D uses POV-Ray terminology to organize material concepts. It
does **not** embed POV-Ray, parse or export POV-Ray SDL, or claim
pixel-compatible rendering. The live viewport is rendered by Three.js/WebGL,
so each concept catalogued by this release is classified by preview fidelity
instead of being silently ignored.

## Fidelity levels

| Status | Meaning |
| --- | --- |
| Direct | The live preview has a closely corresponding Three.js control. This does not imply identical pixels or POV-Ray semantics. |
| Approximate | The concept is represented using a physically based WebGL approximation. |
| Stored only | The SceneModel can retain the structure or value, but the viewport does not render the effect. This is a rendering classification. The values can also be retained in the dedicated `.rv3d` project and IndexedDB autosave. |

The in-app list is authoritative only for the release-specific classifications
implemented by this project. It is not an exhaustive statement about all
POV-Ray syntax or renderer behavior.

## Separate preview and POV-Ray concept profiles

Each material has two intentionally separate profiles:

- `preview` is the source for the Three.js `MeshPhysicalMaterial` shown in the
  live viewport.
- `pov` organizes POV-Ray material concepts and metadata in the SceneModel.

Edits to `preview` do not automatically rewrite `pov`, and edits to `pov` do
not drive the WebGL material. The application does not currently provide a
conversion or synchronization contract between the profiles.

For example, the SceneModel can retain an IOR above 2.333, while the current
Three.js preview clamps IOR to the `MeshPhysicalMaterial` range of 1–2.333 and
reports the preview as approximate.

## Concept families represented by the model

The data model provides separate typed slots for the following POV-Ray
material families:

- `material`: reusable wrapper and assignment
- `texture`: plain, patterned, and layered surface topology
- `pigment`: solid color, RGBFT transparency, image and procedural patterns,
  and blend maps
- `normal`: apparent surface relief, including normal and bump-map concepts
- `finish`: illumination response, highlights, reflection, energy
  conservation, iridescence, and subsurface settings
- `interior_texture`: a distinct surface description for an inside face
- `interior`: index of refraction, dispersion, attenuation, and caustics
- `media`: absorption, emission, scattering, density, and sampling controls
- pattern transforms, waves, turbulence, warps, mapping, and extension nodes

Extension nodes provide an escape hatch for additional serializable metadata.
This structure is not a POV-Ray SDL parser, validator, exporter, or guarantee
that arbitrary POV-Ray materials can round-trip through the application.

POV-Ray `finish roughness` is not the same scale or lighting model as PBR
roughness, and POV-Ray `metallic` is not identical to PBR metalness. They are
therefore represented as separate concepts; any WebGL relationship is marked
as an approximation.

## Intentional rendering limits

Procedural pattern graphs, recursive layered textures, photon caustics,
radiosity-dependent subsurface transport, full volume media, POV-Ray image projection,
and exact ray-traced reflection/refraction are not rendered by the current
real-time WebGL viewport. The SceneModel has slots for the listed concept
families, and the capability catalog classifies their current viewport status
as **Stored only**.

The Basic preview editor can load a local PNG, JPEG, or WebP as a WebGL
base-color map and edit repeat, offset, rotation, and edge wrapping. This is a
preview-only `MaterialColorMapModel`; it is intentionally separate from
POV-Ray `PovImageMapModel`, whose source string and mapping options remain
stored-only metadata and are never fetched by the application.

The preview also supports local tangent-space normal, roughness, metalness,
and ambient-occlusion image maps through `material.maps`. These are WebGL PBR
controls, separate from the POV-Ray `normal`, `finish`, and image-projection
concepts. Base color uses sRGB; data maps use no color-space conversion.
Roughness reads green, metalness blue, and AO red. Bump maps and procedural
image projection remain unsupported. Meshes without usable UV coordinates
fall back to scalar/base-color materials.

SceneModel stores asset identifiers, source metadata, dimensions, and mapping
values, never a browser `File`, `Blob`, object URL, decoded bitmap, or GPU
resource. Runtime stores validate and own the images/textures; current-scene
and Undo/Redo references determine their lifetime. The `.rv3d` container and
IndexedDB autosave separately include original image bytes, allowing restore
without reselecting each image. Image limits are 16 MiB per file, 4096 pixels
per side, roughly 16 megapixels, and a 256 MiB estimated image-store budget.

Ambient/directional light controls, exposure, and a local Radiance RGBE HDR
environment affect the WebGL preview. HDR input is limited to 32 MiB, 8192
pixels per side, and 8 megapixels; EXR is not supported. These controls do not
implement POV-Ray lighting transport. The dedicated project retains the HDR
bytes and scene descriptors. PNG captures the viewport, while GLB exports
supported standard geometry/material/animation; neither is a POV-Ray SDL export.

## Reference baseline

The classification uses the official POV-Ray material documentation as its
terminology baseline:

- [POV-Ray 3.7 reference](https://www.povray.org/documentation/3.7.0/r3_4.html)
- [Texture](https://wiki.povray.org/content/Reference%3ATexture)
- [Pigment](https://wiki.povray.org/content/Reference%3APigment)
- [Normal](https://www.povray.org/documentation/view/3.60/339/)
- [Finish](https://wiki.povray.org/content/Reference%3AFinish)
- [Interior](https://wiki.povray.org/content/Reference%3AInterior)
- [Media](https://wiki.povray.org/content/Reference%3AMedia)

POV-Ray 3.7 is the primary terminology baseline. Catalog entries derived from
3.8 development documentation carry an explicit version label.

## Project relationship and trademarks

Render Viewer 3D is an independent, unofficial project. It is not affiliated
with or endorsed by Persistence of Vision Raytracer Pty. Ltd. or the POV-Ray
development team. The POV-Ray name is used descriptively to identify the
material concepts and terminology being referenced. No POV-Ray executable,
source code, or official assets are included in this project.

POV-Ray, Persistence of Vision Ray Tracer, and POV-Team are trademarks of
Persistence of Vision Raytracer Pty. Ltd. See the official
[POV-Ray trademark notice](https://www.povray.org/documentation/view/3.6.1/772/).
