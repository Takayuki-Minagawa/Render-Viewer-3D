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

  it("rejects resources shared across independently owned assets", () => {
    const store = new ImportedAssetStore();
    const image = trackClose();
    const texture = new THREE.Texture(image);
    const firstMaterial = new THREE.MeshStandardMaterial({ map: texture });
    const secondMaterial = new THREE.MeshStandardMaterial({ map: texture });
    const firstRoot = new THREE.Group();
    const secondRoot = new THREE.Group();
    firstRoot.add(
      new THREE.Mesh(new THREE.BoxGeometry(), firstMaterial),
    );
    secondRoot.add(
      new THREE.Mesh(new THREE.SphereGeometry(), secondMaterial),
    );
    const textureDisposal = trackDisposal(texture);

    store.register("asset-01", firstRoot);
    assert.throws(
      () => store.register("asset-02", secondRoot),
      /must not share .* resources/,
    );
    assert.equal(store.size, 1);

    store.dispose();
    assert.equal(textureDisposal.count, 1);
    assert.equal(image.count, 1);
  });

  it("disposes shared special textures once and each GPU owner once", () => {
    const store = new ImportedAssetStore();
    const root = new THREE.Group();
    const boneTexture = new THREE.DataTexture();
    const firstSkeleton = new THREE.Skeleton([new THREE.Bone()]);
    const secondSkeleton = new THREE.Skeleton([new THREE.Bone()]);
    firstSkeleton.boneTexture = boneTexture;
    secondSkeleton.boneTexture = boneTexture;
    const boneTextureDisposal = trackDisposal(boneTexture);
    const firstSkeletonDisposal = trackSkeletonDisposal(firstSkeleton);
    const secondSkeletonDisposal = trackSkeletonDisposal(secondSkeleton);

    const firstSkinned = new THREE.SkinnedMesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
    );
    const secondSkinned = new THREE.SkinnedMesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
    );
    const thirdSkinned = new THREE.SkinnedMesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
    );
    firstSkinned.bind(firstSkeleton);
    secondSkinned.bind(firstSkeleton);
    thirdSkinned.bind(secondSkeleton);

    const firstInstanced = new THREE.InstancedMesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
      2,
    );
    const secondInstanced = new THREE.InstancedMesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
      2,
    );
    const morphTexture = new THREE.DataTexture();
    firstInstanced.morphTexture = morphTexture;
    secondInstanced.morphTexture = morphTexture;
    const morphTextureDisposal = trackDisposal(morphTexture);
    const firstInstancedDisposal = trackDisposeEvent(firstInstanced);
    const secondInstancedDisposal = trackDisposeEvent(secondInstanced);
    root.add(
      firstSkinned,
      secondSkinned,
      thirdSkinned,
      firstInstanced,
      secondInstanced,
    );

    store.register("asset-01", root);
    assert.equal(store.delete("asset-01"), true);
    assert.equal(firstSkeletonDisposal.count, 1);
    assert.equal(secondSkeletonDisposal.count, 1);
    assert.equal(boneTextureDisposal.count, 1);
    assert.equal(firstSkeleton.boneTexture, null);
    assert.equal(secondSkeleton.boneTexture, null);
    assert.equal(firstInstancedDisposal.count, 1);
    assert.equal(secondInstancedDisposal.count, 1);
    assert.equal(morphTextureDisposal.count, 1);
    assert.equal(firstInstanced.morphTexture, null);
    assert.equal(secondInstanced.morphTexture, null);

    store.dispose();
    assert.equal(firstSkeletonDisposal.count, 1);
    assert.equal(secondSkeletonDisposal.count, 1);
    assert.equal(firstInstancedDisposal.count, 1);
    assert.equal(secondInstancedDisposal.count, 1);
  });

  it("rejects a skeleton shared across independently owned assets", () => {
    const store = new ImportedAssetStore();
    const skeleton = new THREE.Skeleton([new THREE.Bone()]);
    const firstMesh = new THREE.SkinnedMesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
    );
    const secondMesh = new THREE.SkinnedMesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
    );
    firstMesh.bind(skeleton);
    secondMesh.bind(skeleton);
    const firstRoot = new THREE.Group().add(firstMesh);
    const secondRoot = new THREE.Group().add(secondMesh);

    store.register("asset-01", firstRoot);
    assert.throws(
      () => store.register("asset-02", secondRoot),
      /must not share .* resources/,
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

function trackSkeletonDisposal(skeleton) {
  const tracker = { count: 0 };
  const originalDispose = skeleton.dispose.bind(skeleton);
  skeleton.dispose = () => {
    tracker.count += 1;
    originalDispose();
  };
  return tracker;
}

function trackDisposeEvent(resource) {
  const tracker = { count: 0 };
  resource.addEventListener("dispose", () => {
    tracker.count += 1;
  });
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
