import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'vite';
import * as THREE from 'three';

let server, SceneStore, SceneHistory, ProjectAssets, ImportedAssetStore, MaterialImageAssetStore, createDefaultSceneModel, ReviewController, validateScene, encodeProject, decodeProject, geometry, review;
before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  ({ SceneStore } = await server.ssrLoadModule('/src/app/scene-store.ts'));
  ({ SceneHistory } = await server.ssrLoadModule('/src/app/scene-history.ts'));
  ({ ProjectAssets } = await server.ssrLoadModule('/src/app/project-assets.ts'));
  ({ ImportedAssetStore } = await server.ssrLoadModule('/src/three/imported-asset-store.ts'));
  ({ MaterialImageAssetStore } = await server.ssrLoadModule('/src/three/material/image-asset-store.ts'));
  ({ createDefaultSceneModel } = await server.ssrLoadModule('/src/model/default-scene.ts'));
  ({ ReviewController } = await server.ssrLoadModule('/src/app/review-controller.ts'));
  ({ validateScene } = await server.ssrLoadModule('/src/app/project-validation.ts'));
  ({ encodeProject, decodeProject } = await server.ssrLoadModule('/src/app/project-format.ts'));
  geometry = await server.ssrLoadModule('/src/three/review-geometry.ts');
  review = await server.ssrLoadModule('/src/model/review-model.ts');
});
after(() => server?.close());

function harness() {
  const store = new SceneStore(createDefaultSceneModel()), assets = new ImportedAssetStore(), images = new MaterialImageAssetStore(), sources = new ProjectAssets();
  const history = new SceneHistory(store, assets, images, sources);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial()); mesh.userData.sceneModelId = 'box-01';
  let clip = { axis: 'off', offset: 0, reverse: false, cap: false, capColor: '#e9a23b' }, picking = false, editable = true, root = mesh;
  const viewport = {
    getClipping: () => structuredClone(clip), setClipping: value => { clip = value; },
    resolveAnchor: anchor => geometry.resolveReviewAnchor(root, anchor),
    isAnchorVisible: anchor => geometry.reviewAnchorVisible(root, anchor),
    getBounds: () => geometry.reviewBounds(root), projectPoint: point => ({ x: point.x, y: point.y, visible: true }),
    setPicking: active => { picking = active; }, requestRender() {}, getSelectedRootId: () => 'box-01',
  };
  const controller = new ReviewController(store, viewport, { canEdit: () => editable });
  const anchor = (x, y, z) => geometry.createReviewAnchor({ object: mesh, point: mesh.localToWorld(new THREE.Vector3(x, y, z)) });
  return { store, history, assets, images, sources, mesh, viewport, controller, anchor, get picking() { return picking; }, set editable(value) { editable = value; }, set root(value) { root = value; },
    dispose() { controller.dispose(); history.dispose(); assets.dispose(); images.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); } };
}

test('schema 2 migrates to schema 3 with an empty versioned review; review validation rejects corrupt leaves', () => {
  const old = createDefaultSceneModel(); old.schemaVersion = 2; delete old.review;
  const migrated = validateScene(old); assert.equal(migrated.schemaVersion, 3); assert.deepEqual(migrated.review, review.createReviewModel()); assert.equal(old.schemaVersion, 2);
  for (const mutate of [model => { model.review.version = 99; }, model => { model.review = null; }, model => { model.review.views = new Array(201).fill({}); }]) {
    const bad = createDefaultSceneModel(); mutate(bad); assert.throws(() => validateScene(bad));
  }
});

test('surface anchors survive root movement and nonuniform scale but reject geometry replacement', () => {
  const h = harness(), anchor = h.anchor(1, 1, 0);
  h.mesh.position.set(3, 4, 5); h.mesh.scale.set(2, 3, 4); h.mesh.rotation.z = Math.PI / 2;
  const resolved = h.viewport.resolveAnchor(anchor); assert.ok(Math.abs(resolved.x) < 1e-12); assert.ok(Math.abs(resolved.y - 6) < 1e-12); assert.equal(resolved.z, 5);
  h.mesh.geometry = new THREE.BoxGeometry(4, 4, 4); assert.equal(h.viewport.resolveAnchor(anchor), null);
  h.dispose();
});

test('imported node anchors detect changed placement at the same path and ignore runtime asset identity', () => {
  const wrapper = new THREE.Group(); wrapper.userData.importedAssetId = 'old-runtime';
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); mesh.name = 'Part'; mesh.userData.sceneModelId = 'root'; mesh.userData.importedNodeId = '0/0'; wrapper.add(mesh);
  const anchor = geometry.createReviewAnchor({ object: mesh, point: new THREE.Vector3(.5, 0, 0) });
  wrapper.userData.importedAssetId = 'new-runtime'; wrapper.position.x = 10;
  assert.equal(geometry.resolveReviewAnchor(wrapper, anchor).x, 10.5);
  mesh.position.x = 1; assert.equal(geometry.resolveReviewAnchor(wrapper, anchor), null);
  mesh.geometry.dispose(); mesh.material.dispose();
});

test('unsupported deformed or instanced meshes do not create misleading static anchors', () => {
  const h = harness();
  h.mesh.geometry.morphAttributes.position = [new THREE.Float32BufferAttribute([0, 0, 0], 3)]; assert.equal(h.anchor(1, 0, 0), null);
  delete h.mesh.geometry.morphAttributes.position;
  h.mesh.animations = [new THREE.AnimationClip('move', 1, [])]; assert.equal(h.anchor(1, 0, 0), null);
  h.dispose();
});

test('named views restore clipping and camera; visibility recall is an undoable edit without camera rollback', () => {
  const h = harness(); h.viewport.setClipping({ axis: 'x', offset: 1, reverse: true, cap: true, capColor: '#123456' });
  h.controller.saveView('Inspection'); const id = h.store.getSnapshot().review.views[0].id;
  h.store.update(draft => { draft.objects[0].visible = false; draft.camera.position.x = 20; });
  h.viewport.setClipping({ axis: 'off', offset: 0, reverse: false, cap: false, capColor: '#e9a23b' });
  h.controller.applyView(id); assert.equal(h.store.getSnapshot().objects[0].visible, true); assert.equal(h.store.getSnapshot().camera.position.x, 6.5); assert.equal(h.viewport.getClipping().capColor, '#123456');
  h.history.undo(); assert.equal(h.store.getSnapshot().objects[0].visible, false); assert.equal(h.store.getSnapshot().camera.position.x, 6.5);
  h.history.redo(); assert.equal(h.store.getSnapshot().objects[0].visible, true);
  h.dispose();
});

test('annotation CRUD, orphan preservation, reattachment and undo use the model history', () => {
  const h = harness(); h.controller.start('annotation', 'Note', '<img src=x onerror=alert(1)>'); assert.equal(h.picking, true);
  assert.equal(h.controller.pick(h.anchor(1, 0, 0)), true); assert.equal(h.picking, false);
  const id = h.store.getSnapshot().review.annotations[0].id; h.controller.rename('annotations', id, 'Changed', 'Safe text');
  assert.equal(h.store.getSnapshot().review.annotations[0].text, 'Safe text'); h.history.undo(); assert.equal(h.store.getSnapshot().review.annotations[0].name, 'Note');
  h.root = undefined; assert.equal(h.controller.displayItems()[0].unresolved, true); assert.doesNotThrow(() => validateScene(h.store.getSnapshot()));
  h.root = h.mesh; h.controller.reattach(id); h.controller.pick(h.anchor(0, 1, 0)); assert.equal(h.store.getSnapshot().review.annotations[0].anchor.localPosition.y, 1);
  h.controller.remove('annotations', id); assert.equal(h.store.getSnapshot().review.annotations.length, 0); h.history.undo(); assert.equal(h.store.getSnapshot().review.annotations.length, 1);
  h.dispose();
});

test('multiple distances and three point angles follow current transforms; duplicate points are rejected', () => {
  const h = harness(); h.controller.start('distance', 'Edge'); h.controller.pick(h.anchor(0, 0, 0)); h.controller.pick(h.anchor(0, 0, 0));
  assert.equal(h.store.getSnapshot().review.measurements.length, 0); assert.equal(h.controller.state.pending.length, 1);
  h.controller.pick(h.anchor(1, 0, 0)); h.mesh.scale.x = 2;
  assert.equal(h.controller.displayItems()[0].text, '2000 mm'); h.controller.setUnit('m'); assert.equal(h.controller.displayItems()[0].text, '2 m');
  h.controller.start('angle', 'Corner'); h.controller.pick(h.anchor(1, 0, 0)); h.controller.pick(h.anchor(0, 0, 0)); h.controller.pick(h.anchor(0, 1, 0));
  assert.equal(h.controller.displayItems()[1].text, '90°'); assert.equal(h.store.getSnapshot().review.measurements.length, 2);
  assert.equal(review.measureAngle({x:0,y:0,z:0}, {x:0,y:0,z:0}, {x:1,y:0,z:0}), null);
  h.dispose();
});

test('world AABB is recomputed after rotation and ignores hidden meshes', () => {
  const h = harness(); h.mesh.scale.set(2, 1, 1); h.controller.addBounds('Bounds');
  assert.match(h.controller.displayItems()[0].text, /X 4000 mm · Y 2000 mm/);
  h.mesh.rotation.z = Math.PI / 2; assert.match(h.controller.displayItems()[0].text, /X 2000 mm · Y 4000 mm/);
  h.mesh.visible = false; assert.equal(h.controller.displayItems()[0].unresolved, true);
  h.dispose();
});

test('triangle vertex snap uses a pixel radius and excludes clipped vertices', () => {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-1,-1,0, 1,-1,0, 0,1,0], 3)), new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld(); const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, .1, 100); camera.position.z = 5; camera.updateMatrixWorld();
  const hit = { object: mesh, face: {a:0,b:1,c:2}, point: new THREE.Vector3(-.96, -.96, 0) }, canvas = {getBoundingClientRect: () => ({width:400,height:400})};
  const snapped = geometry.snapReviewIntersection(hit, camera, canvas); assert.deepEqual(snapped.point.toArray(), [-1,-1,0]);
  const clipped = geometry.snapReviewIntersection(hit, camera, canvas, [new THREE.Plane(new THREE.Vector3(1,0,0),0)]); assert.equal(clipped, hit);
  const distant = {...hit, point: new THREE.Vector3(0,0,0)}; assert.equal(geometry.snapReviewIntersection(distant,camera,canvas), distant);
  mesh.geometry.dispose(); mesh.material.dispose();
});

test('review state round trips with project files, including unresolved anchors and angular measurements', async () => {
  const h = harness(); h.controller.saveView('Front'); h.controller.start('annotation', 'Note', 'Keep this'); h.controller.pick(h.anchor(1,0,0));
  h.controller.start('distance', 'Width'); h.controller.pick(h.anchor(-1,0,0)); h.controller.pick(h.anchor(1,0,0));
  const original = h.store.getSnapshot(), decoded = await decodeProject(await encodeProject(original, h.sources, h.images));
  assert.deepEqual(decoded.model.review, JSON.parse(JSON.stringify(original.review)));
  const bad = structuredClone(decoded.model); bad.review.annotations[0].anchor.localPosition.x = Infinity; assert.throws(() => validateScene(bad));
  const duplicate = structuredClone(decoded.model); duplicate.review.views.push(duplicate.review.views[0]); assert.throws(() => validateScene(duplicate));
  const wrongPoints = structuredClone(decoded.model); wrongPoints.review.measurements[0].anchors.pop(); assert.throws(() => validateScene(wrongPoints));
  h.dispose();
});

test('cancel and exclusive-operation guards keep partial measurements outside saved history', () => {
  const h = harness(); h.controller.start('angle', 'Draft'); h.controller.pick(h.anchor(1,0,0)); h.controller.cancel();
  assert.equal(h.store.getSnapshot().review.measurements.length, 0); assert.equal(h.history.canUndo, false); assert.equal(h.picking, false);
  h.controller.start('distance', 'Draft'); h.editable = false; h.controller.pick(h.anchor(0,0,0)); assert.equal(h.controller.state.mode, null);
  assert.throws(() => h.controller.saveView('Busy')); assert.equal(h.store.getSnapshot().review.views.length, 0); h.dispose();
});

test('project replacement cancels partially picked tools and a geometry change requires a fresh measurement', () => {
  const h = harness(); h.controller.start('distance', 'Partial'); h.controller.pick(h.anchor(0,0,0));
  h.store.replace(createDefaultSceneModel()); assert.equal(h.controller.state.mode, null); assert.equal(h.picking, false);
  h.controller.start('distance', 'Changed'); h.controller.pick(h.anchor(0,0,0)); h.mesh.geometry = new THREE.BoxGeometry(4,4,4);
  h.controller.pick(h.anchor(1,0,0)); assert.equal(h.store.getSnapshot().review.measurements.length, 0); assert.equal(h.controller.state.mode, null);
  assert.match(h.controller.state.message, /Geometry changed/); h.dispose();
});

test('saved part visibility skips stale node paths after imported hierarchy changes', () => {
  const model = createDefaultSceneModel();
  model.imports.push({id:'root',visible:true,isolatedNodeId:'node-0',nodeOverrides:{'node-0':{visible:false,materialId:'keep'}},hierarchy:[{id:'node-0',name:'Original part',objectType:'Mesh',mesh:true,triangleCount:1,children:[]}]});
  const saved = review.captureReviewVisibility(model); model.imports[0].hierarchy[0].name = 'Different part'; model.imports[0].isolatedNodeId = null;
  model.imports[0].nodeOverrides['node-0'].visible = true;
  review.applyReviewVisibility(model, saved); assert.equal(model.imports[0].isolatedNodeId,null); assert.equal(model.imports[0].nodeOverrides['node-0'].visible,true);
});

test('new STEP captures assembly explicitly while legacy project options restore as flat', async () => {
  const h = harness(), file = new File(['STEP'], 'old.step');
  const options = {unit:'millimeter',coordinateSystem:'y-up',quality:'medium',centerModel:false,placeOnGround:false};
  h.sources.capture('cad',file,[file],options); assert.equal(h.sources.imports.get('cad').options.stepStructure,'assembly');
  h.store.update(draft => draft.imports.push({id:'cad-root',assetId:'cad',name:'Cad',format:'STEP',visible:true,transform:{position:{x:0,y:0,z:0},rotationDegrees:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}},materialMode:'imported',customMaterialId:null,metadata:{fileName:'old.step',format:'STEP',sizeBytes:file.size,objectCount:1,triangleCount:0,materialCount:1},hierarchy:[],warnings:[]}));
  delete h.sources.imports.get('cad').options.stepStructure;
  const decoded = await decodeProject(await encodeProject(h.store.getSnapshot(),h.sources,h.images)); assert.equal(decoded.imports.get('cad').options.stepStructure,'flat');
  h.dispose();
});
