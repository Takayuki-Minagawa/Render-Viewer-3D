import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as THREE from "three";
import { createServer } from "vite";

let ImportedAssetStore;
let ImportedSceneAdapter;
let createImportedSceneModel;
let createMaterialDefinition;
let server;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
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

describe("ImportedSceneAdapter", () => {
  it("reconciles transforms and visibility and round-trips imported materials", () => {
    const scene = new THREE.Scene();
    const assets = new ImportedAssetStore();
    const adapter = new ImportedSceneAdapter(scene, assets);
    const source = createSourceAsset();
    const asset = assets.register("asset-01", source.root);
    const customDefinition = createMaterialDefinition(
      "custom-01",
      "Custom material",
      "metal",
    );
    const model = createModel();

    adapter.applyModel([model], [customDefinition]);
    const renderedRoot = adapter.getObjectById("import-01");
    assert.equal(renderedRoot, asset.root);
    assert.ok(scene.children.includes(renderedRoot));
    assert.equal(renderedRoot.name, "Imported assembly");
    assert.deepEqual(renderedRoot.position.toArray(), [1, 2, 3]);
    assert.ok(nearlyEqual(renderedRoot.rotation.y, Math.PI / 4));
    assert.deepEqual(renderedRoot.scale.toArray(), [2, 1, 0.5]);
    assert.deepEqual(adapter.getPickableObjects(), [source.firstMesh, source.secondMesh]);
    assert.equal(source.firstMesh.userData.sceneModelId, "import-01");
    assert.equal(source.secondMesh.userData.sceneModelId, "import-01");

    const customModel = structuredClone(model);
    customModel.materialMode = "custom";
    customModel.customMaterialId = customDefinition.id;
    adapter.applyModel([customModel], [customDefinition]);
    const customRuntime = source.firstMesh.material;
    assert.ok(customRuntime instanceof THREE.MeshPhysicalMaterial);
    assert.equal(source.secondMesh.material, customRuntime);
    assert.notEqual(customRuntime, source.firstMaterial);

    const customDisposal = trackDisposal(customRuntime);
    adapter.applyModel([model], [customDefinition]);
    assert.equal(source.firstMesh.material, source.firstMaterial);
    assert.equal(source.secondMesh.material, source.secondMaterialArray);
    assert.equal(customDisposal.count, 0);

    const hiddenModel = structuredClone(model);
    hiddenModel.visible = false;
    adapter.applyModel([hiddenModel], [customDefinition]);
    assert.deepEqual(adapter.getPickableObjects(), []);

    const firstGeometryDisposal = trackDisposal(source.firstMesh.geometry);
    const secondGeometryDisposal = trackDisposal(source.secondMesh.geometry);
    const firstMaterialDisposal = trackDisposal(source.firstMaterial);
    const secondMaterialDisposal = trackDisposal(source.secondMaterial);
    adapter.applyModel([], [customDefinition]);
    assert.equal(adapter.getObjectById("import-01"), undefined);
    assert.ok(!scene.children.includes(renderedRoot));
    assert.equal(assets.get("asset-01"), undefined);
    assert.equal(firstGeometryDisposal.count, 1);
    assert.equal(secondGeometryDisposal.count, 1);
    assert.equal(firstMaterialDisposal.count, 1);
    assert.equal(secondMaterialDisposal.count, 1);
    assert.equal(customDisposal.count, 0);

    adapter.dispose();
    assert.equal(customDisposal.count, 1);
  });

  it("replaces assets safely and rejects invalid model references before mutation", () => {
    const scene = new THREE.Scene();
    const assets = new ImportedAssetStore();
    const adapter = new ImportedSceneAdapter(scene, assets);
    const first = createSourceAsset();
    const second = createSourceAsset();
    const firstRuntime = assets.register("asset-01", first.root);
    const secondRuntime = assets.register("asset-02", second.root);
    const firstDisposal = trackDisposal(first.firstMesh.geometry);
    const model = createModel();

    adapter.applyModel([model], []);
    assert.throws(
      () =>
        adapter.applyModel(
          [{ ...structuredClone(model), assetId: "missing" }],
          [],
        ),
      /Missing imported runtime asset/,
    );
    assert.equal(adapter.getObjectById("import-01"), firstRuntime.root);
    assert.ok(scene.children.includes(firstRuntime.root));

    const replacement = { ...structuredClone(model), assetId: "asset-02" };
    adapter.applyModel([replacement], []);
    assert.equal(adapter.getObjectById("import-01"), secondRuntime.root);
    assert.equal(assets.get("asset-01"), undefined);
    assert.equal(firstDisposal.count, 1);
    assert.ok(!scene.children.includes(firstRuntime.root));
    assert.ok(scene.children.includes(secondRuntime.root));

    const missingMaterial = structuredClone(replacement);
    missingMaterial.materialMode = "custom";
    missingMaterial.customMaterialId = "missing-material";
    assert.throws(
      () => adapter.applyModel([missingMaterial], []),
      /Missing material id for imported scene/,
    );
    assert.equal(adapter.getObjectById("import-01"), secondRuntime.root);
    adapter.dispose();
  });
});

function createSourceAsset() {
  const firstMaterial = new THREE.MeshStandardMaterial({ color: 0xff8844 });
  const secondMaterial = new THREE.MeshStandardMaterial({ color: 0x4488ff });
  const firstMesh = new THREE.Mesh(new THREE.BoxGeometry(), firstMaterial);
  const secondMaterialArray = [secondMaterial];
  const secondMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 8, 6),
    secondMaterialArray,
  );
  const nested = new THREE.Group();
  nested.add(secondMesh);
  const root = new THREE.Group();
  root.add(firstMesh, nested);
  return {
    root,
    firstMesh,
    secondMesh,
    firstMaterial,
    secondMaterial,
    secondMaterialArray,
  };
}

function createModel() {
  return createImportedSceneModel({
    id: "import-01",
    assetId: "asset-01",
    name: "Imported assembly",
    format: "glTF",
    transform: {
      position: { x: 1, y: 2, z: 3 },
      rotationDegrees: { y: 45 },
      scale: { x: 2, y: 1, z: 0.5 },
    },
    metadata: {
      fileName: "assembly.glb",
      format: "glTF",
      objectCount: 3,
      triangleCount: 24,
      materialCount: 2,
      animationCount: 0,
      sizeBytes: 1024,
    },
    hierarchy: [],
  });
}

function trackDisposal(resource) {
  const tracker = { count: 0 };
  resource.dispose = () => {
    tracker.count += 1;
  };
  return tracker;
}

function nearlyEqual(actual, expected) {
  return Math.abs(actual - expected) < 1e-10;
}
