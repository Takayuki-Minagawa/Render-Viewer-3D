import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as THREE from "three";
import { createServer } from "vite";

let server;
let createGeometry;
let geometrySignature;
let SceneGraphAdapter;
let createDefaultGeometry;
let createDefaultSceneObject;
let geometryTypes;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });

  ({ createGeometry, geometrySignature } = await server.ssrLoadModule(
    "/src/three/geometry-factory.ts",
  ));
  ({ SceneGraphAdapter } = await server.ssrLoadModule(
    "/src/three/scene-graph-adapter.ts",
  ));
  const commands = await server.ssrLoadModule(
    "/src/model/scene-object-commands.ts",
  );
  ({
    createDefaultGeometry,
    createDefaultSceneObject,
    SCENE_OBJECT_GEOMETRY_TYPES: geometryTypes,
  } = commands);
});

after(async () => {
  await server?.close();
});

describe("geometry factory", () => {
  it("creates the matching Three.js geometry for all six model variants", () => {
    for (const type of geometryTypes) {
      const model = createDefaultGeometry(type);
      const geometry = createGeometry(model);

      assertGeometryMatchesModel(geometry, model);
      geometry.dispose();
    }
  });

  it("changes the signature for every geometry parameter", () => {
    const fieldsByType = {
      box: ["width", "height", "depth"],
      sphere: ["radius", "widthSegments", "heightSegments"],
      cylinder: [
        "radiusTop",
        "radiusBottom",
        "height",
        "radialSegments",
      ],
      cone: ["radius", "height", "radialSegments"],
      plane: ["width", "height"],
      torus: [
        "radius",
        "tubeRadius",
        "radialSegments",
        "tubularSegments",
      ],
    };

    for (const type of geometryTypes) {
      const model = createDefaultGeometry(type);
      const signature = geometrySignature(model);
      assert.equal(geometrySignature(structuredClone(model)), signature);

      for (const field of fieldsByType[type]) {
        const changed = structuredClone(model);
        changed[field] += 1;
        assert.notEqual(
          geometrySignature(changed),
          signature,
          `Expected ${type}.${field} to affect its signature`,
        );
      }
    }
  });
});

describe("SceneGraphAdapter geometry reconciliation", () => {
  it("adds all variants, reuses equal geometry, and disposes replacements", () => {
    const scene = new THREE.Scene();
    const adapter = new SceneGraphAdapter(scene);
    const objects = geometryTypes.map((type) =>
      createDefaultSceneObject(type, `shape-${type}`),
    );

    adapter.applyModel(objects, []);

    const initialGeometries = new Map();
    const initialDisposed = new Map();
    for (const object of objects) {
      const mesh = findMesh(adapter, object.id);
      assertGeometryMatchesModel(mesh.geometry, object.geometry);
      initialGeometries.set(object.id, mesh.geometry);
      initialDisposed.set(object.id, false);
      mesh.geometry.dispose = () => {
        initialDisposed.set(object.id, true);
      };
    }

    const equalGeometryModels = structuredClone(objects);
    for (const object of equalGeometryModels) {
      object.name = `${object.name} renamed`;
      object.transform.position.x += 2;
    }
    adapter.applyModel(equalGeometryModels, []);

    for (const object of equalGeometryModels) {
      const mesh = findMesh(adapter, object.id);
      assert.equal(mesh.geometry, initialGeometries.get(object.id));
      assert.equal(initialDisposed.get(object.id), false);
      assert.equal(mesh.name, object.name);
      assert.equal(mesh.position.x, object.transform.position.x);
    }

    const changedValueModels = structuredClone(equalGeometryModels);
    for (const object of changedValueModels) {
      changeOneGeometryValue(object.geometry);
    }
    adapter.applyModel(changedValueModels, []);

    const valueChangedGeometries = new Map();
    const valueChangedDisposed = new Map();
    for (const object of changedValueModels) {
      const mesh = findMesh(adapter, object.id);
      assert.notEqual(mesh.geometry, initialGeometries.get(object.id));
      assert.equal(initialDisposed.get(object.id), true);
      assertGeometryMatchesModel(mesh.geometry, object.geometry);
      valueChangedGeometries.set(object.id, mesh.geometry);
      valueChangedDisposed.set(object.id, false);
      mesh.geometry.dispose = () => {
        valueChangedDisposed.set(object.id, true);
      };
    }

    const typeChangedModels = structuredClone(changedValueModels);
    for (let index = 0; index < typeChangedModels.length; index += 1) {
      const nextType = geometryTypes[(index + 1) % geometryTypes.length];
      typeChangedModels[index].geometry = createDefaultGeometry(nextType);
    }
    adapter.applyModel(typeChangedModels, []);

    for (const object of typeChangedModels) {
      const mesh = findMesh(adapter, object.id);
      assert.notEqual(mesh.geometry, valueChangedGeometries.get(object.id));
      assert.equal(valueChangedDisposed.get(object.id), true);
      assertGeometryMatchesModel(mesh.geometry, object.geometry);
    }

    adapter.dispose();
    assert.equal(
      scene.children.filter((child) => child instanceof THREE.Mesh).length,
      0,
    );
  });
});

function findMesh(adapter, objectId) {
  const object = adapter.getObjectById(objectId);
  assert.ok(object instanceof THREE.Mesh, `Expected mesh ${objectId}`);
  return object;
}

function changeOneGeometryValue(model) {
  switch (model.type) {
    case "box":
      model.width += 1;
      break;
    case "sphere":
      model.radius += 1;
      break;
    case "cylinder":
      model.height += 1;
      break;
    case "cone":
      model.radius += 1;
      break;
    case "plane":
      model.width += 1;
      break;
    case "torus":
      model.tubeRadius += 0.1;
      break;
  }
}

function assertGeometryMatchesModel(geometry, model) {
  switch (model.type) {
    case "box":
      assert.ok(geometry instanceof THREE.BoxGeometry);
      assert.equal(geometry.parameters.width, model.width);
      assert.equal(geometry.parameters.height, model.height);
      assert.equal(geometry.parameters.depth, model.depth);
      break;
    case "sphere":
      assert.ok(geometry instanceof THREE.SphereGeometry);
      assert.equal(geometry.parameters.radius, model.radius);
      assert.equal(geometry.parameters.widthSegments, model.widthSegments);
      assert.equal(geometry.parameters.heightSegments, model.heightSegments);
      break;
    case "cylinder":
      assert.ok(geometry instanceof THREE.CylinderGeometry);
      assert.equal(geometry.parameters.radiusTop, model.radiusTop);
      assert.equal(geometry.parameters.radiusBottom, model.radiusBottom);
      assert.equal(geometry.parameters.height, model.height);
      assert.equal(geometry.parameters.radialSegments, model.radialSegments);
      break;
    case "cone":
      assert.ok(geometry instanceof THREE.ConeGeometry);
      assert.equal(geometry.parameters.radius, model.radius);
      assert.equal(geometry.parameters.height, model.height);
      assert.equal(geometry.parameters.radialSegments, model.radialSegments);
      break;
    case "plane":
      assert.ok(geometry instanceof THREE.PlaneGeometry);
      assert.equal(geometry.parameters.width, model.width);
      assert.equal(geometry.parameters.height, model.height);
      break;
    case "torus":
      assert.ok(geometry instanceof THREE.TorusGeometry);
      assert.equal(geometry.parameters.radius, model.radius);
      assert.equal(geometry.parameters.tube, model.tubeRadius);
      assert.equal(geometry.parameters.radialSegments, model.radialSegments);
      assert.equal(geometry.parameters.tubularSegments, model.tubularSegments);
      break;
  }
}
