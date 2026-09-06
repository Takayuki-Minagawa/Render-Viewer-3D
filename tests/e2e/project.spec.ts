import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('project file, history, autosave recovery and invalid restore preserve edits', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('[data-project-action="save"]')).toBeVisible();
  await page.locator('.primitive-menu summary').click();
  await page.locator('[data-add-primitive="box"]').click();
  await expect(page.locator('[data-object-count]')).toHaveText('4');
  await page.locator('[data-action="reset"]').click();
  await page.locator('[data-project-action="undo"]').click();
  await expect(page.locator('[data-object-count]')).toHaveText('3');
  await page.locator('[data-project-action="redo"]').click();
  await expect(page.locator('[data-object-count]')).toHaveText('4');
  const saved = page.waitForEvent('download'); await page.locator('[data-project-action="save"]').click();
  const download = await saved; const file = await download.path(); expect(file).toBeTruthy();
  if (await page.locator('.primitive-menu').getAttribute('open') === null) await page.locator('.primitive-menu summary').click();
  await page.locator('[data-add-primitive="sphere"]').click();
  await expect(page.locator('[data-object-count]')).toHaveText('5');
  await page.locator('[data-project-file]').setInputFiles(file!);
  await expect(page.locator('[data-object-count]')).toHaveText('4');
  await page.locator('[data-project-file]').setInputFiles({ name:'bad.rv3d', mimeType:'application/octet-stream', buffer:Buffer.from('invalid project') });
  await expect(page.locator('[data-project-status]')).toContainText('失敗');
  await expect(page.locator('[data-object-count]')).toHaveText('4');
  if (await page.locator('.primitive-menu').getAttribute('open') === null) await page.locator('.primitive-menu summary').click();
  await page.locator('[data-add-primitive="cone"]').click();
  await expect(page.locator('[data-project-status]')).toContainText('保存済み');
  await page.reload();
  await expect(page.locator('[data-object-count]')).toHaveText('3');
  await page.locator('[data-project-action="recover"]').click();
  await expect(page.locator('[data-object-count]')).toHaveText('5');
  await page.locator('[data-action="language"]').click();
  await expect(page.locator('[data-project-action="save"]')).toHaveText('Save project');
  await page.locator('[data-action="theme"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
});

test('demand rendering, orthographic view, PNG and GLB exports', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.viewport-canvas')).toBeVisible();
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => (window as any).__viewer.adapter.getRenderCount());
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as any).__viewer.adapter.getRenderCount())).toBe(before);
  await page.locator('.viewport-tools summary').click();
  await page.locator('[data-vt="projection"]').selectOption('orthographic');
  await page.locator('[data-vt="top"]').click();
  expect(await page.evaluate(() => (window as any).__viewer.store.getSnapshot().camera.projection)).toBe('orthographic');
  const pngEvent = page.waitForEvent('download'); await page.locator('[data-vt="png"]').click();
  const png = await pngEvent; const bytes = await readFile((await png.path())!);
  expect(bytes.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a'); expect(bytes.length).toBeGreaterThan(1000);
  const glbEvent = page.waitForEvent('download'); await page.locator('[data-vt="glb"]').click();
  const glb = await glbEvent; const model = await readFile((await glb.path())!);
  expect(model.subarray(0,4).toString()).toBe('glTF');
  const jsonLength = model.readUInt32LE(12); const json = JSON.parse(model.subarray(20,20+jsonLength).toString());
  expect(json.meshes.length).toBe(3);
  expect(json.nodes.some((n: {name:string}) => /Grid|Axes|TransformControls/.test(n.name))).toBe(false);
});

test('imported runtime and local texture survive delete undo and project restore', async ({ page }) => {
  await page.goto('./');
  const result = await page.evaluate(async () => {
    const viewer = (window as any).__viewer;
    const { ImportController } = await import('/Render-Viewer-3D/src/app/import-controller.ts');
    const { ImportManager } = await import('/Render-Viewer-3D/src/importers/ImportManager.ts');
    const { DEFAULT_IMPORT_OPTIONS } = await import('/Render-Viewer-3D/src/importers/types.ts');
    const { MaterialTextureController } = await import('/Render-Viewer-3D/src/app/material-texture-controller.ts');
    const controller = new ImportController(new ImportManager(), viewer.importedAssets, viewer.store, viewer.editorStore, viewer.adapter,
      (id:any, primary:any, files:any, options:any) => viewer.projectAssets.capture(id,primary,files,options));
    const file = new File(['v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3'], 'triangle.obj');
    const imported = await viewer.projects.editAsync(() => controller.importFiles([file], DEFAULT_IMPORT_OPTIONS));
    const material = viewer.store.getSnapshot().materials[0].id;
    const canvas = document.createElement('canvas'); canvas.width=2;canvas.height=2; canvas.getContext('2d')!.fillRect(0,0,2,2);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!)));
    const textures = new MaterialTextureController(viewer.store,viewer.materialImages);
    await viewer.projects.editAsync(() => textures.attach(material,new File([blob],'local.png',{type:'image/png'})));
    const originalImage=viewer.store.getSnapshot().materials[0].colorMap.assetId;
    await viewer.projects.editAsync(() => textures.attach(material,new File([blob],'replacement.png',{type:'image/png'})));
    viewer.history.undo();
    if(viewer.store.getSnapshot().materials[0].colorMap.assetId!==originalImage || !viewer.materialImages.sourceFile(originalImage)) throw new Error('Texture replacement Undo lost the original image');
    viewer.store.update((d:any) => { d.imports=[]; });
    viewer.history.undo();
    const retained = !!viewer.importedAssets.get(imported.assetId);
    textures.dispose();
    return {retained};
  });
  expect(result.retained).toBe(true);
  const saved = page.waitForEvent('download'); await page.locator('[data-project-action="save"]').click();
  const file = await (await saved).path();
  await page.reload();
  await page.locator('[data-project-file]').setInputFiles(file!);
  await expect(page.locator('[data-project-status]')).toContainText(/復元|保存済み/);
  const restored = await page.evaluate(() => {
    const v = (window as any).__viewer; const m = v.store.getSnapshot();
    return {imports:m.imports.length, runtime:!!v.importedAssets.get(m.imports[0]?.assetId), image:!!v.materialImages.sourceFile(m.materials[0].colorMap?.assetId)};
  });
  expect(restored).toEqual({imports:1,runtime:true,image:true});
});

test('repeated drag-drop import delete undo and history release keep resources stable', async ({page}) => {
  await page.goto('./');await page.locator('.viewport-tools summary').click();
  const counts:string[]=[];
  for(let i=0;i<6;i++) {
    const data=await page.evaluateHandle(()=>{
      const dt=new DataTransfer();dt.items.add(new File(['v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3'],'drop.obj'));return dt;
    });
    await page.locator('.viewport-canvas').dispatchEvent('drop',{dataTransfer:data});await data.dispose();
    await expect(page.locator('[data-object-count]')).toHaveText('4');
    await page.locator('[data-project-action="save"]').focus();await page.keyboard.press('Delete');
    await expect(page.locator('[data-object-count]')).toHaveText('3');
    await page.locator('[data-project-action="undo"]').click();await expect(page.locator('[data-object-count]')).toHaveText('4');
    await page.locator('[data-project-action="redo"]').click();await expect(page.locator('[data-object-count]')).toHaveText('3');
    await page.evaluate(()=>{ const v=(window as any).__viewer;v.history.clear();v.adapter.requestRender(); });
    await page.waitForTimeout(100);
    expect(await page.evaluate(()=>(window as any).__viewer.importedAssets.size)).toBe(0);
    counts.push((await page.locator('[data-vt="stats"]').textContent())!.match(/Geometry:.*Textures: \d+/)![0]);
  }
  expect(new Set(counts.slice(1)).size).toBe(1);
});

test('asynchronous edits make open modal controls inert and restore them afterwards', async ({page}) => {
  await page.goto('./');
  await page.evaluate(()=>{
    const dialog=document.querySelector<HTMLDialogElement>('[data-material-dialog]') ?? document.querySelector<HTMLDialogElement>('dialog');
    if(!dialog) throw new Error('Missing application dialog');
    dialog.showModal();(window as any).__busyDialog=dialog;
    (window as any).__busyOperation=(window as any).__viewer.projects.editAsync(()=>new Promise(resolve=>{(window as any).__finishBusy=resolve;}));
  });
  expect(await page.evaluate(()=>{const d=(window as any).__busyDialog;return d.inert;})).toBe(true);
  // WebKit clears the previously focused modal element on the next rendering step.
  await expect.poll(()=>page.evaluate(()=>{const d=(window as any).__busyDialog;const input=d.querySelector('input,button');input?.focus();return d.contains(document.activeElement);})).toBe(false);
  await page.evaluate(async()=>{(window as any).__finishBusy();await (window as any).__busyOperation;});
  expect(await page.evaluate(()=>(window as any).__busyDialog.inert)).toBe(false);
});
