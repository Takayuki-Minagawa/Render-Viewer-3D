import * as THREE from 'three';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
const geometry = new THREE.SphereGeometry(1, 1024, 512);
const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
mesh.updateMatrixWorld(true); geometry.computeBoundingSphere();
const rays = Array.from({ length: 120 }, (_, i) => {
  const angle = i * 2.399963229728653;
  const origin = new THREE.Vector3(3 * Math.cos(angle), (i % 7 - 3) / 3, 3 * Math.sin(angle));
  return new THREE.Raycaster(origin, origin.clone().negate().normalize());
});
const times = []; let hits = 0;
for (let i = 0; i < rays.length; i++) {
  const start = performance.now(); const result = rays[i].intersectObject(mesh, false); const elapsed = performance.now() - start;
  if (i >= 20) { times.push(elapsed); hits += result.length; }
}
times.sort((a, b) => a - b);
const p95 = times[Math.ceil(times.length * .95) - 1];
console.log(JSON.stringify({runtime:process.version,platform:`${os.platform()} ${os.release()} ${os.arch()}`,cpu:os.cpus()[0].model,three:THREE.REVISION,fixture:'SphereGeometry(1,1024,512), indexed, DoubleSide, all intersections',triangles:geometry.index.count/3,warmup:20,samples:times.length,hits,p50Ms:times[49],p95Ms:p95,maxMs:times.at(-1),bvhGateExceeded:p95 > 50},null,2));
geometry.dispose(); mesh.material.dispose();
