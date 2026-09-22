import { test, expect, type Page } from '@playwright/test';

async function prepare(page: Page): Promise<void> {
  await page.goto('./');
  await page.evaluate(() => {
    const viewer = (window as any).__viewer;
    viewer.store.update((draft: any) => {
      const box = draft.objects[0]; box.transform.position = {x:0,y:0,z:0}; box.transform.rotationDegrees = {x:0,y:0,z:0};
      draft.objects.slice(1).forEach((object: any) => { object.visible = false; });
    });
  });
  await page.locator('.viewport-tools summary').click();
  await page.locator('[data-vt=projection]').selectOption('orthographic');
  await page.locator('[data-vt=front]').click(); await page.locator('[data-vt=fit]').click();
  await page.locator('.viewport-tools summary').click(); await page.locator('.review-panel summary').click();
}
async function clickPoint(page: Page, x: number, y: number, z = 1): Promise<void> {
  await page.locator('.viewport-canvas').scrollIntoViewIfNeeded();
  const point = await page.evaluate(point => (window as any).__viewer.adapter.getReviewViewport().projectPoint(point), {x,y,z});
  expect(point.visible).toBe(true);
  const canvas = (await page.locator('.viewport-canvas').boundingBox())!;
  await page.mouse.click(canvas.x + point.x, canvas.y + point.y);
}

test('review clicks create snapped distance, angle and safe annotation; save/reload preserves them', async ({page}) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await prepare(page);
  await page.locator('[data-review=snap]').check();
  await page.locator('[data-review=name]').fill('Cube width'); await page.locator('[data-review=distance]').click();
  await clickPoint(page,-.96,.96); await clickPoint(page,.96,.96);
  await expect(page.locator('.review-overlay-label')).toContainText('2000 mm');
  await page.locator('[data-review=name]').fill('Right angle'); await page.locator('[data-review=angle]').click();
  await clickPoint(page,.96,-.96); await clickPoint(page,-.96,-.96); await clickPoint(page,-.96,.96);
  await expect(page.locator('.review-overlay-label').filter({hasText:'Right angle'})).toContainText('90°');
  await page.locator('[data-review=name]').fill('Surface note');
  await page.locator('[data-review=text]').fill('<img src=x onerror="throw new Error(1)">'); await page.locator('[data-review=annotation]').click();
  await clickPoint(page,0,0);
  await expect(page.locator('.review-overlay-label').filter({hasText:'Surface note'})).toContainText('<img');
  await expect(page.locator('.review-overlay img')).toHaveCount(0);
  await page.locator('[data-review=name]').fill('Front inspection'); await page.locator('[data-review=saveView]').click();
  const stored = await page.evaluate(() => (window as any).__viewer.store.getSnapshot().review);
  expect(stored.views).toHaveLength(1); expect(stored.annotations).toHaveLength(1); expect(stored.measurements).toHaveLength(2);
  const download = page.waitForEvent('download'); await page.locator('[data-project-action=save]').click(); const path = await (await download).path();
  await page.reload(); await page.locator('[data-project-file]').setInputFiles(path!);
  await expect.poll(() => page.evaluate(() => (window as any).__viewer.store.getSnapshot().review)).toEqual(stored);
  await expect(page.locator('.review-overlay-label')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('cancel leaves no partial measurement, saved view recalls camera/visibility, orphan annotation reattaches and undoes', async ({page}) => {
  await prepare(page);
  await page.locator('[data-review=name]').fill('Draft'); await page.locator('[data-review=angle]').click(); await clickPoint(page,0,0); await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as any).__viewer.store.getSnapshot().review.measurements.length)).toBe(0);
  await expect(page.locator('[data-review=cancel]')).toBeDisabled();
  await page.locator('[data-review=name]').fill('Inspection'); await page.locator('[data-review=saveView]').click();
  const viewId = await page.evaluate(() => (window as any).__viewer.store.getSnapshot().review.views[0].id);
  await page.evaluate(() => { const v = (window as any).__viewer; v.store.update((d:any) => {d.objects[0].visible=false; d.camera.position.x = 10;}); });
  await page.locator('[data-review=views]').selectOption(viewId); await page.locator('[data-review=apply]').click();
  expect(await page.evaluate(() => (window as any).__viewer.store.getSnapshot().objects[0].visible)).toBe(true);
  await page.locator('[data-project-action=undo]').click(); expect(await page.evaluate(() => (window as any).__viewer.store.getSnapshot().objects[0].visible)).toBe(false);
  await page.locator('[data-project-action=redo]').click();
  await page.locator('[data-review=name]').fill('Check'); await page.locator('[data-review=text]').fill('Inspect this face'); await page.locator('[data-review=annotation]').click(); await clickPoint(page,0,0);
  const annotationId = await page.evaluate(() => (window as any).__viewer.store.getSnapshot().review.annotations[0].id);
  await page.evaluate(() => (window as any).__viewer.store.update((d:any) => { d.objects[0].geometry.width = 3; }));
  await page.locator('[data-review=items]').selectOption(`annotations:${annotationId}`);
  await expect(page.locator('[data-review=value]')).toContainText('参照切れ'); await expect(page.locator('.review-overlay-label')).toHaveCount(0);
  await page.locator('[data-review=reattach]').click(); await clickPoint(page,.2,0);
  await expect(page.locator('.review-overlay-label')).toContainText('Inspect this face');
  await page.locator('[data-project-action=undo]').click(); await expect(page.locator('[data-review=value]')).toContainText('参照切れ');
  await page.locator('[data-action=language]').click(); await expect(page.locator('.review-panel summary')).toHaveText('Review & measurements');
});
