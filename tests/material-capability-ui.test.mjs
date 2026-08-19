import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer } from "vite";

let server;
let MATERIAL_CAPABILITIES;
let createMaterialDefinition;
let filterCapabilities;
let getRuntimeMaterialCapability;
let resolveCapabilityValue;
let translate;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ MATERIAL_CAPABILITIES } = await server.ssrLoadModule(
    "/src/model/material/material-capabilities.ts",
  ));
  ({ createMaterialDefinition } = await server.ssrLoadModule(
    "/src/model/material/material-presets.ts",
  ));
  ({ getMaterialCapability: getRuntimeMaterialCapability } =
    await server.ssrLoadModule("/src/three/material/material-capabilities.ts"));
  ({ filterCapabilities, resolveCapabilityValue } = await server.ssrLoadModule(
    "/src/ui/material-library-view-base.ts",
  ));
  ({ translate } = await server.ssrLoadModule("/src/ui/i18n.ts"));
});

after(async () => {
  await server?.close();
});

describe("material capability catalog UI", () => {
  it("uses the comprehensive model catalog as the complete listing source", () => {
    assert.ok(MATERIAL_CAPABILITIES.length >= 40);
    const categories = new Set(MATERIAL_CAPABILITIES.map(({ category }) => category));
    for (const expected of [
      "preview",
      "material",
      "texture",
      "pigment",
      "normal",
      "finish",
      "interior",
      "media",
      "mapping",
      "pattern",
      "warp",
      "global",
    ]) {
      assert.ok(categories.has(expected), `missing category: ${expected}`);
    }
  });

  it("labels every current POV-only capability as stored-only", () => {
    const povEntries = MATERIAL_CAPABILITIES.filter(({ path }) =>
      path === "pov" || path.startsWith("pov."),
    );
    assert.ok(povEntries.length > 0);
    assert.ok(povEntries.every(({ fidelity }) => fidelity === "stored-only"));
  });

  it("searches localized labels and POV-Ray keywords before values exist", () => {
    assert.ok(
      filterCapabilities(
        MATERIAL_CAPABILITIES,
        "conserve energy",
        "stored",
        "en",
      ).some(({ id }) => id === "pov.finish.energy"),
    );
    assert.ok(
      filterCapabilities(MATERIAL_CAPABILITIES, "レイリー", "stored", "ja").some(
        ({ id }) => id === "pov.media.scattering",
      ),
    );
  });

  it("resolves configured scalar values without hiding unconfigured catalog rows", () => {
    const material = createMaterialDefinition("glass", "Glass", "glass");
    assert.equal(
      resolveCapabilityValue(material, "preview.ior"),
      material.preview.ior,
    );
    assert.equal(
      resolveCapabilityValue(material, "pov.texture.pigment.*Map"),
      undefined,
    );
  });
});

describe("runtime material capability resolution", () => {
  it("matches indexed and recursive density paths to their specific capability IDs", () => {
    assert.deepEqual(
      getRuntimeMaterialCapability(
        "pov.interior.media.0.density.0.colorMap.0.position",
      ),
      {
        support: "stored-only",
        code: "pov.media.density-color-map",
      },
    );
    assert.deepEqual(
      getRuntimeMaterialCapability(
        "pov.interior.media.0.density.0.densityMap.0.value.pattern.type",
      ),
      {
        support: "stored-only",
        code: "pov.media.density-map",
      },
    );
    assert.deepEqual(
      getRuntimeMaterialCapability("pov.interior.media.0.absorption.red"),
      {
        support: "stored-only",
        code: "pov.media.absorption",
      },
    );
  });
});

describe("public material wording", () => {
  it("states the WebGL/POV-Ray distinction in Japanese and English", () => {
    assert.match(translate("ja", "material.disclaimer"), /WebGL.*POV-Ray/);
    assert.match(translate("en", "material.disclaimer"), /WebGL.*not POV-Ray rendering/);
  });
});
