import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

let server, ImportedAssetStore, SceneHistory, SceneStore, ProjectAssets, MaterialImageAssetStore, createDefaultSceneModel;
before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  const load = path => server.ssrLoadModule(`/src/${path}.ts`);
  ({ ImportedAssetStore } = await load('three/imported-asset-store'));
  ({ SceneHistory } = await load('app/scene-history'));
  ({ SceneStore } = await load('app/scene-store'));
  ({ ProjectAssets } = await load('app/project-assets'));
  ({ MaterialImageAssetStore } = await load('three/material/image-asset-store'));
  ({ createDefaultSceneModel } = await load('model/default-scene'));
});
after(() => server?.close());

function estimated(...objects) {
  const store = new ImportedAssetStore(), root = new THREE.Group();
  root.add(...objects); store.register('fixture', root);
  try { return store.estimatedBytes('fixture'); } finally { store.dispose(); }
}
function mesh(geometry) { return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()); }

test('disjoint views sharing one allocation retain both GPU attributes', () => {
  const buffer = new ArrayBuffer(72), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buffer, 0, 9), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(buffer, 36, 9), 3));
  assert.equal(estimated(mesh(geometry)), 144);
});

test('overlapping views have one CPU allocation and independent GPU owners', () => {
  const buffer = new ArrayBuffer(36), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buffer), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(buffer), 3));
  assert.equal(estimated(mesh(geometry)), 108);
});

test('a shared attribute across distinct geometries is uploaded once while the entire backing buffer is retained', () => {
  const buffer = new ArrayBuffer(144), attribute = new THREE.BufferAttribute(new Float32Array(buffer, 36, 9), 3);
  const first = new THREE.BufferGeometry().setAttribute('position', attribute);
  const second = new THREE.BufferGeometry().setAttribute('position', attribute);
  assert.equal(estimated(mesh(first), mesh(second), mesh(first)), 180);
});

test('interleaved attributes share their GPU owner and index arrays are included', () => {
  const data = new THREE.InterleavedBuffer(new Float32Array(18), 6), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(data, 3, 0));
  geometry.setAttribute('normal', new THREE.InterleavedBufferAttribute(data, 3, 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1));
  assert.equal(estimated(mesh(geometry)), 144 + 12);
});

test('morph inputs include their retained buffers and conservative packed texture copies', () => {
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  geometry.morphAttributes.position = [new THREE.BufferAttribute(new Float32Array(9), 3)];
  const bytes = estimated(mesh(geometry));
  // 72 base bytes + 36 input bytes + at least 48 CPU / 48 GPU packed bytes.
  assert.ok(bytes >= 204);
  assert.ok(bytes <= 300, 'row padding remains bounded by twice the unpacked texture');
});

test('instance matrices, instance colors and float morph textures are included once', () => {
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  const instances = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 2);
  instances.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(6), 3);
  instances.morphTexture = new THREE.DataTexture(new Float32Array(8), 4, 2, THREE.RedFormat, THREE.FloatType);
  assert.equal(estimated(instances), 72 + 256 + 48 + 64);
});

test('history releases an asset when the corrected shared-buffer estimate exceeds its byte budget', () => {
  const assets = new ImportedAssetStore(), images = new MaterialImageAssetStore(), root = new THREE.Group();
  const buffer = new ArrayBuffer(8192), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buffer, 0, 1024), 1));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(buffer, 4096, 1024), 1));
  root.add(mesh(geometry)); assets.register('fixture', root);
  const model = createDefaultSceneModel(); model.imports.push({ id: 'import', assetId: 'fixture' });
  const store = new SceneStore(model), history = new SceneHistory(store, assets, images, new ProjectAssets(), 12 * 1024);
  let disposed = 0; geometry.addEventListener('dispose', () => disposed++);
  try {
    assert.equal(assets.estimatedBytes('fixture'), 16 * 1024);
    assert.equal(assets.delete('fixture'), false, 'active history reference defers disposal');
    store.update(draft => { draft.imports = []; });
    assert.equal(history.canUndo, false);
    assert.equal(assets.size, 0); assert.equal(disposed, 1);
  } finally { history.dispose(); assets.dispose(); images.dispose(); }
});
