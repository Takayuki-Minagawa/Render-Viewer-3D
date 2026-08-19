import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer } from "vite";

let createImportOptions;
let createImporterDisplayItems;
let hasDraggedFiles;
let importErrorDetail;
let server;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({
    createImportOptions,
    createImporterDisplayItems,
    hasDraggedFiles,
    importErrorDetail,
  } = await server.ssrLoadModule("/src/ui/import-ui-state.ts"));
});

after(async () => {
  await server?.close();
});

describe("import UI state", () => {
  it("normalizes dialog options and falls back for unknown values", () => {
    assert.deepEqual(
      createImportOptions({
        unit: "millimeter",
        coordinateSystem: "z-up",
        centerModel: false,
        placeOnGround: true,
        quality: "high",
      }),
      {
        unit: "millimeter",
        coordinateSystem: "z-up",
        centerModel: false,
        placeOnGround: true,
        quality: "high",
      },
    );
    assert.deepEqual(createImportOptions({ unit: "parsec", quality: null }), {
      unit: "auto",
      coordinateSystem: "auto",
      centerModel: true,
      placeOnGround: true,
      quality: "medium",
    });
  });

  it("recognizes file drags without depending on browser DataTransfer", () => {
    assert.equal(hasDraggedFiles(["text/plain", "Files"]), true);
    assert.equal(hasDraggedFiles(["text/plain"]), false);
  });

  it("derives supported format labels from registry-shaped entries", () => {
    assert.deepEqual(
      createImporterDisplayItems([
        {
          id: "gltf",
          name: "glTF / GLB",
          extensions: ["gltf", ".GLB"],
          experimental: false,
        },
        {
          id: "step",
          name: "STEP / STP",
          extensions: ["step", "stp"],
          experimental: true,
        },
      ]),
      [
        {
          id: "gltf",
          label: "glTF / GLB (.gltf, .glb)",
          experimental: false,
        },
        {
          id: "step",
          label: "STEP / STP (.step, .stp)",
          experimental: true,
        },
      ],
    );
    assert.equal(importErrorDetail(new Error(" broken ")), "broken");
    assert.equal(importErrorDetail("failed"), "failed");
  });
});
