import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";

test("PBR image UI decodes numeric channels, supports Undo, and restores them with a real STEP model", async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.createImageBitmap.bind(window);
    (window as any).__bitmapModes = [];
    window.createImageBitmap = ((...args: any[]) => {
      (window as any).__bitmapModes.push(args.at(-1)?.colorSpaceConversion);
      return (original as any)(...args);
    }) as typeof createImageBitmap;
  });
  await page.goto("./");
  await page.locator(".material-map-tools summary").click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 2; canvas.height = 2;
    const context = canvas.getContext("2d")!; context.fillStyle = "rgb(128,128,255)"; context.fillRect(0,0,2,2);
    return canvas.toDataURL().split(",")[1];
  });
  for (const channel of ["normal", "roughness", "metalness", "ao"]) {
    await page.locator('[data-pbr="channel"]').selectOption(channel);
    await page.locator('[data-pbr="file"]').setInputFiles({ name: `${channel}.png`, mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    await expect(page.locator('[data-pbr="status"]')).toHaveText("画像を設定しました");
    await expect(page.locator('[data-pbr="source"]')).toContainText(`${channel}.png`);
  }
  expect(await page.evaluate(() => (window as any).__bitmapModes)).toEqual(["none", "none", "none", "none"]);
  await page.locator('[data-pbr="repeatX"]').fill("2.5"); await page.locator('[data-pbr="repeatX"]').press("Tab");
  await page.locator('[data-pbr="remove"]').click();
  await expect(page.locator('[data-pbr="source"]')).toHaveText("画像なし");
  await page.locator('[data-project-action="undo"]').click();
  await expect(page.locator('[data-pbr="source"]')).toContainText("ao.png");
  await expect(page.locator('[data-pbr="repeatX"]')).toHaveValue("2.5");
  await page.locator('[data-import-file-input]').setInputFiles(fileURLToPath(new URL("../fixtures/step/box-10x20x30mm.step", import.meta.url)));
  await expect.poll(() => page.evaluate(() => (window as any).__viewer.store.getSnapshot().imports.length)).toBe(1);
  const downloadEvent = page.waitForEvent("download");
  await page.locator('[data-project-action="save"]').click();
  const saved = await (await downloadEvent).path();
  await page.reload();
  await page.locator('[data-project-file]').setInputFiles(saved!);
  await expect(page.locator('[data-project-status]')).toContainText(/復元|保存済み/);
  const restored = await page.evaluate(() => {
    const viewer = (window as any).__viewer;
    const scene = viewer.store.getSnapshot(); const maps = scene.materials[0].maps;
    return { modes: (window as any).__bitmapModes, names: Object.keys(maps), repeat: maps.ao.repeatX,
      images: Object.values(maps).every((map: any) => !!viewer.materialImages.sourceFile(map.assetId)),
      format: scene.imports[0].format, runtime: !!viewer.importedAssets.get(scene.imports[0].assetId) };
  });
  expect(restored).toEqual({ modes: ["none", "none", "none", "none"], names: ["normal", "roughness", "metalness", "ao"], repeat: 2.5, images: true, format: "STEP", runtime: true });
});
