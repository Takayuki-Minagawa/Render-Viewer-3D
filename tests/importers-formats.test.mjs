import assert from "node:assert/strict";
import { Buffer, File } from "node:buffer";
import { after, before, describe, it } from "node:test";
import * as THREE from "three";
import { createServer } from "vite";

let server;
let GLTFImporter;
let OBJImporter;
let STLImporter;
let DEFAULT_IMPORT_OPTIONS;
let previousProgressEventDescriptor;

before(async () => {
  previousProgressEventDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "ProgressEvent",
  );
  if (typeof globalThis.ProgressEvent === "undefined") {
    class TestProgressEvent extends Event {
      constructor(type, init = {}) {
        super(type);
        this.lengthComputable = init.lengthComputable ?? false;
        this.loaded = init.loaded ?? 0;
        this.total = init.total ?? 0;
      }
    }
    Object.defineProperty(globalThis, "ProgressEvent", {
      configurable: true,
      writable: true,
      value: TestProgressEvent,
    });
  }

  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ GLTFImporter } = await server.ssrLoadModule(
    "/src/importers/GLTFImporter.ts",
  ));
  ({ OBJImporter } = await server.ssrLoadModule(
    "/src/importers/OBJImporter.ts",
  ));
  ({ STLImporter } = await server.ssrLoadModule(
    "/src/importers/STLImporter.ts",
  ));
  ({ DEFAULT_IMPORT_OPTIONS } = await server.ssrLoadModule(
    "/src/importers/types.ts",
  ));
});

after(async () => {
  await server?.close();
  if (previousProgressEventDescriptor) {
    Object.defineProperty(
      globalThis,
      "ProgressEvent",
      previousProgressEventDescriptor,
    );
  } else {
    delete globalThis.ProgressEvent;
  }
});

function options(overrides = {}) {
  return {
    ...DEFAULT_IMPORT_OPTIONS,
    centerModel: false,
    placeOnGround: false,
    ...overrides,
  };
}

function findMesh(root) {
  let result;
  root.traverse((object) => {
    if (!result && object.isMesh) {
      result = object;
    }
  });
  assert.ok(result, "Expected the imported root to contain a mesh");
  return result;
}

function assertFiniteBounds(root) {
  const bounds = new THREE.Box3().setFromObject(root);
  assert.equal(bounds.isEmpty(), false);
  for (const value of [
    bounds.min.x,
    bounds.min.y,
    bounds.min.z,
    bounds.max.x,
    bounds.max.y,
    bounds.max.z,
  ]) {
    assert.equal(Number.isFinite(value), true);
  }
}

function gltfFixture() {
  const positions = new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ]);
  const encoded = Buffer.from(
    positions.buffer,
    positions.byteOffset,
    positions.byteLength,
  ).toString("base64");
  const document = {
    asset: { version: "2.0", generator: "importer-test" },
    buffers: [
      {
        byteLength: positions.byteLength,
        uri: `data:application/octet-stream;base64,${encoded}`,
      },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
    materials: [
      {
        name: "Fixture Material",
        pbrMetallicRoughness: {
          baseColorFactor: [0.2, 0.4, 0.6, 1],
          metallicFactor: 0.25,
          roughnessFactor: 0.75,
        },
      },
    ],
    meshes: [
      {
        name: "Triangle Mesh",
        primitives: [{ attributes: { POSITION: 0 }, material: 0 }],
      },
    ],
    nodes: [
      { name: "Fixture Parent", children: [1] },
      { name: "Fixture Triangle", mesh: 0 },
    ],
    scenes: [{ name: "Fixture Scene", nodes: [0] }],
    scene: 0,
  };
  return new File([JSON.stringify(document)], "triangle.gltf", {
    type: "model/gltf+json",
  });
}

describe("GLTFImporter", () => {
  it("preserves hierarchy, PBR material, asset metadata, and animations", async () => {
    const primary = gltfFixture();
    const imported = await new GLTFImporter().import(
      primary,
      [primary],
      options(),
    );
    const mesh = findMesh(imported.root);

    assert.equal(imported.root.name, "triangle.gltf");
    assert.ok(imported.root.getObjectByName("Fixture_Parent"));
    assert.ok(imported.root.getObjectByName("Fixture_Triangle"));
    assert.ok(mesh.material instanceof THREE.MeshStandardMaterial);
    assert.equal(mesh.material.name, "Fixture Material");
    assert.equal(mesh.material.metalness, 0.25);
    assert.equal(mesh.material.roughness, 0.75);
    assert.deepEqual(imported.root.animations, []);
    assert.equal(imported.root.userData.gltfAsset.version, "2.0");
    assert.equal(imported.metadata.objectCount, 1);
    assert.equal(imported.metadata.triangleCount, 1);
    assert.equal(imported.metadata.materialCount, 1);
    assert.equal(imported.metadata.unit, "meter");
    assert.deepEqual(imported.warnings, []);
    assert.ok(mesh.geometry.getAttribute("normal"));
    assertFiniteBounds(imported.root);
  });
});

describe("OBJImporter", () => {
  it("loads geometry and reports unsupported MTL references", async () => {
    const source = [
      "mtllib fixture.mtl",
      "o Triangle",
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "f 1 2 3",
      "",
    ].join("\n");
    const primary = new File([source], "triangle.obj", {
      type: "text/plain",
    });
    const imported = await new OBJImporter().import(
      primary,
      [primary],
      options(),
    );
    const mesh = findMesh(imported.root);

    assert.equal(imported.metadata.format, "OBJ");
    assert.equal(imported.metadata.objectCount, 1);
    assert.equal(imported.metadata.triangleCount, 1);
    assert.ok(mesh.geometry.getAttribute("normal"));
    assert.equal(mesh.castShadow, true);
    assert.equal(mesh.receiveShadow, true);
    assert.deepEqual(
      imported.warnings.map(({ code }) => code),
      [
        "obj-material-library-ignored",
        "unit-unavailable",
        "coordinate-system-unavailable",
      ],
    );
    assertFiniteBounds(imported.root);
  });
});

describe("STLImporter", () => {
  it("loads ASCII triangles with the default light-gray PBR material", async () => {
    const source = [
      "solid triangle",
      "  facet normal 0 0 1",
      "    outer loop",
      "      vertex 0 0 0",
      "      vertex 1 0 0",
      "      vertex 0 1 0",
      "    endloop",
      "  endfacet",
      "endsolid triangle",
      "                                                                                     ",
    ].join("\n");
    const primary = new File([source], "triangle.stl", {
      type: "model/stl",
    });
    const imported = await new STLImporter().import(
      primary,
      [primary],
      options(),
    );
    const mesh = findMesh(imported.root);

    assert.ok(mesh.material instanceof THREE.MeshStandardMaterial);
    assert.equal(mesh.material.color.getHex(), 0xd3d7dc);
    assert.equal(mesh.material.roughness, 0.6);
    assert.equal(mesh.material.metalness, 0);
    assert.equal(mesh.geometry.index, null);
    assert.ok(mesh.geometry.getAttribute("normal"));
    assert.equal(imported.metadata.objectCount, 1);
    assert.equal(imported.metadata.triangleCount, 1);
    assert.deepEqual(
      imported.warnings.map(({ code }) => code),
      ["unit-unavailable", "coordinate-system-unavailable"],
    );
    assertFiniteBounds(imported.root);
  });
});
