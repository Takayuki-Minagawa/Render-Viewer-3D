import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer } from "vite";

let server;
let countMaterialUsage;
let filterMaterialLibraryItems;
let normalizeSearchText;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ countMaterialUsage, filterMaterialLibraryItems, normalizeSearchText } =
    await server.ssrLoadModule("/src/ui/material-library-state.ts"));
});

after(async () => {
  await server?.close();
});

const ITEMS = [
  {
    id: "glass-02",
    name: "Glass 10",
    category: "glass",
    tags: ["透明", "clear"],
    keywords: ["ior", "filter", "transmit"],
    support: "approximate",
  },
  {
    id: "glass-01",
    name: "Glass 2",
    category: "glass",
    tags: ["曇り", "frosted"],
    keywords: ["normal", "ior"],
    support: "stored",
  },
  {
    id: "metal-01",
    name: "Polished Metal",
    category: "metal",
    tags: ["金属", "polished"],
    keywords: ["reflection", "metallic", "conserve_energy"],
    support: "direct",
  },
];

describe("material library filtering", () => {
  it("normalizes full-width text, separators, and case", () => {
    assert.equal(normalizeSearchText("  ＩＯＲ_conserve-energy  "), "ior conserve energy");
  });

  it("searches names, Japanese tags, and POV-Ray keywords", () => {
    const defaults = { category: "all", support: "all" };
    assert.deepEqual(
      filterMaterialLibraryItems(ITEMS, { ...defaults, query: "透明 IOR" }, "ja").map(
        ({ id }) => id,
      ),
      ["glass-02"],
    );
    assert.deepEqual(
      filterMaterialLibraryItems(
        ITEMS,
        { ...defaults, query: "conserve energy" },
        "en",
      ).map(({ id }) => id),
      ["metal-01"],
    );
  });

  it("combines category and support filters and sorts names naturally", () => {
    assert.deepEqual(
      filterMaterialLibraryItems(
        ITEMS,
        { query: "", category: "glass", support: "all" },
        "en",
      ).map(({ id }) => id),
      ["glass-01", "glass-02"],
    );
    assert.deepEqual(
      filterMaterialLibraryItems(
        ITEMS,
        { query: "", category: "glass", support: "stored" },
        "en",
      ).map(({ id }) => id),
      ["glass-01"],
    );
  });
});

describe("material usage", () => {
  it("counts every object assignment", () => {
    assert.equal(countMaterialUsage("glass-02", ["glass-02", "metal-01", "glass-02"]), 2);
    assert.equal(countMaterialUsage("unused", ["glass-02", "metal-01"]), 0);
  });
});
