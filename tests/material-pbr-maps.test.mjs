import assert from "node:assert/strict";
import { before, after, it } from "node:test";
import { createServer } from "vite";
import * as THREE from "three";
let server, MaterialRuntimeCache, MaterialPbrMapController, MaterialTextureController, SceneStore, createDefaultSceneModel, commands;
before(async () => {
  server = await createServer({ appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  ({ MaterialRuntimeCache } = await server.ssrLoadModule("/src/three/material/material-runtime-cache.ts"));
  ({ MaterialPbrMapController } = await server.ssrLoadModule("/src/app/material-pbr-map-controller.ts"));
  ({ MaterialTextureController } = await server.ssrLoadModule("/src/app/material-texture-controller.ts"));
  ({ SceneStore } = await server.ssrLoadModule("/src/app/scene-store.ts"));
  ({ createDefaultSceneModel } = await server.ssrLoadModule("/src/model/default-scene.ts"));
  commands = await server.ssrLoadModule("/src/model/material/material-pbr-map.ts");
});
after(() => server.close());
function descriptor(assetId) { return { assetId, sourceName: `${assetId}.png`, mimeType: "image/png", byteSize: 100, width: 4, height: 4, repeatX: 1, repeatY: 1, offsetX: 0, offsetY: 0, rotationDegrees: 0, wrapMode: "repeat" }; }
function assets() {
  const sources = new Map(), leases = new Map(), deleted = [];
  return { sources, leases, deleted,
    seed(id) { sources.set(id, new THREE.Source({ width: 4, height: 4 })); return descriptor(id); },
    acquire(id) { if (!sources.has(id)) return; leases.set(id, (leases.get(id) ?? 0) + 1); return { assetId: id, source: sources.get(id) }; },
    release(id) { leases.set(id, leases.get(id) - 1); },
    delete(id) { deleted.push(id); sources.delete(id); return true; },
    ids() { return [...sources.keys()]; },
  };
}
it("uses numeric color space for every PBR channel, independent UV variants and stable no-UV fallback", () => {
  const imageAssets = assets(); const d = imageAssets.seed("shared");
  const model = createDefaultSceneModel(); const material = model.materials[0];
  material.colorMap = d; material.maps = Object.fromEntries(["normal", "roughness", "metalness", "ao"].map((key) => [key, d]));
  const cache = new MaterialRuntimeCache(imageAssets); cache.reconcile([material]);
  const normal = cache.requireMaterial(material.id), flipped = cache.requireMaterial(material.id, "top-left"), fallback = cache.requireUntexturedMaterial(material.id);
  assert.equal(normal.map.colorSpace, THREE.SRGBColorSpace);
  for (const key of ["normalMap", "roughnessMap", "metalnessMap", "aoMap"]) {
    assert.equal(normal[key].colorSpace, THREE.NoColorSpace);
    assert.notEqual(normal[key], flipped[key]); assert.equal(normal[key].source, flipped[key].source);
    assert.equal(normal[key].matrixAutoUpdate, true); assert.equal(flipped[key].matrixAutoUpdate, false);
    assert.equal(fallback[key], null);
  }
  assert.equal(imageAssets.leases.get("shared"), 10);
  assert.equal(cache.requireUntexturedMaterial(material.id), fallback);
  cache.dispose(); assert.equal(imageAssets.leases.get("shared"), 0);
});
it("preserves PBR-only flipped material, applies mapping without upload and releases removed channels once", () => {
  const imageAssets = assets(); const d = imageAssets.seed("normal");
  const material = createDefaultSceneModel().materials[0]; material.maps = { normal: d };
  const cache = new MaterialRuntimeCache(imageAssets); cache.reconcile([material]);
  const runtime = cache.requireMaterial(material.id), flipped = cache.requireMaterial(material.id, "top-left");
  const texture = runtime.normalMap, version = texture.version;
  const updated = structuredClone(material); updated.maps.normal.repeatX = 3;
  cache.reconcile([updated]);
  assert.equal(cache.requireMaterial(material.id, "top-left"), flipped);
  assert.equal(runtime.normalMap, texture); assert.equal(texture.repeat.x, 3); assert.equal(texture.version, version);
  assert.notEqual(cache.requireUntexturedMaterial(material.id), runtime);
  delete updated.maps; cache.reconcile([updated]);
  assert.equal(runtime.normalMap, null); assert.equal(imageAssets.leases.get("normal"), 0);
  cache.dispose(); assert.equal(imageAssets.leases.get("normal"), 0);
});
it("validates channels, clamps mapping, removes empty maps without changing old snapshots", () => {
  const scene = new SceneStore(createDefaultSceneModel()); const id = scene.getSnapshot().materials[0].id;
  const before = scene.getSnapshot();
  scene.update((draft) => { assert.equal(commands.setMaterialPbrMap(draft, id, "normal", descriptor("n")), true); });
  assert.equal(before.materials[0].maps, undefined);
  scene.update((draft) => { assert.equal(commands.updateMaterialPbrMap(draft, id, "normal", "repeatX", 100_000), true); });
  assert.equal(scene.getSnapshot().materials[0].maps.normal.repeatX, 1000);
  scene.update((draft) => { assert.equal(commands.setMaterialPbrMap(draft, id, "__proto__", descriptor("bad")), false); commands.setMaterialPbrMap(draft, id, "normal", null); });
  assert.equal(scene.getSnapshot().materials[0].maps, undefined);
});
it("cancels stale asynchronous PBR attachments and retains current maps during base-color cleanup", async () => {
  const scene = new SceneStore(createDefaultSceneModel()); const id = scene.getSnapshot().materials[0].id;
  const imageAssets = assets(); let resolve;
  imageAssets.importFile = () => new Promise((done) => { resolve = done; });
  const controller = new MaterialPbrMapController(scene, imageAssets);
  const pending = controller.attach(id, "normal", {}); controller.cancelPending();
  resolve(imageAssets.seed("stale")); await pending;
  assert.equal(scene.getSnapshot().materials[0].maps, undefined); assert.deepEqual(imageAssets.deleted, ["stale"]);
  const current = controller.attach(id, "normal", {}); resolve(imageAssets.seed("current")); await current;
  const baseController = new MaterialTextureController(scene, imageAssets); baseController.releaseUnused();
  assert.ok(imageAssets.sources.has("current"));
  controller.remove(id, "normal"); assert.equal(imageAssets.sources.has("current"), false);
  controller.dispose(); baseController.dispose();
});
it("does not remove a shared asset when removing one PBR channel", async () => {
  const sceneModel = createDefaultSceneModel(), imageAssets = assets(), d = imageAssets.seed("shared");
  sceneModel.materials[0].maps = { normal: d, roughness: d };
  const scene = new SceneStore(sceneModel); const controller = new MaterialPbrMapController(scene, imageAssets);
  controller.remove(sceneModel.materials[0].id, "normal");
  assert.ok(imageAssets.sources.has("shared"));
  controller.remove(sceneModel.materials[0].id, "roughness");
  assert.equal(imageAssets.sources.has("shared"), false);
});
