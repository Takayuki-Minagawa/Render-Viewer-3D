import assert from 'node:assert/strict';
import { before, after, it } from 'node:test';
import { createServer } from 'vite';
import * as THREE from 'three';
let server, ImportedAssetStore, ImportedSceneAdapter, createImportedSceneModel, buildImportedHierarchy;
let setImportedNodeVisibility, setImportedNodeMaterial, isolateImportedNode, resetImportedNodeOverrides;
let createMaterialDefinition, deleteMaterial, getMaterialUsageCount, getMaterialUsageCounts;
before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  ({ ImportedAssetStore } = await server.ssrLoadModule('/src/three/imported-asset-store.ts'));
  ({ ImportedSceneAdapter } = await server.ssrLoadModule('/src/three/imported-scene-adapter.ts'));
  ({ createImportedSceneModel, setImportedNodeVisibility, setImportedNodeMaterial, isolateImportedNode, resetImportedNodeOverrides } = await server.ssrLoadModule('/src/model/imported-scene-model.ts'));
  ({ buildImportedHierarchy } = await server.ssrLoadModule('/src/app/import-controller.ts'));
  ({ createMaterialDefinition } = await server.ssrLoadModule('/src/model/material/material-presets.ts'));
  ({ deleteMaterial, getMaterialUsageCount, getMaterialUsageCounts } = await server.ssrLoadModule('/src/model/material/material-commands.ts'));
});
after(async () => { await server?.close(); });
function fixture() {
  const root = new THREE.Group();
  const branch = new THREE.Group(); branch.name = 'Assembly'; branch.position.x = 5;
  const a = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 'red' })); a.name = 'Part A';
  const b = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 'blue' })); b.name = 'Part B';
  const hidden = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); hidden.visible = false;
  const bone = new THREE.Bone(); bone.position.set(1,2,3);
  branch.add(a, bone); root.add(branch, b, hidden);
  const model = createImportedSceneModel({ id: 'import', assetId: 'asset', name: 'Assembly', format: 'glTF', metadata: { fileName: 'assembly.glb', format: 'glTF', objectCount: 6, triangleCount: 36, materialCount: 3, sizeBytes: 100 }, hierarchy: buildImportedHierarchy(root).nodes });
  const definitions = [createMaterialDefinition('metal', 'Metal', 'metal'), createMaterialDefinition('glass', 'Glass', 'glass')];
  const assets = new ImportedAssetStore(); assets.register('asset', root);
  const adapter = new ImportedSceneAdapter(new THREE.Scene(), assets);
  return { root, branch, a, b, hidden, bone, model, definitions, assets, adapter };
}
it('selectable IDs match saved hierarchy, isolation preserves ancestors and restores original hidden flags', () => {
  const f = fixture();
  try {
    f.adapter.applyModel([f.model], f.definitions);
    assert.equal(f.a.userData.importedNodeId, 'node-0-0');
    assert.equal(f.b.userData.importedNodeId, 'node-1');
    assert.equal(f.a.userData.sceneModelId, 'import');
    assert.equal(isolateImportedNode([f.model], 'import', 'node-0-0'), true);
    f.adapter.applyModel([f.model], f.definitions);
    assert.equal(f.branch.visible, true);
    assert.equal(f.a.visible, true);
    assert.equal(f.b.visible, false);
    assert.deepEqual(f.adapter.getPickableObjects(), [f.a]);
    isolateImportedNode([f.model], 'import', null);
    f.adapter.applyModel([f.model], f.definitions);
    assert.equal(f.b.visible, true);
    assert.equal(f.hidden.visible, false);
    setImportedNodeVisibility([f.model], 'import', 'node-2', true);
    f.adapter.applyModel([f.model], f.definitions);
    assert.equal(f.hidden.visible, true);
    setImportedNodeVisibility([f.model], 'import', 'node-2', null);
    f.adapter.applyModel([f.model], f.definitions);
    assert.equal(f.hidden.visible, false);
  } finally { f.adapter.dispose(); f.assets.dispose(); }
});
it('nested part materials override root/parent and reset without changing source transforms or original materials', () => {
  const f = fixture(); const originals = [f.a.material, f.b.material];
  try {
    f.adapter.applyModel([f.model], f.definitions);
    f.model.materialMode = 'custom'; f.model.customMaterialId = 'glass';
    setImportedNodeMaterial([f.model], 'import', 'node-0', 'metal');
    f.adapter.applyModel([f.model], f.definitions);
    assert.notEqual(f.a.material, f.b.material);
    assert.equal(f.a.material.metalness, f.definitions[0].preview.metalness);
    assert.equal(f.b.material.transmission, f.definitions[1].preview.transmission);
    // Simulate an animation mixer updating a descendant between scene updates.
    f.a.position.x = 123;
    setImportedNodeMaterial([f.model], 'import', 'node-0-0', 'glass');
    f.adapter.applyModel([f.model], f.definitions);
    assert.equal(f.a.material, f.b.material);
    assert.equal(f.a.position.x, 123);
    assert.deepEqual(f.bone.position.toArray(), [1,2,3]);
    assert.equal(f.branch.position.x, 5);
    resetImportedNodeOverrides([f.model], 'import');
    f.model.materialMode = 'imported';
    f.adapter.applyModel([f.model], f.definitions);
    assert.equal(f.a.material, originals[0]); assert.equal(f.b.material, originals[1]);
    assert.equal(f.a.position.x, 123);
  } finally { f.adapter.dispose(); f.assets.dispose(); }
});
it('rejects unknown node/material references before scene mutation and protects material deletion', () => {
  const f = fixture();
  try {
    assert.equal(setImportedNodeMaterial([f.model], 'import', 'node-99', 'metal'), false);
    setImportedNodeMaterial([f.model], 'import', 'node-0', 'metal');
    const scene = { imports: [f.model], objects: [], materials: f.definitions };
    assert.equal(getMaterialUsageCount(scene, 'metal'), 1);
    assert.equal(getMaterialUsageCounts(scene).get('metal'), 1);
    assert.equal(deleteMaterial(scene, 'metal'), 'in-use');
    f.adapter.applyModel([f.model], f.definitions);
    const existing = f.a.material;
    const invalid = structuredClone(f.model); invalid.nodeOverrides['node-0'].materialId = 'missing';
    assert.throws(() => f.adapter.applyModel([invalid], f.definitions), /Missing material/);
    assert.equal(f.a.material, existing);
    const restored = createImportedSceneModel(JSON.parse(JSON.stringify(f.model)));
    assert.deepEqual(restored.nodeOverrides, f.model.nodeOverrides);
    setImportedNodeMaterial([f.model], 'import', 'node-0', null);
    assert.equal(deleteMaterial(scene, 'metal'), 'deleted');
  } finally { f.adapter.dispose(); f.assets.dispose(); }
});
