import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createServer } from "vite";
import * as THREE from "three";
let server, DemandRenderer, AnimationPlayer, createExportSnapshot;
before(async () => {
  server = await createServer({ appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  ({ DemandRenderer } = await server.ssrLoadModule("/src/three/demand-renderer.ts"));
  ({ AnimationPlayer } = await server.ssrLoadModule("/src/three/animation-player.ts"));
  ({ createExportSnapshot } = await server.ssrLoadModule("/src/three/scene-export.ts"));
});
after(() => server?.close());
test("demand renderer coalesces invalidations and leaves an idle scene without frames", () => {
  const queued = new Map(); let id = 0, renders = 0;
  const scheduler = new DemandRenderer(() => { renders++; return false; }, callback => { queued.set(++id, callback); return id; }, id => queued.delete(id));
  scheduler.request(); scheduler.request(); scheduler.request(); assert.equal(queued.size, 1);
  const tick = (time) => { const entry = queued.entries().next().value; if (entry) { queued.delete(entry[0]); entry[1](time); } };
  tick(0); assert.equal(renders, 1); assert.equal(queued.size, 0);
  tick(10_000); assert.equal(renders, 1);
  scheduler.request(); scheduler.dispose(); assert.equal(queued.size, 0);
  scheduler.request(); assert.equal(queued.size, 0);
});
test("continuous frames stop when animation stops and visibility pause resets elapsed time", () => {
  let callback, active = true; const deltas = [];
  const scheduler = new DemandRenderer(delta => { deltas.push(delta); return active; }, cb => { callback = cb; return 1; }, () => { callback = null; });
  scheduler.request(); callback(0); callback(16); assert.equal(deltas[1], .016);
  scheduler.pause(); scheduler.request(); active = false; callback(20_000); assert.equal(deltas[2], 0);
  scheduler.dispose();
});
test("animation play, pause, seek, speed and release preserve editable wrapper transform", () => {
  const wrapper = new THREE.Group(); wrapper.position.x = 50;
  const root = new THREE.Group(); root.name = "part"; wrapper.add(root);
  const clip = new THREE.AnimationClip("move", 2, [new THREE.NumberKeyframeTrack(".position[x]", [0, 2], [0, 10])]);
  const player = new AnimationPlayer(); player.select(root, clip); player.play(); player.update(.5);
  assert.equal(root.position.x, 2.5); assert.equal(wrapper.position.x, 50);
  player.pause(); player.update(.5); assert.equal(root.position.x, 2.5);
  player.seek(1); assert.equal(root.position.x, 5);
  player.setSpeed(2); player.play(); player.update(.25); assert.equal(root.position.x, 7.5);
  player.update(1); assert.equal(player.playing, false); assert.equal(root.position.x, 10);
  player.play(); player.update(.5); assert.equal(root.position.x, 5);
  player.clear(); assert.equal(root.position.x, 0); assert.equal(player.root, null);
});
test("GLB snapshot excludes helpers and isolates geometry, material, hierarchy and animation targets", () => {
  const liveScene = new THREE.Scene(); const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); mesh.name = "part"; root.add(mesh);
  root.position.x = 3;
  root.animations = [new THREE.AnimationClip("move", 1, [new THREE.VectorKeyframeTrack("part.position", [0, 1], [0, 0, 0, 1, 0, 0])])];
  liveScene.add(root, new THREE.GridHelper());
  const exported = createExportSnapshot([root]);
  assert.equal(exported.scene.children.length, 1); assert.equal(root.parent, liveScene);
  const copiedMesh = exported.scene.children[0].children[0];
  assert.notEqual(copiedMesh.geometry, mesh.geometry); assert.notEqual(copiedMesh.material, mesh.material);
  assert.equal(exported.clips[0].tracks[0].name, `${mesh.uuid}.position`);
  root.position.x = 9; mesh.position.y = 5; mesh.geometry.dispose();
  assert.equal(exported.scene.children[0].position.x, 3); assert.equal(copiedMesh.position.y, 0);
  exported.dispose();
});
test("HDR preflight rejects allocation bombs, unknown orientation and invalid formats", async () => {
  const { inspectHdrHeader } = await server.ssrLoadModule("/src/three/hdr-environment.ts");
  const bytes = value => new TextEncoder().encode(value);
  const header = size => bytes(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n${size}\n`);
  assert.deepEqual(inspectHdrHeader(header('-Y 512 +X 1024')), { width: 1024, height: 512 });
  assert.throws(() => inspectHdrHeader(header('-Y 8192 +X 8192')), /limit/);
  assert.throws(() => inspectHdrHeader(header('+Y 512 +X 1024')), /orientation/);
  assert.throws(() => inspectHdrHeader(bytes('not an HDR')), /Radiance/);
});
