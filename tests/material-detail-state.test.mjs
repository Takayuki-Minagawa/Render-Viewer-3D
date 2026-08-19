import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer } from "vite";

let server;
let createMaterialDetailRenderKey;
let materialKindMessageKey;
let resolveMaterialTabKey;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({
    createMaterialDetailRenderKey,
    materialKindMessageKey,
    resolveMaterialTabKey,
  } = await server.ssrLoadModule("/src/ui/material-detail-state.ts"));
});

after(async () => {
  await server?.close();
});

const BASE = {
  materialId: "material-glass",
  locale: "ja",
  editorTab: "basic",
  capabilityQuery: "",
  capabilitySupport: "all",
  selectedObjectId: "object-box",
  selectedObjectMaterialId: "material-matte",
  usage: 0,
  assigned: false,
};

describe("material detail render state", () => {
  it("invalidates action UI after assignment", () => {
    const beforeAssignment = createMaterialDetailRenderKey(BASE);
    const afterAssignment = createMaterialDetailRenderKey({
      ...BASE,
      selectedObjectMaterialId: "material-glass",
      usage: 1,
      assigned: true,
    });
    assert.notEqual(afterAssignment, beforeAssignment);
  });

  it("invalidates usage and selected-object action UI independently", () => {
    assert.notEqual(
      createMaterialDetailRenderKey(BASE),
      createMaterialDetailRenderKey({ ...BASE, usage: 2 }),
    );
    assert.notEqual(
      createMaterialDetailRenderKey(BASE),
      createMaterialDetailRenderKey({
        ...BASE,
        selectedObjectId: "object-sphere",
      }),
    );
  });

  it("maps preset state to a badge without requiring DOM replacement", () => {
    assert.equal(materialKindMessageKey("glass"), "material.builtIn");
    assert.equal(materialKindMessageKey(null), "material.custom");
  });
});

describe("material tab keyboard navigation", () => {
  it("wraps Arrow keys and supports Home and End", () => {
    assert.equal(resolveMaterialTabKey("basic", "ArrowRight"), "advanced");
    assert.equal(resolveMaterialTabKey("advanced", "ArrowRight"), "basic");
    assert.equal(resolveMaterialTabKey("basic", "ArrowLeft"), "advanced");
    assert.equal(resolveMaterialTabKey("advanced", "Home"), "basic");
    assert.equal(resolveMaterialTabKey("basic", "End"), "advanced");
    assert.equal(resolveMaterialTabKey("basic", "Enter"), undefined);
  });
});
