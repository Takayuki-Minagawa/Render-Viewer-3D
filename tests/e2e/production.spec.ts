import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('published base path supports local import and project download restore', async ({page}) => {
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  await expect(page.locator('.viewport-canvas')).toBeVisible();
  await page.locator('[data-action="import"]').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-action="choose-import-files"]').click();
  await (await chooser).setFiles({name:'local.obj',mimeType:'text/plain',buffer:Buffer.from('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3')});
  await expect(page.locator('[data-object-count]')).toHaveText('4');
  await expect(page.locator('[data-project-action="save"]')).toBeEnabled();
  const downloadEvent=page.waitForEvent('download');await page.locator('[data-project-action="save"]').click();
  const download=await downloadEvent;const file=(await download.path())!;
  expect((await readFile(file)).subarray(0,8).toString()).toBe('RV3D0001');
  await page.reload();
  await page.locator('[data-project-file]').setInputFiles(file);
  await expect(page.locator('[data-object-count]')).toHaveText('4');
  expect(errors).toEqual([]);
});

test('published decoder and STEP assets load lazily from the application base', async ({page}) => {
  const errors:string[]=[];const requests:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.goto('./');await expect(page.locator('.viewport-canvas')).toBeVisible();
  expect(requests.filter(url=>/draco_decoder|basis_transcoder|occt-wasm\.wasm/.test(url))).toEqual([]);
  const compressed = new URL('../fixtures/compressed/', import.meta.url);
  const meshopt = JSON.parse(await readFile(new URL('triangle-meshopt.gltf',compressed),'utf8'));
  meshopt.extensionsUsed.push('KHR_texture_basisu');meshopt.extensionsRequired.push('KHR_texture_basisu');
  meshopt.images=[{uri:'2d_etc1s.ktx2',mimeType:'image/ktx2'}];meshopt.textures=[{extensions:{KHR_texture_basisu:{source:0}}}];
  meshopt.materials=[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}];meshopt.meshes[0].primitives[0].material=0;
  const groups = [
    await Promise.all(['Box.gltf','Box.bin'].map(async name=>({name,mimeType:'application/octet-stream',buffer:await readFile(new URL(name,compressed))}))),
    [{name:'textured.gltf',mimeType:'model/gltf+json',buffer:Buffer.from(JSON.stringify(meshopt))},{name:'2d_etc1s.ktx2',mimeType:'image/ktx2',buffer:await readFile(new URL('2d_etc1s.ktx2',compressed))}],
    [{name:'box.step',mimeType:'application/step',buffer:await readFile(new URL('../fixtures/step/box-10x20x30mm.step',import.meta.url))}],
  ];
  for(let index=0;index<groups.length;index++) {
    await page.locator('[data-action="import"]').click();const chooser=page.waitForEvent('filechooser');
    await page.locator('[data-action="choose-import-files"]').click();await (await chooser).setFiles(groups[index]);
    await expect(page.locator('[data-object-count]')).toHaveText(String(index+4),{timeout:45000});
    await expect(page.locator('[data-project-action="save"]')).toBeEnabled();
  }
  for(const pattern of [/draco_decoder.*\.wasm/,/basis_transcoder.*\.wasm/,/occt-wasm.*\.wasm/]) expect(requests.some(url=>pattern.test(url))).toBe(true);
  const wasm=requests.filter(url=>/\.wasm(?:$|[?#])/.test(url));
  expect(wasm.every(url=>new URL(url).origin===new URL(page.url()).origin && new URL(url).pathname.startsWith('/Render-Viewer-3D/'))).toBe(true);
  const savedEvent=page.waitForEvent('download');await page.locator('[data-project-action="save"]').click();
  const saved=(await (await savedEvent).path())!;await page.reload();
  await page.locator('[data-project-file]').setInputFiles(saved);
  await expect(page.locator('[data-object-count]')).toHaveText('6',{timeout:45000});
  expect(errors).toEqual([]);
});

test('lights exposure and local HDR survive undo and project restore', async ({page}) => {
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');await page.locator('.appearance-tools summary').click();
  await page.locator('[data-at="exposure"]').fill('2');await page.locator('[data-at="exposure"]').press('Tab');
  await page.locator('[data-at="intensity"]').fill('3');await page.locator('[data-at="intensity"]').press('Tab');
  const hdr=Buffer.concat([Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 2\n'),Buffer.from(Array(4).fill([128,128,128,129]).flat())]);
  await page.locator('[data-at="hdr"]').setInputFiles({name:'neutral.hdr',mimeType:'application/octet-stream',buffer:hdr});
  await expect(page.locator('[data-at="environment"]')).toHaveText('neutral.hdr');
  await page.locator('[data-at="reset"]').click();await expect(page.locator('[data-at="environment"]')).toHaveText('');
  await page.locator('[data-project-action="undo"]').click();await expect(page.locator('[data-at="environment"]')).toHaveText('neutral.hdr');
  const savedEvent=page.waitForEvent('download');await page.locator('[data-project-action="save"]').click();
  const saved=(await (await savedEvent).path())!;await page.reload();await page.locator('[data-project-file]').setInputFiles(saved);
  await expect(page.locator('[data-project-status]')).toContainText(/復元|保存済み/);
  await page.locator('.appearance-tools summary').click();
  await expect(page.locator('[data-at="environment"]')).toHaveText('neutral.hdr');
  await expect(page.locator('[data-at="exposure"]')).toHaveValue('2');await expect(page.locator('[data-at="intensity"]')).toHaveValue('3');
  expect(errors).toEqual([]);
});
