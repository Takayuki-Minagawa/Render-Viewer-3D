import { test, expect, type Page } from '@playwright/test';

const distance = (camera: any) => Math.hypot(camera.position.x - camera.target.x, camera.position.y - camera.target.y, camera.position.z - camera.target.z);

async function renderedPoints(page: Page, size: number) {
  return page.evaluate(size => {
    const viewport = (window as any).__viewer.adapter.getReviewViewport();
    const container = document.querySelector('.viewport-canvas')!.parentElement!;
    const width = container.clientWidth, height = container.clientHeight;
    // Toolbar status can change the viewport height after saving or reloading.
    // Normalize by vertical size, matching perspective FOV / orthographic height.
    return [{ x: 0, y: 0, z: 0 }, { x: size / 4, y: 0, z: 0 }, { x: 0, y: 0, z: size / 4 }].map(point => {
      const projected = viewport.projectPoint(point);
      return { x: (projected.x - width / 2) / height, y: (projected.y - height / 2) / height, visible: projected.visible };
    });
  }, size);
}

for (const size of [0.01, 1, 100]) {
  test(`${size}m camera survives named view, project file, autosave and projection restoration`, async ({ page }) => {
    await page.goto('./');
    const saved = await page.evaluate(size => {
      const { store, adapter } = (window as any).__viewer;
      (window as any).__initialCamera = structuredClone(store.getSnapshot().camera);
      store.update((draft: any) => {
        draft.objects[0].geometry = { type: 'box', width: size, height: size, depth: size };
        draft.objects[0].transform.position = { x: 0, y: 0, z: 0 };
        draft.objects[0].transform.rotationDegrees = { x: 0, y: 0, z: 0 };
        draft.objects.slice(1).forEach((object: any) => { object.visible = false; });
      });
      adapter.setStandardView('top');
      adapter.fitToObject(store.getSnapshot().objects[0].id);
      return structuredClone(store.getSnapshot().camera);
    }, size);
    await expect.poll(async () => (await renderedPoints(page, size)).every(point => point.visible)).toBe(true);
    const expected = await renderedPoints(page, size);
    const assertPose = async () => {
      await expect.poll(() => page.evaluate(() => (window as any).__viewer.store.getSnapshot().camera.near)).toBe(saved.near);
      await expect.poll(async () => {
        const actual = await renderedPoints(page, size);
        return actual.every((point, i) => point.visible && Math.abs(point.x - expected[i].x) < 1e-5 && Math.abs(point.y - expected[i].y) < 1e-5);
      }).toBe(true);
      const camera = await page.evaluate(() => (window as any).__viewer.store.getSnapshot().camera);
      expect(distance(camera) / distance(saved)).toBeCloseTo(1, 10);
    };

    await page.locator('.review-panel summary').click();
    await page.locator('[data-review=name]').fill(`Camera ${size}m`);
    await page.locator('[data-review=saveView]').click();
    const viewId = await page.evaluate(() => (window as any).__viewer.store.getSnapshot().review.views[0].id);
    await page.evaluate(() => {
      const { store, adapter } = (window as any).__viewer;
      adapter.resetCameraConstraints();
      store.update((draft: any) => { draft.camera = structuredClone((window as any).__initialCamera); }, { history: false });
    });
    await page.locator('[data-review=views]').selectOption(viewId);
    await page.locator('[data-review=apply]').click();
    await assertPose();
    await page.locator('.review-panel summary').click();

    const download = page.waitForEvent('download');
    await page.locator('[data-project-action=save]').click();
    const path = await (await download).path();
    await page.reload();
    await page.locator('[data-project-file]').setInputFiles(path!);
    await assertPose();

    const name = `Autosave camera ${size}m`;
    await page.evaluate(name => (window as any).__viewer.store.update((draft: any) => { draft.name = name; }), name);
    await expect.poll(() => page.evaluate(async () => {
      const { readAutosave } = await import('/Render-Viewer-3D/src/app/autosave.ts');
      const { decodeProject } = await import('/Render-Viewer-3D/src/app/project-format.ts');
      const blob = await readAutosave();
      return blob ? (await decodeProject(blob)).model.name : null;
    })).toBe(name);
    await page.reload();
    await page.locator('[data-project-action=recover]').click();
    await assertPose();

    await page.locator('.viewport-tools summary').click();
    for (const projection of ['orthographic', 'perspective']) {
      await page.locator('[data-vt=projection]').selectOption(projection);
      await assertPose();
    }
    await page.locator('.viewport-tools summary').click();
    const canvas = (await page.locator('.viewport-canvas').boundingBox())!;
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.mouse.wheel(0, 40);
    await expect.poll(() => page.evaluate(() => (window as any).__viewer.store.getSnapshot().camera.position)).not.toEqual(saved.position);
    const zoomed = await page.evaluate(() => (window as any).__viewer.store.getSnapshot().camera);
    expect(distance(zoomed) / distance(saved)).toBeGreaterThan(1);
    expect(distance(zoomed) / distance(saved)).toBeLessThan(1.25);
  });
}
