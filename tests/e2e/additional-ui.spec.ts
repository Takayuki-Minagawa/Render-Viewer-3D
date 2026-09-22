import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('PNG presets and transparent export work through the published UI',async({page})=>{
  await page.goto('./');await page.locator('.viewport-tools summary').click();
  await page.locator('[data-vt=png-size]').selectOption('custom');await page.locator('[data-vt=png-lock]').uncheck();
  await page.locator('[data-vt=png-width]').fill('4097');await page.locator('[data-vt=png-height]').fill('100');await page.locator('[data-vt=png]').click();
  await expect(page.locator('[data-vt=status]')).toContainText('PNG:');
  await page.locator('[data-vt=png-size]').selectOption('1080');await page.locator('[data-vt=png-transparent]').check();
  const downloading=page.waitForEvent('download');await page.locator('[data-vt=png]').click();
  const bytes=await readFile((await (await downloading).path())!);
  expect([bytes.readUInt32BE(16),bytes.readUInt32BE(20)]).toEqual([1920,1080]);
  const alpha=await page.evaluate(async(array)=>{
    const image=await createImageBitmap(new Blob([new Uint8Array(array)],{type:'image/png'}));const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const context=canvas.getContext('2d')!;context.drawImage(image,0,0);image.close();return context.getImageData(0,0,1,1).data[3];
  },Array.from(bytes));
  expect(alpha).toBe(0);await expect(page.locator('[data-vt=png]')).toBeEnabled();
  await page.locator('[data-vt=png-size]').selectOption('2160');
  const fourK=page.waitForEvent('download');await page.locator('[data-vt=png]').click();
  const large=await readFile((await (await fourK).path())!);
  expect([large.readUInt32BE(16),large.readUInt32BE(20)]).toEqual([3840,2160]);
});

test('review views and world bounds persist through the published UI',async({page})=>{
  await page.goto('./');await page.locator('.review-panel summary').click();
  await page.locator('[data-review=name]').fill('Inspection');await page.locator('[data-review=saveView]').click();
  await page.locator('[data-review=name]').fill('Box envelope');await page.locator('[data-review=bounds]').click();
  await expect(page.locator('.review-overlay-label')).toContainText('Box envelope');
  const downloading=page.waitForEvent('download');await page.locator('[data-project-action=save]').click();const file=(await (await downloading).path())!;
  await page.reload();await page.locator('[data-project-file]').setInputFiles(file);
  await expect(page.locator('[data-project-status]')).toContainText(/復元|保存済み/);
  await page.locator('.review-panel summary').click();
  await expect(page.locator('[data-review=views]')).toContainText('Inspection');
  await expect(page.locator('[data-review=items]')).toContainText('Box envelope');
  await page.locator('[data-review=views]').selectOption({label:'Inspection'});await page.locator('[data-review=apply]').click();
  await expect(page.locator('.review-overlay-label')).toContainText('Box envelope');
});
