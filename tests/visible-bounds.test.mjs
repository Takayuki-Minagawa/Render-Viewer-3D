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

const material = () => new THREE.MeshBasicMaterial();
const box = () => new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material());
function triangles() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    100, 0, 0, 101, 0, 0, 100, 1, 0,
    1000, 1000, 1000,
  ], 3));
  geometry.setIndex([0, 1, 2, 3, 4, 5]);
  return geometry;
}

test('camera bounds exclude hidden roots, descendants, ancestor chains and invisible materials', () => {
  const root = new THREE.Group(), visible = box(), hiddenGroup = new THREE.Group();
  const hidden = box(); hidden.position.x = 1000; hiddenGroup.add(hidden); hiddenGroup.visible = false;
  const invisible = box(); invisible.position.x = -1000; invisible.material.visible = false;
  root.add(visible, hiddenGroup, invisible);
  assert.deepEqual(visibleBounds([root]).min.toArray(), [-1, -1, -1]);
  assert.deepEqual(visibleBounds([root]).max.toArray(), [1, 1, 1]);
  assert.equal(visibleBounds([hidden]).isEmpty(), true);
  root.visible = false;
  assert.equal(visibleBounds([root]).isEmpty(), true);
});

test('camera bounds use referenced complete primitives and intersect draw ranges with visible groups', () => {
  const geometry = triangles(), first = material(), second = material();
  const mesh = new THREE.Mesh(geometry, [first, second]);
  geometry.addGroup(0, 3, 0); geometry.addGroup(3, 3, 1);
  assert.equal(visibleBounds([mesh]).max.x, 101);
  second.visible = false;
  assert.equal(visibleBounds([mesh]).max.x, 1);
  second.visible = true; geometry.setDrawRange(3, 3);
  assert.equal(visibleBounds([mesh]).min.x, 100);
  geometry.setDrawRange(0, 2);
  assert.equal(visibleBounds([mesh]).isEmpty(), true);
});

test('camera bounds apply nested world transforms and union separate scene roots', () => {
  const parent = new THREE.Group(); parent.position.set(10, 20, 30); parent.scale.setScalar(2);
  const child = box(); parent.add(child);
  const other = box(); other.position.set(-10, -20, -30);
  const result = visibleBounds([child, other]);
  assert.deepEqual(result.min.toArray(), [-11, -21, -31]);
  assert.deepEqual(result.max.toArray(), [12, 22, 32]);
});

test('camera bounds retain points and lines while omitting unused or incomplete vertices', () => {
  const points = new THREE.Points(triangles(), new THREE.PointsMaterial());
  points.geometry.setDrawRange(3, 1);
  assert.deepEqual(visibleBounds([points]).min.toArray(), [100, 0, 0]);
  assert.deepEqual(visibleBounds([points]).max.toArray(), [100, 0, 0]);
  const line = new THREE.Line(points.geometry, new THREE.LineBasicMaterial());
  assert.equal(visibleBounds([line]).isEmpty(), true);
  line.geometry.setDrawRange(0, 4);
  assert.equal(visibleBounds([line]).max.x, 100);
  const segments = new THREE.LineSegments(triangles(), new THREE.LineBasicMaterial());
  segments.geometry.setDrawRange(0, 3);
  assert.equal(visibleBounds([segments]).max.y, 0);
});

test('camera bounds follow the current morph pose', () => {
  const geometry = triangles(); geometry.setDrawRange(0, 3);
  geometry.morphAttributes.position = [new THREE.Float32BufferAttribute([
    10, 0, 0, 11, 0, 0, 10, 1, 0, 100, 0, 0, 101, 0, 0, 100, 1, 0, 1000, 1000, 1000,
  ], 3)];
  const mesh = new THREE.Mesh(geometry, material()); mesh.morphTargetInfluences[0] = .5;
  assert.deepEqual(visibleBounds([mesh]).min.toArray(), [5, 0, 0]);
  assert.deepEqual(visibleBounds([mesh]).max.toArray(), [6, 1, 0]);
});

test('camera bounds include instance transforms and current per-instance morph poses', () => {
  const geometry = triangles(); geometry.setDrawRange(0, 3);
  geometry.morphAttributes.position = [new THREE.Float32BufferAttribute([
    10, 0, 0, 11, 0, 0, 10, 1, 0, 100, 0, 0, 101, 0, 0, 100, 1, 0, 1000, 1000, 1000,
  ], 3)];
  const instances = new THREE.InstancedMesh(geometry, material(), 2);
  instances.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-20, 0, 0));
  instances.setMatrixAt(1, new THREE.Matrix4().makeTranslation(20, 0, 0));
  const pose = new THREE.Mesh(geometry, material());
  pose.morphTargetInfluences[0] = 0; instances.setMorphAt(0, pose);
  pose.morphTargetInfluences[0] = 1; instances.setMorphAt(1, pose);
  assert.deepEqual(visibleBounds([instances]).min.toArray(), [-20, 0, 0]);
  assert.deepEqual(visibleBounds([instances]).max.toArray(), [31, 1, 0]);
});

test('camera bounds follow skinned vertices without including unused geometry', () => {
  const geometry = triangles(); geometry.setDrawRange(0, 3);
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(7 * 4), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Array.from({ length: 7 * 4 }, (_, i) => i % 4 === 0 ? 1 : 0), 4));
  const bone = new THREE.Bone(), mesh = new THREE.SkinnedMesh(geometry, material());
  mesh.add(bone); mesh.bind(new THREE.Skeleton([bone])); bone.position.x = 5;
  assert.deepEqual(visibleBounds([mesh]).min.toArray(), [5, 0, 0]);
  assert.deepEqual(visibleBounds([mesh]).max.toArray(), [6, 1, 0]);
});

test('empty scenes and geometry without position attributes do not invent bounds', () => {
  assert.equal(visibleBounds([]).isEmpty(), true);
  assert.equal(visibleBounds([new THREE.Group(), new THREE.Mesh(new THREE.BufferGeometry(), material())]).isEmpty(), true);
});
