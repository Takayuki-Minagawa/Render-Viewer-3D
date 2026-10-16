import { test, expect } from "@playwright/test";

test("concept search retains its caret for insertion, selection replacement, and composition events", async ({ page }) => {
  await page.goto("./");
  await page.locator("[data-open-material-library]").click();
  await page.locator('[data-material-tab="advanced"]').click();
  const search = page.locator("[data-material-capability-search]");
  const original = await search.elementHandle();
  await search.fill("rough");
  await search.press("Home");
  await search.pressSequentially("ab");
  await expect(search).toHaveValue("abrough");
  await expect(search).toBeFocused();

  await search.fill("rough");
  await search.press("Home");
  await search.press("ArrowRight");
  await search.press("ArrowRight");
  await search.pressSequentially("XY");
  await expect(search).toHaveValue("roXYugh");
  await search.evaluate((input: HTMLInputElement) => input.setSelectionRange(2, 4, "backward"));
  await search.pressSequentially("ZQ");
  await expect(search).toHaveValue("roZQugh");
  expect(await search.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([4, 4]);
  expect(await original!.evaluate((input) => input.isConnected)).toBe(true);

  const support = page.locator("[data-material-capability-support]");
  await support.focus();
  await support.selectOption("direct");
  await expect(support).toBeFocused();
  expect(await original!.evaluate((input) => input.isConnected)).toBe(true);

  await search.fill("");
  // Synthetic composition checks DOM/session preservation; native OS IME is not
  // emulated by Playwright's keyboard API.
  const composition = await search.evaluate((input: HTMLInputElement) => {
    const events: string[] = [];
    for (const event of ["compositionstart", "compositionupdate", "compositionend"]) {
      input.addEventListener(event, () => events.push(event), { once: true });
    }
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    const preserved = [];
    for (const value of ["あ", "粗さ"]) {
      input.value = value;
      input.setSelectionRange(value.length, value.length);
      input.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: value }));
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertCompositionText", isComposing: true }));
      preserved.push(input.isConnected && document.activeElement === input && input.selectionStart === value.length);
    }
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "粗さ" }));
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "粗さ", inputType: "insertText", isComposing: false }));
    return { preserved, events };
  });
  expect(composition).toEqual({ preserved: [true, true], events: ["compositionstart", "compositionupdate", "compositionend"] });
  await expect(search).toHaveValue("粗さ");
  await expect(search).toBeFocused();
  await expect(page.locator(".material-capability-groups")).toContainText("preview.roughness");
});

test("primitive inspector and library count imported root and node material assignments consistently", async ({ page }) => {
  await page.goto("./");
  const materialId = "box-01-material";
  const obj = "o PartA\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\no PartB\nv 2 0 0\nv 3 0 0\nv 2 1 0\nf 4 5 6\n";
  await page.locator("[data-import-file-input]").setInputFiles({ name: "parts.obj", mimeType: "text/plain", buffer: Buffer.from(obj) });
  await expect(page.locator(".imported-node-tools")).toBeVisible();
  await page.locator('[data-import-material-mode][value="custom"]').check();
  await page.locator("[data-import-material-select]").selectOption(materialId);
  const part = page.locator("[data-imported-node-select]").filter({ hasText: "PartB" });
  await part.click();
  await page.locator("[data-node-tool=material]").selectOption(materialId);
  await page.locator('[data-object-select="box-01"]').click();
  await expect(page.locator("[data-inspector-material-meta]")).toContainText("使用中 3");
  await page.locator("[data-open-material-library]").click();
  await expect(page.locator(`[data-material-select="${materialId}"] small`)).toContainText("使用中 3");
  await expect(page.locator("#material-usage-note")).toContainText("使用中 3");
  await page.locator("[data-material-library-dialog] .dialog-close").click();

  // Undo removes the last node assignment while retaining root sharing; the
  // currently selected primitive's inspector must synchronize without rebuild.
  await page.locator('[data-project-action="undo"]').click();
  await expect(page.locator("[data-inspector-material-meta]")).toContainText("使用中 2");
  await page.locator('[data-project-action="redo"]').click();
  await expect(page.locator("[data-inspector-material-meta]")).toContainText("使用中 3");
});
