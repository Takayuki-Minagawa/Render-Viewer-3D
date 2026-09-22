import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("STEP assembly Worker preserves part edits and placements through project restore", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("./");
  const requests: string[] = [];
  page.on("request", request => requests.push(request.url()));
  const source = await readFile(new URL("../fixtures/step/colored-nested-assembly.step", import.meta.url));
  await page.locator("[data-import-file-input]").setInputFiles({ name: "assembly.step", mimeType: "model/step", buffer: source });
  await expect(page.locator(".imported-node-tools")).toBeVisible();
  const redId = await page.evaluate(() => {
    const viewer = (window as any).__viewer;
    const imported = viewer.store.getSnapshot().imports[0];
    let id = "";
    const walk = (nodes: any[]) => { for (const node of nodes) { if (node.name === "Red part") id = node.id; walk(node.children); } };
    walk(imported.hierarchy);
    return id;
  });
  expect(redId).not.toBe("");
  await page.locator(`[data-imported-node-select="${redId}"]`).click();
  const material = page.locator("[data-node-tool=material]");
  const materialId = await material.locator("option").nth(1).getAttribute("value");
  await material.selectOption(materialId!);
  await page.locator("[data-node-tool=isolate]").click();
  const before = await snapshot();
  expect(before.triangles).toBe(36);
  expect(before.mode).toBe("assembly");
  expect(before.names).toEqual(expect.arrayContaining(["Assembly", "Nested assembly", "Red part", "Blue part", "Repeated red part"]));
  expect(before.isolated).toBe(redId);
  expect(before.overrides[redId].materialId).toBe(materialId);
  const downloading = page.waitForEvent("download");
  await page.locator('[data-project-action="save"]').click();
  const projectPath = await (await downloading).path();
  await page.reload();
  await page.locator("[data-project-file]").setInputFiles(projectPath!);
  await expect.poll(() => page.evaluate(() => (window as any).__viewer.store.getSnapshot().imports.length)).toBe(1);
  expect(await snapshot()).toEqual(before);
  expect(requests.some(url => /step-worker-entry/u.test(url))).toBe(true);
  expect(requests.filter(url => /^https?:/u.test(url)).every(url => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  expect(errors).toEqual([]);

  async function snapshot() {
    return page.evaluate(() => {
      const viewer = (window as any).__viewer;
      const imported = viewer.store.getSnapshot().imports[0];
      const root = viewer.importedAssets.get(imported.assetId).sourceRoot;
      root.updateMatrixWorld(true);
      const names: string[] = [];
      const parts: unknown[] = [];
      root.traverse((node: any) => {
        names.push(node.name);
        if (["Red part", "Blue part", "Repeated red part"].includes(node.name)) {
          parts.push({ name: node.name, visible: node.visible, matrix: node.matrixWorld.elements });
        }
      });
      return { names, parts, triangles: imported.metadata.triangleCount, isolated: imported.isolatedNodeId, overrides: imported.nodeOverrides, mode: viewer.projectAssets.imports.get(imported.assetId).options.stepStructure };
    });
  }
});
