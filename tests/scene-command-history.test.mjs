import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'vite';

let server, SceneStore, SceneHistory, ProjectAssets, ImportedAssetStore, MaterialImageAssetStore;
let createDefaultSceneModel, duplicateSceneObject, duplicateMaterial, makeMaterialUnique;

before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  ({ SceneStore } = await server.ssrLoadModule('/src/app/scene-store.ts'));
  ({ SceneHistory } = await server.ssrLoadModule('/src/app/scene-history.ts'));
  ({ ProjectAssets } = await server.ssrLoadModule('/src/app/project-assets.ts'));
  ({ ImportedAssetStore } = await server.ssrLoadModule('/src/three/imported-asset-store.ts'));
  ({ MaterialImageAssetStore } = await server.ssrLoadModule('/src/three/material/image-asset-store.ts'));
  ({ createDefaultSceneModel } = await server.ssrLoadModule('/src/model/default-scene.ts'));
  ({ duplicateSceneObject } = await server.ssrLoadModule('/src/model/scene-object-commands.ts'));
  ({ duplicateMaterial, makeMaterialUnique } = await server.ssrLoadModule('/src/model/material/material-commands.ts'));
});
after(() => server?.close());

function createScene(t, model = createDefaultSceneModel()) {
  const store = new SceneStore(model);
  const assets = new ImportedAssetStore();
  const images = new MaterialImageAssetStore();
  const history = new SceneHistory(store, assets, images, new ProjectAssets());
  t.after(() => { history.dispose(); assets.dispose(); images.dispose(); });
  return { store, history };
}

test('duplicate object through SceneStore copies current geometry and material with undo/redo', t => {
  const { store, history } = createScene(t);
  const before = store.getSnapshot();
  const sourceId = before.objects[0].id;
  let duplicateId;
  store.update(draft => {
    const source = draft.objects[0];
    source.geometry.width = 7;
    draft.materials.find(material => material.id === source.materialId).preview.roughness = 0.23;
    duplicateId = duplicateSceneObject(draft, sourceId).id;
  });
  const after = store.getSnapshot();
  const source = after.objects.find(object => object.id === sourceId);
  const duplicate = after.objects.find(object => object.id === duplicateId);
  const sourceMaterial = after.materials.find(material => material.id === source.materialId);
  const duplicateMaterial = after.materials.find(material => material.id === duplicate.materialId);
  assert.equal(after.objects.length, before.objects.length + 1);
  assert.equal(after.materials.length, before.materials.length + 1);
  assert.equal(duplicate.geometry.width, 7);
  assert.equal(duplicateMaterial.preview.roughness, 0.23);
  assert.notEqual(source.materialId, duplicate.materialId);
  assert.notEqual(source.geometry, duplicate.geometry);
  assert.notEqual(sourceMaterial.preview, duplicateMaterial.preview);
  assert.equal(before.objects[0].geometry.width, 2);
  history.undo();
  assert.deepEqual(store.getSnapshot(), before);
  history.redo();
  assert.deepEqual(store.getSnapshot(), after);
  store.update(draft => {
    draft.objects.find(object => object.id === duplicateId).geometry.width = 9;
    draft.materials.find(material => material.id === duplicate.materialId).preview.roughness = 0.9;
  });
  assert.equal(store.getSnapshot().objects.find(object => object.id === sourceId).geometry.width, 7);
  assert.equal(store.getSnapshot().materials.find(material => material.id === source.materialId).preview.roughness, 0.23);
});

test('duplicate material through SceneStore keeps current nested edits independent', t => {
  const { store, history } = createScene(t);
  const before = store.getSnapshot();
  const sourceId = before.materials[0].id;
  let duplicateId;
  store.update(draft => {
    draft.materials[0].preview.baseColor = '#123456';
    draft.materials[0].tags.push('edited');
    duplicateId = duplicateMaterial(draft, sourceId).id;
  });
  const after = store.getSnapshot();
  const source = after.materials.find(material => material.id === sourceId);
  const duplicate = after.materials.find(material => material.id === duplicateId);
  assert.equal(duplicate.preview.baseColor, '#123456');
  assert.equal(duplicate.tags.at(-1), 'edited');
  assert.notEqual(source.preview, duplicate.preview);
  assert.notEqual(source.tags, duplicate.tags);
  assert.notEqual(source.pov, duplicate.pov);
  history.undo();
  assert.deepEqual(store.getSnapshot(), before);
  history.redo();
  assert.deepEqual(store.getSnapshot(), after);
});

test('make unique through SceneStore preserves the other material user and is undoable', t => {
  const model = createDefaultSceneModel();
  model.objects[1].materialId = model.objects[0].materialId;
  const { store, history } = createScene(t, model);
  const before = store.getSnapshot();
  let uniqueId;
  store.update(draft => {
    const material = makeMaterialUnique(draft, draft.objects[0].id);
    uniqueId = material.id;
    material.preview.baseColor = '#abcdef';
  });
  const after = store.getSnapshot();
  assert.notEqual(uniqueId, before.objects[0].materialId);
  assert.equal(after.objects[0].materialId, uniqueId);
  assert.equal(after.objects[1].materialId, before.objects[1].materialId);
  assert.equal(after.materials.find(material => material.id === uniqueId).preview.baseColor, '#abcdef');
  assert.deepEqual(after.materials.find(material => material.id === before.objects[0].materialId), before.materials[0]);
  history.undo();
  assert.deepEqual(store.getSnapshot(), before);
  history.redo();
  assert.deepEqual(store.getSnapshot(), after);
});
