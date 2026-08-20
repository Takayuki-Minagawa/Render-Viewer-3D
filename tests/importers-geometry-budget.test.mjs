import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as THREE from "three";
import { createServer } from "vite";

let assertRenderableGeometryBudget;
let server;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ assertRenderableGeometryBudget } = await server.ssrLoadModule(
    "/src/importers/geometry-budget.ts",
  ));
});

after(async () => {
  await server?.close();
});

describe("renderable geometry budget", () => {
  it("counts meshes, points, and lines using rendered references", () => {
    const root = new THREE.Group();
    root.add(
      new THREE.Mesh(
        new THREE.BufferGeometry()
          .setAttribute(
            "position",
            new THREE.Float32BufferAttribute(
              [0, 0, 0, 1, 0, 0, 0, 1, 0],
              3,
            ),
          ),
        new THREE.MeshBasicMaterial(),
      ),
      new THREE.Points(
        new THREE.BufferGeometry().setAttribute(
          "position",
          new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1], 3),
        ),
        new THREE.PointsMaterial(),
      ),
      new THREE.LineSegments(
        new THREE.BufferGeometry().setAttribute(
          "position",
          new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3),
        ),
        new THREE.LineBasicMaterial(),
      ),
    );

    assert.deepEqual(
      assertRenderableGeometryBudget(root, "Fixture", {
        maxSceneNodes: 4,
        maxDepth: 1,
        maxRenderableObjects: 3,
        maxPositionVertices: 7,
        maxVertexReferences: 7,
        maxPrimitives: 4,
      }),
      {
        sceneNodes: 4,
        maxDepth: 1,
        renderableObjects: 3,
        positionVertices: 7,
        vertexReferences: 7,
        primitives: 4,
      },
    );
  });

  it("rejects each limit before normalization can scan unbounded output", () => {
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          [0, 0, 0, 1, 0, 0, 0, 1, 0],
          3,
        ),
      ),
      new THREE.MeshBasicMaterial(),
    );
    const root = new THREE.Group().add(mesh);

    assert.throws(
      () =>
        assertRenderableGeometryBudget(root, "Fixture", {
          maxSceneNodes: 2,
          maxDepth: 1,
          maxRenderableObjects: 1,
          maxPositionVertices: 3,
          maxVertexReferences: 2,
          maxPrimitives: 1,
        }),
      /geometry safety budget/u,
    );
  });

  it("rejects indexed geometry whose position buffer exceeds the vertex limit", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex([0, 1, 2]);
    const originalGetAttribute = geometry.getAttribute.bind(geometry);
    geometry.getAttribute = (name) =>
      name === "position"
        ? { count: 2_000_001 }
        : originalGetAttribute(name);
    const root = new THREE.Group().add(
      new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()),
    );

    assert.throws(
      () => assertRenderableGeometryBudget(root, "Fixture"),
      /2000001\/2000000 position vertices/u,
    );
  });

  it("fails fast on deep and wide trees and rejects cycles", () => {
    const deepRoot = new THREE.Group();
    let parent = deepRoot;
    for (let index = 0; index < 4; index += 1) {
      const child = new THREE.Group();
      parent.add(child);
      parent = child;
    }
    const budget = {
      maxSceneNodes: 10,
      maxDepth: 3,
      maxRenderableObjects: 0,
      maxPositionVertices: 0,
      maxVertexReferences: 0,
      maxPrimitives: 0,
    };
    assert.throws(
      () => assertRenderableGeometryBudget(deepRoot, "Deep", budget),
      /4\/3 depth/u,
    );

    const wideRoot = new THREE.Group();
    wideRoot.add(
      new THREE.Group(),
      new THREE.Group(),
      new THREE.Group(),
    );
    assert.throws(
      () =>
        assertRenderableGeometryBudget(wideRoot, "Wide", {
          ...budget,
          maxSceneNodes: 3,
          maxDepth: 1,
        }),
      /4\/3 scene nodes/u,
    );

    const cyclicRoot = new THREE.Group();
    cyclicRoot.children.push(cyclicRoot);
    assert.throws(
      () =>
        assertRenderableGeometryBudget(cyclicRoot, "Cycle", {
          ...budget,
          maxSceneNodes: 2,
        }),
      /not a valid Object3D tree/u,
    );
  });
});
