import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as THREE from "three";
import { createServer } from "vite";

let server;
let SceneGraphAdapter;
let SceneStore;
let createDefaultSceneModel;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ SceneGraphAdapter } = await server.ssrLoadModule(
    "/src/three/scene-graph-adapter.ts",
  ));
  ({ SceneStore } = await server.ssrLoadModule("/src/app/scene-store.ts"));
  ({ createDefaultSceneModel } = await server.ssrLoadModule(
    "/src/model/default-scene.ts",
  ));
});

after(async () => {
  await server?.close();
});

describe("SceneStore", () => {
  it("owns an isolated, deeply frozen snapshot", () => {
    const initialModel = createDefaultSceneModel();
    const store = new SceneStore(initialModel);
    const snapshot = store.getSnapshot();

    initialModel.camera.position.x = 99;

    assert.equal(snapshot.camera.position.x, 6.5);
    assert.ok(Object.isFrozen(snapshot));
    assert.ok(Object.isFrozen(snapshot.camera.position));
    assert.ok(Object.isFrozen(snapshot.objects));
    assert.ok(Object.isFrozen(snapshot.objects[0].material));
    assert.throws(() => {
      snapshot.camera.position.x = 99;
    }, TypeError);
  });

  it("publishes a new frozen snapshot without mutating the previous one", () => {
    const store = new SceneStore(createDefaultSceneModel());
    const previous = store.getSnapshot();
    let published;
    const unsubscribe = store.subscribe((snapshot) => {
      published = snapshot;
    });

    store.update((draft) => {
      draft.helpers.gridVisible = false;
      draft.camera.position.x = 4;
    });

    const current = store.getSnapshot();
    assert.notEqual(current, previous);
    assert.equal(previous.helpers.gridVisible, true);
    assert.equal(previous.camera.position.x, 6.5);
    assert.equal(current.helpers.gridVisible, false);
    assert.equal(current.camera.position.x, 4);
    assert.equal(published, current);
    assert.ok(Object.isFrozen(current.camera.position));
    unsubscribe();
  });
});

describe("SceneGraphAdapter", () => {
  it("reconciles model additions, removals, and geometry changes", () => {
    const scene = new THREE.Scene();
    const adapter = new SceneGraphAdapter(scene);
    const model = createDefaultSceneModel();

    adapter.applyModel(model.objects, model.lights);

    const initialMeshes = findMeshes(scene);
    assert.equal(initialMeshes.length, 2);
    assert.equal(findLights(scene).length, 2);

    const box = findMesh(scene, "box-01");
    const ground = findMesh(scene, "ground-01");
    const originalBoxGeometry = box.geometry;
    let boxGeometryDisposed = false;
    let groundGeometryDisposed = false;
    let groundMaterialDisposed = false;
    originalBoxGeometry.dispose = () => {
      boxGeometryDisposed = true;
    };
    ground.geometry.dispose = () => {
      groundGeometryDisposed = true;
    };
    ground.material.dispose = () => {
      groundMaterialDisposed = true;
    };

    adapter.applyModel(model.objects, model.lights);
    assert.equal(findMesh(scene, "box-01").geometry, originalBoxGeometry);

    const next = structuredClone(model);
    next.objects[0].geometry.width = 3;
    next.objects.splice(1, 1);
    next.objects.push({
      ...structuredClone(next.objects[0]),
      id: "box-02",
      name: "Box 02",
    });
    adapter.applyModel(next.objects, next.lights);

    assert.notEqual(findMesh(scene, "box-01").geometry, originalBoxGeometry);
    assert.deepEqual(
      findMeshes(scene)
        .map((mesh) => mesh.userData.sceneModelId)
        .sort(),
      ["box-01", "box-02"],
    );
    assert.equal(boxGeometryDisposed, true);
    assert.equal(groundGeometryDisposed, true);
    assert.equal(groundMaterialDisposed, true);

    const duplicate = structuredClone(next);
    duplicate.objects.push(structuredClone(duplicate.objects[0]));
    assert.throws(
      () => adapter.applyModel(duplicate.objects, duplicate.lights),
      /Duplicate object id in SceneModel: box-01/,
    );

    adapter.dispose();
    assert.equal(findMeshes(scene).length, 0);
    assert.equal(findLights(scene).length, 0);
  });

  it("replaces a light when its model type changes", () => {
    const scene = new THREE.Scene();
    const adapter = new SceneGraphAdapter(scene);
    const model = createDefaultSceneModel();
    adapter.applyModel(model.objects, model.lights);
    const initialAmbient = scene.children.find(
      (child) => child instanceof THREE.AmbientLight,
    );
    assert.ok(initialAmbient);

    const next = structuredClone(model);
    next.lights[0] = {
      id: "ambient-01",
      type: "directional",
      name: "Replacement Key",
      color: "#ffffff",
      intensity: 1,
      enabled: true,
      position: { x: 1, y: 2, z: 3 },
      target: { x: 0, y: 0, z: 0 },
      castShadow: false,
    };
    adapter.applyModel(next.objects, next.lights);

    assert.ok(!scene.children.includes(initialAmbient));
    assert.equal(
      scene.children.filter((child) => child instanceof THREE.DirectionalLight)
        .length,
      2,
    );

    adapter.dispose();
    assert.equal(findLights(scene).length, 0);
  });
});

function findMeshes(scene) {
  return scene.children.filter((child) => child instanceof THREE.Mesh);
}

function findMesh(scene, id) {
  const mesh = findMeshes(scene).find(
    (candidate) => candidate.userData.sceneModelId === id,
  );
  assert.ok(mesh, `Expected mesh ${id}`);
  return mesh;
}

function findLights(scene) {
  return scene.children.filter((child) => child instanceof THREE.Light);
}
