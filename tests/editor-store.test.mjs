import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer } from "vite";

let server;
let EditorStore;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ EditorStore } = await server.ssrLoadModule("/src/app/editor-store.ts"));
});

after(async () => {
  await server?.close();
});

describe("EditorStore", () => {
  it("keeps transient selection and transform mode outside SceneModel", () => {
    const store = new EditorStore({
      selectedObjectId: "box-01",
      transformMode: "translate",
    });
    const states = [];
    const unsubscribe = store.subscribe((state) => states.push(state));

    store.setSelectedObjectId("ground-01");
    store.setTransformMode("rotate");
    store.setTransformMode("rotate");

    assert.deepEqual(store.getSnapshot(), {
      selectedObjectId: "ground-01",
      transformMode: "rotate",
    });
    assert.equal(Object.isFrozen(store.getSnapshot()), true);
    assert.equal(states.length, 3);

    unsubscribe();
  });
});
