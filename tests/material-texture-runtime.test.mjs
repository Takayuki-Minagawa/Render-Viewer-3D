import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as THREE from "three";
import { createServer } from "vite";

let server;
let materialModel;
let MaterialImageAssetStore;
let MaterialRuntimeCache;
let ImportedAssetStore;
let ImportedSceneAdapter;
let createImportedSceneModel;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  materialModel = await server.ssrLoadModule("/src/model/material/index.ts");
  ({ MaterialImageAssetStore } = await server.ssrLoadModule(
    "/src/three/material/image-asset-store.ts",
  ));
  ({ MaterialRuntimeCache } = await server.ssrLoadModule(
    "/src/three/material/material-runtime-cache.ts",
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
});

after(async () => {
  await server?.close();
});

describe("MaterialRuntimeCache local color maps", () => {
  it("configures sRGB UV mapping and updates mapping without replacing texture identity", async () => {
    const asset = await createLoadedAsset(8, 4);
    const cache = new MaterialRuntimeCache(asset.store);
    const definition = createTexturedDefinition("mapped", asset.descriptor, {
      repeatX: 2.5,
      repeatY: 3.5,
      offsetX: 0.25,
      offsetY: -0.5,
      rotationDegrees: 90,
      wrapMode: "mirrored-repeat",
    });

    cache.reconcile([definition]);
    const material = cache.requireMaterial(definition.id);
    const texture = material.map;
    assert.ok(texture instanceof THREE.Texture);
    assert.equal(texture.mapping, THREE.UVMapping);
    assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
    assert.equal(texture.flipY, false);
    assert.equal(texture.wrapS, THREE.MirroredRepeatWrapping);
    assert.equal(texture.wrapT, THREE.MirroredRepeatWrapping);
    assert.deepEqual(texture.repeat.toArray(), [2.5, 3.5]);
    assert.deepEqual(texture.offset.toArray(), [0.25, -0.5]);
    assert.deepEqual(texture.center.toArray(), [0.5, 0.5]);
    assert.ok(nearlyEqual(texture.rotation, Math.PI / 2));
    assert.ok(texture.version > 0);

    const textureDisposal = trackDisposeEvent(texture);
    const updated = structuredClone(definition);
    Object.assign(updated.colorMap, {
      repeatX: 7,
      repeatY: 0.5,
      offsetX: -2,
      offsetY: 4,
      rotationDegrees: -45,
      wrapMode: "clamp-to-edge",
    });
    cache.reconcile([updated]);

    assert.equal(cache.requireMaterial(definition.id), material);
    assert.equal(material.map, texture);
    assert.equal(texture.wrapS, THREE.ClampToEdgeWrapping);
    assert.equal(texture.wrapT, THREE.ClampToEdgeWrapping);
    assert.deepEqual(texture.repeat.toArray(), [7, 0.5]);
    assert.deepEqual(texture.offset.toArray(), [-2, 4]);
    assert.ok(nearlyEqual(texture.rotation, -Math.PI / 4));
    assert.equal(textureDisposal.count, 0);

    const repeat = structuredClone(updated);
    repeat.colorMap.wrapMode = "repeat";
    cache.reconcile([repeat]);
    assert.equal(material.map, texture);
    assert.equal(texture.wrapS, THREE.RepeatWrapping);
    assert.equal(texture.wrapT, THREE.RepeatWrapping);

    const untextured = structuredClone(repeat);
    untextured.colorMap = null;
    cache.reconcile([untextured]);
    assert.equal(material.map, null);
    assert.equal(textureDisposal.count, 1);
    cache.dispose();
    cache.dispose();
    assert.equal(textureDisposal.count, 1);
    assert.equal(asset.image.closeCount, 0);
    assert.equal(asset.store.delete(asset.descriptor.assetId), true);
    assert.equal(asset.image.closeCount, 1);
    asset.store.dispose();
  });

  it("shares one Source across duplicate materials and independent runtime caches", async () => {
    const asset = await createLoadedAsset(4, 4);
    const firstDefinition = createTexturedDefinition(
      "first",
      asset.descriptor,
    );
    const secondDefinition = structuredClone(firstDefinition);
    secondDefinition.id = "second";
    secondDefinition.name = "second";
    const firstCache = new MaterialRuntimeCache(asset.store);
    const secondCache = new MaterialRuntimeCache(asset.store);
    firstCache.reconcile([firstDefinition]);
    secondCache.reconcile([secondDefinition]);

    const firstMaterial = firstCache.requireMaterial("first");
    const secondMaterial = secondCache.requireMaterial("second");
    const firstTexture = firstMaterial.map;
    const secondTexture = secondMaterial.map;
    assert.ok(firstTexture instanceof THREE.Texture);
    assert.ok(secondTexture instanceof THREE.Texture);
    assert.notEqual(firstTexture, secondTexture);
    assert.equal(firstTexture.source, secondTexture.source);
    assert.equal(firstTexture.source.data, asset.image.image);

    const firstTextureDisposal = trackDisposeEvent(firstTexture);
    const secondTextureDisposal = trackDisposeEvent(secondTexture);
    const firstMaterialDisposal = trackDisposeEvent(firstMaterial);
    const secondMaterialDisposal = trackDisposeEvent(secondMaterial);
    assert.equal(asset.store.delete(asset.descriptor.assetId), true);
    assert.equal(asset.store.has(asset.descriptor.assetId), true);

    firstCache.dispose();
    firstCache.dispose();
    assert.equal(firstTextureDisposal.count, 1);
    assert.equal(firstMaterialDisposal.count, 1);
    assert.equal(secondTextureDisposal.count, 0);
    assert.equal(secondMaterialDisposal.count, 0);
    assert.equal(asset.image.closeCount, 0);
    assert.equal(secondMaterial.map, secondTexture);

    secondCache.dispose();
    secondCache.dispose();
    assert.equal(secondTextureDisposal.count, 1);
    assert.equal(secondMaterialDisposal.count, 1);
    assert.equal(asset.image.closeCount, 1);
    assert.equal(asset.store.has(asset.descriptor.assetId), false);
    asset.store.dispose();
    assert.equal(asset.image.closeCount, 1);
  });

  it("falls back to base color with a diagnostic when the runtime asset is absent", () => {
    const store = new MaterialImageAssetStore(async () => {
      throw new Error("decoder should not run");
    });
    const cache = new MaterialRuntimeCache(store);
    const definition = createTexturedDefinition(
      "missing",
      colorMapDescriptor("missing-image"),
    );

    cache.reconcile([definition]);
    const material = cache.requireMaterial(definition.id);
    assert.equal(material.map, null);
    assert.equal(cache.requireUntexturedMaterial(definition.id), material);
    assert.deepEqual(
      cache.getDiagnostics(definition.id).filter(
        ({ code }) => code === "preview.color-map.asset-unavailable",
      ),
      [
        {
          path: "preview.colorMap",
          code: "preview.color-map.asset-unavailable",
          support: "stored-only",
        },
      ],
    );
    cache.dispose();
    store.dispose();
  });

  it("uses a stable untextured fallback only for imported meshes without usable UVs", async () => {
    const asset = await createLoadedAsset(8, 8);
    const definition = createTexturedDefinition("custom", asset.descriptor);
    const materials = new MaterialRuntimeCache(asset.store);
    materials.reconcile([definition]);
    const texturedMaterial = materials.requireMaterial(definition.id);

    const uvMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial(),
    );
    const noUvGeometry = new THREE.BufferGeometry();
    noUvGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [0, 0, 0, 1, 0, 0, 0, 1, 0],
        3,
      ),
    );
    const noUvMesh = new THREE.Mesh(noUvGeometry, new THREE.MeshBasicMaterial());
    const sourceRoot = new THREE.Group().add(uvMesh, noUvMesh);
    const importedAssets = new ImportedAssetStore();
    importedAssets.register("runtime-asset", sourceRoot);
    const scene = new THREE.Scene();
    const adapter = new ImportedSceneAdapter(scene, importedAssets, materials);
    const model = createImportedModel();
    model.materialMode = "custom";
    model.customMaterialId = definition.id;

    adapter.applyModel([model], [definition]);
    const fallback = noUvMesh.material;
    assert.equal(uvMesh.material, texturedMaterial);
    assert.ok(texturedMaterial.map instanceof THREE.Texture);
    assert.notEqual(fallback, texturedMaterial);
    assert.ok(fallback instanceof THREE.MeshPhysicalMaterial);
    assert.equal(fallback.map, null);
    assert.equal(fallback.userData.materialTextureFallback, true);
    assert.equal(materials.requireUntexturedMaterial(definition.id), fallback);

    const fallbackDisposal = trackDisposeEvent(fallback);
    const updated = structuredClone(definition);
    updated.preview.roughness = 0.91;
    updated.colorMap.repeatX = 3;
    materials.reconcile([updated]);
    adapter.applyModel([model], [updated]);
    assert.equal(uvMesh.material, texturedMaterial);
    assert.equal(noUvMesh.material, fallback);
    assert.equal(fallback.roughness, 0.91);
    assert.equal(texturedMaterial.map.repeat.x, 3);

    const removed = structuredClone(updated);
    removed.colorMap = null;
    materials.reconcile([removed]);
    adapter.applyModel([model], [removed]);
    assert.equal(texturedMaterial.map, null);
    assert.equal(uvMesh.material, texturedMaterial);
    assert.equal(noUvMesh.material, texturedMaterial);
    assert.equal(fallbackDisposal.count, 1);

    adapter.dispose();
    materials.dispose();
    assert.equal(fallbackDisposal.count, 1);
    assert.equal(asset.store.delete(asset.descriptor.assetId), true);
    assert.equal(asset.image.closeCount, 1);
    asset.store.dispose();
  });
});

async function createLoadedAsset(width, height) {
  const image = trackedImage(width, height);
  const store = new MaterialImageAssetStore(async () => image.image);
  const descriptor = await store.importFile(
    new File([pngBytes(width, height)], "texture.png", { type: "image/png" }),
  );
  return { store, descriptor, image };
}

function createTexturedDefinition(id, descriptor, mapping = {}) {
  const definition = materialModel.createMaterialDefinition(id, id);
  definition.colorMap = { ...structuredClone(descriptor), ...mapping };
  return definition;
}

function colorMapDescriptor(assetId) {
  return {
    assetId,
    sourceName: "missing.png",
    mimeType: "image/png",
    byteSize: 64,
    width: 4,
    height: 4,
    repeatX: 1,
    repeatY: 1,
    offsetX: 0,
    offsetY: 0,
    rotationDegrees: 0,
    wrapMode: "repeat",
  };
}

function createImportedModel() {
  return createImportedSceneModel({
    id: "imported-scene",
    assetId: "runtime-asset",
    name: "Imported textured scene",
    format: "glTF",
    metadata: {
      fileName: "local.glb",
      format: "glTF",
      objectCount: 2,
      triangleCount: 2,
      materialCount: 2,
      animationCount: 0,
      sizeBytes: 1024,
    },
    hierarchy: [],
  });
}

function pngBytes(width, height) {
  const bytes = new Uint8Array(45);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  writeUint32BigEndian(bytes, 8, 13);
  bytes.set(new TextEncoder().encode("IHDR"), 12);
  writeUint32BigEndian(bytes, 16, width);
  writeUint32BigEndian(bytes, 20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  writeUint32BigEndian(bytes, 33, 0);
  bytes.set(new TextEncoder().encode("IDAT"), 37);
  return bytes;
}

function writeUint32BigEndian(target, offset, value) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function trackedImage(width, height) {
  const tracker = {
    closeCount: 0,
    image: {
      width,
      height,
      close() {
        tracker.closeCount += 1;
      },
    },
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

function nearlyEqual(actual, expected) {
  return Math.abs(actual - expected) < 1e-10;
}
