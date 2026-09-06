import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'vite';
import * as THREE from 'three';
let server, SceneStore, SceneHistory, ProjectAssets, ImportedAssetStore, MaterialImageAssetStore, createDefaultSceneModel, encodeProject, decodeProject, validateScene;
before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  ({ SceneStore } = await server.ssrLoadModule('/src/app/scene-store.ts'));
  ({ SceneHistory } = await server.ssrLoadModule('/src/app/scene-history.ts'));
  ({ ProjectAssets } = await server.ssrLoadModule('/src/app/project-assets.ts'));
  ({ ImportedAssetStore } = await server.ssrLoadModule('/src/three/imported-asset-store.ts'));
  ({ MaterialImageAssetStore } = await server.ssrLoadModule('/src/three/material/image-asset-store.ts'));
  ({ createDefaultSceneModel } = await server.ssrLoadModule('/src/model/default-scene.ts'));
  ({ encodeProject, decodeProject } = await server.ssrLoadModule('/src/app/project-format.ts'));
  ({ validateScene } = await server.ssrLoadModule('/src/app/project-validation.ts'));
});
after(() => server?.close());
test('structural sharing keeps untouched model domains and suppresses no-op notifications', () => {
  const store = new SceneStore(createDefaultSceneModel()); const old = store.getSnapshot(); let calls = 0;
  store.subscribe(() => calls++);
  store.update(d => { d.name = d.name; }); assert.equal(calls, 1);
  store.update(d => { d.camera.position.x = 20; });
  assert.equal(store.getSnapshot().materials, old.materials); assert.equal(store.getSnapshot().objects, old.objects);
  assert.equal(old.camera.position.x, 6.5); assert.equal(calls, 2); assert.ok(Object.isFrozen(store.getSnapshot().camera.position));
});
test('history groups edits, cancel restores, redo is discarded after new edit', () => {
  const store = new SceneStore(createDefaultSceneModel()); const assets = new ImportedAssetStore(); const images = new MaterialImageAssetStore();
  const history = new SceneHistory(store, assets, images, new ProjectAssets());
  history.begin(); store.update(d => { d.objects[0].name = 'One'; }); store.update(d => { d.objects[0].name = 'Two'; }); history.end();
  history.undo(); assert.equal(store.getSnapshot().objects[0].name, 'Box 01'); history.redo(); assert.equal(store.getSnapshot().objects[0].name, 'Two');
  history.begin(); store.update(d => { d.objects[0].name = 'Cancel'; }); history.cancel(); assert.equal(store.getSnapshot().objects[0].name, 'Two');
  history.undo(); store.update(d => { d.objects[0].name = 'New'; }); assert.equal(history.canRedo, false);
  history.undo(); assert.equal(history.canRedo, true);
  history.begin(); store.update(d => { d.objects[0].name = 'Aborted'; }); history.cancel();
  assert.equal(history.canRedo, true); history.redo(); assert.equal(store.getSnapshot().objects[0].name, 'New');
  history.dispose(); assets.dispose(); images.dispose();
});
test('history pins deleted import runtime until history clear', () => {
  const model = createDefaultSceneModel(); const store = new SceneStore(model); const assets = new ImportedAssetStore(); const images = new MaterialImageAssetStore(); const sources = new ProjectAssets();
  const root = new THREE.Group(); const geometry = new THREE.BoxGeometry(); root.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
  let disposed = 0; geometry.addEventListener('dispose', () => disposed++);
  assets.register('test-asset', root);
  const history = new SceneHistory(store, assets, images, sources);
  store.update(d => { d.imports.push({ id:'test', assetId:'test-asset' }); });
  store.update(d => { d.imports = []; }); assets.delete('test-asset'); assert.equal(disposed, 0);
  history.undo(); assert.ok(assets.get('test-asset')); history.redo(); history.clear(); assert.equal(disposed, 1);
  history.dispose(); assets.dispose(); images.dispose();
});
test('project primitive scene round trip preserves parameters and rejects malformed model', async () => {
  const model = createDefaultSceneModel(); const images = new MaterialImageAssetStore();
  const blob = await encodeProject(model, new ProjectAssets(), images); const decoded = await decodeProject(blob);
  assert.deepEqual(decoded.model, JSON.parse(JSON.stringify(model)));
  const sphere = model.objects.find(object => object.geometry.type === 'sphere');
  sphere.geometry.heightSegments = 2;
  const sphereRestored = await decodeProject(await encodeProject(model, new ProjectAssets(), images));
  assert.equal(sphereRestored.model.objects.find(object => object.id === sphere.id).geometry.heightSegments, 2);
  const bad = structuredClone(model); bad.objects[0].materialId = 'missing'; assert.throws(() => validateScene(bad));
  bad.objects[0].materialId = model.objects[0].materialId; bad.camera.fov = NaN; assert.throws(() => validateScene(bad));
  for (const badValue of [42, null, {}]) { const badTags = structuredClone(model); badTags.materials[0].tags = badValue; assert.throws(() => validateScene(badTags)); }
  const badUp = structuredClone(model); badUp.camera.up = {x:0,y:0,z:0}; assert.throws(() => validateScene(badUp));
  const bytes = new Uint8Array(await blob.arrayBuffer()); bytes[0] = 0; await assert.rejects(decodeProject(new Blob([bytes])));
  images.dispose();
});
test('project original sidecars round trip and checksum mismatch fails', async () => {
  const model = createDefaultSceneModel(); const sources = new ProjectAssets(); const images = new MaterialImageAssetStore();
  const primary = new File(['v 0 0 0'], 'part.obj'); const sidecar = new File(['newmtl m'], 'part.mtl');
  const options = { unit:'millimeter', coordinateSystem:'z-up', centerModel:true, placeOnGround:true, quality:'medium' };
  sources.capture('a', primary, [primary, sidecar], options);
  model.imports.push({ id:'i', assetId:'a', name:'Part', format:'OBJ', visible:true, transform:{ position:{x:1,y:2,z:3},rotationDegrees:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}, materialMode:'imported',customMaterialId:null,metadata:{fileName:'part.obj',format:'OBJ',sizeBytes:primary.size,objectCount:1,triangleCount:0,materialCount:1},warnings:[],hierarchy:[] });
  const blob = await encodeProject(model, sources, images); const decoded = await decodeProject(blob);
  assert.deepEqual(decoded.imports.get('a').options, options); assert.equal(await decoded.imports.get('a').files[1].text(),'newmtl m');
  const bytes = new Uint8Array(await blob.arrayBuffer()); bytes[bytes.length - 1] ^= 1;
  await assert.rejects(decodeProject(new Blob([bytes])), /checksum/); images.dispose();
});
