import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer } from "vite";

let createDefaultSceneModel;
let MaterialTextureController;
let MaterialTextureControllerError;
let SceneStore;
let server;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ MaterialTextureController, MaterialTextureControllerError } =
    await server.ssrLoadModule("/src/app/material-texture-controller.ts"));
  ({ SceneStore } = await server.ssrLoadModule("/src/app/scene-store.ts"));
  ({ createDefaultSceneModel } = await server.ssrLoadModule(
    "/src/model/default-scene.ts",
  ));
});

after(async () => {
  await server?.close();
});

describe("MaterialTextureController", () => {
  it("publishes only the JSON descriptor and releases the replaced asset", async () => {
    const scene = createDefaultSceneModel();
    const materialId = scene.materials[0].id;
    const oldDescriptor = createDescriptor("old-image");
    scene.materials[0].colorMap = oldDescriptor;
    const sceneStore = new SceneStore(scene);
    const assets = createAssetStoreDouble();
    const oldResource = assets.seed(oldDescriptor);
    const controller = new MaterialTextureController(sceneStore, assets);
    const file = new File(["not decoded by this test"], "replacement.png", {
      type: "image/png",
    });

    const attaching = controller.attach(materialId, file);
    assert.equal(assets.pending.length, 1);
    assert.equal(assets.pending[0].file, file);
    const replacement = createDescriptor("new-image", {
      sourceName: "replacement.png",
      mimeType: "image/png",
    });
    const newResource = assets.resolve(0, replacement);

    const result = await attaching;
    const stored = findMaterial(sceneStore, materialId).colorMap;
    assert.deepEqual(result, replacement);
    assert.deepEqual(stored, replacement);
    assert.notEqual(stored, result);
    assert.equal("file" in stored, false);
    assert.deepEqual(JSON.parse(JSON.stringify(stored)), stored);
    assert.equal(assets.has("new-image"), true);
    assert.equal(newResource.disposeCalls, 0);
    assert.equal(assets.has("old-image"), false);
    assert.equal(oldResource.disposeCalls, 1);

    assert.equal(controller.update(materialId, "repeatX", 5_000), true);
    assert.equal(findMaterial(sceneStore, materialId).colorMap.repeatX, 1_000);
    const beforeInvalidUpdate = structuredClone(sceneStore.getSnapshot());
    assert.equal(controller.update(materialId, "wrapMode", "tile"), false);
    assert.deepEqual(sceneStore.getSnapshot(), beforeInvalidUpdate);
  });

  it("preserves the latest mapping settings when replacing an image", async () => {
    const scene = createDefaultSceneModel();
    const materialId = scene.materials[0].id;
    const original = createDescriptor("mapping-old");
    scene.materials[0].colorMap = original;
    const sceneStore = new SceneStore(scene);
    const assets = createAssetStoreDouble();
    assets.seed(original);
    const controller = new MaterialTextureController(sceneStore, assets);

    const attaching = controller.attach(materialId, createFile("mapping-new.png"));
    controller.update(materialId, "repeatX", 4.5);
    controller.update(materialId, "repeatY", 2.25);
    controller.update(materialId, "offsetX", -0.75);
    controller.update(materialId, "offsetY", 0.125);
    controller.update(materialId, "rotationDegrees", 37);
    controller.update(materialId, "wrapMode", "mirrored-repeat");
    const replacement = createDescriptor("mapping-new");
    assets.resolve(0, replacement);

    const result = await attaching;
    const stored = findMaterial(sceneStore, materialId).colorMap;
    const expected = {
      ...replacement,
      repeatX: 4.5,
      repeatY: 2.25,
      offsetX: -0.75,
      offsetY: 0.125,
      rotationDegrees: 37,
      wrapMode: "mirrored-repeat",
    };
    assert.deepEqual(result, expected);
    assert.deepEqual(stored, expected);
    assert.equal(assets.has("mapping-old"), false);
    assert.equal(assets.has("mapping-new"), true);
  });

  it("rolls back a decoded asset when scene publication fails", async () => {
    const snapshot = createDefaultSceneModel();
    const materialId = snapshot.materials[0].id;
    const sceneStore = {
      getSnapshot: () => snapshot,
      update() {
        throw new Error("scene publication failed");
      },
    };
    const assets = createAssetStoreDouble();
    const controller = new MaterialTextureController(sceneStore, assets);

    const attaching = controller.attach(materialId, createFile("rollback.png"));
    const resource = assets.resolve(0, createDescriptor("rollback-image"));

    await assert.rejects(attaching, /scene publication failed/);
    assert.equal(assets.has("rollback-image"), false);
    assert.equal(resource.disposeCalls, 1);
    assert.equal(snapshot.materials[0].colorMap, null);
  });

  it("leaves the scene unchanged when image loading fails", async () => {
    const sceneStore = new SceneStore(createDefaultSceneModel());
    const assets = createAssetStoreDouble();
    const controller = new MaterialTextureController(sceneStore, assets);
    const materialId = sceneStore.getSnapshot().materials[0].id;
    const before = sceneStore.getSnapshot();

    const attaching = controller.attach(materialId, createFile("broken.png"));
    assets.reject(0, new Error("decode failed"));

    await assert.rejects(attaching, /decode failed/);
    assert.equal(sceneStore.getSnapshot(), before);
    assert.deepEqual(assets.ids(), []);
  });

  it("uses last-request-wins for two attachments to the same material", async () => {
    for (const resolutionOrder of ["first-then-second", "second-then-first"]) {
      const sceneStore = new SceneStore(createDefaultSceneModel());
      const assets = createAssetStoreDouble();
      const controller = new MaterialTextureController(sceneStore, assets);
      const materialId = sceneStore.getSnapshot().materials[0].id;
      const first = controller.attach(materialId, createFile("A.png"));
      const second = controller.attach(materialId, createFile("B.png"));
      const descriptorA = createDescriptor(`A-${resolutionOrder}`);
      const descriptorB = createDescriptor(`B-${resolutionOrder}`);

      let resultA;
      let resultB;
      if (resolutionOrder === "first-then-second") {
        const resourceA = assets.resolve(0, descriptorA);
        resultA = await first;
        assert.equal(resultA, undefined);
        assert.equal(resourceA.disposeCalls, 1);
        assets.resolve(1, descriptorB);
        resultB = await second;
      } else {
        assets.resolve(1, descriptorB);
        resultB = await second;
        const resourceA = assets.resolve(0, descriptorA);
        resultA = await first;
        assert.equal(resourceA.disposeCalls, 1);
      }

      assert.equal(resultA, undefined);
      assert.deepEqual(resultB, descriptorB);
      assert.equal(findMaterial(sceneStore, materialId).colorMap.assetId, descriptorB.assetId);
      assert.deepEqual(assets.ids(), [descriptorB.assetId]);
    }
  });

  it("does not collect a concurrently decoded asset for another material", async () => {
    const sceneStore = new SceneStore(createDefaultSceneModel());
    const assets = createAssetStoreDouble();
    const controller = new MaterialTextureController(sceneStore, assets);
    const [firstId, secondId] = sceneStore
      .getSnapshot()
      .materials.slice(0, 2)
      .map(({ id }) => id);
    const first = controller.attach(firstId, createFile("first.png"));
    const second = controller.attach(secondId, createFile("second.png"));
    const firstDescriptor = createDescriptor("parallel-first");
    const secondDescriptor = createDescriptor("parallel-second");

    const firstResource = assets.resolve(0, firstDescriptor);
    const secondResource = assets.resolve(1, secondDescriptor);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.deepEqual(firstResult, firstDescriptor);
    assert.deepEqual(secondResult, secondDescriptor);
    assert.equal(findMaterial(sceneStore, firstId).colorMap.assetId, "parallel-first");
    assert.equal(findMaterial(sceneStore, secondId).colorMap.assetId, "parallel-second");
    assert.deepEqual(new Set(assets.ids()), new Set(["parallel-first", "parallel-second"]));
    assert.equal(firstResource.disposeCalls, 0);
    assert.equal(secondResource.disposeCalls, 0);
  });

  it("invalidates a pending attachment on remove and releases both assets", async () => {
    const scene = createDefaultSceneModel();
    const materialId = scene.materials[0].id;
    const oldDescriptor = createDescriptor("remove-old");
    scene.materials[0].colorMap = oldDescriptor;
    const sceneStore = new SceneStore(scene);
    const assets = createAssetStoreDouble();
    const oldResource = assets.seed(oldDescriptor);
    const controller = new MaterialTextureController(sceneStore, assets);

    const attaching = controller.attach(materialId, createFile("pending.png"));
    assert.equal(controller.remove(materialId), true);
    assert.equal(findMaterial(sceneStore, materialId).colorMap, null);

    const pendingResource = assets.resolve(
      0,
      createDescriptor("remove-pending"),
    );
    assert.equal(await attaching, undefined);
    assert.equal(oldResource.disposeCalls, 1);
    assert.equal(pendingResource.disposeCalls, 1);
    assert.equal(findMaterial(sceneStore, materialId).colorMap, null);
    assert.deepEqual(assets.ids(), []);
  });

  it("rolls back a pending attachment if its material is deleted", async () => {
    const sceneStore = new SceneStore(createDefaultSceneModel());
    const assets = createAssetStoreDouble();
    const controller = new MaterialTextureController(sceneStore, assets);
    const materialId = sceneStore.getSnapshot().materials[0].id;
    const attaching = controller.attach(materialId, createFile("orphan.png"));

    sceneStore.update((draft) => {
      draft.materials = draft.materials.filter(({ id }) => id !== materialId);
    });
    const resource = assets.resolve(0, createDescriptor("orphan-image"));

    await assert.rejects(
      attaching,
      (error) =>
        error instanceof MaterialTextureControllerError &&
        error.code === "material-missing",
    );
    assert.equal(resource.disposeCalls, 1);
    assert.deepEqual(assets.ids(), []);
  });

  it("rolls back a pending attachment when disposed and rejects later operations", async () => {
    const sceneStore = new SceneStore(createDefaultSceneModel());
    const assets = createAssetStoreDouble();
    const controller = new MaterialTextureController(sceneStore, assets);
    const materialId = sceneStore.getSnapshot().materials[0].id;
    const attaching = controller.attach(materialId, createFile("late.png"));

    controller.dispose();
    const resource = assets.resolve(0, createDescriptor("late-image"));

    await assert.rejects(
      attaching,
      (error) =>
        error instanceof MaterialTextureControllerError && error.code === "disposed",
    );
    assert.equal(resource.disposeCalls, 1);
    assert.deepEqual(assets.ids(), []);
    assert.throws(
      () => controller.remove(materialId),
      (error) =>
        error instanceof MaterialTextureControllerError && error.code === "disposed",
    );
  });

  it("keeps shared assets until the final reference is removed and sweeps orphans", () => {
    const scene = createDefaultSceneModel();
    const shared = createDescriptor("shared-image");
    scene.materials[0].colorMap = structuredClone(shared);
    scene.materials[1].colorMap = structuredClone(shared);
    const sceneStore = new SceneStore(scene);
    const assets = createAssetStoreDouble();
    const sharedResource = assets.seed(shared);
    const orphanResource = assets.seed(createDescriptor("unused-image"));
    const controller = new MaterialTextureController(sceneStore, assets);

    controller.releaseUnused();
    assert.equal(orphanResource.disposeCalls, 1);
    assert.equal(sharedResource.disposeCalls, 0);
    assert.deepEqual(assets.ids(), ["shared-image"]);

    assert.equal(controller.remove(scene.materials[0].id), true);
    assert.equal(sharedResource.disposeCalls, 0);
    assert.equal(assets.has("shared-image"), true);

    assert.equal(controller.remove(scene.materials[1].id), true);
    assert.equal(sharedResource.disposeCalls, 1);
    assert.equal(assets.has("shared-image"), false);
  });
});

function createAssetStoreDouble() {
  const pending = [];
  const records = new Map();
  const deleteCalls = [];

  return {
    pending,
    deleteCalls,
    importFile(file) {
      const deferred = createDeferred();
      pending.push({ file, ...deferred });
      return deferred.promise;
    },
    resolve(index, descriptor) {
      const request = pending[index];
      assert.ok(request, `missing import request ${index}`);
      const resource = { descriptor: structuredClone(descriptor), disposeCalls: 0 };
      records.set(descriptor.assetId, resource);
      request.resolve(structuredClone(descriptor));
      return resource;
    },
    reject(index, error) {
      const request = pending[index];
      assert.ok(request, `missing import request ${index}`);
      request.reject(error);
    },
    seed(descriptor) {
      const resource = { descriptor: structuredClone(descriptor), disposeCalls: 0 };
      records.set(descriptor.assetId, resource);
      return resource;
    },
    delete(assetId) {
      deleteCalls.push(assetId);
      const resource = records.get(assetId);
      if (!resource) return false;
      records.delete(assetId);
      resource.disposeCalls += 1;
      return true;
    },
    has(assetId) {
      return records.has(assetId);
    },
    ids() {
      return [...records.keys()];
    },
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createDescriptor(assetId, overrides = {}) {
  return {
    assetId,
    sourceName: `${assetId}.png`,
    mimeType: "image/png",
    byteSize: 1_024,
    width: 64,
    height: 32,
    repeatX: 1,
    repeatY: 1,
    offsetX: 0,
    offsetY: 0,
    rotationDegrees: 0,
    wrapMode: "repeat",
    ...overrides,
  };
}

function createFile(name) {
  return new File(["fixture"], name, { type: "image/png" });
}

function findMaterial(sceneStore, materialId) {
  const definition = sceneStore
    .getSnapshot()
    .materials.find(({ id }) => id === materialId);
  assert.ok(definition, `missing material ${materialId}`);
  return definition;
}
