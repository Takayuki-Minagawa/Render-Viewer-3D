import assert from "node:assert/strict";
import { File } from "node:buffer";
import { after, before, describe, it } from "node:test";
import { DOMParser } from "linkedom";
import * as THREE from "three";
import { createServer } from "vite";

let ColladaImporter;
let DEFAULT_IMPORT_OPTIONS;
let previousDOMParserDescriptor;
let server;

before(async () => {
  previousDOMParserDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "DOMParser",
  );
  Object.defineProperty(globalThis, "DOMParser", {
    configurable: true,
    writable: true,
    value: DOMParser,
  });
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ ColladaImporter } = await server.ssrLoadModule(
    "/src/importers/ColladaImporter.ts",
  ));
  ({ DEFAULT_IMPORT_OPTIONS } = await server.ssrLoadModule(
    "/src/importers/types.ts",
  ));
});

after(async () => {
  await server?.close();
  if (previousDOMParserDescriptor) {
    Object.defineProperty(
      globalThis,
      "DOMParser",
      previousDOMParserDescriptor,
    );
  } else {
    delete globalThis.DOMParser;
  }
});

describe("ColladaImporter browser-format fixture", () => {
  it("parses a real millimeter Z-up DAE once into meter Y-up space", async () => {
    const primary = new File([colladaFixture()], "triangle.dae", {
      type: "model/vnd.collada+xml",
    });
    const imported = await new ColladaImporter().import(
      primary,
      [primary],
      {
        ...DEFAULT_IMPORT_OPTIONS,
        centerModel: false,
        placeOnGround: false,
      },
    );
    const mesh = findMesh(imported.root);
    const bounds = new THREE.Box3().setFromObject(imported.root);

    assert.equal(imported.metadata.format, "COLLADA");
    assert.equal(imported.metadata.objectCount, 1);
    assert.equal(imported.metadata.triangleCount, 1);
    assert.equal(imported.metadata.materialCount, 1);
    assert.deepEqual(imported.root.animations, []);
    assert.ok(mesh.geometry.getAttribute("normal"));
    assert.equal(mesh.material.color.getHex(THREE.SRGBColorSpace), 0x336699);
    assert.ok(Math.abs(bounds.max.x - 1) < 1e-9);
    assert.ok(Math.abs(bounds.min.z + 1) < 1e-9);
    assert.deepEqual(imported.warnings, []);
  });
});

function findMesh(root) {
  let mesh;
  root.traverse((object) => {
    if (!mesh && object.isMesh) mesh = object;
  });
  assert.ok(mesh, "Expected the COLLADA fixture to contain a mesh");
  return mesh;
}

function colladaFixture() {
  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset>
    <contributor><authoring_tool>Render Viewer test</authoring_tool></contributor>
    <created>2026-08-20T00:00:00Z</created>
    <modified>2026-08-20T00:00:00Z</modified>
    <unit name="millimeter" meter="0.001"/>
    <up_axis>Z_UP</up_axis>
  </asset>
  <library_effects>
    <effect id="blue-effect">
      <profile_COMMON>
        <technique sid="common"><lambert><diffuse><color>0.2 0.4 0.6 1</color></diffuse></lambert></technique>
      </profile_COMMON>
    </effect>
  </library_effects>
  <library_materials>
    <material id="blue-material" name="Fixture Blue"><instance_effect url="#blue-effect"/></material>
  </library_materials>
  <library_geometries>
    <geometry id="triangle-geometry" name="Triangle">
      <mesh>
        <source id="triangle-positions">
          <float_array id="triangle-positions-array" count="9">0 0 0 1000 0 0 0 1000 0</float_array>
          <technique_common>
            <accessor source="#triangle-positions-array" count="3" stride="3">
              <param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>
            </accessor>
          </technique_common>
        </source>
        <vertices id="triangle-vertices"><input semantic="POSITION" source="#triangle-positions"/></vertices>
        <triangles count="1" material="blue-symbol">
          <input semantic="VERTEX" source="#triangle-vertices" offset="0"/>
          <p>0 1 2</p>
        </triangles>
      </mesh>
    </geometry>
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="Scene" name="Scene">
      <node id="Triangle" name="Triangle">
        <instance_geometry url="#triangle-geometry">
          <bind_material><technique_common><instance_material symbol="blue-symbol" target="#blue-material"/></technique_common></bind_material>
        </instance_geometry>
      </node>
    </visual_scene>
  </library_visual_scenes>
  <scene><instance_visual_scene url="#Scene"/></scene>
</COLLADA>`;
}
