import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { File } from "node:buffer";
import { after, before, it } from "node:test";
import { createServer } from "vite";
import { OcctKernel } from "occt-wasm";
import * as THREE from "three";

let server, kernel, STEPImporter, exportSTEPAssembly, inspectSTEPAssemblyGLB, DEFAULT_IMPORT_OPTIONS;
let disposeLoadedObject, buildImportedHierarchy, createImportedSceneModel, ImportedAssetStore, ImportedSceneAdapter;
let isolateImportedNode, setImportedNodeMaterial, createMaterialDefinition;
let ProjectAssets, encodeProject, decodeProject, createDefaultScene;
let canCapMesh;
const fixture = (name) => readFile(new URL(`fixtures/step/${name}`, import.meta.url), "utf8");
before(async () => {
  server = await createServer({ appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  ({ STEPImporter } = await server.ssrLoadModule("/src/importers/STEPImporter.ts"));
  ({ exportSTEPAssembly, inspectSTEPAssemblyGLB } = await server.ssrLoadModule("/src/importers/step-assembly.ts"));
  ({ DEFAULT_IMPORT_OPTIONS } = await server.ssrLoadModule("/src/importers/types.ts"));
  ({ disposeLoadedObject } = await server.ssrLoadModule("/src/importers/loader-resource-wait.ts"));
  ({ buildImportedHierarchy } = await server.ssrLoadModule("/src/app/import-controller.ts"));
  ({ createImportedSceneModel, isolateImportedNode, setImportedNodeMaterial } = await server.ssrLoadModule("/src/model/imported-scene-model.ts"));
  ({ ImportedAssetStore } = await server.ssrLoadModule("/src/three/imported-asset-store.ts"));
  ({ ImportedSceneAdapter } = await server.ssrLoadModule("/src/three/imported-scene-adapter.ts"));
  ({ createMaterialDefinition } = await server.ssrLoadModule("/src/model/material/material-presets.ts"));
  ({ ProjectAssets } = await server.ssrLoadModule("/src/app/project-assets.ts"));
  ({ encodeProject, decodeProject } = await server.ssrLoadModule("/src/app/project-format.ts"));
  ({ createDefaultSceneModel: createDefaultScene } = await server.ssrLoadModule("/src/model/default-scene.ts"));
  ({ canCapMesh } = await server.ssrLoadModule("/src/three/section-cap.ts"));
  kernel = await OcctKernel.init({ wasm: await readFile(new URL("../node_modules/occt-wasm/dist/occt-wasm.wasm", import.meta.url)) });
});
after(async () => { kernel?.[Symbol.dispose](); await server?.close(); });
const options = (overrides = {}) => ({ ...DEFAULT_IMPORT_OPTIONS, centerModel: false, placeOnGround: false, ...overrides });
const quality = { linearDeflection: 0.1, angularDeflection: 0.5 };
async function load(name = "colored-nested-assembly.step", overrides = {}) {
  const primary = new File([await fixture(name)], name);
  let terminated = 0;
  const importer = new STEPImporter(() => ({
    ready: Promise.resolve({
      async importAssembly(data, quality) { return exportSTEPAssembly(kernel, data, quality); },
      async importStep(data) { return kernel.importStep(data); },
      async tessellate(shape, quality) { return kernel.tessellate(shape, quality); },
      async release(shape) { kernel.release(shape); },
    }), terminate() { terminated++; },
  }));
  const imported = await importer.import(primary, [primary], options(overrides));
  assert.equal(terminated, 1);
  return { ...imported, primary };
}
function close(actual, expected, epsilon = 1e-7) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < epsilon, `${actual} != ${expected}`));
}
function firstMesh(node) { let result; node.traverse(child => { if (!result && child.isMesh) result = child; }); assert.ok(result); return result; }
function editGLB(bytes, edit) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  edit(json);
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const padded = Math.ceil(encoded.length / 4) * 4;
  const bin = bytes.subarray(20 + length);
  const result = new Uint8Array(20 + padded + bin.length);
  const header = new DataView(result.buffer);
  result.set(bytes.subarray(0, 20));
  header.setUint32(8, result.length, true); header.setUint32(12, padded, true);
  result.fill(32, 20, 20 + padded); result.set(encoded, 20); result.set(bin, 20 + padded);
  return result;
}

it("fixed OCCT 4.3.1 preserves nested names, colors, repeated parts and placements", async () => {
  const count = kernel.shapeCount;
  const imported = await load();
  try {
    const { root } = imported;
    root.updateMatrixWorld(true);
    const nested = root.getObjectByName("Nested assembly");
    const red = root.getObjectByName("Red part");
    const blue = root.getObjectByName("Blue part");
    const repeated = root.getObjectByName("Repeated red part");
    assert.equal(red.parent, nested); assert.equal(blue.parent, nested);
    assert.notEqual(repeated.parent, nested);
    close(red.getWorldPosition(new THREE.Vector3()).toArray(), [0.1, 0.21, 0.3]);
    close(blue.getWorldPosition(new THREE.Vector3()).toArray(), [0.05, 0.2, 0.3]);
    close(repeated.getWorldPosition(new THREE.Vector3()).toArray(), [0, 0, 0.1]);
    close(new THREE.Box3().setFromObject(repeated).getSize(new THREE.Vector3()).toArray(), [0.01, 0.02, 0.03]);
    assert.equal(firstMesh(red).material.color.getHex(), 0xff0000);
    assert.equal(firstMesh(blue).material.color.getHex(), 0x0000ff);
    assert.equal(firstMesh(repeated).material.color.getHex(), 0xff0000);
    assert.equal(red.children.filter(node => node.isMesh).length, 1);
    assert.equal(canCapMesh(firstMesh(red)), true);
    assert.equal(imported.metadata.triangleCount, 36);
    assert.ok(!imported.warnings.some(item => item.code === "step-assembly-flattened"));
    assert.equal(kernel.shapeCount, count);
  } finally { disposeLoadedObject(imported.root); }
});

it("source meters, manual unit overrides and Z-up apply exactly once", async () => {
  for (const [name, overrides, position] of [
    ["colored-nested-assembly-meters.step", {}, [100, 210, 300]],
    ["colored-nested-assembly.step", { unit: "meter" }, [100, 210, 300]],
    ["colored-nested-assembly.step", { coordinateSystem: "z-up" }, [0.1, 0.3, -0.21]],
  ]) {
    const imported = await load(name, overrides);
    try { imported.root.updateMatrixWorld(true); close(imported.root.getObjectByName("Red part").getWorldPosition(new THREE.Vector3()).toArray(), position); }
    finally { disposeLoadedObject(imported.root); }
  }
});

it("unnamed and uncolored geometry gets the normal CAD fallback", async () => {
  const imported = await load("unnamed-box.step");
  try { const mesh = firstMesh(imported.root); assert.ok(mesh.name); assert.equal(mesh.material.color.getHex(), 0xd3d7dc); assert.equal(mesh.material.metalness, 0); }
  finally { disposeLoadedObject(imported.root); }
});

it("assembly geometry totals include every instance and reject cycles and external buffers", async () => {
  const bytes = exportSTEPAssembly(kernel, await new File([await fixture("colored-nested-assembly.step")], "assembly.step").arrayBuffer(), quality);
  assert.doesNotThrow(() => inspectSTEPAssemblyGLB(bytes));
  assert.throws(() => inspectSTEPAssemblyGLB(editGLB(bytes, json => { json.accessors[0].count = 2_000_001; })), /total geometry safety budget/);
  assert.throws(() => inspectSTEPAssemblyGLB(editGLB(bytes, json => { for (const mesh of json.meshes) for (const primitive of mesh.primitives) json.accessors[primitive.indices].count = 6_000_003; })), /total geometry safety budget/);
  assert.throws(() => inspectSTEPAssemblyGLB(editGLB(bytes, json => { json.nodes[0].children = [0]; })), /node hierarchy/);
  assert.throws(() => inspectSTEPAssemblyGLB(editGLB(bytes, json => { json.buffers[0].uri = "https://example.invalid/model.bin"; })), /resources/);
  assert.throws(() => inspectSTEPAssemblyGLB({ byteLength: 128 * 1024 * 1024 + 1 }), /byte safety budget/);
});

it("closes the XCAF document on output validation or export failure", () => {
  for (const shouldThrow of [false, true]) {
    let closed = 0;
    const fake = { importXCAFFromSTEP() { return { exportGLTF() { if (shouldThrow) throw new Error("export failed"); return new Uint8Array(); }, close() { closed++; } }; } };
    assert.throws(() => exportSTEPAssembly(fake, new ArrayBuffer(0), quality), shouldThrow ? /export failed/ : /byte safety budget/);
    assert.equal(closed, 1);
  }
});

it("cancels pending assembly conversion by terminating the worker once", async () => {
  const controller = new AbortController();
  let started, terminated = 0;
  const ready = new Promise(resolve => { started = resolve; });
  const importer = new STEPImporter(() => ({ ready: Promise.resolve({ importAssembly() { started(); return new Promise(() => {}); } }), terminate() { terminated++; } }));
  const primary = new File(["STEP"], "part.step");
  const pending = importer.import(primary, [primary], options({ signal: controller.signal }));
  await ready; controller.abort(new Error("cancel assembly"));
  await assert.rejects(pending, /cancel assembly/); assert.equal(terminated, 1);
});

it("part isolation and material overrides survive project save and reparse with matching node paths", async () => {
  const imported = await load();
  const assets = new ImportedAssetStore(); assets.register("asset", imported.root);
  const adapter = new ImportedSceneAdapter(new THREE.Scene(), assets);
  const model = createImportedSceneModel({ id: "step-import", assetId: "asset", name: "Assembly", format: "STEP", metadata: { ...imported.metadata, sizeBytes: imported.primary.size }, hierarchy: buildImportedHierarchy(imported.root).nodes });
  const scene = createDefaultScene(); scene.objects = []; scene.imports = [model];
  const material = createMaterialDefinition("step-override", "Override", "metal"); scene.materials.push(material);
  try {
    adapter.applyModel([model], scene.materials);
    const red = imported.root.getObjectByName("Red part");
    const blue = imported.root.getObjectByName("Blue part");
    const redId = red.userData.importedNodeId;
    assert.ok(redId);
    isolateImportedNode([model], model.id, redId); setImportedNodeMaterial([model], model.id, redId, material.id);
    adapter.applyModel([model], scene.materials);
    assert.equal(blue.visible, false); assert.equal(red.visible, true);
    assert.equal(firstMesh(red).material.metalness, material.preview.metalness);
    const sources = new ProjectAssets(); sources.capture("asset", imported.primary, [imported.primary], options());
    const decoded = await decodeProject(await encodeProject(scene, sources, { sourceFile() { return undefined; } }));
    assert.equal(decoded.imports.get("asset").options.stepStructure, "assembly");
    const loaded = await load("colored-nested-assembly.step", decoded.imports.get("asset").options);
    try {
      assert.deepEqual(buildImportedHierarchy(loaded.root).nodes, model.hierarchy);
      assert.deepEqual(decoded.model.imports[0].nodeOverrides, model.nodeOverrides);
      assert.equal(decoded.model.imports[0].isolatedNodeId, redId);
    } finally { disposeLoadedObject(loaded.root); }
  } finally { adapter.dispose(); assets.dispose(); }
});

it("flat mode keeps the legacy one-mesh node path and warning", async () => {
  const imported = await load("colored-nested-assembly.step", { stepStructure: "flat" });
  try {
    assert.equal(imported.root.children.length, 1); assert.equal(imported.root.children[0].isMesh, true);
    assert.equal(imported.metadata.triangleCount, 36);
    assert.ok(imported.warnings.some(item => item.code === "step-assembly-flattened"));
  } finally { disposeLoadedObject(imported.root); }
});

it("legacy project without a STEP mode restores the flat geometry and original node override", async () => {
  const imported = await load("colored-nested-assembly.step", { stepStructure: "flat" });
  try {
    const scene = createDefaultScene(); scene.objects = [];
    scene.imports = [createImportedSceneModel({ id: "legacy", assetId: "legacy-asset", name: "Legacy STEP", format: "STEP", metadata: { ...imported.metadata, sizeBytes: imported.primary.size }, hierarchy: buildImportedHierarchy(imported.root).nodes, nodeOverrides: { "node-0": { visible: false } } })];
    const sources = new ProjectAssets(); sources.capture("legacy-asset", imported.primary, [imported.primary], options({ stepStructure: "flat" }));
    const blob = await encodeProject(scene, sources, { sourceFile() { return undefined; } });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const length = new DataView(bytes.buffer).getUint32(8, true);
    const manifest = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + length)));
    delete manifest.imports[0].options.stepStructure;
    manifest.scene.schemaVersion = 2; delete manifest.scene.review;
    const json = new TextEncoder().encode(JSON.stringify(manifest));
    const prefix = bytes.slice(0, 12); new DataView(prefix.buffer).setUint32(8, json.length, true);
    const decoded = await decodeProject(new Blob([prefix, json, bytes.subarray(12 + length)]));
    assert.equal(decoded.imports.get("legacy-asset").options.stepStructure, "flat");
    const restored = await load("colored-nested-assembly.step", decoded.imports.get("legacy-asset").options);
    try {
      assert.equal(restored.root.children[0].isMesh, true);
      assert.deepEqual(buildImportedHierarchy(restored.root).nodes, decoded.model.imports[0].hierarchy);
      assert.deepEqual(decoded.model.imports[0].nodeOverrides, { "node-0": { visible: false } });
    } finally { disposeLoadedObject(restored.root); }
  } finally { disposeLoadedObject(imported.root); }
});
