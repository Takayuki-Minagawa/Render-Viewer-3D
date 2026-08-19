import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer } from "vite";

let createDefaultSceneModel;
let material;
let server;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  material = await server.ssrLoadModule("/src/model/material/index.ts");
  ({ createDefaultSceneModel } = await server.ssrLoadModule(
    "/src/model/default-scene.ts",
  ));
});

after(async () => {
  await server?.close();
});

describe("material color-map model", () => {
  it("creates a strict JSON-only descriptor with stable mapping defaults", () => {
    const runtimeImage = new Blob(["runtime-only"]);
    const input = {
      assetId: "  material-image-0042  ",
      sourceName: "  brushed-metal.png  ",
      mimeType: "image/png",
      byteSize: 2_048,
      width: 1_024,
      height: 512,
      runtimeImage,
    };
    const before = { ...input };

    const descriptor = material.createMaterialColorMap(input);

    assert.ok(descriptor);
    assert.deepEqual(input, before, "descriptor creation must not mutate its input");
    assert.deepEqual(descriptor, {
      assetId: "material-image-0042",
      sourceName: "brushed-metal.png",
      mimeType: "image/png",
      byteSize: 2_048,
      width: 1_024,
      height: 512,
      repeatX: 1,
      repeatY: 1,
      offsetX: 0,
      offsetY: 0,
      rotationDegrees: 0,
      wrapMode: "repeat",
    });
    assertJsonOnly(descriptor);
    assert.deepEqual(JSON.parse(JSON.stringify(descriptor)), descriptor);
  });

  it("attaches a normalized clone, clears the preset, and removes it cleanly", () => {
    const scene = createDefaultSceneModel();
    const target = scene.materials[1];
    const input = {
      ...createDescriptor("  mapped-asset  "),
      sourceName: "  mapped image.webp  ",
      repeatX: -12,
      repeatY: 20_000,
      offsetX: -20_000,
      offsetY: 20_000,
      rotationDegrees: -900_000,
    };
    const before = structuredClone(input);

    assert.equal(material.attachMaterialColorMap(scene, target.id, input), true);
    assert.deepEqual(input, before, "attach must not mutate the caller's descriptor");
    assert.notEqual(target.colorMap, input);
    assert.deepEqual(target.colorMap, {
      ...createDescriptor("mapped-asset"),
      sourceName: "mapped image.webp",
      repeatX: 0.01,
      repeatY: 1_000,
      offsetX: -1_000,
      offsetY: 1_000,
      rotationDegrees: -360_000,
    });
    assert.equal(target.presetId, null);
    assertJsonOnly(target.colorMap);

    assert.equal(material.removeMaterialColorMap(scene, target.id), true);
    assert.equal(target.colorMap, null);
    assert.equal(target.presetId, null);
    const afterRemoval = structuredClone(scene);
    assert.equal(material.removeMaterialColorMap(scene, target.id), false);
    assert.deepEqual(scene, afterRemoval);
  });

  it("updates repeat, offset, rotation, and wrap while clamping numeric limits", () => {
    const scene = createDefaultSceneModel();
    const target = scene.materials[0];
    assert.equal(
      material.attachMaterialColorMap(
        scene,
        target.id,
        createDescriptor("mapping-controls"),
      ),
      true,
    );

    for (const [field, value, expected] of [
      ["repeatX", 0, 0.01],
      ["repeatY", 5_000, 1_000],
      ["offsetX", -5_000, -1_000],
      ["offsetY", 5_000, 1_000],
      ["rotationDegrees", 900_000, 360_000],
      ["wrapMode", "mirrored-repeat", "mirrored-repeat"],
      ["wrapMode", "clamp-to-edge", "clamp-to-edge"],
    ]) {
      target.presetId = "matte";
      assert.equal(material.updateMaterialColorMap(scene, target.id, field, value), true);
      assert.equal(target.colorMap[field], expected);
      assert.equal(target.presetId, null);
    }

    assert.equal(
      material.materialColorMapSignature(target.colorMap),
      JSON.stringify([
        "mapping-controls",
        0.01,
        1_000,
        -1_000,
        1_000,
        360_000,
        "clamp-to-edge",
      ]),
    );
  });

  it("rejects malformed descriptors without partially changing the scene", () => {
    const invalidPatches = [
      { assetId: "   " },
      { sourceName: "" },
      { mimeType: "image/gif" },
      { byteSize: 0 },
      { byteSize: material.MATERIAL_TEXTURE_MAX_FILE_BYTES + 1 },
      { width: 0 },
      { height: material.MATERIAL_TEXTURE_MAX_DIMENSION + 1 },
      { repeatX: Number.NaN },
      { offsetY: Number.POSITIVE_INFINITY },
      { rotationDegrees: "90" },
      { wrapMode: "tile" },
    ];

    for (const patch of invalidPatches) {
      const scene = createDefaultSceneModel();
      const target = scene.materials[0];
      const before = structuredClone(scene);
      const invalid = { ...createDescriptor("invalid-map"), ...patch };

      assert.equal(
        material.attachMaterialColorMap(scene, target.id, invalid),
        false,
        `unexpectedly accepted ${JSON.stringify(patch)}`,
      );
      assert.deepEqual(scene, before);
    }

    const scene = createDefaultSceneModel();
    const before = structuredClone(scene);
    assert.equal(
      material.attachMaterialColorMap(
        scene,
        "missing-material",
        createDescriptor("valid-map"),
      ),
      false,
    );
    assert.deepEqual(scene, before);
  });

  it("rejects invalid update values and unknown fields atomically", () => {
    const scene = createDefaultSceneModel();
    const target = scene.materials[0];
    assert.equal(
      material.attachMaterialColorMap(
        scene,
        target.id,
        createDescriptor("safe-map"),
      ),
      true,
    );

    for (const [field, value] of [
      ["repeatX", Number.NaN],
      ["repeatY", Number.NEGATIVE_INFINITY],
      ["offsetX", "2"],
      ["rotationDegrees", null],
      ["wrapMode", "tile"],
      ["runtimeTexture", { dispose() {} }],
    ]) {
      const before = structuredClone(scene);
      assert.equal(
        material.updateMaterialColorMap(scene, target.id, field, value),
        false,
        `unexpectedly accepted field ${field}`,
      );
      assert.deepEqual(scene, before);
    }

    const withoutMap = createDefaultSceneModel();
    const before = structuredClone(withoutMap);
    assert.equal(
      material.updateMaterialColorMap(
        withoutMap,
        withoutMap.materials[0].id,
        "repeatX",
        2,
      ),
      false,
    );
    assert.deepEqual(withoutMap, before);
  });

  it("backfills colorMap for historical v2 and migrated v1 scenes", () => {
    const historicalV2 = createDefaultSceneModel();
    for (const definition of historicalV2.materials) delete definition.colorMap;
    const v2Before = structuredClone(historicalV2);

    const migratedV2 = material.migrateSceneModel(historicalV2);

    assert.deepEqual(historicalV2, v2Before);
    assert.ok(migratedV2.materials.every(({ colorMap }) => colorMap === null));

    const current = createDefaultSceneModel();
    const legacyV1 = {
      ...structuredClone(current),
      schemaVersion: 1,
      objects: current.objects.slice(0, 2).map((object) => {
        const { materialId, ...legacyObject } = structuredClone(object);
        void materialId;
        return {
          ...legacyObject,
          material: { color: "#123456", metalness: 0.2, roughness: 0.7 },
        };
      }),
    };
    delete legacyV1.imports;
    delete legacyV1.materials;
    const v1Before = structuredClone(legacyV1);

    const migratedV1 = material.migrateSceneModel(legacyV1);

    assert.deepEqual(legacyV1, v1Before);
    assert.ok(migratedV1.materials.every(({ colorMap }) => colorMap === null));
    const serialized = JSON.stringify(migratedV1);
    assert.doesNotThrow(() => JSON.parse(serialized));
    assert.ok(JSON.parse(serialized).materials.every(({ colorMap }) => colorMap === null));
  });
});

function createDescriptor(assetId, overrides = {}) {
  return {
    assetId,
    sourceName: `${assetId.trim() || "texture"}.webp`,
    mimeType: "image/webp",
    byteSize: 4_096,
    width: 256,
    height: 128,
    repeatX: 1,
    repeatY: 1,
    offsetX: 0,
    offsetY: 0,
    rotationDegrees: 0,
    wrapMode: "repeat",
    ...overrides,
  };
}

function assertJsonOnly(value, path = "colorMap") {
  if (value === null) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonOnly(entry, `${path}[${index}]`));
    return;
  }
  switch (typeof value) {
    case "string":
    case "boolean":
      return;
    case "number":
      assert.equal(Number.isFinite(value), true, `${path} must be finite`);
      return;
    case "object":
      assert.equal(
        Object.getPrototypeOf(value),
        Object.prototype,
        `${path} must be a plain JSON object`,
      );
      for (const [key, entry] of Object.entries(value)) {
        assertJsonOnly(entry, `${path}.${key}`);
      }
      return;
    default:
      assert.fail(`${path} contains non-JSON value ${String(value)}`);
  }
}
