import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { after, before, describe, it } from 'node:test';
import { createServer } from 'vite';
import { WebIO } from '@gltf-transform/core';
import { fixture } from './fixtures/generated-gltf.mjs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
let server, diagnoseAsset, optimizeGlbCopy, assertFileBudget, assertDiagnosticBudget, runAssetTool;
before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  ({ diagnoseAsset, assertFileBudget, assertDiagnosticBudget } = await server.ssrLoadModule('/src/asset-tools/diagnostics.ts'));
  ({ optimizeGlbCopy } = await server.ssrLoadModule('/src/asset-tools/optimization.ts'));
  ({ runAssetTool } = await server.ssrLoadModule('/src/asset-tools/client.ts'));
});
after(async () => { await server?.close(); });
const jsonBytes = (value) => new TextEncoder().encode(JSON.stringify(value));
describe('local glTF diagnostics', () => {
  it('reports valid GLB and malformed accessors without changing source bytes', async () => {
    const input = await fixture(), original = input.slice();
    const result = await diagnoseAsset(input, 'model.glb');
    assert.equal(result.report.issues.numErrors, 0); assert.deepEqual(input, original);
    const invalid = await diagnoseAsset(jsonBytes({ asset: { version: '2.0' }, accessors: [{ componentType: 9999, count: -1, type: 'INVALID' }] }), 'invalid.gltf');
    assert.ok(invalid.report.issues.numErrors > 0); assert.ok(invalid.report.issues.messages.some((issue) => issue.pointer?.includes('/accessors')));
  });
  it('resolves selected local sidecars, reports missing/external ones, never fetches', async () => {
    const oldFetch = globalThis.fetch; globalThis.fetch = () => { throw new Error('unexpected network request'); };
    try {
      const source = { asset: { version: '2.0' }, buffers: [{ byteLength: 12, uri: 'mesh.bin' }] };
      const primary = new File([jsonBytes(source)], 'model.gltf'), sidecar = new File([new Uint8Array(12)], 'mesh.bin');
      assert.equal((await diagnoseAsset(jsonBytes(source), 'model.gltf', [primary, sidecar], primary)).report.issues.numErrors, 0);
      const missing = await diagnoseAsset(jsonBytes(source), 'model.gltf', [primary], primary);
      assert.ok(missing.report.issues.messages.some((issue) => issue.code === 'IO_ERROR'));
      source.buffers[0].uri = 'https://example.invalid/mesh.bin';
      const external = await diagnoseAsset(jsonBytes(source), 'model.gltf');
      assert.ok(external.report.issues.messages.some((issue) => issue.code === 'IO_ERROR'));
    } finally { globalThis.fetch = oldFetch; }
  });
  it('explains unknown extensions and enforces allocation limits before loading', async () => {
    const result = await diagnoseAsset(jsonBytes({ asset: { version: '2.0' }, extensionsUsed: ['VENDOR_unknown'] }), 'model.gltf');
    assert.deepEqual(result.unsupportedExtensions, ['VENDOR_unknown']);
    assert.throws(() => assertFileBudget([{ size: 65 * 1024 * 1024 }]), /64 MiB/);
    assert.throws(() => assertDiagnosticBudget(jsonBytes({ accessors: [{ count: 1e9 }] })), /allocation/);
    assert.throws(() => assertDiagnosticBudget(jsonBytes({ accessors: [{ count: 1e308 }] })), /allocation/);
  });
});
describe('optimized GLB copies', () => {
  for (const count of [3, 20]) it(`reduces ${count}-part fixture while preserving hierarchy, names, material, animation and input`, async () => {
    const input = await fixture(count), copy = input.slice();
    const result = await optimizeGlbCopy(input);
    assert.equal(result.reduced, true); assert.ok(result.outputBytes < result.inputBytes); assert.deepEqual(input, copy); assert.equal(result.report.issues.numErrors, 0);
    const io = new WebIO(), document = await io.readBinary(result.bytes), root = document.getRoot();
    assert.deepEqual(root.listNodes().map((node) => node.getName()), (await io.readBinary(input)).getRoot().listNodes().map((node) => node.getName()));
    assert.equal(root.listMaterials().length, count); assert.equal(root.listMaterials()[1].getName(), 'Material 1');
    assert.deepEqual(root.listMaterials()[1].getBaseColorFactor(), [0.2, 0.4, 0.8, 1]);
    assert.equal(root.listAnimations()[0].getName(), 'Move part');
    const loader = new GLTFLoader();
    const loaded = await loader.parseAsync(result.bytes.buffer, '');
    assert.equal(loaded.scene.children.length, count); assert.equal(loaded.scene.children[0].children[0].name, 'Part_0');
    assert.equal(loaded.animations[0].name, 'Move part'); assert.equal(loaded.animations[0].tracks.length, 1);
  });
  it('preserves skin joints, weights and morph-target accessors without simplifying them', async () => {
    const io = new WebIO(), source = await io.readBinary(await fixture(3, false)), root = source.getRoot();
    const buffer = root.listBuffers()[0], primitive = root.listMeshes()[0].listPrimitives()[0], node = root.listNodes().find((node) => node.getName() === 'Part 0');
    const joints = source.createAccessor().setType('VEC4').setArray(new Uint16Array(12)).setBuffer(buffer);
    const weights = source.createAccessor().setType('VEC4').setArray(new Float32Array([1,0,0,0,1,0,0,0,1,0,0,0])).setBuffer(buffer);
    primitive.setAttribute('JOINTS_0', joints).setAttribute('WEIGHTS_0', weights);
    const displacement = source.createAccessor().setType('VEC3').setArray(new Float32Array([0,0,1,0,0,1,0,0,1])).setBuffer(buffer);
    primitive.addTarget(source.createPrimitiveTarget().setAttribute('POSITION', displacement)); root.listMeshes()[0].setWeights([0.25]);
    const joint = source.createNode('Joint'); root.listScenes()[0].addChild(joint);
    node.setSkin(source.createSkin('Rig').addJoint(joint));
    const result = await optimizeGlbCopy(await io.writeBinary(source));
    assert.equal(result.report.issues.numErrors, 0);
    const restored = (await io.readBinary(result.bytes)).getRoot();
    assert.equal(restored.listSkins()[0].getName(), 'Rig'); assert.equal(restored.listSkins()[0].listJoints()[0].getName(), 'Joint');
    const mesh = restored.listMeshes()[0], restoredPrimitive = mesh.listPrimitives()[0];
    assert.deepEqual(mesh.getWeights(), [0.25]);
    assert.deepEqual(Array.from(restoredPrimitive.getAttribute('WEIGHTS_0').getArray()), Array.from(weights.getArray()));
    assert.deepEqual(Array.from(restoredPrimitive.listTargets()[0].getAttribute('POSITION').getArray()), Array.from(displacement.getArray()));
  });
  it('returns original copy when no reduction and rejects unsupported extensions and external resources', async () => {
    const result = await optimizeGlbCopy(await fixture(1, false));
    assert.equal(result.reduced, false); assert.equal(result.outputBytes, result.inputBytes);
    const input = await fixture(1, false);
    const asJSON = await new WebIO().binaryToJSON(input);
    asJSON.json.extensionsUsed = ['VENDOR_unknown']; asJSON.json.extensions = { VENDOR_unknown: {} };
    const makeGLB = (json, bin) => {
      const text = JSON.stringify(json), jsonLength = Math.ceil(text.length / 4) * 4, length = 20 + jsonLength + 8 + bin.length;
      const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
      view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, length, true);
      view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20, 20 + jsonLength); bytes.set(new TextEncoder().encode(text), 20);
      view.setUint32(20 + jsonLength, bin.length, true); view.setUint32(24 + jsonLength, 0x004e4942, true); bytes.set(bin, 28 + jsonLength); return bytes;
    };
    const view = new DataView(input.buffer), start = 20 + view.getUint32(12, true); const bin = input.slice(start + 8);
    await assert.rejects(optimizeGlbCopy(makeGLB(asJSON.json, bin)), /cannot preserve/);
    asJSON.json.buffers[0].uri = 'https://example.invalid/data.bin';
    await assert.rejects(optimizeGlbCopy(makeGLB(asJSON.json, bin)), /self-contained/);
  });
});
describe('asset Worker lifetime', () => {
  it('terminates on cancellation, timeout and success', async () => {
    const OldWorker = globalThis.Worker;
    const instances = [];
    globalThis.Worker = class { constructor() { instances.push(this); } postMessage() {} terminate() { this.terminated = true; } };
    try {
      const controller = new AbortController();
      const cancel = runAssetTool({ operation: 'validate-bytes', bytes: new Uint8Array(), name: 'x.glb' }, { signal: controller.signal });
      controller.abort(); await assert.rejects(cancel, { name: 'AbortError' }); assert.equal(instances[0].terminated, true);
      await assert.rejects(runAssetTool({ operation: 'validate-bytes', bytes: new Uint8Array(), name: 'x.glb' }, { timeoutMs: 1 }), /time limit/); assert.equal(instances[1].terminated, true);
      const success = runAssetTool({ operation: 'validate-bytes', bytes: new Uint8Array(), name: 'x.glb' });
      instances[2].onmessage({ data: { ok: true, result: { report: {} } } }); await success; assert.equal(instances[2].terminated, true);
    } finally { globalThis.Worker = OldWorker; }
  });
});
