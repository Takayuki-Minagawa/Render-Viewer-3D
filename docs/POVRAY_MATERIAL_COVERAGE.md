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
| Stored only | The SceneModel can retain the structure or value, but the viewport does not render the effect. This status does not mean that the scene is persisted to a file or browser storage. |

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
radiosity-dependent subsurface transport, full volume media, image projection,
and exact ray-traced reflection/refraction are not rendered by the current
real-time WebGL viewport. The SceneModel has slots for the listed concept
families, and the capability catalog classifies their current viewport status
as **Stored only**.

Local bitmap and HDRI loading, texture sampler management, and browser-file
persistence are not implemented in this phase. `PovImageMapModel` can retain a
source string and mapping options as model-only metadata, but the application
does not load that source. The SceneModel does not persist browser `File` or
`Blob` objects, object URLs, or Three.js GPU resources.

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
