import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer } from "vite";

let server;
let commands;
let createDefaultSceneModel;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  commands = await server.ssrLoadModule(
    "/src/model/scene-object-commands.ts",
  );
  ({ createDefaultSceneModel } = await server.ssrLoadModule(
    "/src/model/default-scene.ts",
  ));
});

after(async () => {
  await server?.close();
});

describe("scene object factories", () => {
  it("creates all six supported geometry defaults", () => {
    const expected = {
      box: { type: "box", width: 2, height: 2, depth: 2 },
      sphere: {
        type: "sphere",
        radius: 1,
        widthSegments: 32,
        heightSegments: 16,
      },
      cylinder: {
        type: "cylinder",
        radiusTop: 1,
        radiusBottom: 1,
        height: 2,
        radialSegments: 32,
      },
      cone: { type: "cone", radius: 1, height: 2, radialSegments: 32 },
      plane: { type: "plane", width: 2, height: 2 },
      torus: {
        type: "torus",
        radius: 1,
        tubeRadius: 0.25,
        radialSegments: 16,
        tubularSegments: 48,
      },
    };

    assert.deepEqual(commands.SCENE_OBJECT_GEOMETRY_TYPES, Object.keys(expected));
    for (const type of commands.SCENE_OBJECT_GEOMETRY_TYPES) {
      const object = commands.createDefaultSceneObject(
        type,
        `test-${type}`,
      );
      assert.equal(object.id, `test-${type}`);
      assert.deepEqual(object.geometry, expected[type]);
      assert.equal(object.visible, true);
      assert.deepEqual(object.transform.scale, { x: 1, y: 1, z: 1 });
      assert.equal(object.materialId, `test-${type}-material`);
      assert.equal(object.receiveShadow, true);
      assert.equal(object.castShadow, type !== "plane");
    }

    const plane = commands.createDefaultSceneObject("plane", "plane-test");
    assert.deepEqual(plane.transform.position, { x: 0, y: 0.01, z: 0 });
    assert.deepEqual(plane.transform.rotationDegrees, { x: -90, y: 0, z: 0 });
    assert.throws(
      () => commands.createDefaultSceneObject("box", "   "),
      /must not be empty/,
    );
  });
});

describe("scene object commands", () => {
  it("adds objects with deterministic ids unique in the current SceneModel", () => {
    const model = createDefaultSceneModel();

    const box = commands.addSceneObject(model, "box");
    const sphere = commands.addSceneObject(model, "sphere");
    const plane = commands.addSceneObject(model, "plane");

    assert.equal(box.id, "box-02");
    assert.equal(box.name, "Box 02");
    assert.equal(sphere.id, "sphere-02");
    assert.equal(sphere.name, "Sphere 02");
    assert.equal(plane.id, "plane-01");
    assert.equal(plane.name, "Plane 01");
    assert.equal(new Set(model.objects.map((object) => object.id)).size, 6);
    assert.equal(new Set(model.materials.map((material) => material.id)).size, 6);
    for (const object of [box, sphere, plane]) {
      assert.ok(model.materials.some((material) => material.id === object.materialId));
    }
  });

  it("duplicates deeply with a unique id and name", () => {
    const model = createDefaultSceneModel();
    const source = model.objects[0];

    const first = commands.duplicateSceneObject(model, source.id);
    const second = commands.duplicateSceneObject(model, source.id);

    assert.ok(first);
    assert.ok(second);
    assert.equal(first.id, "box-02");
    assert.equal(first.name, "Box 01 Copy");
    assert.equal(second.id, "box-03");
    assert.equal(second.name, "Box 01 Copy 2");
    assert.notEqual(first.transform, source.transform);
    assert.notEqual(first.geometry, source.geometry);
    assert.notEqual(first.materialId, source.materialId);
    const sourceMaterial = model.materials.find(
      (material) => material.id === source.materialId,
    );
    const firstMaterial = model.materials.find(
      (material) => material.id === first.materialId,
    );
    assert.ok(sourceMaterial);
    assert.ok(firstMaterial);
    assert.notEqual(firstMaterial, sourceMaterial);
    firstMaterial.preview.baseColor = "#123456";
    assert.notEqual(firstMaterial.preview.baseColor, sourceMaterial.preview.baseColor);

    commands.updateSceneObjectTransform(model, first.id, {
      position: { x: 8 },
    });
    assert.equal(first.transform.position.x, 8);
    assert.equal(source.transform.position.x, 0);
    assert.equal(commands.duplicateSceneObject(model, "missing"), undefined);
  });

  it("renames, changes visibility, and deletes by id", () => {
    const model = createDefaultSceneModel();
    const object = model.objects[0];

    assert.equal(commands.renameSceneObject(model, object.id, "  Primary Box  "), true);
    assert.equal(object.name, "Primary Box");
    assert.equal(commands.renameSceneObject(model, object.id, "   "), false);
    assert.equal(object.name, "Primary Box");
    assert.equal(
      commands.renameSceneObject(model, object.id, "x".repeat(100)),
      true,
    );
    assert.equal(object.name.length, 80);

    assert.equal(
      commands.setSceneObjectVisibility(model, object.id, false),
      true,
    );
    assert.equal(object.visible, false);
    assert.equal(commands.setSceneObjectVisibility(model, "missing", true), false);
    assert.equal(commands.deleteSceneObject(model, "missing"), false);
    assert.equal(commands.deleteSceneObject(model, object.id), true);
    assert.ok(!model.objects.some((candidate) => candidate.id === object.id));
  });

  it("constrains transform values and leaves material untouched", () => {
    const model = createDefaultSceneModel();
    const object = model.objects[0];
    const material = structuredClone(
      model.materials.find((candidate) => candidate.id === object.materialId),
    );

    assert.equal(
      commands.updateSceneObjectTransform(model, object.id, {
        position: { x: Number.POSITIVE_INFINITY, y: -20_000, z: 12 },
        rotationDegrees: { x: Number.NaN, y: 400_000, z: -400_000 },
        scale: { x: 0, y: -4, z: 5_000 },
      }),
      true,
    );

    assert.deepEqual(object.transform.position, { x: 0, y: -10_000, z: 12 });
    assert.deepEqual(object.transform.rotationDegrees, {
      x: 0,
      y: 360_000,
      z: -360_000,
    });
    assert.deepEqual(object.transform.scale, { x: 0.01, y: 0.01, z: 1_000 });
    assert.deepEqual(
      model.materials.find((candidate) => candidate.id === object.materialId),
      material,
    );
    assert.equal(
      commands.updateSceneObjectTransform(model, "missing", {
        position: { x: 1 },
      }),
      false,
    );
  });

  it("updates and constrains every geometry variant", () => {
    const model = createDefaultSceneModel();
    const object = model.objects[0];
    const material = structuredClone(
      model.materials.find((candidate) => candidate.id === object.materialId),
    );

    assert.equal(
      commands.updateSceneObjectGeometry(model, object.id, {
        type: "box",
        width: -1,
        height: Number.POSITIVE_INFINITY,
        depth: 20_000,
      }),
      true,
    );
    assert.deepEqual(object.geometry, {
      type: "box",
      width: 0.01,
      height: 2,
      depth: 10_000,
    });

    commands.updateSceneObjectGeometry(model, object.id, {
      type: "sphere",
      radius: 0,
      widthSegments: 2.4,
      heightSegments: 999,
    });
    assert.deepEqual(object.geometry, {
      type: "sphere",
      radius: 0.01,
      widthSegments: 3,
      heightSegments: 128,
    });

    commands.updateSceneObjectGeometry(model, object.id, {
      type: "cylinder",
      radiusTop: -5,
      radiusBottom: 3,
      height: 4,
      radialSegments: 3.6,
    });
    assert.deepEqual(object.geometry, {
      type: "cylinder",
      radiusTop: 0.01,
      radiusBottom: 3,
      height: 4,
      radialSegments: 4,
    });

    commands.updateSceneObjectGeometry(model, object.id, {
      type: "cone",
      radius: 2,
      height: Number.NaN,
      radialSegments: 1,
    });
    assert.deepEqual(object.geometry, {
      type: "cone",
      radius: 2,
      height: 2,
      radialSegments: 3,
    });

    commands.updateSceneObjectGeometry(model, object.id, {
      type: "plane",
      width: 5,
      height: 0,
    });
    assert.deepEqual(object.geometry, {
      type: "plane",
      width: 5,
      height: 0.01,
    });

    commands.updateSceneObjectGeometry(model, object.id, {
      type: "torus",
      radius: 2,
      tubeRadius: -1,
      radialSegments: 999,
      tubularSegments: 999,
    });
    assert.deepEqual(object.geometry, {
      type: "torus",
      radius: 2,
      tubeRadius: 0.01,
      radialSegments: 128,
      tubularSegments: 256,
    });
    assert.deepEqual(
      model.materials.find((candidate) => candidate.id === object.materialId),
      material,
    );

    const previous = structuredClone(object.geometry);
    assert.equal(
      commands.updateSceneObjectGeometry(model, object.id, {
        type: "unsupported",
      }),
      false,
    );
    assert.deepEqual(object.geometry, previous);
    assert.equal(
      commands.updateSceneObjectGeometry(model, "missing", {
        type: "box",
        width: 1,
      }),
      false,
    );
  });

  it("keeps the existing default scene shape compatible", () => {
    const model = createDefaultSceneModel();

    assert.deepEqual(
      model.objects.map((object) => [object.id, object.geometry]),
      [
        ["box-01", { type: "box", width: 2, height: 2, depth: 2 }],
        [
          "sphere-01",
          {
            type: "sphere",
            radius: 1,
            widthSegments: 32,
            heightSegments: 16,
          },
        ],
        ["ground-01", { type: "plane", width: 24, height: 24 }],
      ],
    );
  });
});
