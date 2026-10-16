import { test, expect } from '@playwright/test';

test('appearance numeric commits match the model while focused, on blur, after Undo and restore', async ({ page }) => {
  await page.goto('./');
  const appearance = page.locator('.appearance-tools');
  await appearance.locator('summary').click();
  const intensity = appearance.locator('[data-at="intensity"]');
  await intensity.fill('1000'); await intensity.press('Enter');
  await expect(intensity).toBeFocused();
  await expect(intensity).toHaveValue('100');
  await expect(appearance.locator('[data-at="status"]')).toContainText('100 に補正');
  expect(await page.evaluate(() => (window as any).__viewer.store.getSnapshot().lights[0].intensity)).toBe(100);
  await intensity.fill('1000'); await intensity.press('Tab');
  await expect(intensity).toHaveValue('100');
  await intensity.fill(''); await intensity.press('Tab');
  await expect(intensity).toHaveValue('100');
  await expect(appearance.locator('[data-at="status"]')).toContainText('有効な数値');
  await page.locator('[data-project-action="undo"]').click();
  await expect(intensity).toHaveValue('0.65');
  await page.locator('[data-project-action="redo"]').click();
  await expect(intensity).toHaveValue('100');

  const exposure = appearance.locator('[data-at="exposure"]');
  await exposure.fill('99'); await exposure.press('Tab');
  await expect(exposure).toHaveValue('10');
  await appearance.locator('[data-at="light"]').selectOption('directional-01');
  for (const [field, requested, normalized] of [['position-x', '2000000', '1000000'], ['target-y', '-2000000', '-1000000']]) {
    const input = appearance.locator(`[data-at="${field}"]`);
    await input.fill(requested); await input.press('Tab'); await expect(input).toHaveValue(normalized);
    await input.fill(''); await input.press('Tab'); await expect(input).toHaveValue(normalized);
  }
  await page.locator('[data-action="language"]').click();
  await expect(appearance.locator('[data-at="status"]')).toContainText('Enter a valid number');
  await exposure.fill('99'); await exposure.press('Tab');
  await expect(appearance.locator('[data-at="status"]')).toHaveText('Value adjusted to 10.');
  const downloading = page.waitForEvent('download');
  await page.locator('[data-project-action="save"]').click();
  const file = await (await downloading).path();
  await exposure.fill('2'); await exposure.press('Tab');
  await page.locator('[data-project-file]').setInputFiles(file!);
  await expect(exposure).toHaveValue('10');
  expect(await page.evaluate(() => {
    const model = (window as any).__viewer.store.getSnapshot();
    return { intensity: model.lights[0].intensity, exposure: model.exposure, x: model.lights[1].position.x, y: model.lights[1].target.y };
  })).toEqual({ intensity: 100, exposure: 10, x: 1000000, y: -1000000 });
});

test('all PBR channels display normalized mapping values and preserve them through Undo and project restore', async ({ page }) => {
  await page.goto('./');
  await page.locator('.material-map-tools summary').click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
    canvas.getContext('2d')!.fillRect(0, 0, 2, 2);
    return canvas.toDataURL().split(',')[1];
  });
  for (const channel of ['normal', 'roughness', 'metalness', 'ao']) {
    await page.locator('[data-pbr="channel"]').selectOption(channel);
    await page.locator('[data-pbr="file"]').setInputFiles({ name: `${channel}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await expect(page.locator('[data-pbr="source"]')).toContainText(`${channel}.png`);
    for (const [field, requested, normalized] of [['repeatX', '0', '0.01'], ['repeatY', '1001', '1000'], ['offsetX', '-1001', '-1000'], ['offsetY', '1001', '1000'], ['rotationDegrees', '360001', '360000']]) {
      const input = page.locator(`[data-pbr="${field}"]`);
      await input.fill(requested); await input.press('Enter');
      await expect(input).toBeFocused(); await expect(input).toHaveValue(normalized);
      await expect(page.locator('[data-pbr="status"]')).toContainText('補正');
      await input.fill(''); await input.press('Tab');
      await expect(input).toHaveValue(normalized);
      await expect(page.locator('[data-pbr="status"]')).toContainText('有効な数値');
    }
    const repeat = page.locator('[data-pbr="repeatX"]');
    await repeat.fill('2.5'); await repeat.press('Tab');
    await page.locator('[data-project-action="undo"]').click(); await expect(repeat).toHaveValue('0.01');
    await page.locator('[data-project-action="redo"]').click(); await expect(repeat).toHaveValue('2.5');
  }
  const downloading = page.waitForEvent('download');
  await page.locator('[data-project-action="save"]').click();
  const file = await (await downloading).path();
  await page.reload(); await page.locator('[data-project-file]').setInputFiles(file!);
  await page.locator('.material-map-tools summary').click();
  for (const channel of ['normal', 'roughness', 'metalness', 'ao']) {
    await page.locator('[data-pbr="channel"]').selectOption(channel);
    await expect(page.locator('[data-pbr="source"]')).toContainText(`${channel}.png`);
    await expect(page.locator('[data-pbr="repeatX"]')).toHaveValue('2.5');
    await expect(page.locator('[data-pbr="repeatY"]')).toHaveValue('1000');
    await expect(page.locator('[data-pbr="offsetX"]')).toHaveValue('-1000');
    await expect(page.locator('[data-pbr="offsetY"]')).toHaveValue('1000');
    await expect(page.locator('[data-pbr="rotationDegrees"]')).toHaveValue('360000');
  }
});
