import { expect, test } from "@playwright/test";

test("B-006: Space toggles the same tree button twice and unrelated edits retain focus", async ({ page }) => {
  await page.goto("./");
  const visibility = page.locator("[data-object-visibility]").first();
  const original = await visibility.elementHandle();
  await visibility.focus();
  await page.keyboard.press("Space");
  await expect(visibility).toHaveAttribute("aria-pressed", "false");
  await expect(visibility).toBeFocused();
  await page.keyboard.press("Space");
  await expect(visibility).toHaveAttribute("aria-pressed", "true");
  await expect(visibility).toBeFocused();
  await page.evaluate(() => {
    (window as any).__viewer.store.update((scene: any) => {
      scene.objects[0].name = "Focused object renamed";
      scene.objects[1].name = "Another object renamed";
      scene.objects[1].visible = false;
    });
  });
  await expect(visibility).toHaveAttribute("aria-label", /Focused object renamed/);
  await expect(visibility).toBeFocused();
  expect(await original!.evaluate((element) => element === document.activeElement && element.isConnected)).toBe(true);
});

test("B-006: imported root and child controls survive visibility and naming changes", async ({ page }) => {
  await page.goto("./");
  await page.locator("[data-import-file-input]").setInputFiles({
    name: "focus-parts.obj", mimeType: "text/plain",
    buffer: Buffer.from("o PartA\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\no PartB\nv 2 0 0\nv 3 0 0\nv 2 1 0\nf 4 5 6\n"),
  });
  const visibility = page.locator(".tree-import-root [data-object-visibility]");
  await visibility.focus();
  await page.keyboard.press("Space");
  await expect(visibility).toHaveAttribute("aria-pressed", "false");
  await expect(visibility).toBeFocused();
  await page.keyboard.press("Space");
  await expect(visibility).toHaveAttribute("aria-pressed", "true");
  await expect(visibility).toBeFocused();
  const child = page.locator("[data-imported-node-select]").filter({ hasText: "PartB" });
  await child.click();
  const original = await child.elementHandle();
  await page.evaluate(() => {
    (window as any).__viewer.store.update((scene: any) => {
      scene.imports[0].name = "Renamed import";
      scene.imports[0].visible = false;
      scene.objects[0].name = "Renamed neighbor";
    });
  });
  await expect(child).toHaveAttribute("aria-label", /Renamed import \/ PartB/);
  await expect(child).toHaveAttribute("aria-current", "true");
  await expect(child).toBeFocused();
  expect(await original!.evaluate((element) => element === document.activeElement && element.isConnected)).toBe(true);
});

test("B-006: deleting focused rows moves focus next, previous, then to the empty state", async ({ page }) => {
  await page.goto("./");
  const roots = page.locator("[data-object-list] > .tree-item > [data-object-select]");
  const ids = await roots.evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).dataset.objectSelect));
  await roots.nth(1).click();
  await page.keyboard.press("Delete");
  await expect(roots).toHaveCount(2);
  await expect(page.locator(`[data-object-select="${ids[2]}"]`)).toBeFocused();
  // Activate the adjacent control before the next deletion.
  await page.keyboard.press("Space");
  await page.keyboard.press("Delete");
  await expect(roots).toHaveCount(1);
  await expect(page.locator(`[data-object-select="${ids[0]}"]`)).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("Delete");
  await expect(roots).toHaveCount(0);
  await expect(page.locator("[data-object-list] .tree-empty")).toBeFocused();
});
