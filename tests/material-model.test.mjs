import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer } from "vite";

let server;
let material;
let createDefaultSceneModel;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  material = await server.ssrLoadModule("/src/model/material/index.ts");
  ({ createDefaultSceneModel } = await server.ssrLoadModule(
    "/src/model/default-scene.ts",
  ));
});

after(async () => {
  await server?.close();
});

describe("material presets", () => {
  it("publishes immutable bilingual presets with the specified values", () => {
    assert.deepEqual(
      material.MATERIAL_PRESETS.map((preset) => preset.id),
      [
        "matte",
        "matte-plastic",
        "glossy-plastic",
        "metal",
        "glass",
        "frosted-glass",
        "wood-base",
        "concrete",
      ],
    );

    const values = Object.fromEntries(
      material.MATERIAL_PRESETS.map((preset) => [preset.id, preset.preview]),
    );
    assert.deepEqual(
      pick(values["matte-plastic"]),
      [0.8, 0.3, 0.6, 0, 0, 0],
    );
    assert.deepEqual(
      pick(values["glossy-plastic"]),
      [0.7, 0.7, 0.2, 0, 0, 0],
    );
    assert.deepEqual(pick(values.metal), [0.1, 1, 0.2, 1, 0.8, 0]);
    assert.deepEqual(pick(values.glass), [0, 0.8, 0.05, 0, 0.1, 1]);
    assert.equal(values.glass.ior, 1.5);
    assert.deepEqual(
      pick(values["frosted-glass"]),
      [0.1, 0.5, 0.5, 0, 0.1, 0.9],
    );
    assert.equal(values["frosted-glass"].ior, 1.5);
    assert.deepEqual(
      pick(values.concrete),
      [0.8, 0.2, 0.8, 0, 0.1, 0],
    );

    assert.equal(Object.isFrozen(material.MATERIAL_PRESETS), true);
    assert.equal(Object.isFrozen(material.MATERIAL_PRESETS[0].preview), true);
    assert.throws(() => {
      material.MATERIAL_PRESETS[0].preview.roughness = 0;
    }, TypeError);
  });

  it("clones preset data instead of exposing catalog references", () => {
    const first = material.createMaterialDefinition("one", "One", "metal");
    const second = material.createMaterialDefinition("two", "Two", "metal");

    assert.notEqual(first.preview, second.preview);
    assert.notEqual(first.pov, second.pov);
    first.preview.roughness = 0.9;
    assert.equal(second.preview.roughness, 0.2);
    assert.equal(material.getMaterialPreset("metal").preview.roughness, 0.2);
  });
});

describe("material management commands", () => {
  it("adds, duplicates, renames, assigns, counts, and guards deletion", () => {
    const scene = createDefaultSceneModel();
    const added = material.addMaterial(scene, {
      id: "custom",
      name: "Custom",
      presetId: "wood-base",
    });
    const duplicate = material.duplicateMaterial(scene, added.id);

    assert.ok(duplicate);
    assert.equal(duplicate.id, "custom-copy");
    assert.equal(duplicate.name, "Custom Copy");
    assert.notEqual(duplicate.preview, added.preview);
    assert.equal(material.renameMaterial(scene, duplicate.id, "  Accent  "), true);
    assert.equal(duplicate.name, "Accent");

    const objectId = scene.objects[0].id;
    assert.equal(material.assignMaterial(scene, objectId, duplicate.id), true);
    assert.equal(material.getMaterialUsageCount(scene, duplicate.id), 1);
    assert.equal(material.deleteMaterial(scene, duplicate.id), "in-use");
    assert.equal(material.assignMaterial(scene, objectId, added.id), true);
    assert.equal(material.deleteMaterial(scene, duplicate.id), "deleted");
    assert.equal(material.deleteMaterial(scene, duplicate.id), "not-found");
    assert.equal(material.assignMaterial(scene, "missing", added.id), false);
    assert.equal(material.assignMaterial(scene, objectId, "missing"), false);
  });

  it("protects remembered imported material overrides while Imported mode is active", () => {
    const scene = createDefaultSceneModel();
    const remembered = material.addMaterial(scene, {
      id: "remembered-import-override",
      name: "Remembered import override",
    });
    scene.imports.push({
      materialMode: "imported",
      customMaterialId: remembered.id,
    });

    assert.equal(material.getMaterialUsageCount(scene, remembered.id), 1);
    assert.equal(
      material.getMaterialUsageCounts(scene).get(remembered.id),
      1,
    );
    assert.equal(material.deleteMaterial(scene, remembered.id), "in-use");

    scene.imports[0].customMaterialId = null;
    assert.equal(material.deleteMaterial(scene, remembered.id), "deleted");
  });

  it("uses the stable English preset label as a unique default name", () => {
    const scene = createDefaultSceneModel();

    const first = material.addMaterial(scene, { presetId: "glass" });
    const second = material.addMaterial(scene, { presetId: "glass" });
    const generic = material.addMaterial(scene);

    assert.equal(first.name, "Glass");
    assert.equal(second.name, "Glass 2");
    assert.equal(generic.name, "Material");
  });

  it("makes a shared material unique without changing an already unique one", () => {
    const scene = createDefaultSceneModel();
    const first = scene.objects[0];
    const second = scene.objects[1];
    second.materialId = first.materialId;

    const unique = material.makeMaterialUnique(scene, second.id);
    assert.ok(unique);
    assert.notEqual(unique.id, first.materialId);
    assert.equal(second.materialId, unique.id);
    assert.equal(material.getMaterialUsageCount(scene, first.materialId), 1);

    const count = scene.materials.length;
    assert.equal(material.makeMaterialUnique(scene, second.id), unique);
    assert.equal(scene.materials.length, count);
  });

  it("applies presets and normalizes individual preview properties", () => {
    const scene = createDefaultSceneModel();
    const target = scene.materials[0];
    const originalName = target.name;

    assert.equal(
      material.applyMaterialPreset(scene, target.id, "frosted-glass"),
      true,
    );
    assert.equal(target.name, originalName);
    assert.equal(target.presetId, "frosted-glass");
    assert.equal(target.preview.transmission, 0.9);

    assert.equal(
      material.updateMaterialPreviewProperty(scene, target.id, "ior", 2.42),
      true,
    );
    assert.equal(target.preview.ior, 2.42);
    assert.equal(target.presetId, null);
    material.updateMaterialPreviewProperty(scene, target.id, "ior", 99);
    assert.equal(target.preview.ior, 10);
    material.updateMaterialPreviewProperty(
      scene,
      target.id,
      "iridescenceIOR",
      99,
    );
    assert.equal(target.preview.iridescenceIOR, 2.333);
    material.updateMaterialPreviewProperty(
      scene,
      target.id,
      "iridescenceThicknessRange",
      [700, -5],
    );
    assert.deepEqual(target.preview.iridescenceThicknessRange, [0, 700]);
    material.updateMaterialPreview(scene, target.id, {
      baseColor: "#ABC",
      roughness: -4,
      emissiveIntensity: Number.POSITIVE_INFINITY,
    });
    assert.equal(target.preview.baseColor, "#aabbcc");
    assert.equal(target.preview.roughness, 0);
    assert.equal(target.preview.emissiveIntensity, 0);
  });
});

  it("updates only an existing finite POV-Ray numeric leaf by an own path", () => {
    const scene = createDefaultSceneModel();
    const target = scene.materials[0];
    target.pov.extensions = [
      { keyword: "future", values: [2], raw: "future 2" },
    ];
    target.presetId = "matte-plastic";

    assert.equal(
      material.updateMaterialPovScalar(
        scene,
        target.id,
        "pov.texture.finish.diffuse",
        0.42,
      ),
      true,
    );
    assert.equal(target.pov.texture.finish.diffuse, 0.42);
    assert.equal(target.presetId, null);
    assert.equal(
      material.updateMaterialPovScalar(
        scene,
        target.id,
        "pov.extensions.0.values.0",
        2_000_000_000,
      ),
      true,
    );
    assert.equal(target.pov.extensions[0].values[0], 1_000_000_000);

    for (const [path, value] of [
      ["texture.finish.diffuse", 1],
      ["pov.texture.finish.unknown", 1],
      ["pov.texture.finish.diffuse.value", 1],
      ["pov.extensions.9.values.0", 1],
      ["pov.targetVersion", 1],
      ["pov.__proto__.polluted", 1],
      ["pov.texture.constructor.value", 1],
      ["pov.texture.prototype.value", 1],
      ["pov.texture.finish.diffuse", Number.NaN],
    ]) {
      assert.equal(
        material.updateMaterialPovScalar(scene, target.id, path, value),
        false,
        path,
      );
    }
    assert.equal({}.polluted, undefined);
  });

describe("scene schema migration", () => {
  it("migrates every v1 inline material independently without mutating input", () => {
    const current = createDefaultSceneModel();
    const legacy = {
      ...structuredClone(current),
      schemaVersion: 1,
      objects: current.objects.slice(0, 2).map((object) => {
        const { materialId, ...legacyObject } = structuredClone(object);
        void materialId;
        return {
          ...legacyObject,
          material: { color: "#123456", metalness: 0.4, roughness: 0.6 },
        };
      }),
    };
    delete legacy.materials;
    delete legacy.imports;
    legacy.objects[0].id = "A B";
    legacy.objects[1].id = "a-b";
    const before = structuredClone(legacy);

    const migrated = material.migrateSceneModel(legacy);
    assert.deepEqual(legacy, before);
    assert.equal(migrated.schemaVersion, 2);
    assert.deepEqual(migrated.imports, []);
    assert.equal(migrated.materials.length, 2);
    assert.equal(new Set(migrated.objects.map((object) => object.materialId)).size, 2);
    assert.deepEqual(
      migrated.materials.map((definition) => definition.id),
      ["a-b-material", "a-b-material-2"],
    );
    for (const definition of migrated.materials) {
      assert.equal(definition.preview.baseColor, "#123456");
      assert.equal(definition.preview.metalness, 0.4);
      assert.equal(definition.preview.roughness, 0.6);
      assert.equal(definition.presetId, null);
    }
  });

  it("normalizes malformed v1 material values before creating v2 materials", () => {
    const current = createDefaultSceneModel();
    const legacyValues = [
      {
        color: "invalid",
        metalness: Number.NaN,
        roughness: Number.POSITIVE_INFINITY,
      },
      { color: " #AbC ", metalness: -4, roughness: 2 },
      { color: "#123AbC", metalness: 0.25, roughness: 0.75 },
    ];
    const legacy = {
      ...structuredClone(current),
      schemaVersion: 1,
      objects: current.objects.map((object, index) => {
        const { materialId, ...legacyObject } = structuredClone(object);
        void materialId;
        return { ...legacyObject, material: legacyValues[index] };
      }),
    };
    delete legacy.materials;

    const migrated = material.migrateSceneModel(legacy);
    assert.deepEqual(
      migrated.materials.map((definition) => [
        definition.preview.baseColor,
        definition.preview.metalness,
        definition.preview.roughness,
      ]),
      [
        ["#5f8cff", 0, 0.6],
        ["#aabbcc", 0, 1],
        ["#123abc", 0.25, 0.75],
      ],
    );
    for (const definition of migrated.materials) {
      assert.equal(Number.isFinite(definition.preview.metalness), true);
      assert.equal(Number.isFinite(definition.preview.roughness), true);
    }
  });

  it("preserves recursive density maps and independent finish albedo modifiers", () => {
    const scene = createDefaultSceneModel();
    const target = scene.materials[0];
    const finish = target.pov.texture.finish;
    assert.ok(finish);
    finish.diffuseAlbedo = true;
    finish.phong = 0.4;
    finish.phongAlbedo = false;
    finish.specularAlbedo = true;

    const density = {
      pattern: { type: "gradient", frequency: 1 },
      colorMap: [
        {
          position: 0,
          value: { red: 0.1, green: 0.2, blue: 0.3 },
        },
      ],
      densityMap: [
        {
          position: 0.5,
          value: {
            pattern: { type: "wood", frequency: 2 },
            colorMap: [
              {
                position: 1,
                value: { red: 0.9, green: 0.8, blue: 0.7 },
              },
            ],
          },
        },
      ],
    };
    target.pov.interior = { media: [{ density: [density] }] };

    const migrated = material.migrateSceneModel(scene);
    const migratedTarget = migrated.materials[0];
    const migratedFinish = migratedTarget.pov.texture.finish;
    const migratedDensity =
      migratedTarget.pov.interior.media[0].density[0];

    assert.notEqual(migratedDensity, density);
    assert.deepEqual(migratedDensity, density);
    assert.deepEqual(
      [
        migratedFinish.diffuseAlbedo,
        migratedFinish.phongAlbedo,
        migratedFinish.specularAlbedo,
      ],
      [true, false, true],
    );
    assert.equal(
      material.updateMaterialPovScalar(
        migrated,
        migratedTarget.id,
        "pov.interior.media.0.density.0.densityMap.0.value.pattern.frequency",
        3,
      ),
      true,
    );
    assert.equal(
      migratedDensity.densityMap[0].value.pattern.frequency,
      3,
    );
  });

  it("clones an existing v2 scene and preserves extension nodes", () => {
    const scene = createDefaultSceneModel();
    scene.materials[0].pov.extensions = [
      { keyword: "future_finish", raw: "future_finish { 42 }" },
    ];

    const migrated = material.migrateSceneModel(scene);
    assert.deepEqual(migrated, scene);
    assert.notEqual(migrated, scene);
    assert.notEqual(migrated.materials[0].pov, scene.materials[0].pov);
  });

  it("adds an empty imports collection to historical v2 snapshots", () => {
    const scene = createDefaultSceneModel();
    delete scene.imports;

    const migrated = material.migrateSceneModel(scene);

    assert.deepEqual(migrated.imports, []);
  });
});

describe("capability catalog and default scene", () => {
  it("covers preview, POV-Ray structures, every pattern, and every warp", () => {
    const ids = material.MATERIAL_CAPABILITIES.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(Object.isFrozen(material.MATERIAL_CAPABILITIES), true);
    assert.equal(Object.isFrozen(material.MATERIAL_CAPABILITIES[0].help), true);
    assert.deepEqual(
      new Set(material.MATERIAL_CAPABILITIES.map((entry) => entry.fidelity)),
      new Set(["direct", "approximate", "stored-only"]),
    );

    for (const id of [
      "pov.material",
      "pov.texture.layered",
      "pov.pigment.rgbft",
      "pov.normal.bump-map",
      "pov.finish.reflection",
      "pov.finish.diffuse-albedo",
      "pov.finish.phong-albedo",
      "pov.finish.specular-albedo",
      "pov.interior.dispersion",
      "pov.media.scattering",
      "pov.media.density-color-map",
      "pov.media.density-map",
      "pov.mapping.uv",
      "pov.pattern.wood",
      "pov.pattern.image-pattern",
      "pov.pattern.mandel",
      "pov.pattern.julia",
      "pov.pattern.magnet-mandel",
      "pov.pattern.magnet-julia",
      "pov.warp.black-hole",
      "pov.extensions",
    ]) {
      assert.ok(ids.includes(id), `missing capability: ${id}`);
    }
    const iorCapability = material.findMaterialCapability("preview.ior");
    assert.equal(iorCapability.fidelity, "approximate");
    assert.match(iorCapability.help.en, /1–2\.333/);

    assert.deepEqual(
      [
        material.findMaterialCapability("pov.finish.diffuse-albedo").path,
        material.findMaterialCapability("pov.finish.phong-albedo").path,
        material.findMaterialCapability("pov.finish.specular-albedo").path,
      ],
      [
        "pov.texture.finish.diffuseAlbedo",
        "pov.texture.finish.phongAlbedo",
        "pov.texture.finish.specularAlbedo",
      ],
    );
    assert.equal(
      material.findMaterialCapability("pov.media.density-color-map").path,
      "pov.interior.media.*.density.*.colorMap",
    );
    assert.equal(
      material.findMaterialCapability("pov.media.density-map").path,
      "pov.interior.media.*.density.*.densityMap",
    );

    const magnetMandel = material.findMaterialCapability(
      "pov.pattern.magnet-mandel",
    );
    const magnetJulia = material.findMaterialCapability(
      "pov.pattern.magnet-julia",
    );
    assert.ok(magnetMandel.keywords.en.includes("magnet type mandel iterations"));
    assert.ok(
      magnetJulia.keywords.en.includes("magnet type julia complex iterations"),
    );

    for (const entry of material.MATERIAL_CAPABILITIES) {
      if (!entry.path.startsWith("preview.")) {
        assert.equal(entry.fidelity, "stored-only", entry.id);
        assert.match(entry.help.ja, /プレビューには反映されません/);
        assert.match(entry.help.en, /does not render/);
      }
      assert.ok(entry.label.ja && entry.label.en);
      assert.ok(entry.help.ja && entry.help.en);
      assert.ok(entry.keywords.ja.length && entry.keywords.en.length);
      assert.match(entry.sourceUrl, /^https:\/\//);
    }
  });

  it("places box, sphere, and ground with independent valid materials", () => {
    const scene = createDefaultSceneModel();
    assert.equal(scene.schemaVersion, 2);
    assert.deepEqual(
      scene.objects.map((object) => object.geometry.type),
      ["box", "sphere", "plane"],
    );
    assert.equal(new Set(scene.objects.map((object) => object.materialId)).size, 3);
    assert.equal(scene.materials.length, 3);
    for (const object of scene.objects) {
      assert.ok(
        scene.materials.some((definition) => definition.id === object.materialId),
      );
    }
    assert.equal(
      scene.materials.find((definition) => definition.id === "sphere-01-material")
        ?.presetId,
      "metal",
    );
    assert.equal(
      scene.materials.find((definition) => definition.id === "ground-01-material")
        ?.presetId,
      "concrete",
    );
  });
});

function pick(preview) {
  return [
    preview.diffuse,
    preview.specularIntensity,
    preview.roughness,
    preview.metalness,
    preview.reflection,
    preview.transmission,
  ];
}
