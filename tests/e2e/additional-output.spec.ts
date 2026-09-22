import { test, expect } from '@playwright/test';

test('custom PNG preserves dimensions, alpha, framing, colors and resources across repeated exports', async ({ page }) => {
  const errors: string[]=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.goto('./'); await expect(page.locator('.viewport-canvas')).toBeVisible();
  const result=await page.evaluate(async()=>{
    const {adapter,store}=(window as any).__viewer;
    const pixels=async(blob:Blob)=>{
      const image=await createImageBitmap(blob), canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const context=canvas.getContext('2d')!;context.drawImage(image,0,0);image.close();const data=context.getImageData(0,0,canvas.width,canvas.height).data;
      let transparent=0,opaque=0; for(let i=3;i<data.length;i+=4){if(data[i]===0)transparent++; if(data[i]===255)opaque++;}
      return {width:canvas.width,height:canvas.height,corner:[...data.slice(0,4)],transparent,opaque};
    };
    const camera=JSON.stringify(store.getSnapshot().camera);
    const transparent=await pixels(await adapter.exportPng(false,{width:320,height:180,transparent:true}));
    const opaque=await pixels(await adapter.exportPng(false,{width:320,height:180,transparent:false}));
    const before=adapter.getResourceCounts();
    for(let i=0;i<20;i++) await adapter.exportPng(false,{width:64,height:64,transparent:true});
    const after=adapter.getResourceCounts();
    let rejected=false;try{await adapter.exportPng(false,{width:4097,height:2});}catch{rejected=true;}
    const cameraUnchanged=camera===JSON.stringify(store.getSnapshot().camera);
    adapter.setStandardView('front');
    return {transparent,opaque,before,after,rejected,cameraUnchanged,background:store.getSnapshot().backgroundColor};
  });
  expect(result.transparent.width).toBe(320);expect(result.transparent.height).toBe(180);
  expect(result.transparent.transparent).toBeGreaterThan(100);expect(result.transparent.opaque).toBeGreaterThan(100);
  expect(result.opaque.transparent).toBe(0);expect(result.opaque.corner[3]).toBe(255);
  expect(result.opaque.corner.slice(0,3)).toEqual(result.background.match(/[0-9a-f]{2}/gi)!.map(v=>parseInt(v,16)));
  expect(result.cameraUnchanged).toBe(true);expect(result.after).toEqual(result.before);expect(result.rejected).toBe(true);expect(errors).toEqual([]);
});

test('section cap changes only the closed mesh cut, survives reverse and transparent PNG',async({page})=>{
  await page.goto('./');await expect(page.locator('.viewport-canvas')).toBeVisible();
  const result=await page.evaluate(async()=>{
    const {adapter,store}=(window as any).__viewer;
    store.update((d:any)=>{d.objects=d.objects.slice(0,1);const o=d.objects[0];o.geometry={type:'box',width:2,height:2,depth:2};o.transform={position:{x:0,y:0,z:0},rotationDegrees:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};d.camera.position={x:0,y:0,z:5};d.camera.target={x:0,y:0,z:0};d.helpers.gridVisible=false;d.helpers.axesVisible=false;});
    const read=async()=>{const blob=await adapter.exportPng(false,{width:128,height:128,transparent:true}), img=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const ctx=canvas.getContext('2d')!;ctx.drawImage(img,0,0);img.close();return [...ctx.getImageData(64,64,1,1).data];};
    adapter.setClipping('z',0,true,false,'#ff0000');const open=await read();
    adapter.setClipping('z',0,true,true,'#ff0000');const cap=await read();
    adapter.setClipping('z',0,false,true,'#00ff00');const reverse=await read();
    adapter.setClipping('off',0);const restored=await read();
    return {open,cap,reverse,restored};
  });
  expect(result.open[3]).toBe(0);expect(result.cap[3]).toBe(255);expect(result.cap[0]).toBeGreaterThan(200);expect(result.cap[1]).toBeLessThan(40);
  expect(result.reverse[3]).toBe(255);expect(result.restored[3]).toBe(255);
});
