import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { createServer } from "vite";

let createImportedInspectorBuildKey;
let createObjectTreeRenderKey;
let runImportActionSafely;
let server;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ createImportedInspectorBuildKey, createObjectTreeRenderKey } =
    await server.ssrLoadModule("/src/ui/scene-editor-view.ts"));
  ({ runImportActionSafely } =
    await server.ssrLoadModule("/src/ui/app-shell.ts"));
});

after(async () => {
  await server?.close();
});

const object = {
  id: "box-1",
  name: "Box",
  visible: true,
  geometry: { type: "box" },
  materialId: "material-1",
  transform: {
    position: { x: 0, y: 0, z: 0 },
    rotationDegrees: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  },
};

const imported = {
  id: "import-1",
  assetId: "asset-1",
  name: "Assembly",
  visible: true,
  format: "glTF",
  materialMode: "imported",
  customMaterialId: null,
  metadata: { objectCount: 3, triangleCount: 12 },
  warnings: [],
  hierarchy: [
    {
      id: "node-0",
      name: "Part",
      objectType: "Mesh",
      mesh: true,
      triangleCount: 12,
      children: [],
    },
  ],
  transform: object.transform,
};

describe("scene editor render keys", () => {
  it("keeps the large object tree stable for non-tree scene updates", () => {
    const baseline = createObjectTreeRenderKey([object], [imported], "ja");
    const movedObject = structuredClone(object);
    movedObject.transform.position.x = 4;
    movedObject.materialId = "material-2";
    const materialOverride = {
      ...imported,
      materialMode: "custom",
      customMaterialId: "material-2",
      transform: {
        ...imported.transform,
        position: { x: 9, y: 8, z: 7 },
      },
    };

    assert.equal(
      createObjectTreeRenderKey([movedObject], [materialOverride], "ja"),
      baseline,
    );
    assert.notEqual(
      createObjectTreeRenderKey(
        [{ ...object, name: "Renamed box" }],
        [imported],
        "ja",
      ),
      baseline,
    );
    assert.notEqual(
      createObjectTreeRenderKey(
        [object],
        [{ ...imported, visible: false }],
        "ja",
      ),
      baseline,
    );
    assert.notEqual(createObjectTreeRenderKey([object], [imported], "en"), baseline);
  });

  it("does not rebuild the imported inspector for mode or value changes", () => {
    const materials = [
      { id: "material-1", name: "Default" },
      { id: "material-2", name: "Metal" },
    ];
    const baseline = createImportedInspectorBuildKey(imported, materials, "ja");

    assert.equal(
      createImportedInspectorBuildKey(
        {
          ...imported,
          materialMode: "custom",
          customMaterialId: "material-2",
        },
        materials,
        "ja",
      ),
      baseline,
    );
    assert.equal(
      createImportedInspectorBuildKey(
        { ...imported, name: "Renamed assembly" },
        materials,
        "ja",
      ),
      baseline,
    );
    assert.notEqual(
      createImportedInspectorBuildKey(
        imported,
        [{ id: "material-1", name: "Renamed" }, materials[1]],
        "ja",
      ),
      baseline,
    );
    assert.notEqual(
      createImportedInspectorBuildKey(
        { ...imported, warnings: [{ code: "test", message: "Changed" }] },
        materials,
        "ja",
      ),
      baseline,
    );
  });
});

describe("import UI lifecycle", () => {
  it("settles failures and suppresses completion after disposal", async () => {
    const failure = new Error("failed");
    assert.deepEqual(
      await runImportActionSafely(async () => {
        throw failure;
      }, () => true),
      { kind: "error", error: failure },
    );

    let release;
    let active = true;
    const pending = runImportActionSafely(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      () => active,
    );
    await Promise.resolve();
    active = false;
    release();
    assert.deepEqual(await pending, { kind: "disposed" });
  });
});

describe("import hierarchy accessibility", () => {
  it("does not expose child proxy buttons as independently pressed", async () => {
    const source = await readFile(
      new URL("../src/ui/scene-editor-view.ts", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /select\.setAttribute\("aria-pressed",\s*"false"\)/u,
    );
  });
});
