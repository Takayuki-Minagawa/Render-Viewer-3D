import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as THREE from "three";
import { createServer } from "vite";

let server;
let calculateCameraFit;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ calculateCameraFit } = await server.ssrLoadModule(
    "/src/three/camera-fit.ts",
  ));
});

after(async () => {
  await server?.close();
});

describe("camera auto fit", () => {
  it("frames wide bounds using the limiting horizontal field of view", () => {
    const bounds = new THREE.Box3(
      new THREE.Vector3(-10, -1, -1),
      new THREE.Vector3(10, 1, 1),
    );
    const portrait = calculateCameraFit(
      bounds,
      45,
      0.5,
      new THREE.Vector3(0, 0, 1),
    );
    const landscape = calculateCameraFit(
      bounds,
      45,
      2,
      new THREE.Vector3(0, 0, 1),
    );

    assert.ok(portrait.position.z > landscape.position.z);
    assert.deepEqual(portrait.target.toArray(), [0, 0, 0]);
    assert.ok(portrait.near > 0);
    assert.ok(portrait.far > portrait.near);
  });

  it("supports tiny, huge, and degenerate finite bounds", () => {
    for (const extent of [0, 1e-9, 1e8]) {
      const fit = calculateCameraFit(
        new THREE.Box3(
          new THREE.Vector3(-extent, -extent, -extent),
          new THREE.Vector3(extent, extent, extent),
        ),
        45,
        1,
        new THREE.Vector3(),
      );
      assert.ok(fit.position.toArray().every(Number.isFinite));
      assert.ok(fit.near > 0);
      assert.ok(fit.far > fit.near);
      assert.ok(fit.maxDistance > fit.minDistance);
    }
  });

  it("rejects empty and non-finite bounds", () => {
    assert.throws(
      () =>
        calculateCameraFit(
          new THREE.Box3(),
          45,
          1,
          new THREE.Vector3(1, 1, 1),
        ),
      /empty bounds/,
    );
    assert.throws(
      () =>
        calculateCameraFit(
          new THREE.Box3(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(Number.POSITIVE_INFINITY, 1, 1),
          ),
          45,
          1,
          new THREE.Vector3(1, 1, 1),
        ),
      /non-finite bounds/,
    );
  });
});
