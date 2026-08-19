import assert from "node:assert/strict";
import { File } from "node:buffer";
import { after, before, describe, it } from "node:test";
import * as THREE from "three";
import { createServer } from "vite";

let server;
let ImportManager;
let LocalResourceResolver;
let collectModelStatistics;
let normalizeImportedRoot;
let DEFAULT_IMPORT_OPTIONS;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });

  ({ ImportManager } = await server.ssrLoadModule(
    "/src/importers/ImportManager.ts",
  ));
  ({ LocalResourceResolver } = await server.ssrLoadModule(
    "/src/importers/resource-resolver.ts",
  ));
  ({ collectModelStatistics, normalizeImportedRoot } =
    await server.ssrLoadModule("/src/importers/normalization.ts"));
  ({ DEFAULT_IMPORT_OPTIONS } = await server.ssrLoadModule(
    "/src/importers/types.ts",
  ));
});

after(async () => {
  await server?.close();
});

function file(name, contents = "") {
  return new File([contents], name);
}

function options(overrides = {}) {
  return { ...DEFAULT_IMPORT_OPTIONS, ...overrides };
}

function assertNear(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

describe("ImportManager and importer registry", () => {
  it("derives extension support and accept values from registered importers", () => {
    const manager = new ImportManager();

    assert.deepEqual(manager.supportedExtensions, [
      "gltf",
      "glb",
      "obj",
      "stl",
      "step",
      "stp",
    ]);
    assert.equal(manager.accept, ".gltf,.glb,.obj,.stl,.step,.stp");
    assert.equal(manager.findImporter(file("PART.STEP")).id, "step");
    assert.equal(manager.findImporter(file("scene.GLB")).id, "gltf");
    assert.equal(manager.canImport(file("mesh.unknown")), false);
  });

  it("supports injected importers without changing the manager", async () => {
    const imported = {
      root: new THREE.Group(),
      metadata: { fileName: "shape.foo", format: "FOO" },
      warnings: [],
    };
    const plugin = {
      id: "foo",
      name: "Foo",
      extensions: ["foo"],
      experimental: true,
      canImport: (candidate) => candidate.name.endsWith(".foo"),
      import: async () => imported,
    };
    const manager = new ImportManager([plugin]);

    assert.equal(manager.accept, ".foo");
    assert.equal(
      await manager.import(file("shape.foo"), [], options()),
      imported,
    );
  });

  it("reports unsupported and extensionless files clearly", async () => {
    const manager = new ImportManager();

    await assert.rejects(
      manager.import(file("drawing.dwg")),
      /Unsupported model format: \.dwg/u,
    );
    await assert.rejects(
      manager.import(file("README")),
      /file without an extension/u,
    );
  });
});

describe("import normalization", () => {
  it("normalizes millimeters, centers the model, and places it on Y=0", () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1000, 2000, 500),
      new THREE.MeshStandardMaterial(),
    );
    mesh.position.set(3000, 4000, -2000);
    root.add(mesh);

    const childPosition = mesh.position.clone();
    const warnings = normalizeImportedRoot(
      root,
      options({ unit: "auto", coordinateSystem: "y-up" }),
      [],
      { sourceUnit: "millimeter", sourceCoordinateSystem: "y-up" },
    );
    const bounds = new THREE.Box3().setFromObject(root);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());

    assertNear(size.x, 1);
    assertNear(size.y, 2);
    assertNear(size.z, 0.5);
    assertNear(center.x, 0);
    assertNear(center.z, 0);
    assertNear(bounds.min.y, 0);
    assert.deepEqual(mesh.position, childPosition);
    assert.deepEqual(warnings, []);
    assert.equal(mesh.castShadow, true);
    assert.equal(mesh.receiveShadow, true);
  });

  it("maps a Z-up source to the application's Y-up coordinates", () => {
    const root = new THREE.Group();
    const direction = new THREE.Vector3(0, 0, 1);

    normalizeImportedRoot(
      root,
      options({
        unit: "meter",
        coordinateSystem: "z-up",
        centerModel: false,
        placeOnGround: false,
      }),
    );
    direction.applyQuaternion(root.quaternion);

    assertNear(direction.x, 0);
    assertNear(direction.y, 1);
    assertNear(direction.z, 0);
  });

  it("skips origin correction for non-finite bounds", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [Number.NaN, 0, 0, 1, 0, 0, 0, 1, 0],
        3,
      ),
    );
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));

    const warnings = normalizeImportedRoot(
      root,
      options({ unit: "meter", coordinateSystem: "y-up" }),
    );

    assert.deepEqual(warnings.map(({ code }) => code), ["non-finite-bounds"]);
    assert.deepEqual(root.position.toArray(), [0, 0, 0]);
  });

  it("adds fallback warnings, computes normals, and counts unique materials", () => {
    const material = new THREE.MeshStandardMaterial();
    const nonIndexed = new THREE.BufferGeometry();
    nonIndexed.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [0, 0, 0, 1, 0, 0, 0, 1, 0],
        3,
      ),
    );
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
        3,
      ),
    );
    indexed.setIndex([0, 1, 2, 0, 2, 3]);
    const root = new THREE.Group();
    root.add(
      new THREE.Mesh(nonIndexed, material),
      new THREE.Mesh(indexed, material),
    );

    const warnings = normalizeImportedRoot(
      root,
      options({ centerModel: false, placeOnGround: false }),
    );
    const statistics = collectModelStatistics(root);

    assert.ok(nonIndexed.getAttribute("normal"));
    assert.deepEqual(
      warnings.map(({ code }) => code),
      ["unit-unavailable", "coordinate-system-unavailable"],
    );
    assert.deepEqual(statistics, {
      objectCount: 2,
      triangleCount: 3,
      materialCount: 1,
    });
  });
});

describe("LocalResourceResolver", () => {
  it("resolves primary-relative resources, caches URLs, and revokes them", () => {
    const primary = file("model.gltf", "{}");
    const sidecar = file("Albedo Map.bin", "data");
    Object.defineProperty(primary, "webkitRelativePath", {
      value: "root/model.gltf",
    });
    Object.defineProperty(sidecar, "webkitRelativePath", {
      value: "root/textures/Albedo Map.bin",
    });

    const created = [];
    const revoked = [];
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = (blob) => {
      created.push(blob);
      return `blob:test-${created.length}`;
    };
    URL.revokeObjectURL = (url) => revoked.push(url);

    try {
      const resolver = new LocalResourceResolver(
        [primary, sidecar],
        primary,
      );
      assert.equal(
        resolver.resolve("textures/Albedo%20Map.bin?cache=1#buffer"),
        "blob:test-1",
      );
      assert.equal(
        resolver.resolve("TEXTURES/albedo%20map.bin"),
        "blob:test-1",
      );
      assert.deepEqual(created, [sidecar]);

      resolver.dispose();
      assert.deepEqual(revoked, ["blob:test-1"]);
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });
  it("allows embedded data URIs and blocks network resources", () => {
    const resolver = new LocalResourceResolver([]);
    const dataUri = "data:application/octet-stream;base64,AA==";

    assert.equal(resolver.resolve(dataUri), dataUri);
    assert.throws(
      () => resolver.resolve("https://example.com/mesh.bin"),
      /External model resources are not loaded/,
    );
    assert.deepEqual(resolver.unresolvedResources, [
      "https://example.com/mesh.bin",
    ]);
  });
});
