import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { parseHTML } from "linkedom";
import { createServer } from "vite";

let server, MaterialLibraryView, SceneEditorView, createDefaultSceneModel, createImportedSceneModel;
const previousGlobals = new Map();

before(async () => {
  const { window } = parseHTML("<html><body></body></html>");
  for (const name of ["document", "Element", "HTMLElement", "HTMLInputElement", "HTMLSelectElement"]) {
    previousGlobals.set(name, globalThis[name]);
    globalThis[name] = window[name];
  }
  // Linkedom does not implement the browser select.value setter.
  Object.defineProperty(HTMLSelectElement.prototype, "value", {
    configurable: true,
    get() { return this.querySelector("option[selected]")?.value ?? this.querySelector("option")?.value ?? ""; },
    set(value) {
      for (const option of this.querySelectorAll("option")) option.removeAttribute("selected");
      [...this.querySelectorAll("option")].find((option) => option.value === value)?.setAttribute("selected", "");
    },
  });
  server = await createServer({ appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  ({ MaterialLibraryView } = await server.ssrLoadModule("/src/ui/material-library-view-base.ts"));
  ({ SceneEditorView } = await server.ssrLoadModule("/src/ui/scene-editor-view.ts"));
  ({ createDefaultSceneModel } = await server.ssrLoadModule("/src/model/default-scene.ts"));
  ({ createImportedSceneModel } = await server.ssrLoadModule("/src/model/imported-scene-model.ts"));
});

after(async () => {
  await server?.close();
  for (const [name, value] of previousGlobals) {
    if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
  }
});

function createRoot() {
  const root = document.createElement("div");
  root.innerHTML = `<div class="app-shell"><div data-object-list></div><div data-light-list></div>
    <div data-camera-item><strong></strong><small></small></div><b data-object-count></b><b data-light-count></b>
    <h2 data-inspector-title></h2><span data-inspector-badge></span><div data-inspector-body></div></div>`;
  document.body.append(root);
  return root;
}

function assignments(scene) {
  return [
    ...scene.objects.map(({ id, name, materialId }) => ({ id, name, materialId })),
    ...scene.imports.flatMap((item) => [
      ...(item.customMaterialId ? [{ id: item.id, name: item.name, materialId: item.customMaterialId }] : []),
      ...Object.entries(item.nodeOverrides ?? {}).flatMap(([id, override]) => override.materialId
        ? [{ id: `${item.id}/${id}`, name: `${item.name} / ${id}`, materialId: override.materialId }]
        : []),
    ]),
  ];
}

it("filters capabilities without replacing search, support, or the detail shell, including the next scene render", async () => {
  const root = createRoot();
  try {
    const scene = createDefaultSceneModel();
    const view = new MaterialLibraryView(root);
    view.render(scene.materials, assignments(scene), scene.objects[0].id, "en");
    view.handleUiClick(root.querySelector('[data-material-tab="advanced"]'));
    await Promise.resolve();
    const search = root.querySelector("[data-material-capability-search]");
    const support = root.querySelector("[data-material-capability-support]");
    const heading = root.querySelector("[data-material-detail-heading]");
    const groups = root.querySelector(".material-capability-groups");
    const initialCount = groups.querySelectorAll(".material-capability-row").length;

    search.value = "rough";
    assert.equal(view.handleUiInput(search), true);
    const roughCount = groups.querySelectorAll(".material-capability-row").length;
    assert.ok(roughCount > 0 && roughCount < initialCount);
    assert.match(groups.textContent, /Roughness/);
    assert.equal(root.querySelector("[data-material-capability-search]"), search);
    assert.equal(root.querySelector("[data-material-detail-heading]"), heading);

    search.value = "abrough";
    view.handleUiInput(search);
    assert.equal(groups.querySelectorAll(".material-capability-row").length, 0);
    assert.ok(groups.querySelector(".material-capability-empty"));
    search.value = "rough";
    view.handleUiInput(search);
    support.value = "direct";
    view.handleUiInput(support);
    assert.equal(root.querySelector("[data-material-capability-support]"), support);
    assert.ok(groups.querySelectorAll(".material-capability-row").length < roughCount);

    // A scene publication after filtering must use the updated detail cache key.
    view.render(structuredClone(scene.materials), assignments(scene), scene.objects[0].id, "en");
    assert.equal(root.querySelector("[data-material-capability-search]"), search);
    assert.equal(root.querySelector("[data-material-capability-support]"), support);
    assert.equal(root.querySelector(".material-capability-groups"), groups);
    assert.equal(search.value, "rough");
    assert.equal(support.value, "direct");
  } finally { root.remove(); }
});

it("keeps inspector and library usage equal for primitive, imported root, and node references as assignments change", () => {
  const root = createRoot();
  try {
    const scene = createDefaultSceneModel();
    const object = scene.objects[0];
    const editorState = { selectedObjectId: object.id, transformMode: "translate" };
    const editor = new SceneEditorView(root);
    const library = new MaterialLibraryView(root);
    const render = (expected, locale = "en") => {
      editor.render(scene, editorState, locale);
      library.render(scene.materials, assignments(scene), object.id, locale);
      const label = locale === "en" ? "Used by" : "使用中";
      assert.match(root.querySelector("[data-inspector-material-meta]").textContent, new RegExp(`${label} ${expected}$`));
      assert.match(root.querySelector(`[data-material-select="${object.materialId}"] small`).textContent, new RegExp(`${label} ${expected}$`));
      assert.match(root.querySelector("#material-usage-note").textContent, new RegExp(`${label} ${expected}`));
    };
    render(1);
    const inspectorMeta = root.querySelector("[data-inspector-material-meta]");
    scene.imports.push(createImportedSceneModel({
      id: "import-1", assetId: "asset-1", name: "Assembly", format: "OBJ",
      materialMode: "custom", customMaterialId: object.materialId,
      metadata: { fileName: "assembly.obj", format: "OBJ", objectCount: 1, triangleCount: 1, materialCount: 1, sizeBytes: 48 },
      hierarchy: [{ id: "0", name: "Part", objectType: "Mesh", mesh: true, triangleCount: 1, children: [] }],
      nodeOverrides: { "0": { materialId: object.materialId } },
    }));
    render(3);
    assert.equal(root.querySelector("[data-inspector-material-meta]"), inspectorMeta);
    render(3, "ja"); // Also covers rebuilding the inspector with mixed references.
    delete scene.imports[0].nodeOverrides["0"];
    render(2, "ja");
    scene.imports[0].materialMode = "imported";
    scene.imports[0].customMaterialId = null;
    render(1, "ja");
  } finally { root.remove(); }
});
