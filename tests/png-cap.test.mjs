import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'vite';
import * as THREE from 'three';
let server, validatePngSize, createPngCamera, isClosedGeometry, canCapMesh;
before(async () => {
  server = await createServer({ appType:'custom',logLevel:'silent',server:{middlewareMode:true} });
  ({validatePngSize,createPngCamera}=await server.ssrLoadModule('/src/three/png-export.ts'));
  ({isClosedGeometry,canCapMesh}=await server.ssrLoadModule('/src/three/section-cap.ts'));
});
after(()=>server?.close());
test('PNG rejects oversize/noninteger allocations and fits cloned cameras without changing the live camera',()=>{
  for(const [width,height,limit] of [[0,1],[1,0],[Infinity,20],[1.5,2],[4097,1],[2048,2049,2048]]) assert.throws(()=>validatePngSize(width,height,limit),/PNG/);
  validatePngSize(3840,2160);validatePngSize(4096,4096);
  const p=new THREE.PerspectiveCamera(45,2,.1,100);p.position.set(1,2,3);p.zoom=2;
  const copy=createPngCamera(p,1920,1080);assert.equal(copy.aspect,16/9);assert.equal(p.aspect,2);assert.equal(copy.zoom,2);assert.deepEqual(copy.position,p.position);
  const o=new THREE.OrthographicCamera(-4,4,2,-2); const oc=createPngCamera(o,100,100);assert.equal(oc.left,-2);assert.equal(oc.right,2);assert.equal(o.left,-4);
});
test('cap accepts welded closed boxes and spheres, skips open/transparent/animated topology',()=>{
  const box=new THREE.BoxGeometry();assert.equal(isClosedGeometry(box),true);assert.equal(isClosedGeometry(box.toNonIndexed()),true);
  assert.equal(isClosedGeometry(new THREE.SphereGeometry()),true);assert.equal(isClosedGeometry(new THREE.PlaneGeometry()),false);
  const mesh=new THREE.Mesh(box,new THREE.MeshStandardMaterial());assert.equal(canCapMesh(mesh),true);
  mesh.material.transparent=true;assert.equal(canCapMesh(mesh),false);mesh.material.transparent=false;
  box.morphAttributes.position=[box.attributes.position.clone()];assert.equal(canCapMesh(mesh),false);delete box.morphAttributes.position;
  box.setDrawRange(0,3);assert.equal(isClosedGeometry(box),false);
  assert.equal(canCapMesh(new THREE.SkinnedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial())),false);
});

test('cap excludes transmission even with opaque blending and rejects incomplete material groups',()=>{
  const box=new THREE.BoxGeometry(), glass=new THREE.MeshPhysicalMaterial({transmission:1,transparent:false,opacity:1});
  assert.equal(canCapMesh(new THREE.Mesh(box,glass)),false);glass.transmission=0;
  const solid=new THREE.Mesh(box,[glass]);box.groups.forEach(group=>{group.materialIndex=0;});assert.equal(canCapMesh(solid),true);
  box.groups.pop();assert.equal(canCapMesh(solid),false);
  box.dispose();glass.dispose();
});
