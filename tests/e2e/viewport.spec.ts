import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('viewport sleeps when idle and PNG/GLB export produce valid files', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  await page.locator('.viewport-tools summary').click();
  await expect(page.locator('[data-vt=stats]')).toContainText('Frames:');
  await page.waitForTimeout(500);
  const before = await page.locator('[data-vt=stats]').textContent();
  await page.waitForTimeout(10_000);
  expect(await page.locator('[data-vt=stats]').textContent()).toBe(before);
  const pngDownload = page.waitForEvent('download'); await page.locator('[data-vt=png]').click();
  const png = await readFile((await (await pngDownload).path())!);
  expect(png.subarray(1, 4).toString()).toBe('PNG'); expect(png.length).toBeGreaterThan(1000);
  const dimensions = await page.locator('.viewport-canvas').evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height]);
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual(dimensions);
  const glbDownload = page.waitForEvent('download'); await page.locator('[data-vt=glb]').click();
  const glb = await readFile((await (await glbDownload).path())!);
  expect(glb.subarray(0, 4).toString()).toBe('glTF'); expect(glb.readUInt32LE(4)).toBe(2);
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
  expect(json.meshes.length).toBe(3);
  expect(json.nodes.some((node: {name?: string}) => /Helper|TransformControls/.test(node.name ?? ''))).toBe(false);
  expect(errors).toEqual([]);
});

test('orthographic standard views, fit, mesh measurement and clipping work together', async ({ page }) => {
  await page.goto('./'); await page.locator('.viewport-tools summary').click();
  await page.locator('[data-vt=projection]').selectOption('orthographic');
  await page.locator('[data-vt=top]').click(); await page.locator('[data-vt=front]').click(); await page.locator('[data-vt=fit]').click();
  await expect(page.locator('[data-vt=projection]')).toHaveValue('orthographic');
  await page.locator('[data-vt=measure]').check(); await page.locator('.viewport-tools summary').click();
  const box = (await page.locator('.viewport-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 - 20, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2 + 20, box.y + box.height / 2);
  await page.locator('.viewport-tools summary').click();
  await expect(page.locator('[data-vt=distance]')).toContainText('mm');
  const distance = parseFloat((await page.locator('[data-vt=distance]').textContent())!); expect(distance).toBeGreaterThan(0);
  await page.locator('[data-vt=clear]').click(); await page.locator('[data-vt=axis]').selectOption('x');
  await page.locator('[data-vt=offset]').fill('100000'); await page.locator('[data-vt=offset]').press('Tab');
  await page.locator('.viewport-tools summary').click();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('.viewport-tools summary').click(); await expect(page.locator('[data-vt=distance]')).toHaveText('0 / 2');
});

test('switching imports with identical clip names resets clip selection and permits replay', async ({ page }) => {
  await page.goto('./');
  const result = await page.evaluate(async () => {
    const THREE = await import('/Render-Viewer-3D/node_modules/three/build/three.module.js');
    const { SceneAdapter } = await import('/Render-Viewer-3D/src/three/scene-adapter.ts');
    const { ImportedAssetStore } = await import('/Render-Viewer-3D/src/three/imported-asset-store.ts');
    const { createDefaultSceneModel } = await import('/Render-Viewer-3D/src/model/default-scene.ts');
    const assets = new ImportedAssetStore(), model = createDefaultSceneModel();
    for (let i = 0; i < 2; i++) {
      const root = new THREE.Group(); root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
      root.animations = [new THREE.AnimationClip('Shared clip', 1, [new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [0, 1])])];
      assets.register(`asset-${i}`, root);
      model.imports.push({ id: `import-${i}`, assetId: `asset-${i}`, name: `Import ${i}`, visible: true, format: 'GLTF', materialMode: 'imported', customMaterialId: null, transform: {position:{x:0,y:0,z:0},rotationDegrees:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}, metadata:{fileName:'test.gltf',format:'GLTF',sizeBytes:1,objectCount:1,triangleCount:12,materialCount:1},hierarchy:[],warnings:[] });
    }
    const container = document.createElement('div'); container.style.cssText='width:320px;height:240px;position:fixed;left:0;top:0'; document.body.append(container);
    const adapter = new SceneAdapter(container, model, { importedAssets: assets, onCameraInteractionEnd(){}, onObjectSelected(){}, onObjectTransformCommitted(){} });
    const select = container.querySelector<HTMLSelectElement>('[data-vt=clip]')!;
    adapter.setSelection('import-0'); select.value = '0'; select.dispatchEvent(new Event('change'));
    await new Promise(requestAnimationFrame);
    adapter.setSelection('import-1');
    const reset = select.value;
    select.value = '0'; select.dispatchEvent(new Event('change'));
    await new Promise(requestAnimationFrame);
    const playable = !container.querySelector<HTMLButtonElement>('[data-vt=play]')!.disabled;
    adapter.dispose(); container.remove(); return {reset,playable};
  });
  expect(result).toEqual({reset:'-1',playable:true});
});
