import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as THREE from "three";
import { createServer } from "vite";

let ImportController;
let buildImportedHierarchy;
let server;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ ImportController, buildImportedHierarchy } = await server.ssrLoadModule(
    "/src/app/import-controller.ts",
  ));
});

after(async () => {
  await server?.close();
});

describe("ImportController", () => {
  it("registers a runtime asset and publishes a serializable scene record", async () => {
    const root = createImportedRoot();
    const manager = {
      canImport: (file) => file.name.toLowerCase().endsWith(".foo"),
      import: async () => ({
        root,
        metadata: {
          fileName: "assembly.foo",
          format: "FOO",
          objectCount: 1,
          triangleCount: 1,
          materialCount: 1,
          unit: "meter",
        },
        warnings: [{ code: "fixture", message: "Fixture warning." }],
      }),
    };
    const assets = createAssetStoreDouble();
    const sceneStore = createSceneStoreDouble();
    sceneStore.snapshot.materials.push({
      id: "import-assembly-1-material-1",
    });
    const selected = [];
    const fitted = [];
    const controller = new ImportController(
      manager,
      assets,
      sceneStore,
      { setSelectedObjectId: (id) => selected.push(id) },
      { fitToObject: (id) => (fitted.push(id), true) },
    );

    const model = await controller.importFiles(
      [new File(["fixture"], "assembly.foo")],
      defaultOptions(),
    );

    assert.match(model.id, /^import-assembly-\d+$/u);
    assert.equal(model.assetId, `${model.id}-asset`);
    assert.equal(assets.registered.get(model.assetId), root);
    assert.equal(sceneStore.snapshot.imports[0].id, model.id);
    assert.notEqual(sceneStore.snapshot.imports[0], model);
    assert.equal(sceneStore.snapshot.materials.length, 2);
    assert.equal(
      model.customMaterialId,
      "import-assembly-1-material-1-2",
    );
    assert.equal(sceneStore.snapshot.materials[1].category, "custom");
    assert.deepEqual(selected, [model.id]);
    assert.deepEqual(fitted, [model.id]);
    assert.equal(model.hierarchy[0].name, "Assembly");
    assert.equal(model.hierarchy[0].children[0].triangleCount, 1);
    assert.equal(model.metadata.sizeBytes, 7);
  });

  it("rejects ambiguous primary files and delegates unsupported errors", async () => {
    const unsupportedCalls = [];
    const manager = {
      canImport: (file) => file.name.endsWith(".foo"),
      import: async (primary) => {
        unsupportedCalls.push(primary.name);
        throw new Error(`Unsupported model format: ${primary.name}`);
      },
    };
    const controller = new ImportController(
      manager,
      createAssetStoreDouble(),
      createSceneStoreDouble(),
      { setSelectedObjectId() {} },
      { fitToObject: () => true },
    );

    await assert.rejects(
      controller.importFiles([new File(["x"], "notes.txt")], defaultOptions()),
      /Unsupported model format/,
    );
    assert.deepEqual(unsupportedCalls, ["notes.txt"]);
    await assert.rejects(
      controller.importFiles(
        [new File(["a"], "a.foo"), new File(["b"], "b.foo")],
        defaultOptions(),
      ),
      /one supported model file at a time/,
    );
  });

  it("rolls back the runtime asset if the scene transaction fails", async () => {
    const root = createImportedRoot();
    const assets = createAssetStoreDouble();
    const sceneStore = createSceneStoreDouble();
    sceneStore.update = () => {
      throw new Error("scene rejected");
    };
    const controller = new ImportController(
      {
        canImport: () => true,
        import: async () => ({
          root,
          metadata: { fileName: "bad.foo", format: "FOO" },
          warnings: [],
        }),
      },
      assets,
      sceneStore,
      { setSelectedObjectId() {} },
      { fitToObject: () => true },
    );

    await assert.rejects(
      controller.importFiles([new File(["bad"], "bad.foo")], defaultOptions()),
      /scene rejected/,
    );
    assert.equal(assets.deleted.length, 1);
    assert.equal(assets.registered.size, 0);
  });
});

describe("buildImportedHierarchy", () => {
  it("creates stable path ids and triangle summaries", () => {
    const hierarchy = buildImportedHierarchy(createImportedRoot());
    assert.equal(hierarchy.truncated, false);
    assert.deepEqual(
      hierarchy.nodes.map(({ id, name }) => ({ id, name })),
      [{ id: "node-0", name: "Assembly" }],
    );
    assert.equal(hierarchy.nodes[0].children[0].id, "node-0-0");
    assert.equal(hierarchy.nodes[0].children[0].triangleCount, 1);
  });
});

function createImportedRoot() {
  const root = new THREE.Group();
  const assembly = new THREE.Group();
  assembly.name = "Assembly";
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.name = "Body";
  assembly.add(mesh);
  root.add(assembly);
  return root;
}

function createAssetStoreDouble() {
  return {
    registered: new Map(),
    deleted: [],
    register(assetId, root) {
      this.registered.set(assetId, root);
    },
    delete(assetId) {
      this.deleted.push(assetId);
      return this.registered.delete(assetId);
    },
  };
}

function createSceneStoreDouble() {
  return {
    snapshot: { objects: [], imports: [], materials: [] },
    getSnapshot() {
      return this.snapshot;
    },
    update(recipe) {
      const draft = structuredClone(this.snapshot);
      recipe(draft);
      this.snapshot = draft;
    },
  };
}

function defaultOptions() {
  return {
    unit: "auto",
    coordinateSystem: "auto",
    centerModel: true,
    placeOnGround: true,
    quality: "medium",
  };
}
