import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'vite';
import * as THREE from 'three';

let server, visibleBounds;
before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  ({ visibleBounds } = await server.ssrLoadModule('/src/three/visible-bounds.ts'));
});
after(() => server?.close());

function countReads(attribute) {
  let reads = 0;
  const getX = attribute.getX;
  attribute.getX = function (index) { reads++; return getX.call(this, index); };
  return () => reads;
}

test('fitting repeated instances scans shared vertices once instead of once per instance', () => {
  const geometry = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
  const instances = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 500);
  for (let i = 0; i < instances.count; i++) instances.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * 4, 0, 0));
  const reads = countReads(geometry.getAttribute('position'));
  const bounds = visibleBounds([instances]);
  assert.deepEqual(bounds.min.toArray(), [-1, -1, -1]);
  assert.deepEqual(bounds.max.toArray(), [1997, 1, 1]);
  assert.ok(reads() <= geometry.getAttribute('position').count * 2, `Repeated shared geometry ${reads()} times`);
  geometry.dispose(); instances.material.dispose(); instances.dispose();
});

for (const relative of [true, false]) test(`instanced morph bounds contain signed current poses with bounded vertex work (relative=${relative})`, () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 2, 0, 0, 0, 2, 0, 10000, 10000, 10000], 3));
  geometry.setIndex([0, 1, 2]);
  geometry.morphAttributes.position = [
    new THREE.Float32BufferAttribute([3, 4, 0, 4, 3, 0, 2, -1, 0, 20000, 20000, 20000], 3),
    new THREE.Float32BufferAttribute([-2, 0, 3, 1, 1, 2, 5, 0, 1, 30000, 30000, 30000], 3),
  ];
  geometry.morphTargetsRelative = relative;
  const material = new THREE.MeshBasicMaterial(), instances = new THREE.InstancedMesh(geometry, material, 500);
  const pose = new THREE.Mesh(geometry, material), matrix = new THREE.Matrix4();
  const exact = [];
  for (let i = 0; i < instances.count; i++) {
    pose.morphTargetInfluences = [i % 2 ? -0.5 : 1.5, i % 3 ? 0.25 : -1];
    instances.setMorphAt(i, pose);
    matrix.makeRotationZ(i / 7).setPosition(i, 0, 0);
    instances.setMatrixAt(i, matrix);
    for (let vertex = 0; vertex < 3; vertex++) exact.push(pose.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(matrix));
  }
  const readCounts = [geometry.getAttribute('position'), ...geometry.morphAttributes.position].map(countReads);
  const bounds = visibleBounds([instances]);
  for (const reads of readCounts) assert.ok(reads() <= 6, `Per-instance vertex scan detected: ${reads()}`);
  for (const point of exact) assert.ok(bounds.clone().expandByScalar(1e-4).containsPoint(point), `Excluded pose vertex ${point.toArray()}`);
  assert.ok(bounds.max.x < 600, 'Unused attribute vertices must not inflate bounds');
  assert.ok(bounds.min.toArray().every(Number.isFinite) && bounds.max.toArray().every(Number.isFinite));
  geometry.dispose(); material.dispose(); instances.dispose();
});
