import assert from "node:assert/strict";
import { File } from "node:buffer";
import { after, before, describe, it } from "node:test";
import { createServer } from "vite";
import * as THREE from "three";
import { readFile } from "node:fs/promises";
let server, disposeLoadedObject, OBJImporter, LocalResourceResolver, inspectGLTFSource, inspectKTX2Header, assertImportedTextureBudget, attachGLTFDecoders, configureGLTFRenderer, parseSTL, defaults;
before(async () => {
  server = await createServer({ appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  ({ disposeLoadedObject } = await server.ssrLoadModule("/src/importers/loader-resource-wait.ts"));
  ({ OBJImporter } = await server.ssrLoadModule("/src/importers/OBJImporter.ts"));
  ({ LocalResourceResolver } = await server.ssrLoadModule("/src/importers/resource-resolver.ts"));
  ({ inspectGLTFSource, inspectKTX2Header } = await server.ssrLoadModule("/src/importers/gltf-preflight.ts"));
  ({ assertImportedTextureBudget } = await server.ssrLoadModule("/src/importers/texture-budget.ts"));
  ({ attachGLTFDecoders, configureGLTFRenderer } = await server.ssrLoadModule("/src/importers/gltf-decoders.ts"));
  ({ parseSTL } = await server.ssrLoadModule("/src/importers/stl-parser.ts"));
  ({ DEFAULT_IMPORT_OPTIONS: defaults } = await server.ssrLoadModule("/src/importers/types.ts"));
});
after(async () => { configureGLTFRenderer(null); await server.close(); });
const source = "mtllib fixture.mtl\no Triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl Red\nf 1 2 3\n";
const opts = () => ({ ...defaults, centerModel: false, placeOnGround: false });
function firstMesh(root) { let result; root.traverse((node) => { if (!result && node.isMesh) result = node; }); return result; }
function file(text, path) { const f = new File([text], path.split("/").at(-1)); Object.defineProperty(f, "webkitRelativePath", { value: path }); return f; }
describe("OBJ MTL", () => {
  it("preserves selected MTL colors and shininess and reports PBR approximation", async () => {
    const primary = file(source, "model/triangle.obj");
    const mtl = file("newmtl Red\nKd 1 0 0\nNs 50\nd 0.7", "model/fixture.mtl");
    const imported = await new OBJImporter().import(primary, [primary, mtl], opts());
    const material = firstMesh(imported.root).material;
    assert.equal(material.color.getHex(), 0xff0000);
    assert.equal(material.shininess, 50);
    assert.equal(material.opacity, 0.7);
    assert.equal(imported.warnings[0].code, "obj-mtl-pbr-approximation");
  });
  it("supports multiple library references and filenames containing spaces", async () => {
    const primary = file(source.replace("fixture.mtl", "one.mtl two.mtl"), "model/triangle.obj");
    const a = file("newmtl Red\nKd 0 1 0", "model/one.mtl");
    const b = file("newmtl Red\nKd 0 0 1", "model/two.mtl");
    assert.equal(firstMesh((await new OBJImporter().import(primary, [primary, a, b], opts())).root).material.color.getHex(), 0x0000ff);
    const spaced = file(source.replace("fixture.mtl", "material with spaces.mtl"), "triangle.obj");
    const material = file("newmtl Red\nKd 0 1 0", "material with spaces.mtl");
    assert.equal(firstMesh((await new OBJImporter().import(spaced, [spaced, material], opts())).root).material.color.getHex(), 0x00ff00);
  });
  it("rejects missing, external, and undefined material references", async () => {
    const primary = file(source, "triangle.obj");
    await assert.rejects(new OBJImporter().import(primary, [primary], opts()), /not selected/);
    const external = file(source.replace("fixture.mtl", "https://example.com/fixture.mtl"), "triangle.obj");
    await assert.rejects(new OBJImporter().import(external, [external], opts()), /External model resources/);
    const mtl = file("newmtl Blue\nKd 0 0 1", "fixture.mtl");
    await assert.rejects(new OBJImporter().import(primary, [primary, mtl], opts()), /material is not defined/);
  });
  it("resolves texture paths relative to MTL instead of OBJ with no basename ambiguity", () => {
    const a = file("a", "model/mats/textures/color.png");
    const b = file("b", "model/other/color.png");
    const mtl = file("", "model/mats/fixture.mtl");
    const resolver = new LocalResourceResolver([mtl, a, b], mtl);
    assert.equal(resolver.resolveFile("textures/color.png"), a);
    assert.throws(() => resolver.resolveFile("color.png"), /Ambiguous/);
    resolver.dispose();
  });
});
describe("compressed glTF boundaries", () => {
  it("attaches bundled Meshopt and base-prefixed Draco/KTX2 without letting models fetch decoder URLs", async () => {
    const resolver = new LocalResourceResolver([]);
    const loader = { setDRACOLoader(value) { this.draco = value; return this; }, setMeshoptDecoder(value) { this.meshopt = value; return this; }, setKTX2Loader(value) { this.ktx2 = value; return this; } };
    configureGLTFRenderer({ extensions: { has() { return false; } } });
    const dispose = await attachGLTFDecoders(loader, resolver);
    assert.ok(loader.meshopt.supported);
    assert.match(loader.draco.decoderPaths.wasm, /\/draco\/gltf\/draco_decoder.wasm$/);
    assert.equal(loader.ktx2.transcoderPath, "");
    assert.throws(() => loader.ktx2.load("https://example.com/image.ktx2", () => {}), /External model resources/);
    assert.throws(() => resolver.resolve("/decoders/basis/basis_transcoder.wasm"), /not selected/);
    dispose(); configureGLTFRenderer(null);
  });
  it("rejects expansion, accessor, cyclic/deep hierarchy, and external image allocations before decode", async () => {
    const resolver = new LocalResourceResolver([]);
    for (const [document, pattern] of [
      [{ buffers: [{ byteLength: 129 * 1024 * 1024 }] }, /128 MiB/],
      [{ bufferViews: [{ extensions: { EXT_meshopt_compression: { count: 20_000_000, byteStride: 12 } } }] }, /128 MiB/],
      [{ accessors: [{ count: 2_000_001 }] }, /geometry safety/],
      [{ nodes: [{ children: [1] }, { children: [0] }] }, /cyclic/],
      [{ nodes: Array.from({ length: 300 }, (_, i) => ({ children: i < 299 ? [i + 1] : [] })) }, /depth/],
      [{ images: [{ uri: "https://example.com/image.png" }] }, /External/],
    ]) await assert.rejects(inspectGLTFSource(JSON.stringify({ asset: { version: "2.0" }, ...document }), resolver), pattern);
  });
  it("rejects compact DAG and repeated scene roots whose expanded instances exceed the budget", async () => {
    const resolver = new LocalResourceResolver([]);
    const chain = Array.from({ length: 17 }, (_, index) => ({ children: index < 16 ? [index + 1, index + 1] : [] }));
    await assert.rejects(inspectGLTFSource(JSON.stringify({ nodes: chain, scenes: [{ nodes: [0] }] }), resolver), /expanded node instances/);
    await assert.rejects(inspectGLTFSource(JSON.stringify({ nodes: [{ children: Array.from({ length: 25000 }, () => 1) }, {}], scenes: [{ nodes: [0] }, { nodes: [0] }] }), resolver), /expanded node instances/);
    await assert.rejects(inspectGLTFSource(JSON.stringify({ nodes: [{ mesh: 0 }], meshes: [{ primitives: Array(10001).fill({}) }], scenes: [{ nodes: [0] }] }), resolver), /expanded node instances/);
  });
  it("disposes inactive scene resources while retaining shared geometry, materials and image bitmaps", () => {
    const active = new THREE.Group(), unused = new THREE.Group();
    let closes = 0, uniqueCloses = 0, sharedDisposes = 0, uniqueDisposes = 0;
    const texture = new THREE.Texture({ close() { closes++; } });
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const geometry = new THREE.BoxGeometry();
    for (const value of [texture, material, geometry]) value.addEventListener("dispose", () => sharedDisposes++);
    active.add(new THREE.Mesh(geometry, material)); unused.add(new THREE.Mesh(geometry, material));
    const uniqueTexture = new THREE.Texture({ close() { uniqueCloses++; } });
    const uniqueMaterial = new THREE.MeshStandardMaterial({ map: uniqueTexture });
    const uniqueGeometry = new THREE.BoxGeometry();
    for (const value of [uniqueTexture, uniqueMaterial, uniqueGeometry]) value.addEventListener("dispose", () => uniqueDisposes++);
    unused.add(new THREE.Mesh(uniqueGeometry, uniqueMaterial));
    disposeLoadedObject(unused, [active]);
    assert.equal(sharedDisposes, 0); assert.equal(closes, 0);
    assert.equal(uniqueDisposes, 3); assert.equal(uniqueCloses, 1);
    disposeLoadedObject(active); assert.equal(sharedDisposes, 3); assert.equal(closes, 1);
  });
  it("checks decoded KTX2 pixel allocation before transcoding", () => {
    const data = new Uint8Array(80);
    data.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(data.buffer);
    view.setUint32(20, 64, true); view.setUint32(24, 64, true); view.setUint32(36, 1, true);
    assert.equal(inspectKTX2Header(data), 4096);
    view.setUint32(20, 32768, true);
    assert.throws(() => inspectKTX2Header(data), /image safety budget/);
  });
  it("counts shared texture only once but rejects excessive decoded pixels", () => {
    const texture = new THREE.Texture({ width: 4096, height: 4096 });
    const material = new THREE.MeshStandardMaterial({ map: texture, normalMap: texture });
    const root = new THREE.Group(); root.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
    assert.doesNotThrow(() => assertImportedTextureBudget(root, "test"));
    texture.image.width = 16384;
    assert.throws(() => assertImportedTextureBudget(root, "test"), /image safety budget/);
  });
  it("ships valid wasm binaries for the bundled decoders", async () => {
    for (const name of ["draco/gltf/draco_decoder.wasm", "basis/basis_transcoder.wasm"]) {
      const bytes = await readFile(new URL(`../node_modules/three/examples/jsm/libs/${name}`, import.meta.url));
      assert.ok(WebAssembly.validate(bytes));
    }
  });
});
describe("STL worker lifecycle", () => {
  it("transfers large source buffer, reconstructs attributes, and terminates after success", async () => {
    const previous = globalThis.Worker;
    let worker;
    globalThis.Worker = class {
      constructor(url, options) { worker = this; assert.match(String(url), /stl-worker-entry/); assert.equal(options.type, "module"); }
      terminate() { this.terminated = true; }
      postMessage(data, transfer) { assert.equal(transfer[0], data); queueMicrotask(() => this.onmessage({ data: { attributes: { position: { array: new Float32Array([0,0,0, 1,0,0, 0,1,0]), itemSize: 3, normalized: false } } } })); }
    };
    try { const result = await parseSTL(new ArrayBuffer(1024 * 1024)); assert.equal(result.getAttribute("position").count, 3); assert.ok(worker.terminated); }
    finally { if (previous) globalThis.Worker = previous; else delete globalThis.Worker; }
  });
  it("terminates on abort and preserves the cancellation reason", async () => {
    const previous = globalThis.Worker;
    let worker;
    globalThis.Worker = class { constructor() { worker = this; } postMessage() {} terminate() { this.terminated = true; } };
    try {
      const controller = new AbortController(); const reason = new Error("cancel-test");
      const pending = parseSTL(new ArrayBuffer(1024 * 1024), controller.signal); controller.abort(reason);
      await assert.rejects(pending, (error) => error === reason); assert.ok(worker.terminated);
    } finally { if (previous) globalThis.Worker = previous; else delete globalThis.Worker; }
  });
});
