import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as THREE from "three";
import { createServer } from "vite";

let server;
let adaptImportedMaterialToPreview;
let collectImportedMaterialDefinitions;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ adaptImportedMaterialToPreview, collectImportedMaterialDefinitions } =
    await server.ssrLoadModule("/src/importers/material-adapter.ts"));
});

after(async () => {
  await server?.close();
});

describe("imported material adapter", () => {
  it("maps all major MeshPhysicalMaterial scalar and color properties", () => {
    const material = new THREE.MeshPhysicalMaterial({
      color: "#8090a0",
      roughness: 0.42,
      metalness: 0.31,
      opacity: 0.53,
      transparent: true,
      emissive: "#203040",
      emissiveIntensity: 1.7,
      side: THREE.DoubleSide,
      wireframe: true,
      envMapIntensity: 0.63,
      transmission: 0.74,
      ior: 2.2,
      thickness: 0.86,
      attenuationColor: "#607080",
      attenuationDistance: 12.5,
      clearcoat: 0.11,
      clearcoatRoughness: 0.22,
      specularIntensity: 0.33,
      specularColor: "#90a0b0",
      sheen: 0.44,
      sheenColor: "#b0a090",
      sheenRoughness: 0.55,
      iridescence: 0.66,
      iridescenceIOR: 1.8,
      iridescenceThicknessRange: [510, 120],
      anisotropy: 0.77,
      anisotropyRotation: Math.PI / 4,
      dispersion: 0.88,
    });

    const preview = adaptImportedMaterialToPreview(material);

    assert.deepEqual(preview, {
      baseColor: "#8090a0",
      diffuse: 1,
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
      ior: 2.2,
      thickness: 0.86,
      attenuationColor: "#607080",
      attenuationDistance: 12.5,
      clearcoat: 0.11,
      clearcoatRoughness: 0.22,
      specularIntensity: 0.33,
      specularColor: "#90a0b0",
      sheen: 0.44,
      sheenRoughness: 0.55,
      sheenColor: "#b0a090",
      iridescence: 0.66,
      iridescenceIOR: 1.8,
      iridescenceThicknessRange: [120, 510],
      anisotropy: 0.77,
      anisotropyRotationDegrees: 45,
      dispersion: 0.88,
    });
  });

  it("maps standard materials and safely ignores or clamps invalid scalars", () => {
    const standard = new THREE.MeshStandardMaterial({
      color: "#1a2b3c",
      roughness: 0.25,
      metalness: 0.75,
      emissive: "#102030",
    });
    standard.opacity = -2;
    standard.emissiveIntensity = 120;
    standard.envMapIntensity = Number.POSITIVE_INFINITY;

    const preview = adaptImportedMaterialToPreview(standard);

    assert.equal(preview.baseColor, "#1a2b3c");
    assert.equal(preview.diffuse, 1);
    assert.equal(preview.roughness, 0.25);
    assert.equal(preview.metalness, 0.75);
    assert.equal(preview.opacity, 0);
    assert.equal(preview.emissiveColor, "#102030");
    assert.equal(preview.emissiveIntensity, 100);
    assert.equal(preview.reflection, 0);
    assert.equal(preview.transmission, 0);

    standard.roughness = Number.NaN;
    assert.equal(adaptImportedMaterialToPreview(standard).roughness, 0.6);
  });

  it("creates a conservative common-PBR fallback for non-standard materials", () => {
    const basic = new THREE.MeshBasicMaterial({
      color: "#336699",
      opacity: 0.4,
      transparent: true,
      side: THREE.DoubleSide,
      wireframe: true,
    });

    const preview = adaptImportedMaterialToPreview(basic);

    assert.equal(preview.baseColor, "#336699");
    assert.equal(preview.diffuse, 1);
    assert.equal(preview.metalness, 0);
    assert.equal(preview.roughness, 1);
    assert.equal(preview.specularIntensity, 0);
    assert.equal(preview.opacity, 0.4);
    assert.equal(preview.transparent, true);
    assert.equal(preview.doubleSided, true);
    assert.equal(preview.wireframe, true);
  });

  it("deduplicates material arrays by identity in stable traversal order", () => {
    const root = new THREE.Group();
    const first = new THREE.MeshStandardMaterial({ color: "#ff0000" });
    const second = new THREE.MeshStandardMaterial({ color: "#00ff00" });
    const third = new THREE.MeshStandardMaterial({ color: "#0000ff" });
    first.name = "Steel";
    second.name = "Steel";
    third.name = "";

    root.add(new THREE.Mesh(new THREE.BoxGeometry(), [first, second, first]));
    const child = new THREE.Group();
    child.add(new THREE.Mesh(new THREE.SphereGeometry(), [second, third]));
    root.add(child);

    const definitions = collectImportedMaterialDefinitions(
      root,
      "\u0000  Demo \n Model #1  ",
    );

    assert.deepEqual(
      definitions.map((definition) => definition.id),
      [
        "demo-model-1-material-1",
        "demo-model-1-material-2",
        "demo-model-1-material-3",
      ],
    );
    assert.deepEqual(
      definitions.map((definition) => definition.name),
      [
        "Demo Model #1 / Steel",
        "Demo Model #1 / Steel 2",
        "Demo Model #1 / Material 3",
      ],
    );
    assert.deepEqual(
      definitions.map((definition) => definition.preview.baseColor),
      ["#ff0000", "#00ff00", "#0000ff"],
    );
    assert.ok(
      definitions.every((definition) => definition.category === "custom"),
    );
    assert.ok(definitions.every((definition) => definition.presetId === null));
  });
});
