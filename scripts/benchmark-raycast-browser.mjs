import { chromium } from '@playwright/test';
import os from 'node:os';
const browser=await chromium.launch();
try {
 const page=await browser.newPage(); await page.route('**/@vite/client',route=>route.fulfill({contentType:'application/javascript',body:''})); await page.goto('http://127.0.0.1:4173/Render-Viewer-3D/');
 const result=await page.evaluate(async()=>{
  const THREE=await import('/Render-Viewer-3D/node_modules/three/build/three.module.js');
  const geometry=new THREE.SphereGeometry(1,1024,512),mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));mesh.updateMatrixWorld(true);geometry.computeBoundingSphere();
  const times=[];let hits=0;
  for(let i=0;i<120;i++){
   const angle=i*2.399963229728653,origin=new THREE.Vector3(3*Math.cos(angle),(i%7-3)/3,3*Math.sin(angle));
   const ray=new THREE.Raycaster(origin,origin.clone().negate().normalize());
   const start=performance.now(),result=ray.intersectObject(mesh,false),elapsed=performance.now()-start;
   if(i>=20){times.push(elapsed);hits+=result.length;}
  }
  times.sort((a,b)=>a-b);const p95=times[94];
  const result={three:THREE.REVISION,fixture:'SphereGeometry(1,1024,512), indexed, DoubleSide, all intersections',triangles:geometry.index.count/3,warmup:20,samples:times.length,hits,p50Ms:times[49],p95Ms:p95,maxMs:times.at(-1),bvhGateExceeded:p95>50};geometry.dispose();mesh.material.dispose();return result;
 });
 console.log(JSON.stringify({browser:browser.version(),platform:`${os.platform()} ${os.release()} ${os.arch()}`,cpu:os.cpus()[0].model,...result},null,2));
}finally{await browser.close();}
