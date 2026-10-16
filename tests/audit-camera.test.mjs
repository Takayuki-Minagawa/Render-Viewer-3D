import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createServer } from 'vite';

let server, calculateCameraFit, includeCameraDistance;
before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  ({ calculateCameraFit } = await server.ssrLoadModule('/src/three/camera-fit.ts'));
  ({ includeCameraDistance } = await server.ssrLoadModule('/src/three/camera-constraints.ts'));
});
after(() => server?.close());

for (const size of [0.01, 1, 100]) {
  for (const projection of ['perspective', 'orthographic']) {
    test(`${size}m ${projection} saved fit survives real OrbitControls updates and its first zoom`, () => {
      const bounds = new THREE.Box3(new THREE.Vector3().setScalar(-size / 2), new THREE.Vector3().setScalar(size / 2));
      const fit = calculateCameraFit(bounds, 45, 1, new THREE.Vector3(1, 0.75, 1));
      const camera = projection === 'perspective' ? new THREE.PerspectiveCamera(45, 1) : new THREE.OrthographicCamera(-size, size, size, -size);
      const controls = new OrbitControls(camera);
      controls.minDistance = 2.5; controls.maxDistance = 45;
      camera.position.copy(fit.position); camera.near = fit.near; camera.far = fit.far;
      controls.target.copy(fit.target);
      const savedDistance = camera.position.distanceTo(controls.target);
      includeCameraDistance(controls, savedDistance);
      camera.updateProjectionMatrix();
      for (let i = 0; i < 3; i++) controls.update();
      assert.ok(camera.position.distanceTo(fit.position) < savedDistance * 1e-12);
      camera.updateMatrixWorld();
      const projected = fit.target.clone().project(camera);
      assert.ok(projected.z > -1 && projected.z < 1, 'saved target remains within the clip planes');
      controls.dollyOut(0.95);
      const afterZoom = camera.position.distanceTo(controls.target);
      const ratio = afterZoom / savedDistance;
      assert.ok(ratio > 0.9 && ratio < 1.1, 'one zoom cannot jump to an old model scale');
      if (projection === 'perspective') assert.ok(afterZoom > savedDistance);
      else assert.ok(camera.zoom < 1);
    });
  }
}

test('ordinary navigation preserves Fit limits instead of expanding them on every model update', () => {
  const limits = { minDistance: 0.002, maxDistance: 200 };
  for (const distance of [0.002, 0.003, 10, 199, 200]) includeCameraDistance(limits, distance);
  assert.deepEqual(limits, { minDistance: 0.002, maxDistance: 200 });
  for (const distance of [NaN, Infinity, 0, -1]) includeCameraDistance(limits, distance);
  assert.deepEqual(limits, { minDistance: 0.002, maxDistance: 200 });
});
