import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'vite';
import { parseHTML } from 'linkedom';
import * as THREE from 'three';
let server, SceneStore, SceneHistory, ProjectAssets, ImportedAssetStore, MaterialImageAssetStore, ProjectController, EditorStore, createDefaultSceneModel, encodeProject, estimateHistorySnapshotBytes;
before(async () => {
  server = await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
  const load = path => server.ssrLoadModule(`/src/${path}.ts`);
  ({SceneStore}=await load('app/scene-store')); ({SceneHistory,estimateHistorySnapshotBytes}=await load('app/scene-history'));
  ({ProjectAssets}=await load('app/project-assets')); ({ImportedAssetStore}=await load('three/imported-asset-store'));
  ({MaterialImageAssetStore}=await load('three/material/image-asset-store')); ({ProjectController}=await load('app/project-controller'));
  ({EditorStore}=await load('app/editor-store')); ({createDefaultSceneModel}=await load('model/default-scene')); ({encodeProject}=await load('app/project-format'));
});
after(()=>server?.close());

test('a large active import does not erase rename Undo; historical-only assets remain bounded', () => {
  const model=createDefaultSceneModel(); model.imports.push({id:'large',assetId:'large-asset'});
  const store=new SceneStore(model), assets=new ImportedAssetStore(), images=new MaterialImageAssetStore();
  assets.estimatedBytes=()=>300*1024*1024;
  const history=new SceneHistory(store,assets,images,new ProjectAssets());
  store.update(d=>{d.name='Renamed'}); assert.equal(history.canUndo,true);
  history.undo(); assert.equal(store.getSnapshot().name,model.name);
  history.redo(); assert.equal(store.getSnapshot().name,'Renamed');
  store.update(d=>{d.imports=[]});
  // Keeping the removed 300 MiB asset exclusively for Undo exceeds the default 256 MiB budget.
  assert.equal(history.canUndo,false);
  history.dispose(); assets.dispose(); images.dispose();
});

test('historical metadata is budgeted while structurally shared scene data is skipped', () => {
  const model=createDefaultSceneModel(); model.name='Old name '.repeat(2000);
  const store=new SceneStore(model), assets=new ImportedAssetStore(), images=new MaterialImageAssetStore();
  const original=store.getSnapshot();
  const history=new SceneHistory(store,assets,images,new ProjectAssets(),4096);
  store.update(d=>{d.name='Small'});
  assert.equal(history.canUndo,false);
  assert.equal(estimateHistorySnapshotBytes(original,[original]),0);
  const changed=store.getSnapshot();
  assert.ok(estimateHistorySnapshotBytes(changed,[original])>4096);
  assert.equal(estimateHistorySnapshotBytes(changed,[original,original]),estimateHistorySnapshotBytes(changed,[original]));
  history.dispose(); assets.dispose(); images.dispose();
});

test('restore rejects cumulative decoded staging and disposes every prepared import without replacing the scene', async () => {
  const dom=parseHTML('<html><body><main id="root"></main></body></html>');
  const keys=['document','window','HTMLElement'];
  const prior=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const key of keys) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:dom[key]??dom.window[key]});
  let controller, history, assets, images;
  try {
    const old=createDefaultSceneModel(), store=new SceneStore(old), sources=new ProjectAssets();
    assets=new ImportedAssetStore(); images=new MaterialImageAssetStore();
    history=new SceneHistory(store,assets,images,sources);
    store.update(d=>{d.name='Keep existing edits'});
    const before=store.getSnapshot();
    const editor=new EditorStore({selectedObjectId:old.objects[0].id,transformMode:'translate'});
    const next=createDefaultSceneModel(), targetSources=new ProjectAssets();
    const options={unit:'meter',coordinateSystem:'y-up',quality:'medium',centerModel:false,placeOnGround:false};
    for(let i=0;i<3;i++) {
      const file=new File(['small compressed source'],`part-${i}.gltf`); targetSources.capture(`a-${i}`,file,[file],options);
      next.imports.push({id:`i-${i}`,assetId:`a-${i}`,name:`Part ${i}`,format:'GLTF',visible:true,transform:{position:{x:0,y:0,z:0},rotationDegrees:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}},materialMode:'imported',customMaterialId:null,metadata:{fileName:file.name,format:'GLTF',sizeBytes:file.size,objectCount:1,triangleCount:12,materialCount:1},warnings:[],hierarchy:[]});
    }
    const blob=await encodeProject(next,targetSources,images);
    let imports=0,disposals=0;
    const manager={async import(){imports++;const geometry=new THREE.BoxGeometry();geometry.addEventListener('dispose',()=>disposals++);const root=new THREE.Group();root.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial()));return {root};}};
    // Model realistic decoded expansion without allocating hundreds of MiB in the test.
    assets.estimatedBytes=()=>300*1024*1024;
    controller=new ProjectController(document.getElementById('root'),store,editor,manager,assets,images,sources,history);
    await assert.rejects(controller.open(blob),/decoded resource limit/);
    assert.equal(imports,2); assert.equal(disposals,2); assert.equal(assets.size,0); assert.equal(sources.imports.size,0);
    assert.equal(store.getSnapshot(),before); assert.equal(history.canUndo,true); assert.equal(editor.getSnapshot().selectedObjectId,old.objects[0].id); assert.equal(controller.busy,false);
  } finally {
    controller?.dispose(); history?.dispose();assets?.dispose();images?.dispose();
    for(const key of keys){const descriptor=prior.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  }
});

test('exclusive work explicitly locks modal dialogs and restores each prior inert state on success and failure', async () => {
  const dom=parseHTML('<html><body><main id="root"><div class="app-shell"><dialog open id="editable"></dialog><dialog id="already-locked"></dialog></div></main></body></html>');
  const keys=['document','window','HTMLElement'];const prior=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:dom[key]??dom.window[key]});
  let controller,history,assets,images;
  try {
    const store=new SceneStore(createDefaultSceneModel()),sources=new ProjectAssets();assets=new ImportedAssetStore();images=new MaterialImageAssetStore();history=new SceneHistory(store,assets,images,sources);
    const editor=new EditorStore({selectedObjectId:null,transformMode:'translate'});
    const shell=document.querySelector('.app-shell'),editable=document.getElementById('editable'),locked=document.getElementById('already-locked');
    shell.inert=false;editable.inert=false;locked.inert=true;
    controller=new ProjectController(document.getElementById('root'),store,editor,{},assets,images,sources,history);
    let complete;const running=controller.editAsync(()=>new Promise(resolve=>{complete=resolve;}));
    assert.equal(shell.inert,true);assert.equal(editable.inert,true);assert.equal(locked.inert,true);
    complete();await running;
    assert.equal(shell.inert,false);assert.equal(editable.inert,false);assert.equal(locked.inert,true);
    await assert.rejects(controller.editAsync(async()=>{assert.equal(editable.inert,true);throw new Error('decode failed');}),/decode failed/);
    assert.equal(shell.inert,false);assert.equal(editable.inert,false);assert.equal(locked.inert,true);
  }finally{controller?.dispose();history?.dispose();assets?.dispose();images?.dispose();for(const key of keys){const descriptor=prior.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
