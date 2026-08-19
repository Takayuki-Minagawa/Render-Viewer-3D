import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as THREE from "three";
import { createServer } from "vite";

let ImportedAssetStore;
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
});

after(async () => {
  await server?.close();
});

describe("ImportedAssetStore", () => {
  it("wraps assets, restores original materials, and disposes owned resources once", () => {
    const store = new ImportedAssetStore();
    const scene = new THREE.Scene();
    const sourceRoot = new THREE.Group();
    sourceRoot.name = "Source assembly";

    const image = trackClose();
    const texture = new THREE.Texture(image);
    const geometry = new THREE.BoxGeometry();
    const originalMaterial = new THREE.MeshStandardMaterial();
    originalMaterial.map = texture;
    originalMaterial.normalMap = texture;
    const firstMesh = new THREE.Mesh(geometry, originalMaterial);
    const originalMaterialArray = [originalMaterial];
    const secondMesh = new THREE.Mesh(geometry, originalMaterialArray);
    const nested = new THREE.Group();
    nested.add(secondMesh);
    sourceRoot.add(firstMesh, nested);

    const geometryDisposal = trackDisposal(geometry);
    const materialDisposal = trackDisposal(originalMaterial);
    const textureDisposal = trackDisposal(texture);
    const customMaterial = new THREE.MeshBasicMaterial();
    const customDisposal = trackDisposal(customMaterial);

    const asset = store.register("asset-01", sourceRoot);
    scene.add(asset.root);
    assert.equal(asset.root.children[0], sourceRoot);
    assert.equal(asset.root.userData.importedAssetId, "asset-01");
    assert.equal(store.size, 1);

    firstMesh.material = customMaterial;
    secondMesh.material = customMaterial;
    asset.restoreOriginalMaterials();
    assert.equal(firstMesh.material, originalMaterial);
    assert.equal(secondMesh.material, originalMaterialArray);

    assert.equal(store.delete("asset-01"), true);
    assert.equal(store.delete("asset-01"), false);
    assert.equal(asset.root.parent, null);
    assert.equal(asset.root.children.length, 0);
    assert.equal(geometryDisposal.count, 1);
    assert.equal(materialDisposal.count, 1);
    assert.equal(textureDisposal.count, 1);
    assert.equal(image.count, 1);
    assert.equal(customDisposal.count, 0);
    assert.equal(store.size, 0);

    store.dispose();
    assert.equal(geometryDisposal.count, 1);
  });

  it("rejects empty, duplicate, and multiply registered assets", () => {
    const store = new ImportedAssetStore();
    const root = new THREE.Group();
    assert.throws(() => store.register("   ", root), /must not be empty/);
    store.register("asset-01", root);
    assert.throws(
      () => store.register("asset-01", new THREE.Group()),
      /Duplicate imported asset id/,
    );
    assert.throws(
      () => store.register("asset-02", root),
      /already registered as asset: asset-01/,
    );
    store.dispose();
  });
});

function trackDisposal(resource) {
  const tracker = { count: 0 };
  resource.dispose = () => {
    tracker.count += 1;
  };
  return tracker;
}

function trackClose() {
  return {
    count: 0,
    close() {
      this.count += 1;
    },
  };
}
