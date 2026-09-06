import { createServer } from 'vite';
import { performance } from 'node:perf_hooks';
const server = await createServer({ appType:'custom', logLevel:'silent', server:{middlewareMode:true} });
try {
  const { SceneStore } = await server.ssrLoadModule('/src/app/scene-store.ts');
  const { createDefaultSceneModel } = await server.ssrLoadModule('/src/model/default-scene.ts');
  const { freezeDeep } = await server.ssrLoadModule('/src/model/immutable.ts');
  const original = createDefaultSceneModel();
  original.objects = Array.from({length:1000}, (_,i)=>({...structuredClone(original.objects[0]),id:`object-${i}`}));
  let baseline = freezeDeep(structuredClone(original)); const store = new SceneStore(original);
  const measure = operation => {
    const samples=[];
    for(let i=0;i<120;i++){const start=performance.now();operation(i);if(i>=20)samples.push(performance.now()-start);}
    samples.sort((a,b)=>a-b);return {medianMs:samples[50],p95Ms:samples[95]};
  };
  const fullClone = measure(i=>{const draft=structuredClone(baseline);draft.camera.position.x=i;baseline=freezeDeep(draft);});
  const structuralSharing = measure(i=>store.update(d=>{d.camera.position.x=i;}));
  console.log(JSON.stringify({node:process.version,objects:1000,warmup:20,samples:100,fullClone,structuralSharing},null,2));
} finally { await server.close(); }
