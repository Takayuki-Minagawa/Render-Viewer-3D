import { test, expect } from '@playwright/test';

test('object and material copies support undo, redo and project restore through the UI', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  await page.locator('[data-duplicate-object]').click();
  await expect(page.locator('[data-object-count]')).toHaveText('4');
  await page.locator('[data-project-action=undo]').click();
  await expect(page.locator('[data-object-count]')).toHaveText('3');
  await page.locator('[data-project-action=redo]').click();
  await expect(page.locator('[data-object-count]')).toHaveText('4');

  // Share another object's material, then explicitly make that assignment unique.
  await page.locator('[data-open-material-library]').click();
  const dialog = page.locator('[data-material-library-dialog]');
  const materials = dialog.locator('[data-material-select]');
  await expect(materials).toHaveCount(4);
  await dialog.locator('[data-material-select="sphere-01-material"]').click();
  await dialog.locator('[data-assign-material]').click();
  await dialog.locator('[data-make-material-unique]').click();
  await expect(materials).toHaveCount(5);
  await expect(dialog.locator('[data-make-material-unique]')).toBeDisabled();
  await dialog.locator('[data-duplicate-material]').click();
  await expect(materials).toHaveCount(6);
  await dialog.locator('.dialog-close').click();
  await page.locator('[data-project-action=undo]').click();
  await page.locator('[data-open-material-library]').click();
  await expect(materials).toHaveCount(5);
  await dialog.locator('.dialog-close').click();
  await page.locator('[data-project-action=redo]').click();

  const downloading = page.waitForEvent('download');
  await page.locator('[data-project-action=save]').click();
  const file = (await (await downloading).path())!;
  await page.reload();
  await page.locator('[data-project-file]').setInputFiles(file);
  await expect(page.locator('[data-object-count]')).toHaveText('4');
  await page.locator('[data-open-material-library]').click();
  await expect(materials).toHaveCount(6);
  expect(errors).toEqual([]);
});
