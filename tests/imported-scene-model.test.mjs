import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer } from "vite";

let importedModel;
let server;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  importedModel = await server.ssrLoadModule(
    "/src/model/imported-scene-model.ts",
  );
});

after(async () => {
  await server?.close();
});

describe("imported scene model commands", () => {
  it("creates an isolated model and rejects duplicate ids", () => {
    const input = createInput();
    const imports = [];
    const created = importedModel.addImportedScene(imports, input);

    assert.equal(imports[0], created);
    assert.equal(created.name, "Assembly");
    assert.deepEqual(created.transform, {
      position: { x: 4, y: 0, z: 0 },
      rotationDegrees: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    assert.notEqual(created.metadata, input.metadata);
    assert.notEqual(created.warnings, input.warnings);
    assert.notEqual(created.hierarchy, input.hierarchy);

    input.metadata.triangleCount = 999;
    input.warnings[0].message = "changed";
    input.hierarchy[0].name = "changed";
    assert.equal(created.metadata.triangleCount, 12);
    assert.equal(created.warnings[0].message, "Source unit was inferred.");
    assert.equal(created.hierarchy[0].name, "Body");

    assert.throws(
      () => importedModel.addImportedScene(imports, createInput()),
      /Duplicate imported scene id: import-01/,
    );
    assert.throws(
      () =>
        importedModel.addImportedScene(imports, {
          ...createInput(),
          id: "import-02",
        }),
      /Duplicate imported asset id: asset-01/,
    );
    assert.throws(
      () =>
        importedModel.createImportedSceneModel({
          ...createInput(),
          transform: { position: { x: Number.NaN } },
        }),
      /transform must contain only finite values/,
    );
  });

  it("updates identity, visibility, transform, and material mode", () => {
    const imports = [importedModel.createImportedSceneModel(createInput())];

    assert.equal(
      importedModel.renameImportedScene(imports, "import-01", "  Updated assembly  "),
      true,
    );
    assert.equal(imports[0].name, "Updated assembly");
    assert.equal(
      importedModel.renameImportedScene(imports, "import-01", "   "),
      false,
    );
    assert.equal(
      importedModel.setImportedSceneVisibility(imports, "import-01", false),
      true,
    );
    assert.equal(imports[0].visible, false);

    assert.equal(
      importedModel.updateImportedSceneTransform(imports, "import-01", {
        position: { y: 3 },
        rotationDegrees: { z: 45 },
        scale: { x: 2 },
      }),
      true,
    );
    assert.deepEqual(imports[0].transform, {
      position: { x: 4, y: 3, z: 0 },
      rotationDegrees: { x: 0, y: 0, z: 45 },
      scale: { x: 2, y: 1, z: 1 },
    });
    assert.equal(
      importedModel.updateImportedSceneTransform(imports, "import-01", {
        position: { x: Number.NaN },
      }),
      false,
    );
    assert.equal(imports[0].transform.position.x, 4);

    assert.equal(
      importedModel.setImportedSceneMaterialMode(
        imports,
        "import-01",
        "custom",
        " material-01 ",
      ),
      true,
    );
    assert.equal(imports[0].materialMode, "custom");
    assert.equal(imports[0].customMaterialId, "material-01");
    assert.equal(
      importedModel.setImportedSceneMaterialMode(
        imports,
        "import-01",
        "imported",
      ),
      true,
    );
    assert.equal(imports[0].materialMode, "imported");
    assert.equal(imports[0].customMaterialId, "material-01");
    assert.equal(
      importedModel.setImportedSceneMaterialMode(
        imports,
        "import-01",
        "custom",
      ),
      true,
    );
    assert.equal(imports[0].customMaterialId, "material-01");
  });

  it("deletes only the requested imported scene", () => {
    const imports = [importedModel.createImportedSceneModel(createInput())];
    assert.equal(importedModel.deleteImportedScene(imports, "missing"), false);
    assert.equal(importedModel.deleteImportedScene(imports, "import-01"), true);
    assert.deepEqual(imports, []);
  });
});

function createInput() {
  return {
    id: "import-01",
    assetId: "asset-01",
    name: "  Assembly  ",
    format: "STEP",
    transform: { position: { x: 4 } },
    metadata: {
      fileName: "assembly.step",
      format: "STEP",
      objectCount: 2,
      triangleCount: 12,
      materialCount: 1,
      sourceUnit: "mm",
      unit: "m",
      sizeBytes: 512,
    },
    warnings: [
      { code: "unit.inferred", message: "Source unit was inferred." },
    ],
    hierarchy: [
      {
        id: "node-01",
        name: "Body",
        objectType: "Mesh",
        mesh: true,
        triangleCount: 12,
        children: [],
      },
    ],
  };
}
