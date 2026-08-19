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
let MaterialTextureController;
let SceneStore;
let createDefaultSceneModel;

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
  ({ MaterialTextureController } = await server.ssrLoadModule(
    "/src/app/material-texture-controller.ts",
  ));
  ({ SceneStore } = await server.ssrLoadModule("/src/app/scene-store.ts"));
  ({ createDefaultSceneModel } = await server.ssrLoadModule(
    "/src/model/default-scene.ts",
  ));
});

after(async () => {
  await server?.close();
});

describe("MaterialRuntimeCache local color maps", () => {
  it("updates affine mapping without re-uploading and notifies wrap changes", async () => {
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
    const initialTextureVersion = texture.version;
    const initialSourceVersion = texture.source.version;
    const updated = structuredClone(definition);
    Object.assign(updated.colorMap, {
      repeatX: 7,
      repeatY: 0.5,
      offsetX: -2,
      offsetY: 4,
      rotationDegrees: -45,
    });
    cache.reconcile([updated]);

    assert.equal(cache.requireMaterial(definition.id), material);
    assert.equal(material.map, texture);
    assert.equal(texture.wrapS, THREE.MirroredRepeatWrapping);
    assert.equal(texture.wrapT, THREE.MirroredRepeatWrapping);
    assert.deepEqual(texture.repeat.toArray(), [7, 0.5]);
    assert.deepEqual(texture.offset.toArray(), [-2, 4]);
    assert.ok(nearlyEqual(texture.rotation, -Math.PI / 4));
    assert.equal(texture.version, initialTextureVersion);
    assert.equal(texture.source.version, initialSourceVersion);
    assert.equal(textureDisposal.count, 0);

    const wrapUpdated = structuredClone(updated);
    wrapUpdated.colorMap.wrapMode = "clamp-to-edge";
    cache.reconcile([wrapUpdated]);
    assert.equal(material.map, texture);
    assert.equal(texture.wrapS, THREE.ClampToEdgeWrapping);
    assert.equal(texture.wrapT, THREE.ClampToEdgeWrapping);
    assert.ok(texture.version > initialTextureVersion);
    assert.ok(texture.source.version > initialSourceVersion);

    const repeat = structuredClone(wrapUpdated);
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

  it("uses a shared Source with a top-left glTF variant across updates and disposal", async () => {
    const loaded = await createLoadedAssets([
      [8, 4],
      [16, 8],
    ]);
    const [firstDescriptor, secondDescriptor] = loaded.descriptors;
    const definition = createTexturedDefinition("oriented", firstDescriptor, {
      repeatX: 1.5,
      repeatY: 0.75,
      offsetX: 0.125,
      offsetY: -0.25,
      rotationDegrees: 30,
      wrapMode: "clamp-to-edge",
    });
    const materials = new MaterialRuntimeCache(loaded.store);
    materials.reconcile([definition]);
    const standardMaterial = materials.requireMaterial(definition.id);
    const standardMaterialDisposal = trackDisposeEvent(standardMaterial);

    const gltfMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial(),
    );
    const objMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial(),
    );
    const importedAssets = new ImportedAssetStore();
    importedAssets.register("gltf-asset", new THREE.Group().add(gltfMesh));
    importedAssets.register("obj-asset", new THREE.Group().add(objMesh));
    const scene = new THREE.Scene();
    const adapter = new ImportedSceneAdapter(scene, importedAssets, materials);
    const gltfModel = createImportedModel({
      id: "gltf-model",
      assetId: "gltf-asset",
      format: "glTF",
    });
    const objModel = createImportedModel({
      id: "obj-model",
      assetId: "obj-asset",
      format: "OBJ",
    });
    for (const model of [gltfModel, objModel]) {
      model.materialMode = "custom";
      model.customMaterialId = definition.id;
    }

    adapter.applyModel([gltfModel, objModel], [definition]);
    const topLeftMaterial = gltfMesh.material;
    assert.ok(topLeftMaterial instanceof THREE.MeshPhysicalMaterial);
    assert.notEqual(topLeftMaterial, standardMaterial);
    assert.equal(objMesh.material, standardMaterial);
    assert.equal(
      topLeftMaterial,
      materials.requireMaterial(definition.id, "top-left"),
    );
    const standardTexture = standardMaterial.map;
    const topLeftTexture = topLeftMaterial.map;
    assert.ok(standardTexture instanceof THREE.Texture);
    assert.ok(topLeftTexture instanceof THREE.Texture);
    assert.notEqual(topLeftTexture, standardTexture);
    assert.equal(topLeftTexture.source, standardTexture.source);
    assert.equal(topLeftTexture.source.data, loaded.images[0].image);
    assert.equal(standardTexture.matrixAutoUpdate, true);
    assert.equal(topLeftTexture.matrixAutoUpdate, false);
    assertEquivalentUvMapping(standardTexture, topLeftTexture, 0.2, 0.3);

    const topLeftMaterialDisposal = trackDisposeEvent(topLeftMaterial);
    const firstStandardTextureDisposal = trackDisposeEvent(standardTexture);
    const firstTopLeftTextureDisposal = trackDisposeEvent(topLeftTexture);
    assert.equal(loaded.store.delete(firstDescriptor.assetId), true);
    assert.equal(loaded.store.has(firstDescriptor.assetId), true);
    assert.equal(loaded.images[0].closeCount, 0);

    const replaced = structuredClone(definition);
    replaced.colorMap = {
      ...structuredClone(secondDescriptor),
      repeatX: definition.colorMap.repeatX,
      repeatY: definition.colorMap.repeatY,
      offsetX: definition.colorMap.offsetX,
      offsetY: definition.colorMap.offsetY,
      rotationDegrees: definition.colorMap.rotationDegrees,
      wrapMode: definition.colorMap.wrapMode,
    };
    materials.reconcile([replaced]);
    adapter.applyModel([gltfModel, objModel], [replaced]);

    const replacedStandardTexture = standardMaterial.map;
    const replacedTopLeftTexture = topLeftMaterial.map;
    assert.equal(gltfMesh.material, topLeftMaterial);
    assert.equal(objMesh.material, standardMaterial);
    assert.ok(replacedStandardTexture instanceof THREE.Texture);
    assert.ok(replacedTopLeftTexture instanceof THREE.Texture);
    assert.notEqual(replacedStandardTexture, standardTexture);
    assert.notEqual(replacedTopLeftTexture, topLeftTexture);
    assert.equal(replacedTopLeftTexture.source, replacedStandardTexture.source);
    assert.equal(replacedTopLeftTexture.source.data, loaded.images[1].image);
    assert.equal(firstStandardTextureDisposal.count, 1);
    assert.equal(firstTopLeftTextureDisposal.count, 1);
    assert.equal(loaded.store.has(firstDescriptor.assetId), false);
    assert.equal(loaded.images[0].closeCount, 1);

    const secondStandardTextureDisposal =
      trackDisposeEvent(replacedStandardTexture);
    const secondTopLeftTextureDisposal =
      trackDisposeEvent(replacedTopLeftTexture);
    const standardVersion = replacedStandardTexture.version;
    const topLeftVersion = replacedTopLeftTexture.version;
    const sourceVersion = replacedStandardTexture.source.version;
    const mapped = structuredClone(replaced);
    Object.assign(mapped.colorMap, {
      repeatX: 2.25,
      repeatY: 1.25,
      offsetX: -0.5,
      offsetY: 0.375,
      rotationDegrees: -20,
    });
    materials.reconcile([mapped]);
    adapter.applyModel([gltfModel, objModel], [mapped]);
    assert.equal(standardMaterial.map, replacedStandardTexture);
    assert.equal(topLeftMaterial.map, replacedTopLeftTexture);
    assert.equal(replacedStandardTexture.version, standardVersion);
    assert.equal(replacedTopLeftTexture.version, topLeftVersion);
    assert.equal(replacedStandardTexture.source.version, sourceVersion);
    assert.equal(replacedTopLeftTexture.matrixAutoUpdate, false);
    assertEquivalentUvMapping(
      replacedStandardTexture,
      replacedTopLeftTexture,
      0.4,
      0.15,
    );

    const wrapped = structuredClone(mapped);
    wrapped.colorMap.wrapMode = "mirrored-repeat";
    materials.reconcile([wrapped]);
    assert.ok(replacedStandardTexture.version > standardVersion);
    assert.ok(replacedTopLeftTexture.version > topLeftVersion);
    assert.ok(replacedStandardTexture.source.version > sourceVersion);

    assert.equal(loaded.store.delete(secondDescriptor.assetId), true);
    assert.equal(loaded.store.has(secondDescriptor.assetId), true);
    const removed = structuredClone(wrapped);
    removed.colorMap = null;
    materials.reconcile([removed]);
    adapter.applyModel([gltfModel, objModel], [removed]);
    assert.equal(gltfMesh.material, standardMaterial);
    assert.equal(objMesh.material, standardMaterial);
    assert.equal(standardMaterial.map, null);
    assert.equal(secondStandardTextureDisposal.count, 1);
    assert.equal(secondTopLeftTextureDisposal.count, 1);
    assert.equal(topLeftMaterialDisposal.count, 1);
    assert.equal(loaded.store.has(secondDescriptor.assetId), false);
    assert.equal(loaded.images[1].closeCount, 1);

    adapter.dispose();
    assert.equal(standardMaterialDisposal.count, 0);
    materials.dispose();
    materials.dispose();
    assert.equal(standardMaterialDisposal.count, 1);
    assert.equal(topLeftMaterialDisposal.count, 1);
    loaded.store.dispose();
    assert.equal(loaded.images[0].closeCount, 1);
    assert.equal(loaded.images[1].closeCount, 1);
  });

  it("retries the glTF texture variant after lease capacity recovers", async () => {
    const loaded = await createLoadedAssets(
      [
        [100, 100],
        [100, 100],
      ],
      200_000,
    );
    const [firstDescriptor, secondDescriptor] = loaded.descriptors;
    const definition = createTexturedDefinition("retry", firstDescriptor);
    const materials = new MaterialRuntimeCache(loaded.store);
    materials.reconcile([definition]);

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial(),
    );
    const importedAssets = new ImportedAssetStore();
    importedAssets.register("retry-asset", new THREE.Group().add(mesh));
    const adapter = new ImportedSceneAdapter(
      new THREE.Scene(),
      importedAssets,
      materials,
    );
    const model = createImportedModel({
      id: "retry-model",
      assetId: "retry-asset",
      format: "glTF",
    });
    model.materialMode = "custom";
    model.customMaterialId = definition.id;

    adapter.applyModel([model], [definition]);
    const fallback = mesh.material;
    assert.equal(fallback.map, null);
    assert.equal(fallback.userData.materialTextureFallback, true);
    assert.equal(loaded.store.residentBytes, 186_668);

    assert.equal(loaded.store.delete(secondDescriptor.assetId), true);
    assert.equal(loaded.images[1].closeCount, 1);
    assert.equal(loaded.store.residentBytes, 93_334);

    adapter.applyModel([model], [definition]);
    const recovered = mesh.material;
    assert.notEqual(recovered, fallback);
    assert.ok(recovered instanceof THREE.MeshPhysicalMaterial);
    assert.ok(recovered.map instanceof THREE.Texture);
    assert.equal(recovered.userData.materialTextureUvOrigin, "top-left");
    assert.equal(loaded.store.residentBytes, 146_668);

    adapter.dispose();
    materials.dispose();
    assert.equal(loaded.store.delete(firstDescriptor.assetId), true);
    assert.equal(loaded.images[0].closeCount, 1);
    loaded.store.dispose();
  });

  it("releases old variants before replacing both at the resident limit", async () => {
    const loaded = await createLoadedAssets(
      [
        [100, 100],
        [100, 100],
      ],
      240_002,
    );
    const [firstDescriptor, secondDescriptor] = loaded.descriptors;
    const definition = createTexturedDefinition(
      "bounded-swap",
      firstDescriptor,
    );
    const materials = new MaterialRuntimeCache(loaded.store);
    materials.reconcile([definition]);

    const standardMaterial = materials.requireMaterial(definition.id);
    const topLeftMaterial = materials.requireMaterial(
      definition.id,
      "top-left",
    );
    const firstStandardTexture = standardMaterial.map;
    const firstTopLeftTexture = topLeftMaterial.map;
    assert.ok(firstStandardTexture instanceof THREE.Texture);
    assert.ok(firstTopLeftTexture instanceof THREE.Texture);
    assert.equal(loaded.store.residentBytes, 240_002);
    const firstStandardDisposal = trackDisposeEvent(firstStandardTexture);
    const firstTopLeftDisposal = trackDisposeEvent(firstTopLeftTexture);

    const replaced = structuredClone(definition);
    replaced.colorMap = {
      ...structuredClone(secondDescriptor),
      repeatX: definition.colorMap.repeatX,
      repeatY: definition.colorMap.repeatY,
      offsetX: definition.colorMap.offsetX,
      offsetY: definition.colorMap.offsetY,
      rotationDegrees: definition.colorMap.rotationDegrees,
      wrapMode: definition.colorMap.wrapMode,
    };
    materials.reconcile([replaced]);

    assert.equal(materials.requireMaterial(definition.id), standardMaterial);
    assert.equal(
      materials.requireMaterial(definition.id, "top-left"),
      topLeftMaterial,
    );
    const secondStandardTexture = standardMaterial.map;
    const secondTopLeftTexture = topLeftMaterial.map;
    assert.ok(secondStandardTexture instanceof THREE.Texture);
    assert.ok(secondTopLeftTexture instanceof THREE.Texture);
    assert.notEqual(secondStandardTexture, firstStandardTexture);
    assert.notEqual(secondTopLeftTexture, firstTopLeftTexture);
    assert.equal(secondStandardTexture.source, secondTopLeftTexture.source);
    assert.equal(secondStandardTexture.source.data, loaded.images[1].image);
    assert.equal(firstStandardDisposal.count, 1);
    assert.equal(firstTopLeftDisposal.count, 1);
    assert.equal(loaded.store.residentBytes, 240_002);

    assert.equal(loaded.store.delete(firstDescriptor.assetId), true);
    assert.equal(loaded.images[0].closeCount, 1);
    assert.equal(loaded.store.residentBytes, 146_668);
    materials.dispose();
    assert.equal(loaded.store.residentBytes, 93_334);
    assert.equal(loaded.store.delete(secondDescriptor.assetId), true);
    assert.equal(loaded.images[1].closeCount, 1);
    assert.equal(loaded.store.residentBytes, 0);
    loaded.store.dispose();
  });

  it("retries a larger replacement immediately after releasing the old asset", async () => {
    const images = [trackedImage(50, 50), trackedImage(100, 100)];
    let decodeIndex = 0;
    const store = new MaterialImageAssetStore(async () => {
      const image = images[decodeIndex];
      decodeIndex += 1;
      if (!image) throw new Error("Unexpected material image decode.");
      return image.image;
    }, 150_000);
    const firstDescriptor = await store.importFile(
      new File([pngBytes(50, 50)], "small.png", { type: "image/png" }),
    );

    const sceneModel = createDefaultSceneModel();
    const definition = sceneModel.materials[0];
    definition.colorMap = structuredClone(firstDescriptor);
    const importedModel = createImportedModel({
      id: "large-swap-model",
      assetId: "large-swap-asset",
      format: "glTF",
    });
    importedModel.materialMode = "custom";
    importedModel.customMaterialId = definition.id;
    sceneModel.imports = [importedModel];

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial(),
    );
    const importedAssets = new ImportedAssetStore();
    importedAssets.register(
      importedModel.assetId,
      new THREE.Group().add(mesh),
    );
    const materials = new MaterialRuntimeCache(store);
    const adapter = new ImportedSceneAdapter(
      new THREE.Scene(),
      importedAssets,
      materials,
    );
    const sceneStore = new SceneStore(sceneModel);
    const applySnapshot = (snapshot) => {
      materials.reconcile(snapshot.materials);
      adapter.applyModel(snapshot.imports, snapshot.materials);
    };
    applySnapshot(sceneStore.getSnapshot());
    assert.ok(
      materials.requireMaterial(definition.id).map instanceof THREE.Texture,
    );
    assert.ok(mesh.material.map instanceof THREE.Texture);
    assert.equal(store.residentBytes, 36_668);

    let sceneNotifications = 0;
    const unsubscribe = sceneStore.subscribe((snapshot) => {
      sceneNotifications += 1;
      applySnapshot(snapshot);
    });
    sceneNotifications = 0;
    let postReleaseRetries = 0;
    const controller = new MaterialTextureController(
      sceneStore,
      store,
      () => {
        postReleaseRetries += 1;
        applySnapshot(sceneStore.getSnapshot());
      },
    );
    const replacement = await controller.attach(
      definition.id,
      new File([pngBytes(100, 100)], "large.png", { type: "image/png" }),
    );

    assert.ok(replacement);
    assert.equal(sceneNotifications, 1);
    assert.equal(postReleaseRetries, 1);
    assert.equal(store.has(firstDescriptor.assetId), false);
    assert.equal(images[0].closeCount, 1);
    const standardTexture = materials.requireMaterial(definition.id).map;
    const topLeftTexture = mesh.material.map;
    assert.ok(standardTexture instanceof THREE.Texture);
    assert.ok(topLeftTexture instanceof THREE.Texture);
    assert.equal(standardTexture.source, topLeftTexture.source);
    assert.equal(standardTexture.source.data, images[1].image);
    assert.equal(
      topLeftTexture.userData.materialTextureUvOrigin,
      "top-left",
    );
    assert.equal(store.residentBytes, 146_668);

    controller.dispose();
    unsubscribe();
    adapter.dispose();
    materials.dispose();
    assert.equal(store.residentBytes, 93_334);
    assert.equal(store.delete(replacement.assetId), true);
    assert.equal(images[1].closeCount, 1);
    assert.equal(store.residentBytes, 0);
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
    const gltfMaterial = uvMesh.material;
    const fallback = noUvMesh.material;
    assert.equal(
      gltfMaterial,
      materials.requireMaterial(definition.id, "top-left"),
    );
    assert.notEqual(gltfMaterial, texturedMaterial);
    assert.ok(gltfMaterial instanceof THREE.MeshPhysicalMaterial);
    assert.ok(gltfMaterial.map instanceof THREE.Texture);
    assert.ok(texturedMaterial.map instanceof THREE.Texture);
    assert.equal(gltfMaterial.map.source, texturedMaterial.map.source);
    assert.notEqual(fallback, gltfMaterial);
    assert.notEqual(fallback, texturedMaterial);
    assert.ok(fallback instanceof THREE.MeshPhysicalMaterial);
    assert.equal(fallback.map, null);
    assert.equal(fallback.userData.materialTextureFallback, true);
    assert.equal(materials.requireUntexturedMaterial(definition.id), fallback);

    const fallbackDisposal = trackDisposeEvent(fallback);
    const gltfMaterialDisposal = trackDisposeEvent(gltfMaterial);
    const updated = structuredClone(definition);
    updated.preview.roughness = 0.91;
    updated.colorMap.repeatX = 3;
    materials.reconcile([updated]);
    adapter.applyModel([model], [updated]);
    assert.equal(uvMesh.material, gltfMaterial);
    assert.equal(noUvMesh.material, fallback);
    assert.equal(fallback.roughness, 0.91);
    assert.equal(gltfMaterial.roughness, 0.91);
    assert.equal(gltfMaterial.map.repeat.x, 3);
    assert.equal(texturedMaterial.map.repeat.x, 3);

    const removed = structuredClone(updated);
    removed.colorMap = null;
    materials.reconcile([removed]);
    adapter.applyModel([model], [removed]);
    assert.equal(texturedMaterial.map, null);
    assert.equal(uvMesh.material, texturedMaterial);
    assert.equal(noUvMesh.material, texturedMaterial);
    assert.equal(fallbackDisposal.count, 1);
    assert.equal(gltfMaterialDisposal.count, 1);

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

async function createLoadedAssets(dimensions, maxResidentBytes) {
  const images = dimensions.map(([width, height]) =>
    trackedImage(width, height),
  );
  let decodeIndex = 0;
  const store = new MaterialImageAssetStore(async () => {
    const image = images[decodeIndex];
    decodeIndex += 1;
    if (!image) throw new Error("Unexpected material image decode.");
    return image.image;
  }, maxResidentBytes);
  const descriptors = [];
  for (let index = 0; index < dimensions.length; index += 1) {
    const [width, height] = dimensions[index];
    descriptors.push(
      await store.importFile(
        new File([pngBytes(width, height)], `texture-${index}.png`, {
          type: "image/png",
        }),
      ),
    );
  }
  return { store, descriptors, images };
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

function createImportedModel({
  id = "imported-scene",
  assetId = "runtime-asset",
  format = "glTF",
} = {}) {
  return createImportedSceneModel({
    id,
    assetId,
    name: "Imported textured scene",
    format,
    metadata: {
      fileName: format === "glTF" ? "local.glb" : "local.obj",
      format,
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

function assertEquivalentUvMapping(
  bottomLeftTexture,
  topLeftTexture,
  u,
  bottomLeftV,
) {
  const bottomLeft = new THREE.Vector2(u, bottomLeftV).applyMatrix3(
    bottomLeftTexture.matrix,
  );
  const topLeft = new THREE.Vector2(u, 1 - bottomLeftV).applyMatrix3(
    topLeftTexture.matrix,
  );
  assert.ok(nearlyEqual(topLeft.x, bottomLeft.x));
  assert.ok(nearlyEqual(topLeft.y, bottomLeft.y));
}

function nearlyEqual(actual, expected) {
  return Math.abs(actual - expected) < 1e-10;
}
