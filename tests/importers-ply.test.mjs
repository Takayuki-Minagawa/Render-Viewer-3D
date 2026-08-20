import assert from "node:assert/strict";
import { File } from "node:buffer";
import { after, before, describe, it } from "node:test";
import * as THREE from "three";
import { createServer } from "vite";

let createImportedSceneModel;
let createMaterialDefinition;
let DEFAULT_IMPORT_OPTIONS;
let ImportedAssetStore;
let ImportedSceneAdapter;
let PLYImporter;
let MAX_PLY_HEADER_BYTES;
let server;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ MAX_PLY_HEADER_BYTES, PLYImporter } = await server.ssrLoadModule(
    "/src/importers/PLYImporter.ts",
  ));
  ({ DEFAULT_IMPORT_OPTIONS } = await server.ssrLoadModule(
    "/src/importers/types.ts",
  ));
  ({ ImportedAssetStore } = await server.ssrLoadModule(
    "/src/three/imported-asset-store.ts",
  ));
  ({ ImportedSceneAdapter } = await server.ssrLoadModule(
    "/src/three/imported-scene-adapter.ts",
  ));
  ({ createImportedSceneModel } = await server.ssrLoadModule(
    "/src/model/imported-scene-model.ts",
  ));
  ({ createMaterialDefinition } = await server.ssrLoadModule(
    "/src/model/material/material-presets.ts",
  ));
});

after(async () => {
  await server?.close();
});

function options(overrides = {}) {
  return {
    ...DEFAULT_IMPORT_OPTIONS,
    centerModel: false,
    placeOnGround: false,
    ...overrides,
  };
}

function plyFile(body, name = "fixture.ply") {
  return new File([body], name, { type: "application/octet-stream" });
}

function triangleFixture() {
  return plyFile(
    [
      "ply",
      "format ascii 1.0",
      "element vertex 3",
      "property float x",
      "property float y",
      "property float z",
      "property uchar red",
      "property uchar green",
      "property uchar blue",
      "element face 1",
      "property list uchar int vertex_indices",
      "end_header",
      "0 0 0 255 0 0",
      "1 0 0 0 255 0",
      "0 1 0 0 0 255",
      "3 0 1 2",
      "",
    ].join("\n"),
    "triangle.ply",
  );
}

function pointCloudFixture() {
  return plyFile(
    [
      "ply",
      "format ascii 1.0",
      "element vertex 3",
      "property float x",
      "property float y",
      "property float z",
      "property uchar red",
      "property uchar green",
      "property uchar blue",
      "end_header",
      "-1 2 3 255 0 0",
      "4 -2 1 0 255 0",
      "2 3 -4 0 0 255",
      "",
    ].join("\n"),
    "points.ply",
  );
}

function findObject(root, predicate, message) {
  let result;
  root.traverse((object) => {
    if (!result && predicate(object)) result = object;
  });
  assert.ok(result, message);
  return result;
}

describe("PLYImporter", () => {
  it("parses a colored face set as a PBR mesh with normals and bounds", async () => {
    const primary = triangleFixture();
    const imported = await new PLYImporter().import(
      primary,
      [primary],
      options(),
    );
    const mesh = findObject(
      imported.root,
      (object) => object instanceof THREE.Mesh,
      "Expected PLY faces to produce a mesh",
    );

    assert.equal(imported.root.name, "triangle.ply");
    assert.ok(mesh.material instanceof THREE.MeshStandardMaterial);
    assert.equal(mesh.material.vertexColors, true);
    assert.ok(mesh.geometry.getAttribute("color"));
    assert.ok(mesh.geometry.getAttribute("normal"));
    assert.equal(mesh.castShadow, true);
    assert.equal(mesh.receiveShadow, true);
    assert.equal(imported.metadata.fileName, "triangle.ply");
    assert.equal(imported.metadata.format, "PLY");
    assert.equal(imported.metadata.objectCount, 1);
    assert.equal(imported.metadata.triangleCount, 1);
    assert.equal(imported.metadata.materialCount, 1);
    assert.equal(imported.metadata.unit, "meter");
    assert.deepEqual(
      imported.warnings.map(({ code }) => code),
      ["unit-unavailable", "coordinate-system-unavailable"],
    );
    assertFiniteBounds(imported.root);
  });

  it("parses face-less vertices as a colored point cloud with statistics and bounds", async () => {
    const primary = pointCloudFixture();
    const imported = await new PLYImporter().import(
      primary,
      [primary],
      options({ centerModel: true, placeOnGround: true }),
    );
    const points = findObject(
      imported.root,
      (object) => object instanceof THREE.Points,
      "Expected face-less PLY vertices to produce points",
    );

    assert.ok(points.material instanceof THREE.PointsMaterial);
    assert.equal(points.material.vertexColors, true);
    assert.equal(imported.metadata.objectCount, 1);
    assert.equal(imported.metadata.triangleCount, 0);
    assert.equal(imported.metadata.materialCount, 1);
    assertFiniteBounds(imported.root);
    const bounds = new THREE.Box3().setFromObject(imported.root);
    const center = bounds.getCenter(new THREE.Vector3());
    assert.ok(Math.abs(bounds.min.y) < 1e-10);
    assert.ok(Math.abs(center.x) < 1e-10);
    assert.ok(Math.abs(center.z) < 1e-10);
    assert.ok(points.geometry.boundingBox);
    assert.ok(points.geometry.boundingSphere);
    assert.deepEqual(
      imported.warnings.map(({ code }) => code),
      [
        "ply-point-cloud-custom-material-unsupported",
        "unit-unavailable",
        "coordinate-system-unavailable",
      ],
    );
  });

  it("enforces abort and the 32 MiB main-thread budget before parsing", async () => {
    const aborted = new AbortController();
    aborted.abort();
    const primary = triangleFixture();
    await assert.rejects(
      new PLYImporter().import(
        primary,
        [primary],
        options({ signal: aborted.signal }),
      ),
      { name: "AbortError" },
    );

    const oversized = plyFile("", "oversized.ply");
    Object.defineProperty(oversized, "size", {
      value: 32 * 1024 * 1024 + 1,
    });
    await assert.rejects(
      new PLYImporter().import(oversized, [oversized], options()),
      /32 MiB main-thread safety limit/,
    );
  });

  it("bounds and validates the PLY header before loading the addon", async () => {
    let factoryCalls = 0;
    const importer = new PLYImporter({
      createLoader() {
        factoryCalls += 1;
        return { parse: () => new THREE.BufferGeometry() };
      },
    });
    const missingEnd = plyFile(
      "ply\nformat ascii 1.0\nelement vertex 0\n",
      "missing-header-end.ply",
    );
    await assert.rejects(
      importer.import(missingEnd, [missingEnd], options()),
      /missing end_header within the 64 KiB safety limit/,
    );

    const oversizedHeader = plyFile(
      `ply\nformat ascii 1.0\n${"comment padding\n".repeat(
        Math.ceil(MAX_PLY_HEADER_BYTES / 16),
      )}end_header\n`,
      "oversized-header.ply",
    );
    await assert.rejects(
      importer.import(oversizedHeader, [oversizedHeader], options()),
      /missing end_header within the 64 KiB safety limit/,
    );

    const invalidFaces = plyFile(
      [
        "ply",
        "format ascii 1.0",
        "element vertex 0",
        "element face not-a-number",
        "end_header",
        "",
      ].join("\n"),
      "invalid-faces.ply",
    );
    await assert.rejects(
      importer.import(invalidFaces, [invalidFaces], options()),
      /face element declaration must contain a non-negative integer/,
    );

    for (const [headerLines, expected] of [
      [
        [
          "PLY",
          "format ascii 1.0",
          "element vertex 0",
          "end_header",
          "",
        ],
        /exact "ply" magic line/u,
      ],
      [
        [
          "ply",
          "FORMAT ascii 1.0",
          "element vertex 0",
          "end_header",
          "",
        ],
        /exactly one format declaration/u,
      ],
      [
        [
          "ply",
          "format binary_middle_endian 1.0",
          "element vertex 0",
          "end_header",
          "",
        ],
        /PLY format must be ascii, binary_little_endian, or binary_big_endian version 1\.0/u,
      ],
      [
        [
          "ply",
          "format ascii 2.0",
          "element vertex 0",
          "end_header",
          "",
        ],
        /PLY format must be ascii, binary_little_endian, or binary_big_endian version 1\.0/u,
      ],
      [
        [
          "ply",
          "format ascii 1.0",
          "format ascii 1.0",
          "element vertex 0",
          "end_header",
          "",
        ],
        /exactly one format declaration/u,
      ],
    ]) {
      const invalidHeader = plyFile(
        headerLines.join("\n"),
        "invalid-header.ply",
      );
      await assert.rejects(
        importer.import(invalidHeader, [invalidHeader], options()),
        expected,
      );
    }

    const ignoredUppercaseProperty = plyFile(
      [
        "ply",
        "format ascii 1.0",
        "element vertex 2000000",
        "PROPERTY float x",
        "end_header",
        "",
      ].join("\n"),
      "uppercase-property.ply",
    );
    await assert.rejects(
      importer.import(
        ignoredUppercaseProperty,
        [ignoredUppercaseProperty],
        options(),
      ),
      /vertex element has no properties and exceeds the 100000 zero-width parse safety limit/u,
    );

    for (const [declaration, expected] of [
      ["property float", /scalar property declaration/u],
      ["property half x", /scalar property declaration/u],
      ["property float x extra", /scalar property declaration/u],
      ["property list float int values", /list property declaration/u],
      ["property list uchar half values", /list property declaration/u],
      ["property list uchar int", /list property declaration/u],
    ]) {
      const malformedProperty = plyFile(
        [
          "ply",
          "format ascii 1.0",
          "element vertex 1",
          declaration,
          "end_header",
          "",
        ].join("\n"),
        "malformed-property.ply",
      );
      await assert.rejects(
        importer.import(
          malformedProperty,
          [malformedProperty],
          options(),
        ),
        expected,
      );
    }

    for (const [declaration, expected] of [
      [
        "element junk 4294967295",
        /junk element count exceeds the 2000000 synchronous parse safety limit/u,
      ],
      [
        "element vertex 2000001",
        /vertex element count exceeds the 2000000 synchronous parse safety limit/u,
      ],
      [
        "element junk 100001",
        /junk element has no properties and exceeds the 100000 zero-width parse safety limit/u,
      ],
    ]) {
      const malicious = plyFile(
        ["ply", "format ascii 1.0", declaration, "end_header", ""].join("\n"),
        "huge-element-count.ply",
      );
      await assert.rejects(
        importer.import(malicious, [malicious], options()),
        expected,
      );
    }
    const crOnly = plyFile(
      [
        "ply",
        "format ascii 1.0",
        "element junk 4294967295",
        "end_header",
        "",
      ].join("\r"),
      "cr-only-huge-element.ply",
    );
    await assert.rejects(
      importer.import(crOnly, [crOnly], options()),
      /junk element count exceeds the 2000000 synchronous parse safety limit/u,
    );


    const excessiveTotal = plyFile(
      [
        "ply",
        "format ascii 1.0",
        "element vertex 1500000",
        "property float x",
        "element face 500001",
        "property list uchar int vertex_indices",
        "end_header",
        "",
      ].join("\n"),
      "excessive-total-elements.ply",
    );
    await assert.rejects(
      importer.import(excessiveTotal, [excessiveTotal], options()),
      /total element count exceeds the 2000000 synchronous parse safety limit/u,
    );
    assert.equal(factoryCalls, 0);
  });

  it("keeps element names case-sensitive like PLYLoader", async () => {
    const primary = plyFile(
      [
        "ply",
        "format ascii 1.0",
        "element vertex 3",
        "property float x",
        "property float y",
        "property float z",
        "element FACE 1",
        "property list uchar int vertex_indices",
        "end_header",
        "0 0 0",
        "1 0 0",
        "0 1 0",
        "3 0 1 2",
        "",
      ].join("\n"),
      "uppercase-face.ply",
    );

    const imported = await new PLYImporter().import(
      primary,
      [primary],
      options(),
    );
    const points = findObject(
      imported.root,
      (object) => object instanceof THREE.Points,
      "Expected uppercase FACE to be ignored by PLYLoader",
    );

    assert.equal(points.geometry.getAttribute("position").count, 3);
    assert.equal(imported.metadata.triangleCount, 0);
  });

  it("rejects oversized parsed point geometry and disposes it", async () => {
    const geometry = new THREE.BufferGeometry();
    geometry.getAttribute = (name) =>
      name === "position" ? { count: 2_000_001 } : undefined;
    let disposeCalls = 0;
    geometry.dispose = () => {
      disposeCalls += 1;
    };
    const importer = new PLYImporter({
      createLoader() {
        return { parse: () => geometry };
      },
    });
    const primary = plyFile(
      "ply\nformat ascii 1.0\nelement vertex 0\nend_header\n",
      "oversized-output.ply",
    );

    await assert.rejects(
      importer.import(primary, [primary], options()),
      /PLY output exceeds the main-thread geometry safety budget/,
    );
    assert.equal(disposeCalls, 1);
  });
});

describe("PLY point-cloud runtime integration", () => {
  it("picks the point cloud as one imported root and keeps its material during custom PBR override", async () => {
    const primary = pointCloudFixture();
    const imported = await new PLYImporter().import(
      primary,
      [primary],
      options(),
    );
    const points = findObject(
      imported.root,
      (object) => object instanceof THREE.Points,
      "Expected imported points",
    );
    const originalMaterial = points.material;
    const geometryDisposal = trackDisposal(points.geometry);
    const materialDisposal = trackDisposal(originalMaterial);
    const scene = new THREE.Scene();
    const assets = new ImportedAssetStore();
    const asset = assets.register("asset-ply", imported.root);
    const adapter = new ImportedSceneAdapter(scene, assets);
    const material = createMaterialDefinition(
      "custom-ply",
      "Custom point-cloud material",
      "metal",
    );
    const model = createImportedSceneModel({
      id: "import-ply",
      assetId: "asset-ply",
      name: "Imported point cloud",
      format: "PLY",
      metadata: {
        ...imported.metadata,
        objectCount: imported.metadata.objectCount ?? 0,
        triangleCount: imported.metadata.triangleCount ?? 0,
        materialCount: imported.metadata.materialCount ?? 0,
        sizeBytes: primary.size,
      },
      hierarchy: [],
    });

    adapter.applyModel([model], [material]);
    assert.equal(adapter.getObjectById("import-ply"), asset.root);
    assert.deepEqual(adapter.getPickableObjects(), [points]);
    assert.equal(asset.root.userData.sceneModelId, "import-ply");
    assert.equal(points.userData.sceneModelId, "import-ply");

    const customModel = structuredClone(model);
    customModel.materialMode = "custom";
    customModel.customMaterialId = material.id;
    adapter.applyModel([customModel], [material]);
    assert.equal(points.material, originalMaterial);
    assert.ok(points.material instanceof THREE.PointsMaterial);

    adapter.applyModel([], [material]);
    assert.equal(geometryDisposal.count, 1);
    assert.equal(materialDisposal.count, 1);
    assert.equal(assets.size, 0);
    adapter.dispose();
  });
});

function assertFiniteBounds(root) {
  const bounds = new THREE.Box3().setFromObject(root);
  assert.equal(bounds.isEmpty(), false);
  for (const value of [...bounds.min.toArray(), ...bounds.max.toArray()]) {
    assert.equal(Number.isFinite(value), true);
  }
}

function trackDisposal(resource) {
  const tracker = { count: 0 };
  resource.dispose = () => {
    tracker.count += 1;
  };
  return tracker;
}
