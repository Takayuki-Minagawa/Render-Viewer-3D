import { test, expect } from '@playwright/test';
import { fixture } from '../fixtures/generated-gltf.mjs';

test('glTF diagnostics and optimization run in local browser Workers', async ({ page }) => {
  test.skip(process.env.RV3D_PREVIEW === '1', 'Direct module API test uses the development server.');
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('./');
  const bytes = Array.from(await fixture(3));
  const result = await page.evaluate(async (array) => {
    const { diagnoseGlb, optimizeGlb, diagnoseFiles } = await import('/Render-Viewer-3D/src/asset-tools/client.ts');
    const bytes = new Uint8Array(array).buffer;
    const validation = await diagnoseGlb(bytes), optimized = await optimizeGlb(bytes);
    const source = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ byteLength: 12, uri: 'mesh.bin' }] });
    const local = await diagnoseFiles([new File([source], 'model.gltf'), new File([new Uint8Array(12)], 'mesh.bin')]);
    const external = await diagnoseFiles([new File([source.replace('mesh.bin', 'https://example.invalid/mesh.bin')], 'model.gltf')]);
    return { errors: validation.report.issues.numErrors, optimizedErrors: optimized.report.issues.numErrors, sidecarErrors: local.report.issues.numErrors, blocked: external.report.issues.messages.some((issue) => issue.code === 'IO_ERROR'), input: optimized.inputBytes, output: optimized.outputBytes, originalLength: bytes.byteLength };
  }, bytes);
  expect(result.errors).toBe(0); expect(result.optimizedErrors).toBe(0); expect(result.sidecarErrors).toBe(0); expect(result.blocked).toBe(true);
  expect(result.output).toBeLessThan(result.input); expect(result.originalLength).toBe(result.input);
  expect(requests.filter((url) => /^https?:/u.test(url)).every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
});

test('asset panel validates input and downloads its diagnostic report', async ({ page }) => {
  await page.goto('./');
  const panel = page.locator('.asset-tools');
  await panel.locator('summary').click();
  await panel.locator('input[type=file]').setInputFiles({ name: 'fixture.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(await fixture(3)) });
  await expect(panel.locator('[data-at=status]')).toContainText('エラー: 0');
  const downloadPromise = page.waitForEvent('download');
  await panel.locator('[data-at=report]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('gltf-diagnostic-report.json');
  await panel.locator('[data-at=optimize]').click();
  await expect(panel.locator('[data-at=copy]')).toBeEnabled();
  await expect(panel.locator('[data-at=status]')).toContainText('エラー: 0');
});
