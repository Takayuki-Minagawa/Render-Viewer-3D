import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as THREE from "three";
import { createServer } from "vite";

let server;
let materialModel;
let projectMaterial;
let createMeshPhysicalMaterial;
let MaterialRuntimeCache;
let SceneGraphAdapter;
let createDefaultSceneObject;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  materialModel = await server.ssrLoadModule("/src/model/material/index.ts");
  ({ projectMaterial, createMeshPhysicalMaterial } =
    await server.ssrLoadModule("/src/three/material/material-projector.ts"));
  ({ MaterialRuntimeCache } = await server.ssrLoadModule(
    "/src/three/material/material-runtime-cache.ts",
  ));
  ({ SceneGraphAdapter } = await server.ssrLoadModule(
    "/src/three/scene-graph-adapter.ts",
  ));
  ({ createDefaultSceneObject } = await server.ssrLoadModule(
    "/src/model/scene-object-commands.ts",
  ));
});

after(async () => {
  await server?.close();
});

describe("Three.js material projection", () => {
  it("maps every physical preview field and reports every POV-Ray leaf", () => {
    const definition = createDefinition("physical", {
      baseColor: "#8090a0",
      diffuse: 0.4,
      metalness: 0.31,
      roughness: 0.42,
      opacity: 0.53,
      transparent: true,
      emissiveColor: "#203040",
      emissiveIntensity: 1.7,
      doubleSided: true,
      wireframe: true,
      reflection: 0.63,
      transmission: 0.74,
      ior: 2.42,
      thickness: 0.86,
      attenuationColor: "#607080",
      attenuationDistance: null,
      clearcoat: 0.11,
      clearcoatRoughness: 0.22,
      specularIntensity: 0.33,
      specularColor: "#90a0b0",
      sheen: 0.44,
      sheenColor: "#b0a090",
      sheenRoughness: 0.55,
      iridescence: 0.66,
      iridescenceIOR: 1.8,
      iridescenceThicknessRange: [120, 510],
      anisotropy: 0.77,
      anisotropyRotationDegrees: 45,
      dispersion: 0.88,
    });
    definition.pov.interior = {
      ior: 2.42,
      caustics: 0.25,
      media: [{ method: 3, samples: { minimum: 4, maximum: 12 } }],
    };
    definition.pov.extensions = [
      {
        keyword: "future_finish",
        values: [null, 42],
        raw: "future_finish { 42 }",
      },
    ];

    const projection = projectMaterial(definition);
    const rendered = createMeshPhysicalMaterial(projection);
    const expectedColor = new THREE.Color(definition.preview.baseColor)
      .multiplyScalar(definition.preview.diffuse);

    assertColorEqual(rendered.color, expectedColor);
    assert.equal(rendered.metalness, 0.31);
    assert.equal(rendered.roughness, 0.42);
    assert.equal(rendered.opacity, 0.53);
    assert.equal(rendered.transparent, true);
    assertColorEqual(rendered.emissive, new THREE.Color("#203040"));
    assert.equal(rendered.emissiveIntensity, 1.7);
    assert.equal(rendered.side, THREE.DoubleSide);
    assert.equal(rendered.wireframe, true);
    assert.equal(rendered.envMapIntensity, 0.63);
    assert.equal(rendered.transmission, 0.74);
    assert.equal(rendered.ior, 2.333);
    assert.equal(rendered.thickness, 0.86);
    assertColorEqual(rendered.attenuationColor, new THREE.Color("#607080"));
    assert.equal(rendered.attenuationDistance, Number.POSITIVE_INFINITY);
    assert.equal(rendered.clearcoat, 0.11);
    assert.equal(rendered.clearcoatRoughness, 0.22);
    assert.equal(rendered.specularIntensity, 0.33);
    assertColorEqual(rendered.specularColor, new THREE.Color("#90a0b0"));
    assert.equal(rendered.sheen, 0.44);
    assertColorEqual(rendered.sheenColor, new THREE.Color("#b0a090"));
    assert.equal(rendered.sheenRoughness, 0.55);
    assert.equal(rendered.iridescence, 0.66);
    assert.equal(rendered.iridescenceIOR, 1.8);
    assert.deepEqual(rendered.iridescenceThicknessRange, [120, 510]);
    assert.equal(rendered.anisotropy, 0.77);
    assert.ok(nearlyEqual(rendered.anisotropyRotation, Math.PI / 4));
    assert.equal(rendered.dispersion, 0.88);

    const clamp = projection.diagnostics.find(
      (diagnostic) => diagnostic.path === "preview.ior",
    );
    assert.deepEqual(clamp, {
      path: "preview.ior",
      code: "preview.ior.clamped",
      support: "approximate",
    });
    for (const path of ["preview.diffuse", "preview.reflection"]) {
      assert.deepEqual(
        projection.diagnostics.find(
          (diagnostic) => diagnostic.path === path,
        ),
        { path, code: path, support: "approximate" },
      );
    }

    const povDiagnostics = projection.diagnostics.filter((diagnostic) =>
      diagnostic.path.startsWith("pov"),
    );
    assert.deepEqual(
      povDiagnostics.map((diagnostic) => diagnostic.path).sort(),
      collectLeafPaths(definition.pov, "pov").sort(),
    );
    assert.ok(
      povDiagnostics.every((diagnostic) => diagnostic.support === "stored-only"),
    );
    assert.equal(
      povDiagnostics.find(
        (diagnostic) => diagnostic.path === "pov.interior.caustics",
      )?.code,
      "pov.interior.caustics",
    );
    assert.equal(
      povDiagnostics.find(
        (diagnostic) => diagnostic.path === "pov.extensions.0.raw",
      )?.code,
      "pov.extensions",
    );

    rendered.dispose();
  });
});

describe("MaterialRuntimeCache", () => {
  it("reuses scalar updates and disposes removed definitions exactly once", () => {
    const cache = new MaterialRuntimeCache();
    const first = createDefinition("shared", { roughness: 0.2 });
    cache.reconcile([first]);
    const runtime = cache.requireMaterial(first.id);
    let disposeCount = 0;
    runtime.dispose = () => {
      disposeCount += 1;
    };

    const updated = structuredClone(first);
    updated.preview.roughness = 0.83;
    cache.reconcile([updated]);
    assert.equal(cache.requireMaterial(first.id), runtime);
    assert.equal(runtime.roughness, 0.83);
    assert.equal(disposeCount, 0);

    assert.throws(
      () => cache.reconcile([updated, structuredClone(updated)]),
      /Duplicate material id in SceneModel: shared/,
    );
    assert.equal(cache.requireMaterial(first.id), runtime);

    cache.reconcile([]);
    cache.reconcile([]);
    cache.dispose();
    cache.dispose();
    assert.equal(disposeCount, 1);
    assert.throws(
      () => cache.reconcile([]),
      /MaterialRuntimeCache has already been disposed/,
    );
  });
});

describe("SceneGraphAdapter material ownership", () => {
  it("shares, reassigns, and removes materials without mesh-owned disposal", () => {
    const scene = new THREE.Scene();
    const graph = new SceneGraphAdapter(scene);
    const shared = createDefinition("shared", { roughness: 0.2 });
    const accent = createDefinition("accent", { metalness: 1 });
    const objects = [
      createDefaultSceneObject("box", "one", "One", shared.id),
      createDefaultSceneObject("sphere", "two", "Two", shared.id),
    ];

    graph.applyModel(objects, [], [shared, accent]);
    const one = graph.getObjectById("one");
    const two = graph.getObjectById("two");
    assert.ok(one instanceof THREE.Mesh);
    assert.ok(two instanceof THREE.Mesh);
    assert.equal(one.material, two.material);

    const sharedRuntime = one.material;
    let sharedDisposeCount = 0;
    sharedRuntime.dispose = () => {
      sharedDisposeCount += 1;
    };
    shared.preview.roughness = 0.91;
    graph.applyModel(objects, [], [shared, accent]);
    assert.equal(one.material, sharedRuntime);
    assert.equal(two.material, sharedRuntime);
    assert.equal(sharedRuntime.roughness, 0.91);

    objects[1].materialId = accent.id;
    graph.applyModel(objects, [], [shared, accent]);
    const accentRuntime = two.material;
    assert.notEqual(accentRuntime, sharedRuntime);
    assert.equal(one.material, sharedRuntime);

    objects.splice(0, 1);
    graph.applyModel(objects, [], [shared, accent]);
    assert.equal(sharedDisposeCount, 0);
    graph.applyModel(objects, [], [accent]);
    assert.equal(sharedDisposeCount, 1);

    assert.throws(
      () => graph.applyModel(objects, [], [accent, structuredClone(accent)]),
      /Duplicate material id in SceneModel: accent/,
    );
    assert.equal(two.material, accentRuntime);

    const missing = structuredClone(objects);
    missing[0].materialId = "missing";
    assert.throws(
      () => graph.applyModel(missing, [], [accent]),
      /Missing material id in SceneModel for object two: missing/,
    );
    assert.equal(two.material, accentRuntime);

    let accentDisposeCount = 0;
    accentRuntime.dispose = () => {
      accentDisposeCount += 1;
    };
    graph.dispose();
    graph.dispose();
    assert.equal(accentDisposeCount, 1);
  });
});

function createDefinition(id, values = {}) {
  const preview = materialModel.createDefaultPhysicalMaterialPreview(values);
  return materialModel.createMaterialDefinitionFromPreview(id, id, preview);
}

function collectLeafPaths(value, path) {
  if (value === undefined) return [];
  if (value === null || typeof value !== "object") return [path];
  if (Array.isArray(value)) {
    return value.flatMap((child, index) =>
      collectLeafPaths(child, `${path}.${index}`),
    );
  }
  return Object.entries(value).flatMap(([key, child]) =>
    collectLeafPaths(child, `${path}.${key}`),
  );
}

function assertColorEqual(actual, expected) {
  assert.ok(nearlyEqual(actual.r, expected.r), `red: ${actual.r} !== ${expected.r}`);
  assert.ok(
    nearlyEqual(actual.g, expected.g),
    `green: ${actual.g} !== ${expected.g}`,
  );
  assert.ok(
    nearlyEqual(actual.b, expected.b),
    `blue: ${actual.b} !== ${expected.b}`,
  );
}

function nearlyEqual(actual, expected) {
  return Math.abs(actual - expected) < 1e-10;
}
