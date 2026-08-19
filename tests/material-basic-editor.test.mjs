import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer } from "vite";

let server;
let IOR_PRESETS;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ IOR_PRESETS } = await server.ssrLoadModule(
    "/src/ui/material-basic-editor.ts",
  ));
});

after(async () => {
  await server?.close();
});

describe("material IOR presets", () => {
  it("uses the documented Water and Diamond values", () => {
    const values = Object.fromEntries(
      IOR_PRESETS.map(({ label, value }) => [label, value]),
    );
    assert.equal(values["material.iorWater"], 1.33);
    assert.equal(values["material.iorDiamond"], 2.42);
  });
});
