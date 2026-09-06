import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'vite';
let server, writeAutosave, readAutosave;
before(async()=>{
  server=await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
  ({writeAutosave,readAutosave}=await server.ssrLoadModule('/src/app/autosave.ts'));
});
after(()=>server?.close());

async function withDatabase(failures, run, initialValue) {
  const previous=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
  const state={value:initialValue,writes:0,closed:0};
  const db={
    close(){state.closed++;},
    transaction(){
      const tx={error:null,objectStore(){return {
        put(value,key){
          const request={result:undefined,error:null};state.writes++;
          queueMicrotask(()=>{
            const failure=failures.shift();
            if(failure){
              request.error=failure;request.onerror?.();
              // WebKit's bubbling transaction error has no cause until abort.
              assert.equal(tx.error,null);tx.onerror?.();
              tx.error=failure;tx.onabort?.();
            }else{state.value=value;request.result=key;request.onsuccess?.();tx.oncomplete?.();}
          });
          return request;
        },
        get(){const request={result:undefined,error:null};queueMicrotask(()=>{request.result=state.value;request.onsuccess?.();tx.oncomplete?.();});return request;},
      };}};
      return tx;
    },
  };
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:{open(){const request={result:db,error:null};queueMicrotask(()=>request.onsuccess?.());return request;}}});
  try{return await run(state);}finally{if(previous)Object.defineProperty(globalThis,'indexedDB',previous);else delete globalThis.indexedDB;}
}

test('WebKit Blob preparation error retries portable bytes and preserves exact binary content and MIME type',async()=>{
  await withDatabase([new DOMException('Error preparing Blob/File data to be stored in object store','UnknownError')],async state=>{
    const bytes=new Uint8Array([0,255,3,128,0,50]);
    await writeAutosave(new Blob([bytes],{type:'application/octet-stream'}));
    assert.equal(state.writes,2);assert.equal(state.value.format,'rv3d-autosave-bytes-v1');
    const restored=await readAutosave();assert.deepEqual(new Uint8Array(await restored.arrayBuffer()),bytes);
    assert.equal(restored.type,'application/octet-stream');assert.equal(state.closed,2);
  });
});

test('legacy Blob autosaves remain readable and supported Blob writes do not copy into fallback bytes',async()=>{
  const legacy=new Blob(['legacy'],{type:'application/octet-stream'});
  await withDatabase([],async state=>{
    assert.equal(await (await readAutosave()).text(),'legacy');
    const next=new Blob(['next']);await writeAutosave(next);
    assert.equal(state.writes,1);assert.equal(state.value,next);
  },legacy);
});

test('quota failures retain request error despite initially null transaction error and are not retried',async()=>{
  const quota=new DOMException('Storage quota exhausted','QuotaExceededError');
  await withDatabase([quota],async state=>{
    await assert.rejects(writeAutosave(new Blob(['project'])),error=>error===quota);
    assert.equal(state.writes,1);assert.equal(state.closed,1);
  });
});

test('a failed binary fallback propagates the actual error and closes the connection',async()=>{
  const quota=new DOMException('Storage quota exhausted','QuotaExceededError');
  await withDatabase([new DOMException('Blob cannot be cloned','DataCloneError'),quota],async state=>{
    await assert.rejects(writeAutosave(new Blob(['project'])),error=>error===quota);
    assert.equal(state.writes,2);assert.equal(state.closed,1);
  });
});

test('unknown saved records are ignored',async()=>{
  await withDatabase([],async()=>{assert.equal(await readAutosave(),undefined);},{format:'rv3d-autosave-bytes-v1',type:'application/octet-stream',bytes:'corrupt'});
});
