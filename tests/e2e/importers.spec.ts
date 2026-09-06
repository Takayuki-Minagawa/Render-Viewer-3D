import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const fixture = (name: string) => readFile(new URL(`../fixtures/compressed/${name}`, import.meta.url));

test("local Draco, Meshopt and KTX2 imports use bundled decoders", async ({ page }) => {
  await page.goto("./");
  const requests: string[] = [];
  page.on("request", (request) => { if (/\.wasm(?:$|[?#])/u.test(request.url())) requests.push(request.url()); });
  const inputs = await Promise.all(["Box.gltf", "Box.bin", "triangle-meshopt.gltf", "2d_etc1s.ktx2"].map(async (name) => ({ name, data: [...await fixture(name)] })));
  const result = await page.evaluate(async (inputs) => {
    const { GLTFImporter } = await import("/Render-Viewer-3D/src/importers/GLTFImporter.ts");
    const { configureGLTFRenderer } = await import("/Render-Viewer-3D/src/importers/gltf-decoders.ts");
    const { DEFAULT_IMPORT_OPTIONS } = await import("/Render-Viewer-3D/src/importers/types.ts");
    const THREE = await import("/Render-Viewer-3D/node_modules/three/build/three.module.js");
    const renderer = new THREE.WebGLRenderer();
    configureGLTFRenderer(renderer);
    const files = inputs.map(({ name, data }) => new File([new Uint8Array(data)], name));
    const importer = new GLTFImporter();
    const draco = await importer.import(files[0], files.slice(0, 2), DEFAULT_IMPORT_OPTIONS);
    const meshopt = await importer.import(files[2], [files[2]], DEFAULT_IMPORT_OPTIONS);
    const json = JSON.parse(await files[2].text());
    json.extensionsUsed.push("KHR_texture_basisu"); json.extensionsRequired.push("KHR_texture_basisu");
    json.images = [{ uri: "2d_etc1s.ktx2", mimeType: "image/ktx2" }];
    json.textures = [{ extensions: { KHR_texture_basisu: { source: 0 } } }];
    json.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }];
    json.meshes[0].primitives[0].material = 0;
    const ktxFile = new File([JSON.stringify(json)], "textured.gltf");
    const ktx = await importer.import(ktxFile, [ktxFile, files[3]], DEFAULT_IMPORT_OPTIONS);
    let texture;
    ktx.root.traverse((node) => { if (node.isMesh) texture = node.material.map; });
    const output = { draco: draco.metadata.triangleCount, meshopt: meshopt.metadata.triangleCount, textureWidth: texture?.image?.width, compressed: texture?.isCompressedTexture === true };
    renderer.dispose(); configureGLTFRenderer(null);
    return output;
  }, inputs);
  expect(result.draco).toBe(12);
  expect(result.meshopt).toBe(1);
  expect(result.textureWidth).toBeGreaterThan(0);
  expect(result.compressed).toBe(true);
  expect(requests.some((url) => /draco_decoder.*\.wasm(?:$|[?#])/u.test(url))).toBe(true);
  expect(requests.some((url) => /basis_transcoder.*\.wasm(?:$|[?#])/u.test(url))).toBe(true);
  expect(requests.every((url) => new URL(url).origin === new URL(page.url()).origin && new URL(url).pathname.startsWith("/Render-Viewer-3D/"))).toBe(true);
});

test("OBJ MTL textures finish loading locally, STL worker returns geometry", async ({ page }) => {
  await page.goto("./");
  const result = await page.evaluate(async () => {
    const { OBJImporter } = await import("/Render-Viewer-3D/src/importers/OBJImporter.ts");
    const { STLImporter } = await import("/Render-Viewer-3D/src/importers/STLImporter.ts");
    const { DEFAULT_IMPORT_OPTIONS } = await import("/Render-Viewer-3D/src/importers/types.ts");
    const canvas = document.createElement("canvas"); canvas.width = 2; canvas.height = 2;
    canvas.getContext("2d").fillRect(0,0,2,2);
    const png = await new Promise<Blob>((resolve) => canvas.toBlob(resolve));
    const primary = new File(["mtllib colors.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nusemtl Black\nf 1/1 2/2 3/3"], "triangle.obj");
    const mtl = new File(["newmtl Black\nKd 1 1 1\nmap_Kd color.png"], "colors.mtl");
    const texture = new File([png], "color.png", { type: "image/png" });
    const imported = await new OBJImporter().import(primary, [primary, mtl, texture], DEFAULT_IMPORT_OPTIONS);
    let width = 0; imported.root.traverse((node) => { if (node.isMesh) width = node.material.map.image.width; });
    const triangle = "facet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\n";
    const stl = new File([`solid test\n${triangle.repeat(20_000)}endsolid test\n`], "worker.stl");
    const parsed = await new STLImporter().import(stl, [stl], DEFAULT_IMPORT_OPTIONS);
    return { width, triangles: parsed.metadata.triangleCount };
  });
  expect(result).toEqual({ width: 2, triangles: 20_000 });
});

test("STEP loads and tessellates the synthetic box using the real OCCT Worker and WASM", async ({ page }) => {
  await page.goto("./");
  const step = await readFile(new URL("../fixtures/step/box-10x20x30mm.step", import.meta.url), "utf8");
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const result = await page.evaluate(async (step) => {
    const { STEPImporter } = await import("/Render-Viewer-3D/src/importers/STEPImporter.ts");
    const { DEFAULT_IMPORT_OPTIONS } = await import("/Render-Viewer-3D/src/importers/types.ts");
    const file = new File([step], "box.step");
    const imported = await new STEPImporter().import(file, [file], { ...DEFAULT_IMPORT_OPTIONS, centerModel: false, placeOnGround: false });
    const THREE = await import("/Render-Viewer-3D/node_modules/three/build/three.module.js");
    return { triangles: imported.metadata.triangleCount, unit: imported.metadata.unit, sourceUnit: imported.metadata.sourceUnit, size: new THREE.Box3().setFromObject(imported.root).getSize(new THREE.Vector3()).toArray() };
  }, step);
  expect(result.triangles).toBe(12);
  expect(result.unit).toBe("meter");
  expect(result.sourceUnit).toBe("millimeter");
  [0.01,0.02,0.03].forEach((value,index) => expect(result.size[index]).toBeCloseTo(value, 6));
  expect(requests.some((url) => /step-worker-entry/u.test(url))).toBe(true);
  expect(requests.some((url) => /occt-wasm\.wasm/u.test(url))).toBe(true);
});
