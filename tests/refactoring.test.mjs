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
    assert.ok(Object.isFrozen(snapshot.materials[0].preview));
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

    adapter.applyModel(model.objects, model.lights, model.materials);

    const initialMeshes = findMeshes(scene);
    assert.equal(initialMeshes.length, 3);
    assert.equal(findLights(scene).length, 2);

    const box = findMesh(scene, "box-01");
    const ground = findMesh(scene, "ground-01");
    assert.equal(box.name, "Box 01");
    assert.deepEqual(box.position.toArray(), [0, 1, 0]);
    assert.ok(nearlyEqual(box.rotation.y, THREE.MathUtils.degToRad(-18)));
    assert.deepEqual(box.scale.toArray(), [1, 1, 1]);
    assert.equal(box.castShadow, true);
    assert.equal(box.receiveShadow, true);
    assertMaterialColor(
      box.material,
      findMaterial(model, model.objects[0].materialId),
    );
    assert.equal(box.material.metalness, 0.08);
    assert.equal(box.material.roughness, 0.32);
    assert.deepEqual(ground.position.toArray(), [0, -0.02, 0]);
    assert.ok(nearlyEqual(ground.rotation.x, -Math.PI / 2));
    assert.equal(ground.receiveShadow, true);

    const ambient = findLight(scene, THREE.AmbientLight, "Ambient Light");
    const directional = findLight(scene, THREE.DirectionalLight, "Key Light");
    assert.equal(ambient.color.getHexString(THREE.SRGBColorSpace), "c2d2ff");
    assert.equal(ambient.intensity, 0.65);
    assert.equal(ambient.visible, true);
    assert.equal(
      directional.color.getHexString(THREE.SRGBColorSpace),
      "fff4e4",
    );
    assert.equal(directional.intensity, 3.2);
    assert.deepEqual(directional.position.toArray(), [5, 8, 4]);
    assert.deepEqual(directional.target.position.toArray(), [0, 0.6, 0]);
    assert.equal(directional.castShadow, true);

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

    adapter.applyModel(model.objects, model.lights, model.materials);
    assert.equal(findMesh(scene, "box-01").geometry, originalBoxGeometry);

    const next = structuredClone(model);
    next.objects[0].name = "Updated Box";
    next.objects[0].geometry.width = 3;
    next.objects[0].visible = false;
    next.objects[0].transform.position = { x: 2, y: 3, z: 4 };
    next.objects[0].transform.rotationDegrees = { x: 10, y: 20, z: 30 };
    next.objects[0].transform.scale = { x: 1.5, y: 2, z: 0.5 };
    const nextBoxMaterial = findMaterial(next, next.objects[0].materialId);
    Object.assign(nextBoxMaterial.preview, {
      baseColor: "#ff8844",
      diffuse: 1,
      metalness: 0.4,
      roughness: 0.6,
    });
    next.objects[0].castShadow = false;
    next.objects[0].receiveShadow = false;
    next.lights[0].color = "#88aaff";
    next.lights[0].intensity = 0.25;
    next.lights[1].color = "#ffcc88";
    next.lights[1].intensity = 1.7;
    next.lights[1].position = { x: 7, y: 6, z: 5 };
    next.lights[1].target = { x: 1, y: 2, z: 3 };
    next.lights[1].castShadow = false;
    next.objects = next.objects.filter((object) => object.id === "box-01");
    next.objects.push({
      ...structuredClone(next.objects[0]),
      id: "box-02",
      name: "Box 02",
    });
    adapter.applyModel(next.objects, next.lights, next.materials);

    assert.notEqual(findMesh(scene, "box-01").geometry, originalBoxGeometry);
    const updatedBox = findMesh(scene, "box-01");
    assert.equal(updatedBox.name, "Updated Box");
    assert.equal(updatedBox.visible, false);
    assert.deepEqual(updatedBox.position.toArray(), [2, 3, 4]);
    assert.ok(nearlyEqual(updatedBox.rotation.x, THREE.MathUtils.degToRad(10)));
    assert.ok(nearlyEqual(updatedBox.rotation.y, THREE.MathUtils.degToRad(20)));
    assert.ok(nearlyEqual(updatedBox.rotation.z, THREE.MathUtils.degToRad(30)));
    assert.deepEqual(updatedBox.scale.toArray(), [1.5, 2, 0.5]);
    assert.equal(updatedBox.castShadow, false);
    assert.equal(updatedBox.receiveShadow, false);
    assertMaterialColor(updatedBox.material, nextBoxMaterial);
    assert.equal(updatedBox.material.metalness, 0.4);
    assert.equal(updatedBox.material.roughness, 0.6);
    const updatedAmbient = findLight(scene, THREE.AmbientLight, "Ambient Light");
    const updatedDirectional = findLight(
      scene,
      THREE.DirectionalLight,
      "Key Light",
    );
    assert.equal(
      updatedAmbient.color.getHexString(THREE.SRGBColorSpace),
      "88aaff",
    );
    assert.equal(updatedAmbient.intensity, 0.25);
    assert.equal(
      updatedDirectional.color.getHexString(THREE.SRGBColorSpace),
      "ffcc88",
    );
    assert.equal(updatedDirectional.intensity, 1.7);
    assert.deepEqual(updatedDirectional.position.toArray(), [7, 6, 5]);
    assert.deepEqual(updatedDirectional.target.position.toArray(), [1, 2, 3]);
    assert.equal(updatedDirectional.castShadow, false);
    assert.deepEqual(
      findMeshes(scene)
        .map((mesh) => mesh.userData.sceneModelId)
        .sort(),
      ["box-01", "box-02"],
    );
    assert.equal(boxGeometryDisposed, true);
    assert.equal(groundGeometryDisposed, true);
    assert.equal(groundMaterialDisposed, false);

    const duplicate = structuredClone(next);
    duplicate.objects.push(structuredClone(duplicate.objects[0]));
    assert.throws(
      () =>
        adapter.applyModel(
          duplicate.objects,
          duplicate.lights,
          duplicate.materials,
        ),
      /Duplicate object id in SceneModel: box-01/,
    );

    adapter.dispose();
    assert.equal(groundMaterialDisposed, true);
    assert.equal(findMeshes(scene).length, 0);
    assert.equal(findLights(scene).length, 0);
  });

  it("replaces a light when its model type changes", () => {
    const scene = new THREE.Scene();
    const adapter = new SceneGraphAdapter(scene);
    const model = createDefaultSceneModel();
    adapter.applyModel(model.objects, model.lights, model.materials);
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
    adapter.applyModel(next.objects, next.lights, next.materials);

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

function findLight(scene, LightType, name) {
  const light = scene.children.find(
    (child) => child instanceof LightType && child.name === name,
  );
  assert.ok(light, `Expected light ${name}`);
  return light;
}

function findMaterial(model, materialId) {
  const material = model.materials.find((candidate) => candidate.id === materialId);
  assert.ok(material, `Expected material ${materialId}`);
  return material;
}

function assertMaterialColor(actual, definition) {
  const expected = new THREE.Color(definition.preview.baseColor);
  assert.ok(nearlyEqual(actual.color.r, expected.r));
  assert.ok(nearlyEqual(actual.color.g, expected.g));
  assert.ok(nearlyEqual(actual.color.b, expected.b));
}

function nearlyEqual(actual, expected) {
  return Math.abs(actual - expected) < 1e-10;
}
